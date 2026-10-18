const DATA_ORIGIN = "https://pub-611b5bc156eb455ba86d9bcece9aea1c.r2.dev";
const ALLOWED_DATA_FILES = new Set([
  "feed_info.txt",
  "routes.txt",
  "stops.txt",
  "trips.txt",
  "vehicles.txt"
]);
const UPSTREAM_TIMEOUT_MS = 8000;

export async function onRequest({ request, params }) {
  if (request.method !== "GET") {
    return new Response("Methode niet toegestaan", {
      status: 405,
      headers: { Allow: "GET", "Cache-Control": "no-store" }
    });
  }

  const filename = params?.filename;
  if (typeof filename !== "string" || !ALLOWED_DATA_FILES.has(filename)) {
    return new Response("Onbekend databestand", {
      status: 404,
      headers: { "Cache-Control": "no-store" }
    });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstreamResponse = await fetch(`${DATA_ORIGIN}/${filename}`, {
      signal: controller.signal,
      cf: { cacheTtl: 300, cacheEverything: true }
    });

    if (!upstreamResponse.ok) {
      console.error(`Data-ophaalverzoek voor ${filename} gaf HTTP ${upstreamResponse.status}`);
      return new Response(`Databestand tijdelijk niet beschikbaar (${upstreamResponse.status})`, {
        status: 502,
        headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=UTF-8" }
      });
    }

    return new Response(upstreamResponse.body, {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=300",
        "Content-Type": "text/plain; charset=UTF-8"
      }
    });
  } catch (error) {
    console.error(`Databestand ${filename} kon niet worden opgehaald`, error);
    return new Response("Databestand tijdelijk niet beschikbaar", {
      status: 502,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=UTF-8" }
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
