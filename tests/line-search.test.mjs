import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("line search matches line codes, route IDs, numbers and destinations", async () => {
  const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const start = source.indexOf("function getLineSearchTerms(");
  const end = source.indexOf("function getLineSearchBadgeMarkup(", start);
  assert.ok(start >= 0 && end > start);
  const context = {
    routes: [
      { route_id: "54051_2026", route_short_name: "95", route_long_name: "Brussel" },
      { route_id: "54052_2026", route_short_name: "95", route_long_name: "Gent" },
      { route_id: "55410", route_short_name: "410", route_long_name: "Antwerpen" }
    ],
    trips: [],
    lineSearchRouteIndex: null,
    cleanText: (value) => String(value || "").trim(),
    normalizeLookup: (value) => String(value || "").trim().toLowerCase(),
    normalizeSearchText: (value) => String(value || "").trim().toLowerCase(),
    getRouteKey: (value) => String(value || "").split("_")[0]
  };
  vm.runInNewContext(source.slice(start, end), context);
  const ids = (query) => Array.from(context.findLineSearchRoutes(query), (route) => route.route_id);
  assert.deepEqual(ids("54051"), ["54051_2026"]);
  assert.deepEqual(ids("5405"), ["54051_2026", "54052_2026"]);
  assert.deepEqual(ids("55410"), ["55410"]);
  assert.deepEqual(ids("54053"), []);
  assert.deepEqual(ids("95"), ["54051_2026", "54052_2026"]);
  assert.deepEqual(ids("Brussel"), ["54051_2026"]);
});
