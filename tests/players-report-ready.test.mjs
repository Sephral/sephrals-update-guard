import assert from "node:assert/strict";
import test from "node:test";

import {withEvidence} from "../scripts/culprit.mjs";
import {OnlineChecker} from "../scripts/online.mjs";
import {ErrorGate, PlayerErrorStore, buildReport, compareVersions, fingerprint, isReportable, readReport, readVersions,
  sanitizeMessage, sanitizeStack, whereOf} from "../scripts/player-data.mjs";
import {buildReportText, githubRepoOf, issueSearchUrl, issueTerms, newIssueUrl, parseIssues, repositoryOf} from "../scripts/report-data.mjs";
import {canSaveLoadout, differenceKinds, loadoutName, readyAnswer} from "../scripts/ready-data.mjs";
import {WatchLog} from "../scripts/watch-data.mjs";

/* Messages and stacks */

test("a message loses addresses, folders of a computer and mail addresses", () => {
  const text = sanitizeMessage("Failed https://my.server.example:30000/worlds/x/y.json for C:\\Users\\Anna\\data and /home/bob/x and a@b.example");
  assert.ok(!/my\.server|Anna|bob|a@b/.test(text), text);
  assert.ok(text.includes("/worlds/x/y.json"));
  assert.equal(sanitizeMessage("x".repeat(500)).length, 200);
  assert.equal(sanitizeMessage(undefined), "");
});

test("a stack keeps only paths inside modules and systems, first the package lines", () => {
  const stack = ["Error: boom",
    "    at Hooks.callback (http://192.168.1.5:30000/modules/my-mod/scripts/a.js?v=1:12:7)",
    "    at Hooks.call (http://192.168.1.5:30000/scripts/foundry.mjs:100:2)",
    "    at http://192.168.1.5:30000/systems/dnd5e/module/x.js:3:4",
    "    at async renderSheet@http://x/y.js:1:1"].join("\n");
  const lines = sanitizeStack(stack);
  assert.equal(lines[0], "Hooks.callback (modules/my-mod/scripts/a.js:12:7)");
  assert.equal(lines[1], "systems/dnd5e/module/x.js:3:4");
  assert.ok(lines.every(l => !l.includes("192.168")));
  assert.ok(lines.length <= 5);
  const firefox = sanitizeStack("callback@http://localhost:30000/modules/m/a.js:5:9\n@http://localhost:30000/modules/m/b.js:6:1");
  assert.deepEqual(firefox, ["callback (modules/m/a.js:5:9)", "modules/m/b.js:6:1"]);
  assert.deepEqual(sanitizeStack(""), []);
});

test("where an error happened: sheet, window, hook or script", () => {
  assert.deepEqual(whereOf({hook: "renderActorSheetV2", kind: "hook"}), {type: "sheet", name: "ActorSheetV2"});
  assert.deepEqual(whereOf({hook: "renderSceneConfig", kind: "hook"}), {type: "window", name: "SceneConfig"});
  assert.deepEqual(whereOf({hook: "updateActor", kind: "hook"}), {type: "hook", name: "updateActor"});
  assert.deepEqual(whereOf({stack: "at CharacterSheet._onRender (x)"}), {type: "sheet", name: "CharacterSheet"});
  assert.deepEqual(whereOf({stack: "at ChatLogApp.render (x)"}), {type: "window", name: "ChatLogApp"});
  assert.deepEqual(whereOf({stack: "at Hooks.callAll (x)"}), {type: "hook", name: ""});
  assert.deepEqual(whereOf({stack: "at foo (x)"}), {type: "script", name: ""});
});

test("only modules and systems are reportable", () => {
  assert.ok(isReportable("module:a-b.c"));
  assert.ok(isReportable("system:dnd5e"));
  for ( const bad of ["core", "world", "module:", "module:a/b", "other:x", 5, null, "module:" + "x".repeat(200)] ) assert.ok(!isReportable(bad), String(bad));
});

/* Gate */

const report = (message = "boom", extra = {}) => buildReport({owner: "module:m", kind: "error", message, stack: "x", ...extra});

test("the gate lets the first error through and counts the repeats", () => {
  const gate = new ErrorGate({repeatMs: 1000, perMinute: 8});
  const first = gate.add(report(), 0);
  assert.equal(first.length, 1);
  assert.equal(first[0].count, 1);
  for ( let i = 1; i <= 50; i++ ) assert.deepEqual(gate.add(report(), i * 10), []);
  assert.deepEqual(gate.flush(900), []);
  const batch = gate.flush(1000);
  assert.equal(batch.length, 1);
  assert.equal(batch[0].count, 50);
  assert.equal(batch[0].repeat, true);
  assert.deepEqual(gate.flush(1001), []);
});

test("the gate limits reports per minute and different errors", () => {
  const gate = new ErrorGate({perMinute: 3, maxKeys: 5, repeatMs: 100});
  const sent = [];
  for ( let i = 0; i < 10; i++ ) sent.push(...gate.add(report(`error ${i}`), i));
  assert.equal(sent.length, 3);
  assert.equal(gate.keys.size, 5);
  // The held ones go out when the minute has passed
  const later = gate.flush(61000);
  assert.equal(later.length, 2);
  assert.equal(gate.flush(61001).length, 0);
});

test("the same message in another place is another error", () => {
  const a = report("x", {hook: "renderActorSheetV2"});
  const b = report("x", {hook: "renderSceneConfig"});
  assert.notEqual(fingerprint(a), fingerprint(b));
});

/* Reading from the socket */

test("a report from the socket is read with limits, anything else is refused", () => {
  const ok = readReport({owner: "module:m", kind: "weird", message: "a".repeat(900), where: {type: "sheet", name: "S"},
    stack: ["x".repeat(500), 1, "b", "c", "d", "e", "f", "g"], count: 5000000, extra: "ignored"});
  assert.equal(ok.kind, "error");
  assert.equal(ok.message.length, 200);
  assert.equal(ok.stack.length, 5);
  assert.equal(ok.count, 9999);
  assert.equal(ok.extra, undefined);
  for ( const bad of [null, "x", {}, {owner: "core"}, {owner: "module:a/b"}] ) assert.equal(readReport(bad), null);
  assert.equal(readReport({owner: "module:m", where: {type: "evil"}}).where.type, "script");
});

/* Store */

const user = (id = "u1", name = "Anna") => ({id, name});

test("the store counts the same error up and keeps others apart", () => {
  const store = new PlayerErrorStore();
  const a = store.add(user(), readReport(report("boom")), "2026-01-01T10:00:00.000Z");
  assert.ok(a.isNew);
  const again = store.add(user(), {...readReport(report("boom")), count: 4}, "2026-01-01T10:05:00.000Z");
  assert.ok(!again.isNew);
  assert.equal(store.entries.size, 1);
  assert.equal([...store.entries.values()][0].count, 5);
  assert.equal([...store.entries.values()][0].first, "2026-01-01T10:00:00.000Z");
  store.add(user("u2", "Ben"), readReport(report("boom")), "2026-01-01T10:06:00.000Z");
  assert.equal(store.entries.size, 2);
  const rows = store.byOwner();
  assert.deepEqual(rows, [{owner: "module:m", count: 6, players: ["Ben", "Anna"]}]);
  const groups = store.grouped();
  assert.deepEqual(groups.map(g => g.userName), ["Anna", "Ben"]);
  assert.equal(groups[0].modules[0].count, 5);
});

test("read and unread", () => {
  const store = new PlayerErrorStore();
  store.add(user(), readReport(report("one")), "2026-01-01T10:00:00.000Z");
  assert.equal(store.list({unreadOnly: true}).length, 1);
  store.markRead("2026-01-01T11:00:00.000Z");
  assert.equal(store.list({unreadOnly: true}).length, 0);
  assert.equal(store.list().length, 1);
  store.add(user(), readReport(report("one")), "2026-01-01T12:00:00.000Z");
  assert.equal(store.list({unreadOnly: true}).length, 1);
  store.clear();
  assert.equal(store.list().length, 0);
});

test("the store limits what it keeps and what one player may send", () => {
  const store = new PlayerErrorStore({limit: 3, perMinute: 4});
  for ( let i = 0; i < 6; i++ ) store.add(user(), readReport(report(`e${i}`)), `2026-01-01T10:00:0${i}.000Z`);
  assert.equal(store.entries.size, 3, "four accepted, then the limit per minute");
  assert.equal(store.add(user(), readReport(report("late")), "2026-01-01T10:00:30.000Z"), null);
  assert.ok(store.add(user(), readReport(report("later")), "2026-01-01T10:02:00.000Z"));
  assert.ok([...store.entries.values()].every(e => e.message !== "e0"));
});

test("the stored form survives a round trip and an unreadable value gives an empty store", () => {
  const store = new PlayerErrorStore();
  store.add(user(), readReport(report("one", {hook: "renderActorSheetV2"})), "2026-01-01T10:00:00.000Z");
  store.markRead("2026-01-01T11:00:00.000Z");
  const copy = PlayerErrorStore.parse(store.serialize());
  assert.equal(copy.entries.size, 1);
  assert.equal(copy.seenAt, "2026-01-01T11:00:00.000Z");
  assert.deepEqual([...copy.entries.values()][0].where, {type: "sheet", name: "ActorSheetV2"});
  for ( const bad of ["", "x", "{}", JSON.stringify({format: 2, entries: []}), JSON.stringify({format: 1, entries: [{owner: "core"}, null, 5]})] ) {
    assert.equal(PlayerErrorStore.parse(bad).entries.size, 0);
  }
});

/* Versions */

const versions = (modules, core = "14.370") => readVersions({core, system: {id: "dnd5e", version: "6.0.6"}, modules});

test("versions of two browsers are compared", () => {
  const gm = versions([["a", "1"], ["b", "2"], ["c", "3"]]);
  assert.ok(compareVersions(gm, versions([["c", "3"], ["a", "1"], ["b", "2"]])).same);
  const diff = compareVersions(gm, versions([["a", "0.9"], ["c", "3"], ["z", "1"]], "14.369"));
  assert.deepEqual(diff.different, [{id: "a", gm: "1", player: "0.9"}]);
  assert.deepEqual(diff.missing, ["b"]);
  assert.deepEqual(diff.extra, ["z"]);
  assert.deepEqual(diff.core, {gm: "14.370", player: "14.369"});
  assert.equal(diff.system, null);
  assert.deepEqual(differenceKinds(diff), ["core", "different", "missing", "extra"]);
  assert.equal(readVersions(null), null);
  assert.deepEqual(readVersions({modules: "x"}).modules, []);
});

/* Watch log */

test("the watch tells listeners and keeps recent errors of packages", () => {
  const log = new WatchLog();
  const seen = [];
  log.listeners.add(item => seen.push(item));
  log.listeners.add(() => { throw new Error("a listener that throws"); });
  log.addError("module:m", "hook", "boom (renderX)", undefined, {stack: "s".repeat(5000), hook: "renderX"});
  log.addError("core", "error", "no package");
  assert.equal(seen.length, 2);
  assert.equal(seen[0].hook, "renderX");
  assert.ok(seen[0].stack.length < 2000);
  assert.equal(log.recent.length, 1);
  assert.equal(log.errorTotal(), 2);
  for ( let i = 0; i < 100; i++ ) log.addError("module:m", "error", `e${i}`);
  assert.equal(log.recent.length, 40);
});

/* Evidence for the search */

test("errors of players put modules first among the suspects", () => {
  const found = withEvidence(["a", "b", "c"], ["c", "z", "me", "c"], ["a", "b", "c", "me"], "me");
  assert.deepEqual(found.ids, ["c", "a", "b"]);
  assert.deepEqual(found.evidence, ["c"]);
  assert.deepEqual(withEvidence(["a"], [], ["a"]).ids, ["a"]);
  assert.deepEqual(withEvidence(["a"], ["b"], ["a", "b"]).ids, ["b", "a"]);
});

/* Report */

test("the repository comes from the manifest in a fixed order", () => {
  assert.deepEqual(githubRepoOf("https://github.com/Owner/Repo.git"), {owner: "Owner", repo: "Repo"});
  assert.deepEqual(githubRepoOf("https://github.com/Owner/Repo/issues"), {owner: "Owner", repo: "Repo"});
  assert.deepEqual(githubRepoOf("https://github.com/Owner/Repo/releases/latest/download/module.json"), {owner: "Owner", repo: "Repo"});
  assert.deepEqual(githubRepoOf("https://raw.githubusercontent.com/Owner/Repo/main/module.json"), {owner: "Owner", repo: "Repo"});
  for ( const bad of ["https://example.com/Owner/Repo", "javascript:alert(1)", "https://github.com/Owner", "", null, "https://user:pw@github.com/a/b", "https://github.com/a%2F/b"] ) {
    assert.equal(githubRepoOf(bad), null, String(bad));
  }
  assert.deepEqual(repositoryOf({bugs: "https://github.com/A/bugs-repo/issues", url: "https://github.com/B/page"}), {owner: "A", repo: "bugs-repo", source: "bugs"});
  assert.deepEqual(repositoryOf({bugs: "https://example.com/issues", url: "https://github.com/B/page", manifest: "https://github.com/C/m/releases/latest/download/module.json"}),
    {owner: "B", repo: "page", source: "url"});
  assert.deepEqual(repositoryOf({url: "https://example.com", manifest: "https://github.com/C/m/releases/latest/download/module.json"}),
    {owner: "C", repo: "m", source: "manifest"});
  assert.equal(repositoryOf({url: "https://example.com"}), null);
  assert.equal(repositoryOf(undefined), null);
});

test("key words of an error leave out what every message says", () => {
  assert.deepEqual(issueTerms("Cannot read properties of undefined (reading 'getTokenFor')"), ["getTokenFor"]);
  assert.deepEqual(issueTerms("TypeError: Item.rollAttack is not a function"), ["Item", "rollAttack"]);
  assert.deepEqual(issueTerms("SUG player: sheet hook broke (renderActorSheetV2)").slice(0, 3), ["SUG", "player", "sheet"]);
  assert.deepEqual(issueTerms(""), []);
  assert.ok(issueTerms("a b c ".repeat(20) + "alpha beta gamma delta epsilon zeta eta theta").length <= 6);
});

test("the search address names the repository and asks for open issues", () => {
  const url = new URL(issueSearchUrl({owner: "o", repo: "r"}, ["alpha", "beta"]));
  assert.equal(url.origin + url.pathname, "https://api.github.com/search/issues");
  assert.equal(url.searchParams.get("q"), "alpha beta repo:o/r is:issue is:open");
});

test("the answer of the search gives plain issues and drops pull requests and odd links", () => {
  const parsed = parseIssues({total_count: 9, items: [
    {number: 3, title: "A", html_url: "https://github.com/o/r/issues/3", comments: 2, updated_at: "2026-01-01T00:00:00Z"},
    {number: 4, title: "B", html_url: "https://github.com/o/r/pull/4", pull_request: {}},
    {number: 5, title: "C", html_url: "javascript:alert(1)"},
    {number: 6, title: "D", html_url: "https://evil.example/x"},
    null]});
  assert.equal(parsed.total, 9);
  assert.deepEqual(parsed.issues.map(i => i.number), [3]);
  assert.equal(parseIssues({}), null);
  assert.equal(parseIssues(null), null);
});

test("the report text has the versions, the error and the place, and no player", () => {
  const {title, body} = buildReportText({module: {id: "m", title: "My Mod", version: "1.2.3"}, foundry: "14.370",
    system: {id: "dnd5e", version: "6.0.6"}, others: 41, who: "in a player's browser",
    error: {message: "boom", kind: "hook", where: {type: "sheet", name: "ActorSheetV2"}, stack: ["f (modules/m/a.js:1:2)"]}});
  assert.equal(title, "My Mod: boom");
  for ( const part of ["Module: My Mod (m) 1.2.3", "Foundry VTT: 14.370", "Game system: dnd5e 6.0.6", "Other active modules: 41", "\"boom\"",
    "error inside a hook, in sheet ActorSheetV2, seen in a player's browser", "modules/m/a.js:1:2", "Steps to reproduce"] ) {
    assert.ok(body.includes(part), part);
  }
  const empty = buildReportText({module: {id: "m", title: "My Mod", version: "1"}, foundry: "14", system: {id: "s", version: "1"}, error: {}, others: 0});
  assert.ok(empty.body.includes("no error message was recorded"));
  assert.equal(empty.title, "My Mod: error");
});

test("a new issue is opened with the text filled in, and long texts are cut", () => {
  const url = newIssueUrl({owner: "o", repo: "r"}, {title: "T & U", body: "line 1\nline 2"});
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, "https://github.com/o/r/issues/new");
  assert.equal(parsed.searchParams.get("title"), "T & U");
  assert.equal(parsed.searchParams.get("body"), "line 1\nline 2");
  const long = newIssueUrl({owner: "o", repo: "r"}, {title: "T", body: "x".repeat(20000)});
  assert.ok(long.length <= 7000);
  assert.ok(long.startsWith("https://github.com/o/r/issues/new?"));
});

test("looking for open issues goes through the checker, is remembered and reports failures", async () => {
  const calls = [];
  const answer = {total_count: 1, items: [{number: 7, title: "Same", html_url: "https://github.com/o/r/issues/7", comments: 1, updated_at: "x"}]};
  const checker = new OnlineChecker({sleep: async () => {}, delay: 0, fetchFn: async (url, options) => {
    calls.push({url, options});
    return {ok: true, status: 200, headers: {get: () => null}, text: async () => JSON.stringify(answer)};
  }});
  const first = await checker.issues({owner: "o", repo: "r"}, ["alpha"]);
  assert.equal(first.state, "ok");
  assert.equal(first.issues[0].number, 7);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.referrerPolicy, "no-referrer");
  assert.ok(calls[0].url.startsWith("https://api.github.com/search/issues?"));
  await checker.issues({owner: "o", repo: "r"}, ["alpha"]);
  assert.equal(calls.length, 1, "answered from memory");
  assert.deepEqual(await checker.issues({owner: "o", repo: "r"}, []), {state: "ok", total: 0, issues: []});
  assert.equal(calls.length, 1, "no key words, no request");
  const limited = new OnlineChecker({sleep: async () => {}, delay: 0, fetchFn: async () => ({ok: false, status: 403,
    headers: {get: name => (name === "x-ratelimit-remaining" ? "0" : null)}, text: async () => "{}"})});
  const failed = await limited.issues({owner: "o", repo: "r"}, ["alpha"]);
  assert.equal(failed.state, "error");
  assert.equal(failed.error, "rateLimit");
  const offline = new OnlineChecker({sleep: async () => {}, delay: 0, fetchFn: async () => { throw new TypeError("Failed to fetch"); }});
  assert.equal((await offline.issues({owner: "o", repo: "r"}, ["alpha"])).error, "blocked");
});

/* Ready for tonight */

test("the answer names the most important finding and the next step", () => {
  const base = {trialModules: [], playerModules: [], players: [], connected: 3, fitProblems: 0, trialDone: true};
  assert.deepEqual(readyAnswer({...base, trialDone: false}), {level: "warn", key: "notRun", count: 0, next: "run", findings: []});
  assert.equal(readyAnswer(base).key, "ready");
  assert.equal(readyAnswer(base).level, "good");
  assert.equal(readyAnswer({...base, connected: 0}).key, "readyAlone");
  assert.deepEqual([readyAnswer({...base, fitProblems: 2}).key, readyAnswer({...base, fitProblems: 2}).next], ["fit", "fitList"]);
  const versionsOnly = readyAnswer({...base, players: [{name: "A", kinds: ["different"]}]});
  assert.deepEqual([versionsOnly.key, versionsOnly.next, versionsOnly.count], ["versions", "reload", 1]);
  const players = readyAnswer({...base, playerModules: ["M"], players: [{name: "A", kinds: ["silent"]}], fitProblems: 1});
  assert.deepEqual([players.key, players.level, players.next], ["playerErrors", "warn", "playerList"]);
  assert.deepEqual(players.findings, ["playerErrors", "versions", "fit"]);
  const errors = readyAnswer({...base, trialModules: ["T"], playerModules: ["M"]});
  assert.deepEqual([errors.key, errors.level, errors.next], ["errors", "bad", "fixModules"]);
});

test("the loadout of the safety net has a clear name and needs the API of Module Loadouts", () => {
  assert.equal(loadoutName("2026-11-12T20:15:00.000Z", "14.370"), "Update Guard 2026-11-12 (Foundry 14.370)");
  assert.equal(loadoutName("not a date", "14"), "Update Guard not a date (Foundry 14)");
  assert.ok(canSaveLoadout({active: true, api: {saveCurrent() {}}}));
  assert.ok(!canSaveLoadout({active: false, api: {saveCurrent() {}}}));
  assert.ok(!canSaveLoadout({active: true, api: {}}));
  assert.ok(!canSaveLoadout(undefined));
});
