import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function createWorker() {
  const handlers = {};
  const stores = new Map();
  const keyOf = (request) => typeof request === "string" ? new URL(request, "https://busbib.test").href : request.url;
  const caches = {
    async open(name) {
      if (!stores.has(name)) {
        const values = new Map();
        stores.set(name, {
          async put(request, response) { values.set(keyOf(request), response.clone()); },
          async match(request) { return values.get(keyOf(request))?.clone(); },
          async keys() { return [...values.keys()].map((key) => new Request(key)); },
          async delete(request) { return values.delete(keyOf(request)); }
        });
      }
      return stores.get(name);
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async match(request) {
      for (const cache of stores.values()) {
        const result = await cache.match(request);
        if (result) return result;
      }
    }
  };
  let fetchCount = 0;
  const context = {
    URL, Request, Response, console, setTimeout, clearTimeout, caches,
    fetch: async () => {
      fetchCount++;
      return new Response("photo", { headers: { "content-type": "image/jpeg", "content-length": "5" } });
    },
    self: {
      location: { href: "https://busbib.test/", origin: "https://busbib.test", hostname: "busbib.test" },
      addEventListener(type, handler) { handlers[type] = handler; },
      registration: {},
      clients: { claim: async () => {} }
    }
  };
  vm.runInNewContext(await readFile(new URL("../sw.js", import.meta.url), "utf8"), context);
  async function request(url, options = {}) {
    const waits = [];
    let response;
    handlers.fetch({
      request: new Request(url, options),
      respondWith(value) { response = Promise.resolve(value); },
      waitUntil(value) { waits.push(Promise.resolve(value)); }
    });
    if (response) await response;
    await Promise.all(waits);
    return response;
  }
  return { request, caches, handlers, fetchCount: () => fetchCount };
}

test("photo cache is bounded and versioned URLs share one entry", async () => {
  const worker = await createWorker();
  await Promise.all(Array.from({ length: 20 }, (_, i) =>
    worker.request(`https://busbib.test/media/bus/photo${i}.jpeg?v=1`)
  ));
  const cache = await worker.caches.open("busbib-photos-v2");
  const keys = await cache.keys();
  assert.equal(keys.length, 16);
  assert.ok(keys.every((key) => !new URL(key.url).search));
  const fetchCount = worker.fetchCount();
  await worker.request(`${keys[0].url}?v=2`);
  assert.equal(worker.fetchCount(), fetchCount);
  assert.equal((await cache.keys()).length, 16);
});

test("versioned shell assets are served without a network request", async () => {
  const worker = await createWorker();
  const cache = await worker.caches.open("busbib-v247");
  await cache.put("https://busbib.test/app.js?v=20261108-31", new Response("cached"));
  const response = await worker.request("https://busbib.test/app.js?v=20261108-31");
  assert.equal(await (await response).text(), "cached");
  assert.equal(worker.fetchCount(), 0);
});

test("external tiles and range requests bypass service-worker caching", async () => {
  const worker = await createWorker();
  assert.equal(await worker.request("https://tile.memomaps.de/tilegen/1/1/1.png"), undefined);
  assert.equal(await worker.request("https://busbib.test/media/bus/a.jpeg", { headers: { range: "bytes=0-9" } }), undefined);
  assert.deepEqual(await worker.caches.keys(), []);
});

test("activation removes old BUSBIB caches without touching other applications", async () => {
  const worker = await createWorker();
  for (const name of ["busbib-v246", "busbib-photos-v1", "busbib-v247", "busbib-photos-v2", "other-app"]) {
    await worker.caches.open(name);
  }
  let activation;
  worker.handlers.activate({ waitUntil(value) { activation = value; } });
  await activation;
  assert.deepEqual((await worker.caches.keys()).sort(), ["busbib-photos-v2", "busbib-v247", "other-app"].sort());
});
