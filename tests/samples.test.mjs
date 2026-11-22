import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {WINDOW_KINDS, sampleBundle, sampleReport} from "../scripts/sample-data.mjs";
import {findProblems} from "../scripts/problems.mjs";
import {countStatuses, rateAll} from "../scripts/rating.mjs";
import {ratingItems} from "../scripts/state.mjs";
import {backStatus, runStatus, updateStatus} from "../scripts/overview.mjs";
import {lastGood, rollbackTargets} from "../scripts/snapshots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const now = Date.parse("2026-11-22T20:00:00Z");

test("every scenario builds a feed and a session of its own", () => {
  for ( const [family, kinds] of Object.entries(WINDOW_KINDS) ) {
    for ( const kind of kinds ) {
      const a = sampleBundle(family, kind, {now});
      const b = sampleBundle(family, kind, {now});
      assert.ok(a.feed.collectState().modules.length, `${family} ${kind}`);
      assert.ok(Array.isArray(a.feed.readHistory()));
      assert.notEqual(a.session, b.session, "no memory is shared");
      assert.equal(a.session.conflictsCounted, true, "a sample never counts for the statistics");
    }
  }
});

test("module names are made up", () => {
  const ids = new Set();
  for ( const [family, kinds] of Object.entries(WINDOW_KINDS) ) {
    for ( const kind of kinds ) for ( const m of sampleBundle(family, kind, {now}).feed.collectState().modules ) ids.add(m.id);
  }
  for ( const id of ids ) {
    assert.ok(!/sephrals|midi|dice-so-nice|lib-wrapper|tidy5e|item-piles|socketlib/i.test(id), id);
  }
});

test("the trouble scenario has errors, conflicts, players and fit problems", () => {
  const {feed, session} = sampleBundle("first", "trouble", {now});
  assert.ok(session.trial.owners.length >= 2);
  assert.ok(feed.log.errors.size >= 3);
  assert.ok(feed.playerStore.list({unreadOnly: true}).length >= 1);
  assert.ok(feed.playerStore.list().some(e => !feed.playerStore.isNew(e)), "some are read");
  const kinds = new Set(feed.findConflicts().findings.map(f => f.kind));
  for ( const kind of ["declared", "overrideTwice", "libraryConflict", "overrideAndWrap", "replacedUnknown", "key"] ) assert.ok(kinds.has(kind), kind);
  const state = feed.collectState();
  const problems = findProblems({core: state.core, system: state.system, modules: state.modules});
  assert.ok(problems.some(p => p.severity === "problem"));
  assert.ok(problems.some(p => p.severity === "note"));
});

test("the first tab shows each answer of the headline", () => {
  const keys = {};
  for ( const kind of ["trouble", "one", "tested", "ran", "changed", "untested", "first"] ) {
    const {feed, session} = sampleBundle("first", kind, {now});
    const history = feed.readHistory();
    const state = feed.collectState();
    const owners = [...feed.log.errors.keys(), ...(session.trial?.owners.map(o => o.owner) ?? [])]
      .filter(o => o.startsWith("module:") || o.startsWith("system:"));
    const bad = findProblems({core: state.core, system: state.system, modules: state.modules}).filter(p => p.severity === "problem").length;
    const changed = history.length > 1 && (history[0].core !== history[1].core || history[0].system.id !== history[1].system.id
      || history[0].system.version !== history[1].system.version || JSON.stringify(history[0].modules) !== JSON.stringify(history[1].modules));
    keys[kind] = runStatus({hasPrevious: history.length > 1, changes: changed ? 1 : 0, troubled: new Set(owners).size + bad,
      trial: session.trial, good: !!history[0].good}).key;
  }
  assert.deepEqual(keys, {trouble: "trouble", one: "trouble", tested: "tested", ran: "ran", changed: "changed", untested: "untested", first: "first"});
});

test("the checks rate to the answer they are named for", () => {
  const expected = {blocked: "blocked", blockedOne: "blocked", breaks: "breaks", breaksOne: "breaks", update: "update", updateOne: "update", open: "open", ready: "ready"};
  for ( const [kind, key] of Object.entries(expected) ) {
    const {feed, session} = sampleBundle("check", kind, {now});
    const rated = rateAll(ratingItems(feed.collectState()), session.results, "15");
    const counts = countStatuses(rated);
    const breaking = [...feed.log.deprecations].filter(([owner, e]) => e.until.some(u => Number.parseInt(u, 10) <= 15)
      && rated.some(r => `${r.kind}:${r.id}` === owner && !["ready", "blocked", "update"].includes(r.status))).length;
    assert.equal(updateStatus(counts, breaking).key, key, kind);
  }
});

test("the way back scenarios lead to their answers", () => {
  const expected = {older: "older", same: "older", current: "current", none: "none"};
  for ( const [kind, key] of Object.entries(expected) ) {
    const {feed} = sampleBundle("back", kind, {now});
    const history = feed.readHistory();
    const good = lastGood(history.slice(1));
    assert.equal(backStatus({older: !!good, current: !!history[0].good}).key, key, kind);
  }
  const {feed} = sampleBundle("back", "older", {now});
  const history = feed.readHistory();
  const changed = rollbackTargets(history, history[0]).filter(r => r.changed);
  assert.ok(changed.length >= 5);
  assert.ok(changed.some(r => r.downgrade) && changed.some(r => !r.downgrade));
  const same = sampleBundle("back", "same", {now}).feed.readHistory();
  assert.equal(rollbackTargets(same, same[0]).filter(r => r.changed).length, 0);
});

test("the search scenarios are in the states they are named for", () => {
  const search = kind => sampleBundle("search", kind, {now}).feed.readSearch();
  assert.equal(search("testing").phase, "testing");
  assert.ok(search("testing").off.length > 0 && search("testing").round === 2);
  assert.equal(search("found").phase, "found");
  assert.ok(search("found").culprit);
  assert.equal(search("noneChanged").phase, "none");
  assert.equal(search("noneChanged").scope, "changed");
  assert.equal(search("noneAll").scope, "all");
});

test("ready for tonight has every answer", () => {
  const keys = WINDOW_KINDS.ready.filter(k => k !== "readyRunning").map(k => sampleBundle("ready", k, {now}).ready.answer.key);
  assert.deepEqual(keys, ["errors", "playerErrors", "versions", "fit", "conflicts", "ready", "readyAlone"]);
  const versions = sampleBundle("ready", "readyVersions", {now}).ready;
  const lena = versions.players.find(p => p.name === "Lena").diff;
  assert.ok(lena.core && lena.system && lena.different.length && lena.missing.length && lena.extra.length);
});

test("reports of a problem", () => {
  assert.equal(sampleReport("banner-board", "found").lookup.issues.length, 2);
  assert.equal(sampleReport("banner-board", "noRepo").repo, null);
  assert.deepEqual(sampleReport("banner-board", "noMessage").terms, []);
  assert.ok(sampleReport("banner-board", "start").text.body.includes("Banner Board"));
});

test("sample labels exist in both languages with the same keys", async () => {
  const en = JSON.parse(await readFile(path.join(root, "lang/en.json"), "utf8")).SUG.Sample;
  const de = JSON.parse(await readFile(path.join(root, "lang/de.json"), "utf8")).SUG.Sample;
  assert.deepEqual(Object.keys(de.entry).sort(), Object.keys(en.entry).sort());
  assert.deepEqual(Object.keys(de.group).sort(), Object.keys(en.group).sort());
  const source = await readFile(path.join(root, "scripts/sample-windows.mjs"), "utf8");
  for ( const match of source.matchAll(/"[a-z-]+", "(?:first|ready|search|check|back)", "\w+", "(\w+)"/g) ) assert.ok(en.entry[match[1]], match[1]);
  for ( const match of source.matchAll(/\["report-[a-z-]+", "\w+", "(\w+)"\]/g) ) assert.ok(en.entry[match[1]], match[1]);
});
