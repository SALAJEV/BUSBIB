const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_BODY_BYTES = MAX_FILE_BYTES + 128 * 1024;
const HEADERS = { "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "no-store" };

function respond(error, status) {
  return new Response(JSON.stringify(error ? { error } : { ok: true }), { status, headers: HEADERS });
}

async function readLimitedBody(request) {
  if (!request.body) throw new Error("empty");
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error("too-large");
    }
    chunks.push(value);
  }
  return new Blob(chunks);
}

function detectImageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return "image/png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return "";
}

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return respond("method", 405);
  if (!env.PHOTO_UPLOADS || !env.TURNSTILE_SECRET) return respond("unavailable", 503);
  const url = new URL(request.url);
  if (request.headers.get("Origin") !== url.origin) return respond("origin", 403);
  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("multipart/form-data;")) return respond("format", 400);
  const length = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return respond("size", 413);

  let form;
  try {
    const body = await readLimitedBody(request);
    form = await new Request(request.url, { method: "POST", headers: { "Content-Type": request.headers.get("Content-Type") }, body }).formData();
  } catch (error) {
    return respond(error.message === "too-large" ? "size" : "format", error.message === "too-large" ? 413 : 400);
  }
  const photo = form.get("photo");
  const vehicle = form.get("vehicle");
  const photographer = form.get("photographer");
  const consent = form.get("consent");
  const token = form.get("cf-turnstile-response");
  if (photo instanceof File && photo.size > MAX_FILE_BYTES) return respond("size", 413);
  if (!(photo instanceof File) || !photo.size ||
      typeof vehicle !== "string" || !/^[a-zA-Z0-9 -]{1,30}$/.test(vehicle.trim()) ||
      typeof photographer !== "string" || photographer.trim().length < 2 || photographer.trim().length > 100 ||
      consent !== "yes" || typeof token !== "string" || !token || token.length > 2048) {
    return respond("invalid", 400);
  }
  const bytes = new Uint8Array(await photo.slice(0, 12).arrayBuffer());
  const imageType = detectImageType(bytes);
  if (!imageType || photo.type !== imageType) return respond("image", 400);

  try {
    const verify = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token }),
      signal: AbortSignal.timeout(10000)
    });
    if (!verify.ok) return respond("verification", 503);
    const result = await verify.json();
    if (!result.success || result.hostname !== url.hostname) return respond("verification", 403);
    const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[imageType];
    const key = `pending/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
    await env.PHOTO_UPLOADS.put(key, await photo.arrayBuffer(), {
      httpMetadata: { contentType: imageType },
      customMetadata: {
        vehicle: encodeURIComponent(vehicle.trim()),
        photographer: encodeURIComponent(photographer.trim()),
        consent: "yes"
      }
    });
    return respond("", 201);
  } catch (error) {
    console.error("Foto insturen mislukt", error);
    return respond("unavailable", 503);
  }
}
