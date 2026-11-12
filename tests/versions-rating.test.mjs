import assert from "node:assert/strict";
import test from "node:test";

import {assess, countStatuses, ratePackage, rateAll, verdictLine} from "../scripts/rating.mjs";
import {compareVersions, defaultTarget, generationOf, isGeneration, isNewer, parseTarget} from "../scripts/versions.mjs";

/** Foundry 14's isNewerVersion, copied as a reference for the same input (without the majorOnly option). */
function foundryIsNewer(v1, v0) {
  if ( (v1 === null) || (v1 === undefined) ) return false;
  if ( (v0 === null) || (v0 === undefined) ) return true;
  if ( (typeof v1 === "number") && (typeof v0 === "number") ) return v1 > v0;
  const a = String(v1).split(".");
  const b = String(v0).split(".");
  for ( const [i, p1] of a.entries() ) {
    const p0 = b[i];
    if ( p0 === undefined ) return true;
    if ( !Number.isNaN(Number(p0)) && !Number.isNaN(Number(p1)) && (p0 !== "") && (p1 !== "") ) {
      if ( Number(p1) !== Number(p0) ) return Number(p1) > Number(p0);
    }
    if ( p1 !== p0 ) return p1 > p0;
  }
  return false;
}

test("isNewer agrees with Foundry on typical versions", () => {
  const pairs = [["14.370", "14.369"], ["14.9", "14.10"], ["15", "14.999"], ["14", "14.370"], ["14.370", "14"],
    ["1.13.5.1", "1.13.5"], ["6.0.6", "6.0.6"], ["2.0.0-beta", "2.0.0"], ["1.2.3", "1.10.0"], [14, 13], [null, "1"], ["1", null]];
  for ( const [a, b] of pairs ) assert.equal(isNewer(a, b), foundryIsNewer(a, b), `${a} vs ${b}`);
});

test("majorOnly compares the generation only", () => {
  assert.equal(isNewer("14.370", "14", {majorOnly: true}), false);
  assert.equal(isNewer("15.1", "14", {majorOnly: true}), true);
});

test("version helpers", () => {
  assert.equal(isGeneration("14"), true);
  assert.equal(isGeneration("14.1"), false);
  assert.equal(generationOf("14.370"), 14);
  assert.equal(defaultTarget("14.370"), "15");
  assert.equal(defaultTarget("13.351"), "14");
  assert.equal(parseTarget("v14.371"), "14.371");
  assert.equal(parseTarget("<script>"), "");
  assert.equal(parseTarget(""), "");
  assert.deepEqual(["1.10", "1.9", "1.2"].sort(compareVersions), ["1.2", "1.9", "1.10"]);
});

test("assess: verified, likely, blocked and unknown", () => {
  assert.equal(assess({minimum: "13", verified: "14"}, "14.370").level, "verified");
  assert.equal(assess({minimum: "13", verified: "14"}, "15").level, "likely");
  assert.equal(assess({minimum: "13", verified: "14", maximum: "14"}, "15").level, "blocked");
  assert.equal(assess({minimum: "13", verified: "14", maximum: "14"}, "15").reason, "maximumLow");
  assert.equal(assess({minimum: "14.367", verified: "14"}, "14.360").reason, "minimumHigh");
  assert.equal(assess({}, "15").level, "unknown");
  assert.equal(assess(null, "15").level, "unknown");
  // A bare maximum covers the whole generation, a maximum with a build does not go beyond it
  assert.equal(assess({minimum: "13", maximum: "14"}, "14.371").level, "likely");
  assert.equal(assess({minimum: "13", maximum: "14.370"}, "14.371").level, "blocked");
  // A verified build older than the target is not verified for it
  assert.equal(assess({minimum: "14", verified: "14.368"}, "14.370").level, "likely");
  assert.equal(assess({minimum: "14", verified: "14.368"}, "14").level, "verified");
});

test("ratePackage offline", () => {
  const item = {id: "a", title: "A", kind: "module", version: "1.0.0", compat: {minimum: "13", verified: "14"}};
  assert.equal(ratePackage(item, undefined, "14.370").status, "ready");
  assert.equal(ratePackage(item, undefined, "15").status, "likely");
  assert.equal(ratePackage({...item, compat: {minimum: "13", verified: "13", maximum: "13"}}, undefined, "14").status, "blocked");
  assert.equal(ratePackage({...item, compat: {}}, undefined, "14").status, "unknown");
});

test("ratePackage with the list of the Forge: update needed, still blocked, no newer version", () => {
  const item = {id: "a", title: "A", kind: "module", version: "1.0.0", compat: {minimum: "13", verified: "13", maximum: "13"}};
  const forge = {state: "ok", source: "forge", latest: "2.0.0", compat: {
    "1.0.0": {minimum: "13", verified: "13", maximum: "13"}, "2.0.0": {minimum: "14", verified: "14"}}};
  const update = ratePackage(item, forge, "14");
  assert.equal(update.status, "update");
  assert.equal(update.latestVerified, true);
  assert.ok(update.evidence.some(e => (e.source === "forge") && (e.kind === "latest")));
  // The newest version is blocked as well
  const stuck = {...forge, compat: {"2.0.0": {minimum: "13", verified: "13", maximum: "13"}}};
  assert.equal(ratePackage(item, stuck, "14").status, "blocked");
  // A newer version that is not blocked but not verified: update needed, but not "verified"
  const soft = {...forge, compat: {"2.0.0": {minimum: "13"}}};
  const softRating = ratePackage(item, soft, "14");
  assert.equal(softRating.status, "update");
  assert.equal(softRating.latestVerified, false);
  assert.equal(softRating.reason, "latestNotBlocked");
  // Nothing newer
  const same = {state: "ok", source: "forge", latest: "1.0.0", compat: {}};
  const noNewer = ratePackage(item, same, "14");
  assert.equal(noNewer.status, "blocked");
  assert.ok(noNewer.evidence.some(e => e.kind === "noNewer"));
});

test("ratePackage: a failed or missing answer changes nothing but is shown", () => {
  const item = {id: "a", title: "A", kind: "module", version: "1.0.0", compat: {minimum: "13", verified: "14"}};
  const failed = ratePackage(item, {state: "error", source: "forge", error: "blocked"}, "14");
  assert.equal(failed.status, "ready");
  assert.ok(failed.evidence.some(e => e.kind === "failed"));
  const none = ratePackage(item, {state: "notListed", source: "forge"}, "14");
  assert.ok(none.evidence.some(e => e.kind === "notListed"));
  const both = ratePackage(item, {state: "notListed", source: "forge", manifestError: "blocked"}, "14");
  assert.ok(both.evidence.some(e => (e.kind === "failed") && (e.source === "manifest") && (e.error === "blocked")));
});

test("the version confirmed later on the Forge counts for the installed version", () => {
  const item = {id: "a", title: "A", kind: "module", version: "1.0.0", compat: {minimum: "13", verified: "13"}};
  const forge = {state: "ok", source: "forge", latest: "1.0.0", compat: {"1.0.0": {minimum: "13", verified: "14"}}};
  const rating = ratePackage(item, forge, "14");
  assert.equal(rating.status, "ready");
  assert.equal(rating.evidence.filter(e => e.kind === "installed").length, 2);
});

test("rateAll sorts blocked first, verdictLine counts and names", () => {
  const items = [
    {id: "a", title: "Zeta", kind: "module", version: "1", compat: {minimum: "13", verified: "14"}},
    {id: "b", title: "Alpha", kind: "module", version: "1", compat: {minimum: "13", maximum: "13"}},
    {id: "c", title: "Mid", kind: "system", version: "1", compat: {}}
  ];
  const rated = rateAll(items, new Map(), "14");
  assert.deepEqual(rated.map(r => r.id), ["b", "c", "a"]);
  const counts = countStatuses(rated);
  assert.deepEqual(counts, {blocked: 1, update: 0, likely: 0, unknown: 1, ready: 1});
  const labels = {ready: "ready", update: "update needed", likely: "likely", unknown: "unknown", blocked: "blocked"};
  assert.equal(verdictLine(counts, ["Alpha"], labels), "1 ready, 1 unknown, 1 blocked: Alpha");
  assert.equal(verdictLine({ready: 0, blocked: 5}, ["A", "B", "C", "D", "E"], labels), "5 blocked: A, B, C, ...");
  assert.equal(verdictLine({}, [], labels), "");
});
