import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");

test("dated vehicle photos appear first, newest before oldest", () => {
  const start = source.indexOf("function getPhotoEntrySuffixOrder(entry)");
  const end = source.indexOf("function syncVehiclePhotoEntryMeta(entry)", start);
  assert.ok(start >= 0 && end > start);
  const context = {
    cleanText: (value) => String(value || "").trim(),
    parseFlexibleDateParts: () => null
  };
  vm.runInNewContext(source.slice(start, end), context);
  const entries = [
    { src: "/undated.jpeg", metaFields: { maker: "@photographer", date: "" } },
    { src: "/older.jpeg", metaFields: { maker: "", date: "2025:01:02" } },
    { src: "/newer.jpeg", metaFields: { maker: "", date: "2026:03:04" } }
  ];
  const sorted = Array.from(context.sortVehiclePhotoEntries(entries), (entry) => entry.src);
  assert.deepEqual(sorted, ["/newer.jpeg", "/older.jpeg", "/undated.jpeg"]);
});

test("vehicle photo resolution loads metadata before sorting the collection", async () => {
  const start = source.indexOf("async function resolveVehiclePhotoEntries(vehicleId)");
  const end = source.indexOf("function buildVehiclePhotoCopy(entry, vehicleId)", start);
  assert.ok(start >= 0 && end > start);
  const entries = [
    { src: "/undated.jpeg" },
    { src: "/dated.jpeg" }
  ];
  const context = {
    getIndexedPhotoEntries: () => entries,
    enrichResolvedPhotoEntry: async (entry) => {
      entry.dateSortTimestamp = entry.src === "/dated.jpeg"
        ? Date.UTC(2026, 0, 1)
        : Number.NaN;
    },
    sortVehiclePhotoEntries: (photos) => [...photos].sort((a, b) =>
      (Number.isFinite(b.dateSortTimestamp) ? b.dateSortTimestamp : Number.NEGATIVE_INFINITY) -
      (Number.isFinite(a.dateSortTimestamp) ? a.dateSortTimestamp : Number.NEGATIVE_INFINITY)
    )
  };
  vm.runInNewContext(source.slice(start, end), context);
  const resolved = await context.resolveVehiclePhotoEntries("1234");
  assert.deepEqual(Array.from(resolved, (entry) => entry.src), ["/dated.jpeg", "/undated.jpeg"]);
});

test("downloads honor the confirmed photographer allowlist", () => {
  const start = source.indexOf("const PHOTO_DOWNLOAD_ALLOWED_MAKERS = new Set(");
  const end = source.indexOf("function getVehiclePhotoAliases(vehicleId)", start);
  assert.ok(start >= 0 && end > start);
  const context = { cleanText: (value) => String(value || "").trim() };
  vm.runInNewContext(source.slice(start, end), context);
  assert.equal(context.isVehiclePhotoDownloadAllowed({ metaFields: { maker: "@delijn_busspotter" } }), true);
  assert.equal(context.isVehiclePhotoDownloadAllowed({ metaFields: { maker: "@other_photographer" } }), false);
  assert.equal(context.isVehiclePhotoDownloadAllowed({ metaFields: { maker: "" } }), false);
});

test("adding a photo fills an empty widget slot, replaces the same vehicle, and respects the limit", () => {
  const start = source.indexOf("function buildPhotoWidgetChoicesWithEntry(");
  const end = source.indexOf("function updateVehiclePhotoActionLabels()", start);
  assert.ok(start >= 0 && end > start);
  const context = {};
  vm.runInNewContext(source.slice(start, end), context);
  const choices = [
    { id: "1001", src: "/1001-old.jpeg" },
    { id: "", src: "" },
    { id: "1002", src: "/1002.jpeg" }
  ];
  const added = JSON.parse(JSON.stringify(
    context.buildPhotoWidgetChoicesWithEntry(choices, "1003", "/1003.jpeg")
  ));
  assert.deepEqual(added[1], { id: "1003", src: "/1003.jpeg" });
  const replaced = JSON.parse(JSON.stringify(
    context.buildPhotoWidgetChoicesWithEntry(choices, "1001", "/1001-new.jpeg")
  ));
  assert.deepEqual(replaced[0], { id: "1001", src: "/1001-new.jpeg" });
  assert.equal(
    context.buildPhotoWidgetChoicesWithEntry(
      choices.map((choice, index) => ({ ...choice, id: choice.id || `fill-${index}`, src: choice.src || "/filled.jpeg" })),
      "1004",
      "/1004.jpeg"
    ),
    null
  );
});
