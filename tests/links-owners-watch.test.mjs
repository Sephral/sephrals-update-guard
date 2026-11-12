import assert from "node:assert/strict";
import test from "node:test";

import {foundryPackagePage, githubTagApi, isPackageId, olderManifest, parseGithubManifest, safeHttpUrl,
  tagCandidates} from "../scripts/links.mjs";
import {ownerFromStack, ownerFromUrl, splitOwner, stackUrls} from "../scripts/owners.mjs";
import {OVERFLOW, WatchLog, clip, parseDeprecation} from "../scripts/watch-data.mjs";
import {findProblems, inRange} from "../scripts/problems.mjs";

test("safeHttpUrl only lets http and https through", () => {
  assert.equal(safeHttpUrl("https://example.com/a b"), "https://example.com/a%20b");
  assert.equal(safeHttpUrl("http://localhost:30000/x"), "http://localhost:30000/x");
  for ( const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<b>", "blob:http://a/b", "file:///etc/passwd",
    "//example.com", "example.com", "https://user:pw@example.com/", "", null, undefined, 5, {}, "https://" + "a".repeat(2100)] ) {
    assert.equal(safeHttpUrl(bad), "", String(bad).slice(0, 30));
  }
});

test("package ids are plain", () => {
  assert.equal(isPackageId("dnd5e"), true);
  assert.equal(isPackageId("lib-wrapper"), true);
  assert.equal(isPackageId("../etc"), false);
  assert.equal(isPackageId("a b"), false);
  assert.equal(isPackageId("a?b=1"), false);
  assert.equal(isPackageId(""), false);
});

test("older manifest addresses", () => {
  const latest = "https://github.com/Sephral/sephrals-saved-encounters/releases/latest/download/module.json";
  assert.deepEqual(parseGithubManifest(latest), {owner: "Sephral", repo: "sephrals-saved-encounters", file: "module.json", latest: true, tag: ""});
  const older = olderManifest(latest, "1.0.2", "1.0.1");
  assert.equal(older.url, "https://github.com/Sephral/sephrals-saved-encounters/releases/download/v1.0.1/module.json");
  assert.equal(older.kind, "github");
  const pinned = "https://github.com/a/b/releases/download/v2.0.0/module.json";
  assert.equal(olderManifest(pinned, "2.0.0", "1.9.0").url, "https://github.com/a/b/releases/download/v1.9.0/module.json");
  assert.equal(olderManifest("https://example.com/m/2.0.0/module.json", "2.0.0", "1.0.0").url, "https://example.com/m/1.0.0/module.json");
  assert.equal(olderManifest("https://example.com/module.json", "2.0.0", "1.0.0"), null);
  assert.equal(olderManifest("javascript:alert(1)", "2.0.0", "1.0.0"), null);
  assert.equal(olderManifest("", "2.0.0", "1.0.0"), null);
  assert.deepEqual(tagCandidates("1.2.3"), ["v1.2.3", "1.2.3", "release-1.2.3"]);
  assert.equal(githubTagApi("a", "b c", "v1"), "https://api.github.com/repos/a/b%20c/releases/tags/v1");
  assert.equal(foundryPackagePage("x y"), "https://foundryvtt.com/packages/x%20y");
});

test("owners from stacks, Chromium and Firefox format", () => {
  const chrome = [
    "Error: x",
    "    at probe (http://localhost:30000/modules/sephrals-update-guard/scripts/watch.mjs:10:5)",
    "    at logCompatibilityWarning (http://localhost:30000/scripts/foundry.mjs:1:1)",
    "    at ready (http://localhost:30000/modules/some-module/scripts/main.js:3:9)",
    "    at Hooks.callAll (http://localhost:30000/scripts/foundry.mjs:5:5)"
  ].join("\n");
  assert.equal(ownerFromStack(chrome, {ignore: ["module:sephrals-update-guard"]}), "module:some-module");
  assert.equal(ownerFromStack(chrome), "module:sephrals-update-guard");
  const firefox = "go@http://localhost:30000/systems/dnd5e/module/x.mjs:1:2\nfoo@http://localhost:30000/scripts/foundry.mjs:1:1";
  assert.deepEqual(stackUrls(firefox), ["http://localhost:30000/systems/dnd5e/module/x.mjs", "http://localhost:30000/scripts/foundry.mjs"]);
  assert.equal(ownerFromStack(firefox), "system:dnd5e");
  assert.equal(ownerFromStack("Error\n    at f (http://h/scripts/foundry.mjs:1:1)"), "core");
  assert.equal(ownerFromStack(""), "core");
  assert.equal(ownerFromUrl("http://h/prefix/modules/a-b/x.js"), "module:a-b");
  assert.equal(ownerFromUrl("chrome-extension://abc/x.js"), "extension");
  assert.deepEqual(splitOwner("module:x"), {kind: "module", id: "x"});
  assert.deepEqual(splitOwner("core"), {kind: "other", id: "core"});
});

test("a module that only passes the call on is not the owner while another package takes part", () => {
  const stack = [
    "Error",
    "    at wrapped (http://h/modules/lib-wrapper/shim.js:1:1)",
    "    at feature (http://h/modules/real-owner/main.js:1:1)",
    "    at x (http://h/scripts/foundry.mjs:1:1)"
  ].join("\n");
  assert.equal(ownerFromStack(stack), "module:real-owner");
  const only = "Error\n    at wrapped (http://h/modules/lib-wrapper/shim.js:1:1)\n    at x (http://h/scripts/foundry.mjs:1:1)";
  assert.equal(ownerFromStack(only), "module:lib-wrapper");
  // Foundry code called by a module: the module is the owner, not Foundry
  const viaCore = "Error\n    at core (http://h/scripts/foundry.mjs:1:1)\n    at mine (http://h/modules/m/a.js:1:1)\n    at core2 (http://h/scripts/foundry.mjs:1:1)";
  assert.equal(ownerFromStack(viaCore), "module:m");
});

test("WatchLog keeps counts and the first message and stays bounded", () => {
  const log = new WatchLog({ownerLimit: 3});
  log.addError("module:a", "error", "first\n   message");
  log.addError("module:a", "hook", "second");
  log.addError("module:b", "rejection", "x".repeat(1000));
  log.addError("module:c", "error", "c");
  log.addError("module:d", "error", "overflow 1");
  log.addError("module:e", "error", "overflow 2");
  assert.equal(log.errors.get("module:a").count, 2);
  assert.equal(log.errors.get("module:a").first.message, "first message");
  assert.deepEqual(log.errors.get("module:a").kinds, {error: 1, hook: 1});
  assert.equal(log.errors.get("module:b").first.message.length, 300);
  assert.equal(log.errors.size, 4);
  assert.equal(log.errors.get(OVERFLOW).count, 2);
  assert.equal(log.errorTotal(), 6);
  log.clear();
  assert.equal(log.errorTotal(), 0);
});

test("deprecation messages give the version of the removal", () => {
  const message = "foundry.utils.objectsEqual is deprecated.\nDeprecated since Version 14\nBackwards-compatible support will be removed in Version 16";
  assert.deepEqual(parseDeprecation(message), {text: "foundry.utils.objectsEqual is deprecated.", since: "14", until: "16"});
  const log = new WatchLog();
  log.addDeprecation("module:a", message);
  log.addDeprecation("module:a", message);
  log.addDeprecation("module:a", "other\nBackwards-compatible support will be removed in Version 15");
  const entry = log.deprecations.get("module:a");
  assert.equal(entry.count, 3);
  assert.deepEqual(entry.until, ["16", "15"]);
  assert.equal(log.deprecationTotal(), 3);
  assert.equal(clip(undefined), "");
});

const system = {id: "dnd5e", title: "D&D", version: "5.3.3", compat: {minimum: "13", verified: "13"}};
const m = (id, extra = {}) => ({id, title: id, version: "1.0.0", active: true, compat: {minimum: "13", verified: "14"},
  requires: [], systems: [], availability: null, ...extra});

test("findProblems: compatibility range, dependencies, systems and Foundry's status", () => {
  const modules = [
    m("fine"),
    m("tooold", {compat: {minimum: "13", verified: "13", maximum: "13"}}),
    m("toonew", {compat: {minimum: "15"}}),
    m("missing", {requires: [{id: "nothere", type: "module"}]}),
    m("inactive", {requires: [{id: "off", type: "module"}]}),
    m("off", {active: false}),
    m("range", {requires: [{id: "fine", type: "module", compat: {minimum: "2.0.0"}}]}),
    m("othersystem", {systems: [{id: "pf2e"}]}),
    m("systemrange", {systems: [{id: "dnd5e", compat: {minimum: "6.0.0"}}]}),
    m("needsystem", {requires: [{id: "pf2e", type: "system"}]}),
    m("status", {availability: "UNVERIFIED_GENERATION"}),
    m("note", {availability: "UNVERIFIED_BUILD"}),
    m("verified", {availability: "VERIFIED"}),
    m("disabled", {active: false, requires: [{id: "gone", type: "module"}], compat: {minimum: "13", maximum: "12"}})
  ];
  const found = findProblems({core: "14.370", system, modules});
  const kinds = Object.fromEntries(found.map(p => [p.id, p.kind]));
  assert.equal(kinds.tooold, "maximum");
  assert.equal(kinds.toonew, "minimum");
  assert.equal(kinds.missing, "missingDependency");
  assert.equal(kinds.inactive, "inactiveDependency");
  assert.equal(kinds.range, "dependencyVersion");
  assert.equal(kinds.othersystem, "otherSystem");
  assert.equal(kinds.systemrange, "systemRange");
  assert.equal(kinds.needsystem, "missingSystem");
  assert.equal(kinds.status, "foundry");
  assert.equal(found.find(p => p.id === "note").severity, "note");
  for ( const quiet of ["fine", "off", "verified", "disabled"] ) assert.equal(kinds[quiet], undefined, quiet);
  // Problems come before notes
  assert.equal(found.at(-1).severity, "note");
  assert.equal(inRange("1.5", {minimum: "1.0", maximum: "2"}), true);
  assert.equal(inRange("3", {maximum: "2"}), false);
});
