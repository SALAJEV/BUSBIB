import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("phone app zoom is locked while browser, tablet and map zoom remain available", async () => {
  const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const start = source.indexOf("function shouldLockPhoneAppZoom()");
  const end = source.indexOf("function supportsEnhancedDialogs()", start);
  assert.ok(start >= 0 && end > start);
  class Element {
    constructor(map = false) { this.map = map; }
    closest(selector) { return selector === ".leaflet-container" && this.map ? this : null; }
  }
  let content = "";
  const context = {
    Element,
    document: { querySelector: () => ({ setAttribute: (_, value) => { content = value; } }) },
    isStandaloneDisplayMode: () => true,
    isIosPlatform: true,
    isAndroidPlatform: false,
    isAndroidTvPlatform: false,
    isTabletLikeViewport: () => false
  };
  vm.runInNewContext(source.slice(start, end), context);
  context.syncPhoneAppViewport();
  assert.match(content, /maximum-scale=1\.0, user-scalable=no/);
  const gesture = (type, map, count = 2) => ({
    type, target: new Element(map), touches: Array(count), cancelable: true,
    prevented: false, preventDefault() { this.prevented = true; }
  });
  const pinch = gesture("touchmove", false);
  context.preventPhoneAppPageZoom(pinch);
  assert.equal(pinch.prevented, true);
  const iosGesture = gesture("gesturestart", false);
  context.preventPhoneAppPageZoom(iosGesture);
  assert.equal(iosGesture.prevented, true);
  for (const event of [gesture("touchmove", true), gesture("gesturestart", true), gesture("touchmove", false, 1)]) {
    context.preventPhoneAppPageZoom(event);
    assert.equal(event.prevented, false);
  }
  for (const override of [
    { isStandaloneDisplayMode: () => false },
    { isTabletLikeViewport: () => true },
    { isIosPlatform: false, isAndroidPlatform: false },
    { isIosPlatform: false, isAndroidPlatform: true, isAndroidTvPlatform: true }
  ]) {
    const old = Object.fromEntries(Object.keys(override).map(key => [key, context[key]]));
    Object.assign(context, override);
    context.syncPhoneAppViewport();
    assert.doesNotMatch(content, /user-scalable=no/);
    const event = gesture("gesturechange", false);
    context.preventPhoneAppPageZoom(event);
    assert.equal(event.prevented, false);
    Object.assign(context, old);
  }
  context.isIosPlatform = false;
  context.isAndroidPlatform = true;
  context.syncPhoneAppViewport();
  assert.match(content, /user-scalable=no/);
});

test("vehicle card moves into fullscreen and returns to the page when fullscreen closes", async () => {
  const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const start = source.indexOf("function positionHomeGtfsVehicleCard()");
  const end = source.indexOf("function buildVehicleMapPopup(", start);
  assert.ok(start >= 0 && end > start);
  const classes = new Set();
  const classList = {
    contains: (name) => classes.has(name),
    toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
    remove: (name) => classes.delete(name)
  };
  const card = {
    hidden: false,
    _map: {
      getContainer: () => ({ getBoundingClientRect: () => ({ left: 10, top: 100 }) }),
      latLngToContainerPoint: () => ({ x: 200, y: 180 })
    },
    _anchorLatLng: [50, 4],
    offsetHeight: 120,
    classList,
    style: { setProperty() {} }
  };
  const body = { appendChild: (element) => { element.parentElement = body; } };
  const panelClasses = new Set();
  const panel = {
    classList: { contains: (name) => panelClasses.has(name) },
    appendChild: (element) => { element.parentElement = panel; }
  };
  card.parentElement = body;
  const context = {
    document: { getElementById: () => card, body, fullscreenElement: panel },
    window: { innerWidth: 390, innerHeight: 844 },
    homeGtfsMapPanelEl: panel
  };
  vm.runInNewContext(source.slice(start, end), context);
  context.positionHomeGtfsVehicleCard();
  assert.equal(card.parentElement, panel);
  assert.equal(classes.has("is-map-fullscreen-top"), true);

  context.document.fullscreenElement = null;
  panelClasses.add("map-fullscreen-fallback");
  context.positionHomeGtfsVehicleCard();
  assert.equal(card.parentElement, panel);
  assert.equal(classes.has("is-map-fullscreen-top"), true);

  panelClasses.clear();
  context.positionHomeGtfsVehicleCard();
  assert.equal(card.parentElement, body);
  assert.equal(classes.has("is-map-fullscreen-top"), false);
  assert.match(card.style.left, /^\d+px$/);
  assert.match(card.style.top, /^\d+px$/);
});

test("map fullscreen locks page scrolling and restores it on exit", async () => {
  const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const start = source.indexOf("function syncMapFullscreenPage()");
  const end = source.indexOf("function closeMapFullscreen(", start);
  assert.ok(start >= 0 && end > start);
  const htmlClasses = new Set();
  const bodyClasses = new Set();
  const makeClassList = (classes) => ({
    toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name)
  });
  let fallback = false;
  const context = {
    document: {
      querySelector: () => fallback ? {} : null,
      fullscreenElement: { querySelector: () => ({}) },
      documentElement: { classList: makeClassList(htmlClasses) },
      body: { classList: makeClassList(bodyClasses) }
    }
  };
  vm.runInNewContext(source.slice(start, end), context);
  context.syncMapFullscreenPage();
  assert.equal(htmlClasses.has("map-fullscreen-open"), true);
  assert.equal(bodyClasses.has("map-fullscreen-open"), true);
  context.document.fullscreenElement = null;
  fallback = true;
  context.syncMapFullscreenPage();
  assert.equal(htmlClasses.has("map-fullscreen-open"), true);
  fallback = false;
  context.syncMapFullscreenPage();
  assert.equal(htmlClasses.has("map-fullscreen-open"), false);
  assert.equal(bodyClasses.has("map-fullscreen-open"), false);
});

test("home map keeps its position on refresh and filter, but recenters when returning", async () => {
  const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const timers = [];
  const calls = [];
  const map = {
    center: null,
    zoom: 9,
    setView(center, zoom) { this.center = [...center]; this.zoom = zoom; calls.push([...center]); return this; },
    getZoom() { return this.zoom; },
    invalidateSize() {}
  };
  const markers = { addTo: () => markers, clearLayers() {}, addLayer() {} };
  const panel = { hidden: false, setAttribute() {} };
  const context = {
    homeGtfsMapPanelEl: panel,
    homeGtfsMapEl: {},
    homeGtfsMap: null,
    homeGtfsMapMarkers: null,
    HOME_GTFS_MAP_SNAPSHOT_BATCH_SIZE: 48,
    settings: { showHomeRealtimeMap: true },
    window: { setTimeout: (callback) => timers.push(callback) },
    ensureLeafletLoaded: async () => ({ map: () => map, layerGroup: () => markers }),
    getScrollFriendlyMapOptions: () => ({}),
    addPublicTransportTileLayer() {},
    addCurrentLocationControl() {},
    addMapFullscreenControl() {},
    closeMapFullscreen() {},
    closeHomeGtfsVehicleCard() {},
    getHomeGtfsCanvasLayerClass: () => null,
    homeMapModelFilterEl: null,
    homeGtfsMapSnapshots: [],
    updateOpenHomeGtfsMapVehicleCard() {},
    setHomeGtfsMapStatus() {},
    getLabel: (_key, fallback) => fallback,
    homeGtfsMapStarted: false,
    homeGtfsMapIsRefreshing: false,
    homeGtfsMapPausedByInactivity: false,
    homeGtfsMapRequestToken: 0,
    homeGtfsMapRefreshBtn: null,
    voertuigen: [{}],
    routes: [{}],
    stopsById: new Map([["stop", {}]]),
    fetchRealtimeFeed: async () => ({}),
    getRealtimeFeedDerivedData: () => ({ gpsEntityByVehicleId: new Map([["1", {}]]) }),
    getHomeGtfsMapSnapshot: () => ({ latitude: 51, longitude: 4, vehicleId: "1" }),
    updateHomeMapFilterOptions() {},
    trips: [{}],
    console
  };
  for (const name of ["HOME_GTFS_MAP_CENTER", "HOME_GTFS_MAP_ZOOM"]) {
    const declaration = source.match(new RegExp(`const ${name} = [^;]+;`));
    assert.ok(declaration);
    vm.runInNewContext(declaration[0], context);
  }
  for (const [start, end] of [
    ["function setHomeGtfsMapVisible(", "function addPublicTransportTileLayer("],
    ["async function initHomeGtfsMap(", "function updateMapFullscreenButton("],
    ["async function renderHomeGtfsMap(", "function getHomeMapModelKey("],
    ["async function applyHomeMapFilter(", "function redrawHomeGtfsMapMarkers("],
    ["async function refreshHomeGtfsMap(", "function startHomeGtfsMapRefresh("]
  ]) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from);
    assert.ok(from >= 0 && to > from);
    vm.runInNewContext(source.slice(from, to), context);
  }
  const flushTimers = () => { while (timers.length) timers.shift()(); };
  await context.refreshHomeGtfsMap();
  flushTimers();
  assert.deepEqual(map.center, [51.037861, 4.240528]);
  assert.equal(map.zoom, 9);

  map.setView([51.2, 4.5], 14);
  await context.refreshHomeGtfsMap();
  await context.refreshHomeGtfsMap({ force: true });
  await context.applyHomeMapFilter();
  context.setHomeGtfsMapVisible(true);
  flushTimers();
  assert.deepEqual(map.center, [51.2, 4.5]);
  assert.equal(map.zoom, 14);
  assert.equal(calls.length, 2);

  context.getRealtimeFeedDerivedData = () => ({ gpsEntityByVehicleId: new Map() });
  await context.refreshHomeGtfsMap();
  flushTimers();
  assert.deepEqual(map.center, [51.2, 4.5]);

  context.setHomeGtfsMapVisible(false);
  context.setHomeGtfsMapVisible(true);
  flushTimers();
  assert.deepEqual(map.center, [51.037861, 4.240528]);
  assert.equal(map.zoom, 14);
  assert.equal(calls.length, 3);
});
