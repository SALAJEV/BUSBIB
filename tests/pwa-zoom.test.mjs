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
