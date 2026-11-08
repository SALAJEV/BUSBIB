import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../functions/photo-upload.js", import.meta.url));
const { onRequest } = await import(`data:text/javascript;base64,${source.toString("base64")}`);
const origin = "https://busbib.be";

function makeRequest(options = {}) {
  const form = new FormData();
  form.set("photo", new File(
    [options.bytes || new Uint8Array([0xff, 0xd8, 0xff, 0])],
    "photo.jpg",
    { type: options.type || "image/jpeg" }
  ));
  form.set("vehicle", "1234");
  form.set("photographer", "Test Photographer");
  if (!options.noConsent) form.set("consent", "yes");
  form.set("cf-turnstile-response", "token");
  return new Request(`${origin}/photo-upload`, {
    method: "POST",
    headers: { Origin: options.origin || origin },
    body: form
  });
}

test("photo uploads require valid input, consent and verified Turnstile", async () => {
  let saved;
  const env = {
    TURNSTILE_SECRET: "test-secret",
    PHOTO_UPLOADS: { put: async (...args) => { saved = args; } }
  };
  const originalFetch = globalThis.fetch;
  let verification = { success: true, hostname: "busbib.be" };
  globalThis.fetch = async () => Response.json(verification);
  try {
    assert.equal((await onRequest({ request: new Request(`${origin}/photo-upload`), env })).status, 405);
    assert.equal((await onRequest({ request: makeRequest(), env: {} })).status, 503);
    assert.equal((await onRequest({ request: makeRequest({ origin: "https://example.com" }), env })).status, 403);
    assert.equal((await onRequest({ request: makeRequest({ noConsent: true }), env })).status, 400);
    assert.equal((await onRequest({ request: makeRequest({ bytes: new Uint8Array([1, 2, 3]) }), env })).status, 400);
    assert.equal((await onRequest({ request: makeRequest({ bytes: new Uint8Array(8 * 1024 * 1024 + 1) }), env })).status, 413);
    verification = { success: false };
    assert.equal((await onRequest({ request: makeRequest(), env })).status, 403);
    verification = { success: true, hostname: "example.com" };
    assert.equal((await onRequest({ request: makeRequest(), env })).status, 403);
    assert.equal(saved, undefined);
    verification = { success: true, hostname: "busbib.be" };
    assert.equal((await onRequest({ request: makeRequest(), env })).status, 201);
    assert.match(saved[0], /^pending\/\d{4}-\d{2}-\d{2}\/.+\.jpg$/);
    assert.equal(decodeURIComponent(saved[2].customMetadata.vehicle), "1234");
    assert.equal(decodeURIComponent(saved[2].customMetadata.photographer), "Test Photographer");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
