import assert from "node:assert/strict";
import test from "node:test";

import {buildExport, exportFileName, exportText} from "../scripts/export-data.mjs";
import {OnlineChecker, describeFailure, parseForge, parseManifest} from "../scripts/online.mjs";

/** A fake response. */
function reply(body, {status = 200, headers = {}} = {}) {
  return {ok: status >= 200 && status < 300, status, headers: {get: name => headers[name.toLowerCase()] ?? null},
    text: async () => (typeof body === "string" ? body : JSON.stringify(body))};
}

/** A fake fetch with a table of answers by URL. Functions and Errors are run or thrown. */
function fakeFetch(table, calls = []) {
  return async (url, options) => {
    calls.push({url, options});
    const answer = table[url];
    if ( answer === undefined ) throw new TypeError("Failed to fetch");
    if ( answer instanceof Error ) throw answer;
    return typeof answer === "function" ? answer() : answer;
  };
}

const quick = {sleep: async () => {}, delay: 0};

const forgePackage = (extra = {}) => ({success: true, package: {id: "a", title: "A", latest: "2.0.0", versions: ["2.0.0", "1.0.0"],
  compatibility: {"2.0.0": {minimum: "14", verified: "14", status: 0}, "1.0.0": {minimum: "13", verified: "13", maximum: "13"}},
  notes: "https://example.com/notes", url: "javascript:alert(1)", ...extra}});

test("parseForge reads versions and compatibility and drops unsafe links", () => {
  const result = parseForge(forgePackage());
  assert.equal(result.state, "ok");
  assert.equal(result.latest, "2.0.0");
  assert.deepEqual(result.compat["1.0.0"], {minimum: "13", verified: "13", maximum: "13"});
  assert.equal(result.notes, "https://example.com/notes");
  assert.equal(result.url, "");
  assert.deepEqual(parseForge({success: true, package: null}), {state: "notListed", source: "forge"});
  for ( const bad of [null, "x", {}, {success: false}, {success: true, package: 5}] ) {
    assert.throws(() => parseForge(bad), error => error.code === "invalid");
  }
  const odd = parseForge(forgePackage({latest: 5, versions: [1, "2"], compatibility: {"1": 5, "2": {minimum: ["x"]}}, title: {}}));
  assert.equal(odd.latest, "5");
  assert.deepEqual(odd.versions, ["2"]);
  assert.deepEqual(odd.compat, {});
  assert.equal(odd.title, "");
});

test("parseManifest reads one version and refuses another package", () => {
  const manifest = {id: "a", version: "1.2.3", compatibility: {minimum: "13", verified: "14"}, changelog: "https://example.com/c"};
  const result = parseManifest(manifest, "a");
  assert.equal(result.latest, "1.2.3");
  assert.deepEqual(result.compat["1.2.3"], {minimum: "13", verified: "14", maximum: ""});
  assert.throws(() => parseManifest(manifest, "b"), error => error.code === "otherPackage");
  assert.throws(() => parseManifest({id: "a"}, "a"), error => error.code === "invalid");
  assert.throws(() => parseManifest([], "a"), error => error.code === "invalid");
  const legacy = parseManifest({id: "a", version: "1", minimumCoreVersion: "10", compatibleCoreVersion: "11"}, "a");
  assert.equal(legacy.compat["1"].verified, "11");
});

test("describeFailure", () => {
  assert.deepEqual(describeFailure(new TypeError("Failed to fetch")), {code: "blocked", detail: ""});
  assert.equal(describeFailure(new TypeError("x"), {onLine: false}).code, "offline");
  assert.equal(describeFailure(Object.assign(new Error("x"), {name: "AbortError"})).code, "timeout");
  // What a browser really throws on an abort: its code is the number 20, not a text
  assert.equal(describeFailure(new DOMException("aborted", "AbortError")).code, "timeout");
  assert.equal(describeFailure(new SyntaxError("bad json")).code, "invalid");
  assert.equal(describeFailure(Object.assign(new Error("x"), {code: "http", detail: "404"})).detail, "404");
});

test("one failing package does not stop the list, and the request carries no credentials and no referrer", async () => {
  const calls = [];
  const checker = new OnlineChecker({...quick, fetchFn: fakeFetch({
    "https://forge-vtt.com/api/bazaar/package/a": reply(forgePackage()),
    "https://forge-vtt.com/api/bazaar/package/b": reply("oops", {status: 500}),
    "https://forge-vtt.com/api/bazaar/package/c": reply("not json"),
    "https://forge-vtt.com/api/bazaar/package/d": reply({success: true, package: null}),
    "https://forge-vtt.com/api/bazaar/package/e": reply({success: true, package: {id: "e", latest: "1", versions: ["1"], compatibility: {}}})
  }, calls)});
  const {results, report} = await checker.checkPackages([{id: "a"}, {id: "b"}, {id: "c"}, {id: "d"}, {id: "e"}, {id: "f"}]);
  assert.equal(results.get("a").state, "ok");
  assert.equal(results.get("b").error, "http");
  assert.equal(results.get("b").detail, "500");
  assert.equal(results.get("c").error, "invalid");
  assert.equal(results.get("d").state, "notListed");
  assert.equal(results.get("e").state, "ok");
  assert.equal(results.get("f").error, "blocked");
  assert.deepEqual(report.forge, {asked: 6, ok: 2, notListed: 1, failed: 3, cached: 0});
  assert.equal(report.failures.length, 3 + 0);
  assert.equal(calls.length, 6);
  for ( const {options} of calls ) {
    assert.equal(options.credentials, "omit");
    assert.equal(options.referrerPolicy, "no-referrer");
    assert.equal(options.method, "GET");
  }
});

test("only valid package ids are sent anywhere", async () => {
  const calls = [];
  const checker = new OnlineChecker({...quick, fetchFn: fakeFetch({}, calls)});
  const {results} = await checker.checkPackages([{id: "../x"}, {id: "a b"}, {id: ""}]);
  assert.equal(calls.length, 0);
  assert.equal(results.get("../x").error, "invalid");
});

test("manifests are read for packages the Forge does not know, an unsafe address is never requested", async () => {
  const calls = [];
  const checker = new OnlineChecker({...quick, fetchFn: fakeFetch({
    "https://forge-vtt.com/api/bazaar/package/a": reply({success: true, package: null}),
    "https://forge-vtt.com/api/bazaar/package/b": reply({success: true, package: null}),
    "https://forge-vtt.com/api/bazaar/package/c": reply({success: true, package: null}),
    "https://forge-vtt.com/api/bazaar/package/d": reply({success: true, package: null}),
    "https://example.com/a.json": reply({id: "a", version: "3.0.0", compatibility: {minimum: "14", verified: "14"}}),
    "https://example.com/b.json": reply({id: "other", version: "1"})
  }, calls)});
  const {results, report} = await checker.checkPackages([
    {id: "a", manifest: "https://example.com/a.json"},
    {id: "b", manifest: "https://example.com/b.json"},
    {id: "c", manifest: "javascript:alert(1)"},
    {id: "d", manifest: "https://example.com/blocked.json"}
  ]);
  assert.equal(results.get("a").source, "manifest");
  assert.equal(results.get("a").latest, "3.0.0");
  assert.equal(results.get("b").state, "notListed");
  assert.equal(results.get("b").manifestError, "otherPackage");
  assert.equal(results.get("c").state, "notListed");
  assert.equal(results.get("d").state, "notListed");
  assert.deepEqual({ok: report.manifest.ok, failed: report.manifest.failed, skipped: report.manifest.skipped},
    {ok: 1, failed: 2, skipped: 1});
  assert.ok(!calls.some(c => String(c.url).startsWith("javascript")));
});

test("answers stay in memory for an hour, failures are asked again", async () => {
  let time = 0;
  const calls = [];
  let fail = true;
  const checker = new OnlineChecker({...quick, now: () => time, fetchFn: async url => {
    calls.push(url);
    if ( url.endsWith("/bad") && fail ) throw new TypeError("Failed to fetch");
    return reply(forgePackage());
  }});
  await checker.forge("a");
  await checker.forge("a");
  assert.equal(calls.length, 1);
  assert.equal((await checker.forge("a")).cached, true);
  time = 59 * 60 * 1000;
  await checker.forge("a");
  assert.equal(calls.length, 1);
  time = 61 * 60 * 1000;
  await checker.forge("a");
  assert.equal(calls.length, 2);
  assert.equal((await checker.forge("bad")).state, "error");
  fail = false;
  assert.equal((await checker.forge("bad")).state, "ok");
  checker.clear();
  await checker.forge("a");
  assert.equal(calls.length, 5);
});

test("requests are throttled to the given concurrency and spaced", async () => {
  let running = 0;
  let peak = 0;
  const sleeps = [];
  const checker = new OnlineChecker({concurrency: 2, delay: 50, sleep: async ms => { sleeps.push(ms); },
    fetchFn: async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise(r => setTimeout(r, 5));
      running--;
      return reply({success: true, package: null});
    }});
  await checker.checkPackages(Array.from({length: 8}, (_, i) => ({id: `p${i}`})));
  assert.ok(peak <= 2, `peak ${peak}`);
  assert.ok(sleeps.length >= 8);
});

test("a stopped check does not request the rest", async () => {
  const controller = new AbortController();
  const calls = [];
  const checker = new OnlineChecker({...quick, concurrency: 1, fetchFn: async url => {
    calls.push(url);
    controller.abort();
    return reply({success: true, package: null});
  }});
  await checker.checkPackages(Array.from({length: 6}, (_, i) => ({id: `p${i}`})), {signal: controller.signal});
  assert.equal(calls.length, 1);
});

test("the release of an older version is looked up under the usual tag names", async () => {
  const api = tag => `https://api.github.com/repos/o/r/releases/tags/${tag}`;
  const checker = new OnlineChecker({...quick, fetchFn: fakeFetch({
    [api("v1.0.0")]: reply({}, {status: 404}),
    [api("1.0.0")]: reply({tag_name: "1.0.0", assets: [{name: "module.json"}, {name: "module.zip"}]}),
    [api("v2.0.0")]: reply({tag_name: "v2.0.0", assets: [{name: "module.zip"}]}),
    [api("v3.0.0")]: reply("{}", {status: 403, headers: {"x-ratelimit-remaining": "0"}})
  })});
  const repo = {owner: "o", repo: "r", file: "module.json"};
  const found = await checker.githubRelease(repo, "1.0.0");
  assert.equal(found.state, "found");
  assert.equal(found.url, "https://github.com/o/r/releases/download/1.0.0/module.json");
  assert.equal((await checker.githubRelease(repo, "2.0.0")).state, "noFile");
  const limited = await checker.githubRelease(repo, "3.0.0");
  assert.equal(limited.state, "error");
  assert.equal(limited.error, "rateLimit");
  assert.equal((await checker.githubRelease(repo, "9.9.9")).state, "error");
});

test("a response that is too large is refused", async () => {
  const checker = new OnlineChecker({...quick, fetchFn: async () => reply("x".repeat(3_000_001))});
  assert.equal((await checker.forge("a")).error, "tooLarge");
});

test("the export has the data and a readable text", () => {
  const state = {core: "14.370", system: {id: "dnd5e", title: "D&D", version: "6.0.6"}, modules: [
    {id: "a", title: "A", version: "1", active: true, minimum: "13", verified: "14", maximum: "", manifest: "https://x/m.json"}]};
  const history = [{at: "2026-01-01T00:00:00.000Z", seen: "2026-01-01T00:00:00.000Z", core: "14.370", system: state.system,
    modules: [{id: "a", title: "A", version: "1", active: true, manifest: "https://secret"}], good: true, goodAt: "x", errors: null}];
  const data = buildExport({generatedAt: "2026-01-02T00:00:00.000Z", state, history, target: "15",
    rated: [{id: "a", title: "A", kind: "module", version: "1", status: "likely", reason: "minimumFits", latest: null, evidence: [{source: "manifest"}]}],
    report: {forge: {ok: 1, failed: 0, notListed: 0}, manifest: {ok: 0, failed: 0}, failures: []},
    problems: [{id: "a", kind: "maximum", severity: "problem", data: {maximum: "13"}}],
    deprecations: [{id: "module:a", count: 2, message: "old", until: ["16"]}], errors: [{id: "module:a", count: 1, message: "boom"}]});
  assert.equal(data.format, 1);
  assert.equal(data.history[0].modules[0].manifest, undefined);
  assert.deepEqual(data.check[0].sources, ["manifest"]);
  JSON.parse(JSON.stringify(data));
  const text = exportText(data, (key, d) => (d ? `${key} ${JSON.stringify(d)}` : key));
  assert.ok(text.includes("SUG.Export.title"));
  assert.ok(text.includes("[x] A (a) 1  https://x/m.json"));
  assert.ok(text.includes("SUG.STATUS.likely: A 1"));
  assert.ok(text.includes("module:a: 2x old (16)"));
  assert.equal(exportFileName("2026-01-02T00:00:00.000Z", "json"), "update-guard-2026-01-02.json");
});
