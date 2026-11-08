import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const source = await readFile(new URL("../functions/photo-upload.js", import.meta.url));
const { onRequest } = await import(`data:text/javascript;base64,${source.toString("base64")}`);
const origin = "https://busbib.be";
const schema = await readFile(new URL("../functions/photo-upload-quota.sql", import.meta.url), "utf8");

function createQuota() {
  const db = new DatabaseSync(":memory:");
  db.exec(schema);
  return {
    db,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() { return db.prepare(sql).run(...args); },
            async first() { return db.prepare(sql).get(...args) || null; }
          };
        }
      };
    }
  };
}

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
    headers: { Origin: options.origin || origin, "CF-Connecting-IP": options.ip || "192.0.2.1" },
    body: form
  });
}

test("photo uploads require valid input, consent and verified Turnstile", async () => {
  let saved;
  const env = {
    TURNSTILE_SECRET: "test-secret",
    PHOTO_UPLOAD_QUOTA_SECRET: "quota-test-secret",
    PHOTO_UPLOAD_QUOTA: createQuota(),
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
    const row = env.PHOTO_UPLOAD_QUOTA.db.prepare("SELECT * FROM photo_upload_quota").get();
    assert.equal(row.bytes, 4);
    assert.match(row.ip_hash, /^[a-f0-9]{64}$/);
    assert.notEqual(row.ip_hash, "192.0.2.1");
  } finally {
    globalThis.fetch = originalFetch;
    env.PHOTO_UPLOAD_QUOTA.db.close();
  }
});

test("monthly quota is enforced atomically per IP and resets for a new month", async () => {
  const quota = createQuota();
  const env = {
    TURNSTILE_SECRET: "test-secret",
    PHOTO_UPLOAD_QUOTA_SECRET: "quota-test-secret",
    PHOTO_UPLOAD_QUOTA: quota,
    PHOTO_UPLOADS: { put: async () => {} }
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "busbib.be" });
  try {
    assert.equal((await onRequest({ request: makeRequest(), env })).status, 201);
    quota.db.prepare("UPDATE photo_upload_quota SET bytes = ?").run(500000000 - 4);
    const results = await Promise.all([
      onRequest({ request: makeRequest(), env }),
      onRequest({ request: makeRequest(), env })
    ]);
    assert.deepEqual(results.map(result => result.status).sort(), [201, 429]);
    const denied = results.find(result => result.status === 429);
    assert.equal(denied.headers.get("X-Photo-Upload-Error"), "monthly-limit");
    assert.equal((await denied.json()).error, "monthly-limit");
    assert.equal(quota.db.prepare("SELECT bytes FROM photo_upload_quota").get().bytes, 500000000);
    assert.equal((await onRequest({ request: makeRequest({ ip: "192.0.2.2" }), env })).status, 201);
    quota.db.prepare("UPDATE photo_upload_quota SET month = '2000-01'").run();
    assert.equal((await onRequest({ request: makeRequest(), env })).status, 201);
    assert.equal(quota.db.prepare("SELECT COUNT(*) AS count FROM photo_upload_quota").get().count, 1);
    assert.equal(quota.db.prepare("SELECT bytes FROM photo_upload_quota").get().bytes, 4);
  } finally {
    globalThis.fetch = originalFetch;
    quota.db.close();
  }
});

test("failed storage releases reserved quota and missing quota configuration fails closed", async () => {
  const quota = createQuota();
  const env = {
    TURNSTILE_SECRET: "test-secret",
    PHOTO_UPLOAD_QUOTA_SECRET: "quota-test-secret",
    PHOTO_UPLOAD_QUOTA: quota,
    PHOTO_UPLOADS: { put: async () => { throw new Error("storage failure"); } }
  };
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "busbib.be" });
  console.error = () => {};
  try {
    assert.equal((await onRequest({ request: makeRequest(), env: { ...env, PHOTO_UPLOAD_QUOTA: null } })).status, 503);
    assert.equal((await onRequest({ request: makeRequest(), env: { ...env, PHOTO_UPLOAD_QUOTA_SECRET: "" } })).status, 503);
    assert.equal((await onRequest({ request: makeRequest(), env })).status, 503);
    assert.equal(quota.db.prepare("SELECT bytes FROM photo_upload_quota").get().bytes, 0);
    const request = new Request(`${origin}/photo-upload`, { method: "POST", headers: { Origin: origin } });
    assert.equal((await onRequest({ request, env })).status, 503);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    quota.db.close();
  }
});

test("the 8 MiB file limit accepts the boundary and rejects one byte more", async () => {
  const quota = createQuota();
  const env = {
    TURNSTILE_SECRET: "test-secret",
    PHOTO_UPLOAD_QUOTA_SECRET: "quota-test-secret",
    PHOTO_UPLOAD_QUOTA: quota,
    PHOTO_UPLOADS: { put: async () => {} }
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "busbib.be" });
  try {
    const bytes = new Uint8Array(8 * 1024 * 1024);
    bytes.set([0xff, 0xd8, 0xff]);
    assert.equal((await onRequest({ request: makeRequest({ bytes }), env })).status, 201);
    const tooLarge = new Uint8Array(bytes.length + 1);
    tooLarge.set([0xff, 0xd8, 0xff]);
    assert.equal((await onRequest({ request: makeRequest({ bytes: tooLarge }), env })).status, 413);
    assert.equal(quota.db.prepare("SELECT bytes FROM photo_upload_quota").get().bytes, bytes.length);
  } finally {
    globalThis.fetch = originalFetch;
    quota.db.close();
  }
});

test("oversized request bodies are rejected even without Content-Length", async () => {
  const env = {
    TURNSTILE_SECRET: "test-secret",
    PHOTO_UPLOAD_QUOTA_SECRET: "quota-test-secret",
    PHOTO_UPLOAD_QUOTA: createQuota(),
    PHOTO_UPLOADS: { put: async () => { throw new Error("must not store"); } }
  };
  try {
    const request = new Request(`${origin}/photo-upload`, {
      method: "POST",
      headers: { Origin: origin, "CF-Connecting-IP": "192.0.2.1", "Content-Type": "multipart/form-data; boundary=test" },
      body: new Uint8Array(8 * 1024 * 1024 + 128 * 1024 + 1)
    });
    assert.equal(request.headers.get("Content-Length"), null);
    assert.equal((await onRequest({ request, env })).status, 413);
    assert.equal(env.PHOTO_UPLOAD_QUOTA.db.prepare("SELECT COUNT(*) AS count FROM photo_upload_quota").get().count, 0);
  } finally {
    env.PHOTO_UPLOAD_QUOTA.db.close();
  }
});
