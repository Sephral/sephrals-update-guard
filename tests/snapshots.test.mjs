import assert from "node:assert/strict";
import test from "node:test";

import {HISTORY_LIMIT, countChanges, diffStates, lastGood, parseHistory, recordState, rollbackTargets, serializeHistory,
  settleLatest, stateKey} from "../scripts/snapshots.mjs";

const mod = (id, version, active = true) => ({id, title: id.toUpperCase(), version, active});
const state = (core, system, modules) => ({core, system: {id: "dnd5e", title: "D&D", version: system}, modules});

test("stateKey ignores the order of the modules and the data around them", () => {
  const a = state("14.370", "6.0.6", [mod("a", "1"), mod("b", "2")]);
  const b = state("14.370", "6.0.6", [mod("b", "2"), mod("a", "1")]);
  assert.equal(stateKey(a), stateKey(b));
  assert.notEqual(stateKey(a), stateKey(state("14.370", "6.0.6", [mod("a", "1"), mod("b", "2", false)])));
});

test("diffStates finds every kind of change", () => {
  const before = state("13.351", "5.3.3", [mod("up", "1.0"), mod("down", "2.0"), mod("gone", "1"), mod("on", "1", false),
    mod("off", "1"), mod("same", "1")]);
  const after = state("14.370", "6.0.6", [mod("up", "1.1"), mod("down", "1.9"), mod("on", "1"), mod("off", "1", false),
    mod("same", "1"), mod("fresh", "3")]);
  const diff = diffStates(before, after);
  assert.equal(diff.any, true);
  assert.deepEqual(diff.core, {from: "13.351", to: "14.370", newer: true});
  assert.equal(diff.system.newer, true);
  assert.deepEqual(diff.updated.map(m => [m.id, m.newer]), [["DOWN".toLowerCase(), false], ["up", true]]);
  assert.deepEqual(diff.added.map(m => m.id), ["fresh"]);
  assert.deepEqual(diff.removed.map(m => m.id), ["gone"]);
  assert.deepEqual(diff.activated.map(m => m.id), ["on"]);
  assert.deepEqual(diff.deactivated.map(m => m.id), ["off"]);
  assert.equal(countChanges(diff), 8);
});

test("diffStates: no previous state or no change gives nothing", () => {
  const s = state("14.370", "6.0.6", [mod("a", "1")]);
  assert.equal(diffStates(null, s).any, false);
  assert.equal(diffStates(s, structuredClone(s)).any, false);
  const other = state("14.370", "6.0.6", [{...mod("a", "1"), title: "Renamed"}]);
  assert.equal(diffStates(s, other).any, false);
});

test("a system switch is reported as another system", () => {
  const diff = diffStates(state("14.370", "6.0.6", []), {...state("14.370", "1.0", []), system: {id: "pf2e", title: "PF2e", version: "1.0"}});
  assert.equal(diff.system.newId, true);
  assert.equal(diff.system.fromId, "dnd5e");
});

test("recordState saves a change, only touches the date when nothing changed, keeps 12 different states", () => {
  const t0 = "2026-01-01T00:00:00.000Z";
  let r = recordState([], state("14.370", "6.0.6", [mod("a", "1")]), t0);
  assert.equal(r.first, true);
  assert.equal(r.changed, false);
  assert.equal(r.history.length, 1);
  const again = recordState(r.history, state("14.370", "6.0.6", [mod("a", "1")]), "2026-01-02T00:00:00.000Z");
  assert.equal(again.changed, false);
  assert.equal(again.history.length, 1);
  assert.equal(again.history[0].at, t0);
  assert.equal(again.history[0].seen, "2026-01-02T00:00:00.000Z");
  const next = recordState(again.history, state("14.370", "6.0.6", [mod("a", "2")]), "2026-01-03T00:00:00.000Z");
  assert.equal(next.changed, true);
  assert.equal(next.history.length, 2);
  assert.equal(next.previous.modules[0].version, "1");
  let history = next.history;
  for ( let i = 3; i < 30; i++ ) history = recordState(history, state("14.370", "6.0.6", [mod("a", String(i))]), `2026-02-${String(i).padStart(2, "0")}T00:00:00.000Z`).history;
  assert.equal(history.length, HISTORY_LIMIT);
});

test("a state that comes back moves its old entry to the front and keeps the good mark", () => {
  const a = state("14.370", "6.0.6", [mod("a", "1")]);
  const b = state("14.370", "6.0.6", [mod("a", "2")]);
  let r = recordState([], a, "2026-01-01T00:00:00.000Z");
  r = {...r, history: settleLatest(r.history, {}, "2026-01-01T00:10:00.000Z").history};
  r = recordState(r.history, b, "2026-01-02T00:00:00.000Z");
  const back = recordState(r.history, a, "2026-01-03T00:00:00.000Z");
  assert.equal(back.history.length, 2);
  assert.equal(back.history[0].good, true);
  assert.equal(back.history[0].at, "2026-01-03T00:00:00.000Z");
  assert.equal(back.changed, true);
});

test("settleLatest marks a quiet start good and keeps the errors of a noisy one", () => {
  const history = recordState([], state("14.370", "6.0.6", [mod("a", "1")]), "2026-01-01T00:00:00.000Z").history;
  const good = settleLatest(history, {}, "2026-01-01T00:10:00.000Z");
  assert.equal(good.good, true);
  assert.equal(good.history[0].goodAt, "2026-01-01T00:10:00.000Z");
  const bad = settleLatest(history, {"module:a": 2}, "2026-01-01T00:10:00.000Z");
  assert.equal(bad.good, false);
  assert.equal(bad.history[0].good, false);
  assert.deepEqual(bad.history[0].errors, {"module:a": 2});
  assert.equal(lastGood(bad.history), null);
  assert.equal(lastGood(good.history).goodAt, "2026-01-01T00:10:00.000Z");
});

test("rollbackTargets names the last good version of every module", () => {
  let history = recordState([], state("14.370", "6.0.6", [mod("a", "1"), mod("b", "5"), mod("c", "1")]), "2026-01-01T00:00:00.000Z").history;
  history = settleLatest(history, {}, "2026-01-01T00:10:00.000Z").history;
  history = recordState(history, state("14.370", "6.0.6", [mod("a", "2"), mod("b", "5"), mod("c", "1"), mod("d", "1")]), "2026-01-02T00:00:00.000Z").history;
  const rows = rollbackTargets(history, history[0]);
  const a = rows.find(r => r.id === "a");
  assert.equal(a.good, "1");
  assert.equal(a.changed, true);
  assert.equal(a.downgrade, true);
  assert.equal(rows.find(r => r.id === "b").changed, false);
  assert.equal(rows.find(r => r.id === "d").good, null);
  assert.equal(rows[0].id, "a");
});

test("parseHistory survives anything", () => {
  assert.deepEqual(parseHistory(""), []);
  assert.deepEqual(parseHistory("{not json"), []);
  assert.deepEqual(parseHistory(JSON.stringify({history: "no"})), []);
  assert.deepEqual(parseHistory(JSON.stringify([null, 4, {core: 14}])), []);
  const history = recordState([], state("14.370", "6.0.6", [mod("a", "1")]), "2026-01-01T00:00:00.000Z").history;
  assert.deepEqual(parseHistory(serializeHistory(history)), history);
});
