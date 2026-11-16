import assert from "node:assert/strict";
import {test} from "node:test";

import {advanceSearch, beginSearch, chooseHalf, isSearch, restoredConfig, roundsLeft, searchConfig, suspectsSince,
  withDependents} from "../scripts/culprit.mjs";
import {backStatus, countTroubled, groupRows, runStatus, updateStatus} from "../scripts/overview.mjs";
import {noteTrial} from "../scripts/snapshots.mjs";
import {countDelta, storedTrial, summarizeTrial} from "../scripts/trial-data.mjs";

const start = (suspects, extra = {}) => beginSearch({suspects, original: Object.fromEntries(suspects.map(id => [id, true])),
  scope: "changed", now: "2026-11-07T10:00:00.000Z", ...extra});

test("suspects are the active modules that are new, changed or switched on since the good state", () => {
  const good = {modules: [{id: "a", version: "1", active: true}, {id: "b", version: "1", active: true},
    {id: "c", version: "1", active: false}, {id: "self", version: "1", active: true}]};
  const current = {modules: [{id: "a", version: "1", active: true}, {id: "b", version: "2", active: true},
    {id: "c", version: "1", active: true}, {id: "d", version: "1", active: true}, {id: "e", version: "1", active: false},
    {id: "self", version: "2", active: true}]};
  assert.deepEqual(suspectsSince(good, current, "self"), ["b", "c", "d"]);
  assert.deepEqual(suspectsSince(null, current), []);
});

test("what needs a module goes off with it, over several steps", () => {
  const requires = {plugin: ["lib"], addon: ["plugin"], alone: []};
  assert.deepEqual([...withDependents(["lib"], requires)].sort(), ["addon", "lib", "plugin"]);
  assert.deepEqual([...withDependents(["alone"], requires)], ["alone"]);
});

test("one suspect that makes the problem go away is found in one round", () => {
  const search = advanceSearch(start(["a"]), false);
  assert.equal(search.phase, "found");
  assert.equal(search.culprit, "a");
});

test("the problem stays with all suspects off: none of them is the cause", () => {
  const search = advanceSearch(start(["a", "b", "c"]), true);
  assert.equal(search.phase, "none");
  assert.deepEqual(search.off, []);
});

test("halving finds any one of eight suspects within the promised rounds", () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
  for ( const culprit of ids ) {
    let search = start(ids);
    const promised = roundsLeft(search);
    let rounds = 0;
    while ( search.phase === "testing" ) {
      rounds++;
      search = advanceSearch(search, !search.off.includes(culprit));
      assert.ok(rounds < 10, "the search ends");
    }
    assert.equal(search.phase, "found");
    assert.equal(search.culprit, culprit);
    assert.ok(rounds <= promised, `${rounds} rounds, ${promised} promised`);
  }
});

test("candidates that depend on each other are split so that the search goes on", () => {
  const requires = {b: ["a"], c: ["a"], d: ["a"]};
  assert.deepEqual(chooseHalf(["a", "b", "c", "d"], requires), ["b"]);
  assert.deepEqual(chooseHalf(["b", "a", "c", "d"], requires), ["b"]);
  for ( const culprit of ["a", "b", "c", "d"] ) {
    let search = start(["a", "b", "c", "d"]);
    let rounds = 0;
    while ( search.phase === "testing" ) {
      rounds++;
      const closure = withDependents(search.off, requires);
      search = advanceSearch(search, !closure.has(culprit), requires);
      assert.ok(rounds < 10, "the search ends");
    }
    assert.equal(search.culprit, culprit);
  }
});

test("the round switches off with dependents, the end restores all or keeps one off", () => {
  const requires = {plugin: ["lib"]};
  const search = beginSearch({suspects: ["lib"], original: {lib: true, plugin: true, other: true, off: false}, scope: "changed",
    now: "x"});
  assert.deepEqual(searchConfig(search, requires), {lib: false, plugin: false, other: true, off: false});
  assert.deepEqual(restoredConfig(search), search.original);
  assert.deepEqual(restoredConfig(search, "lib", requires), {lib: false, plugin: false, other: true, off: false});
});

test("a finished search does not move, a stored search is recognized", () => {
  const found = advanceSearch(start(["a"]), false);
  assert.equal(advanceSearch(found, true), found);
  assert.equal(roundsLeft(found), 0);
  assert.ok(isSearch(start(["a"])));
  for ( const bad of [null, {}, {active: false}, {active: true, candidates: [], off: []}] ) assert.ok(!isSearch(bad));
});

test("contradicting answers end the search instead of looping", () => {
  let search = start(["a", "b"]);
  search = advanceSearch(search, false);
  search = {...search, candidates: ["a"], off: ["a"]};
  assert.equal(advanceSearch(search, true).phase, "none");
});

test("a test run: errors per step, added up per package, Foundry's own apart", () => {
  assert.deepEqual(countDelta({"module:a": 2}, {"module:a": 3, "module:b": 1, "module:c": 0}),
    [{owner: "module:a", count: 1}, {owner: "module:b", count: 1}]);
  const summary = summarizeTrial([
    {id: "actor", name: "Alda", ms: 100, errors: [{owner: "module:a", count: 2, message: "boom"}]},
    {id: "item", name: "Rope", ms: 2500, errors: [{owner: "module:a", count: 1, message: "later"}, {owner: "core", count: 4}]},
    {id: "journal", skipped: true, errors: []},
    {id: "scene", ms: 50, timedOut: true, errors: [{owner: "system:dnd5e", count: 1, message: "s"}]}
  ], {at: "now", deprecated: 3});
  assert.equal(summary.checks, 3);
  assert.equal(summary.ms, 2650);
  assert.equal(summary.other, 4);
  assert.equal(summary.deprecated, 3);
  assert.deepEqual(summary.slow, ["item", "scene"]);
  assert.deepEqual(summary.owners.map(o => [o.owner, o.count, o.message, o.steps]),
    [["module:a", 3, "boom", ["actor", "item"]], ["system:dnd5e", 1, "s", ["scene"]]]);
  const stored = storedTrial(summary);
  assert.equal(stored.steps, undefined);
  assert.equal(stored.owners.length, 2);
});

test("a clean test run marks the state as good at once, one with errors keeps them", () => {
  const history = [{core: "14", modules: [], good: false}, {core: "13", modules: [], good: true}];
  const clean = noteTrial(history, {at: "now", checks: 9, owners: [], other: 0}, "now");
  assert.equal(clean.history[0].good, true);
  assert.equal(clean.history[0].goodAt, "now");
  assert.equal(clean.history[0].trial.checks, 9);
  assert.equal(history[0].good, false, "the input stays as it was");
  const failed = noteTrial(history, {at: "now", checks: 9, owners: [{owner: "module:a", count: 2}], other: 0}, "now");
  assert.equal(failed.history[0].good, false);
  assert.deepEqual(failed.history[0].errors, {"module:a": 2});
  assert.deepEqual(noteTrial([], {owners: []}, "now").history, []);
});

test("the answers on top of the window", () => {
  const base = {hasPrevious: true, changes: 0, troubled: 0, trial: null, good: false};
  assert.equal(runStatus({...base, troubled: 1, trial: {}, good: true}).key, "trouble");
  assert.equal(runStatus({...base, trial: {}}).key, "tested");
  assert.equal(runStatus({...base, good: true, changes: 3}).key, "ran");
  assert.equal(runStatus({...base, changes: 3}).level, "warn");
  assert.equal(runStatus({...base, hasPrevious: false}).key, "first");
  assert.equal(runStatus(base).key, "untested");
  assert.deepEqual(updateStatus({blocked: 2, likely: 20, unknown: 2}), {level: "bad", key: "blocked", count: 2, open: 22});
  assert.equal(updateStatus({likely: 3}, 1).key, "breaks");
  assert.equal(updateStatus({update: 1, likely: 3}).key, "update");
  assert.equal(updateStatus({likely: 3}).key, "open");
  assert.equal(updateStatus({ready: 3}).key, "ready");
  assert.equal(backStatus({older: true, current: true}).key, "older");
  assert.equal(backStatus({older: false, current: true}).key, "current");
  assert.equal(backStatus({older: false, current: false}).level, "new");
});

test("the rows of the check: what needs attention open and first, a row in one group only", () => {
  const rows = [{id: 1, status: "likely", breaks: false}, {id: 2, status: "blocked", breaks: true}, {id: 3, status: "likely", breaks: true},
    {id: 4, status: "ready", breaks: false}, {id: 5, status: "unknown", breaks: false}, {id: 6, status: "update", breaks: false},
    {id: 7, status: "ready", breaks: true}];
  const groups = groupRows(rows);
  assert.deepEqual(groups.map(g => [g.key, g.rows.map(r => r.id), g.open]), [["blocked", [2], true], ["update", [6], true],
    ["breaks", [3], true], ["waiting", [1, 5], false], ["ready", [4, 7], false]]);
  assert.deepEqual(groupRows([]), []);
});

test("the headline counts each package once, old players' errors only while their module runs", () => {
  const running = new Set(["a", "b", "dnd5e"]);
  const is = id => running.has(id);
  assert.equal(countTroubled([[], [], [], []], [], is), 0);
  assert.equal(countTroubled([["a"], [], ["a"], []], [], is), 1, "one module named twice counts once");
  assert.equal(countTroubled([["a"], [], ["a"], []], ["old"], is), 1, "an old players' error of a module that is off does not count");
  assert.equal(countTroubled([[], [], [], []], ["old"], is), 0, "only such an error: the headline says all is well");
  assert.equal(countTroubled([[], [], [], []], ["b"], is), 1, "a players' error of a running module counts");
  assert.equal(countTroubled([[], ["off"], [], []], [], is), 1, "a module switched off because it does not fit still counts");
  assert.equal(countTroubled([["a"], ["dnd5e"], [], ["gone"]], ["b", "gone"], is), 4);
});
