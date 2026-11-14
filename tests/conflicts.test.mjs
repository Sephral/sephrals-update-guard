import assert from "node:assert/strict";
import test from "node:test";

import {comboOf, comboText, countConflicts, declaredConflicts, keyConflicts, mergeConflicts, wrapperConflicts,
  wrapperType} from "../scripts/conflicts-data.mjs";
import {readyAnswer} from "../scripts/ready-data.mjs";

/** A key action as the bridge reads it. */
const action = (owner, name, key, modifiers = [], extra = {}) => ({id: `${owner}.${name}`, owner, name, bindings: [{key, modifiers}],
  down: true, up: false, ...extra});

test("the same key with the same modifiers in any order is one combination", () => {
  assert.equal(comboOf("KeyK", ["Shift", "Control"]), comboOf("KeyK", ["Control", "Shift"]));
  assert.notEqual(comboOf("KeyK", ["Shift"]), comboOf("KeyK"));
  assert.equal(comboText("KeyK", ["Control", "Shift"], k => "K"), "Ctrl + Shift + K");
});

test("two modules on the same key are a likely conflict", () => {
  const found = keyConflicts([action("module:a", "open", "KeyK", ["Control"]), action("module:b", "show", "KeyK", ["Control"])]);
  assert.equal(found.length, 1);
  assert.equal(found[0].level, "warn");
  assert.deepEqual(found[0].owners, ["module:a", "module:b"]);
  assert.equal(found[0].data.names.length, 2);
});

test("the same key with other modifiers is no conflict", () => {
  assert.deepEqual(keyConflicts([action("module:a", "x", "KeyK", ["Control"]), action("module:b", "y", "KeyK", ["Shift"]),
    action("module:c", "z", "KeyK")]), []);
});

test("keys that are only held down as a modifier never conflict", () => {
  assert.deepEqual(keyConflicts([action("module:a", "x", "AltLeft"), action("module:b", "y", "AltLeft"),
    action("core", "highlight", "AltLeft")]), []);
});

test("a press handler and a release handler on one key do not meet", () => {
  const found = keyConflicts([action("module:a", "x", "KeyK", [], {down: true, up: false}),
    action("module:b", "y", "KeyK", [], {down: false, up: true})]);
  assert.deepEqual(found, []);
  assert.equal(keyConflicts([action("module:a", "x", "KeyK", [], {down: false, up: true}),
    action("module:b", "y", "KeyK", [], {down: false, up: true})]).length, 1);
});

test("an action without any handler (an open binding) is no party", () => {
  assert.deepEqual(keyConflicts([action("module:a", "x", "KeyK", [], {down: false}), action("module:b", "y", "KeyK")]), []);
});

test("a module with Foundry is only a note, Foundry with the system nothing", () => {
  const withCore = keyConflicts([action("core", "undo", "KeyZ", ["Control"]), action("module:a", "x", "KeyZ", ["Control"])]);
  assert.equal(withCore.length, 1);
  assert.equal(withCore[0].level, "note");
  assert.deepEqual(keyConflicts([action("core", "undo", "KeyZ", ["Control"]), action("system:dnd5e", "x", "KeyZ", ["Control"])]), []);
});

test("two actions of one module on one key are no conflict", () => {
  assert.deepEqual(keyConflicts([action("module:a", "x", "KeyK"), action("module:a", "y", "KeyK")]), []);
});

test("three modules on one key give one finding naming all", () => {
  const found = keyConflicts(["a", "b", "c"].map(id => action(`module:${id}`, "x", "KeyJ")));
  assert.equal(found.length, 1);
  assert.equal(found[0].owners.length, 3);
});

/* -------------------------------------------- */

test("the wrapper type is read from the word or from the constant of the library", () => {
  assert.equal(wrapperType("override"), "OVERRIDE");
  assert.equal(wrapperType({name: "OVERRIDE"}), "OVERRIDE");
  assert.equal(wrapperType(undefined), "MIXED");
});

test("two overrides of one method by two modules are confirmed", () => {
  const found = wrapperConflicts({registrations: [{owner: "module:a", target: "Token.prototype.draw", type: "OVERRIDE"},
    {owner: "module:b", target: "Token.prototype.draw", type: {name: "OVERRIDE"}}]});
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, "overrideTwice");
  assert.equal(found[0].level, "bad");
  assert.deepEqual(found[0].data.targets, ["Token.prototype.draw"]);
});

test("plain wraps of one method by many modules are fine", () => {
  const regs = ["a", "b", "c"].map(id => ({owner: `module:${id}`, target: "Token.prototype.draw", type: "WRAPPER"}));
  regs.push({owner: "module:d", target: "Token.prototype.draw", type: "MIXED"}, {owner: "module:e", target: "Token.prototype.draw", type: "LISTENER"});
  assert.deepEqual(wrapperConflicts({registrations: regs}), []);
});

test("an override with a wrap by another module is only a note, listeners do not count", () => {
  const found = wrapperConflicts({registrations: [{owner: "module:a", target: "T.m", type: "OVERRIDE"},
    {owner: "module:b", target: "T.m", type: "WRAPPER"}, {owner: "module:c", target: "T.m", type: "LISTENER"}]});
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, "overrideAndWrap");
  assert.equal(found[0].level, "note");
  assert.equal(found[0].data.overrider, "module:a");
});

test("the library's own packages and the world are never a party", () => {
  assert.deepEqual(wrapperConflicts({registrations: [{owner: "module:lib-wrapper", target: "T.m", type: "OVERRIDE"},
    {owner: "module:a", target: "T.m", type: "OVERRIDE"}]}), []);
});

test("a lost override and a conflict the library detected are named once", () => {
  const found = wrapperConflicts({
    registrations: [{owner: "module:a", target: "T.m", type: "OVERRIDE"}, {owner: "module:b", target: "T.m", type: "OVERRIDE"}],
    lost: [{lost: "module:a", by: "module:b", target: "T.m"}],
    detected: [{owner: "module:a", other: "module:b", target: "T.m"}]
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].level, "bad");
  const detectedOnly = wrapperConflicts({detected: [{owner: "module:a", other: "module:b", target: "T.m"},
    {owner: "module:b", other: "module:a", target: "T.n"}]});
  assert.equal(detectedOnly.length, 1);
  assert.equal(detectedOnly[0].level, "warn");
  assert.deepEqual(detectedOnly[0].data.targets, ["T.m", "T.n"]);
});

test("a registration that failed is a confirmed double override, a replacement by unknown code only a note", () => {
  const failed = wrapperConflicts({detected: [{owner: "module:b", other: "module:a", target: "T.m", confirmed: true}]});
  assert.equal(failed.length, 1);
  assert.equal(failed[0].kind, "overrideTwice");
  assert.equal(failed[0].level, "bad");
  const unknown = wrapperConflicts({detected: [{owner: "unknown", other: "module:a", target: "T.m", confirmed: false},
    {owner: "unknown", other: "module:b", target: "T.m", confirmed: false}]});
  assert.deepEqual(unknown.map(f => [f.kind, f.level, f.owners]), [["replacedUnknown", "note", ["module:a"]], ["replacedUnknown", "note", ["module:b"]]]);
  // Code of a module that replaced a wrapped method outside the library is named
  const known = wrapperConflicts({detected: [{owner: "module:c", other: "module:a", target: "T.m", confirmed: false}]});
  assert.equal(known[0].kind, "libraryConflict");
  assert.equal(known[0].level, "warn");
});

/* -------------------------------------------- */

const system = {id: "dnd5e", title: "D&D", version: "5.3.3"};

test("a declared conflict counts when both are active, and only once when both declare it", () => {
  const modules = [
    {id: "a", version: "1", active: true, conflicts: [{id: "b", type: "module", compat: {}}]},
    {id: "b", version: "2", active: true, conflicts: [{id: "a", type: "module", compat: {}}]},
    {id: "c", version: "1", active: false, conflicts: [{id: "a", type: "module", compat: {}}]}
  ];
  const found = declaredConflicts({system, modules});
  assert.equal(found.length, 1);
  assert.equal(found[0].level, "bad");
  assert.deepEqual(found[0].owners, ["module:a", "module:b"]);
  assert.deepEqual(found[0].data.declaredBy.sort(), ["module:a", "module:b"]);
});

test("a declared conflict with a range only counts inside the range, an inactive module never", () => {
  const make = version => [{id: "a", version: "1", active: true, conflicts: [{id: "b", type: "module", compat: {minimum: "2", maximum: "3"}}]},
    {id: "b", version, active: true}];
  assert.equal(declaredConflicts({system, modules: make("2.5")}).length, 1);
  assert.equal(declaredConflicts({system, modules: make("1.9")}).length, 0);
  assert.equal(declaredConflicts({system, modules: make("3.1")}).length, 0);
  const off = make("2.5");
  off[1].active = false;
  assert.equal(declaredConflicts({system, modules: off}).length, 0);
});

test("a module can declare a conflict with the game system", () => {
  const found = declaredConflicts({system, modules: [{id: "a", version: "1", active: true,
    conflicts: [{id: "dnd5e", type: "system", compat: {maximum: "5.9"}}, {id: "pf2e", type: "system", compat: {}}]}]});
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].owners, ["module:a", "system:dnd5e"]);
});

/* -------------------------------------------- */

test("Sephral's own modules never show red or yellow, others are kept", () => {
  const own = declaredConflicts({system, modules: [
    {id: "sephrals-a", version: "1", active: true, conflicts: [{id: "sephrals-b", type: "module", compat: {}}]},
    {id: "sephrals-b", version: "1", active: true}]});
  const foreign = keyConflicts([action("module:sephrals-a", "x", "KeyK"), action("module:other", "y", "KeyK")]);
  const merged = mergeConflicts(own, foreign, keyConflicts([action("module:sephrals-a", "x", "KeyL"), action("module:sephrals-b", "y", "KeyL")]));
  assert.equal(merged.find(f => f.id === "key:KeyK").level, "warn");
  assert.equal(merged.find(f => f.id === "key:KeyL").level, "note");
  assert.equal(merged.find(f => f.kind === "declared").level, "note");
});

test("findings are sorted by importance and counted without the notes", () => {
  const merged = mergeConflicts(
    keyConflicts([action("module:a", "x", "KeyK"), action("module:b", "y", "KeyK"), action("core", "z", "KeyQ"), action("module:c", "z", "KeyQ")]),
    declaredConflicts({system, modules: [{id: "a", version: "1", active: true, conflicts: [{id: "b", type: "module"}]}, {id: "b", version: "1", active: true}]}));
  assert.deepEqual(merged.map(f => f.level), ["bad", "warn", "note"]);
  const counts = countConflicts(merged);
  assert.equal(counts.counted, 2);
  assert.equal(counts.note, 1);
  assert.deepEqual(counts.owners.sort(), ["module:a", "module:b"]);
});

test("a clean world has no findings", () => {
  assert.deepEqual(mergeConflicts(keyConflicts([action("core", "undo", "KeyZ", ["Control"]), action("module:a", "x", "KeyK")]),
    wrapperConflicts({registrations: [{owner: "module:a", target: "T.m", type: "WRAPPER"}, {owner: "module:b", target: "T.m", type: "WRAPPER"}]}),
    declaredConflicts({system, modules: [{id: "a", version: "1", active: true, conflicts: []}]})), []);
});

test("Ready for tonight: conflicts are a warning after the other findings", () => {
  const clean = readyAnswer({connected: 2});
  assert.equal(clean.level, "good");
  const conflicts = readyAnswer({connected: 2, conflicts: 2});
  assert.equal(conflicts.level, "warn");
  assert.equal(conflicts.key, "conflicts");
  assert.equal(conflicts.next, "conflictList");
  assert.equal(readyAnswer({fitProblems: 1, conflicts: 2}).key, "fit");
  assert.equal(readyAnswer({trialModules: ["x"], conflicts: 2}).key, "errors");
  assert.ok(readyAnswer({trialModules: ["x"], conflicts: 2}).findings.includes("conflicts"));
});

/* -------------------------------------------- */
/*  The bridge with a fake Foundry              */
/* -------------------------------------------- */

test("the bridge reads a fake key registry and the hooks of the wrapper library", async () => {
  const handlers = new Map();
  globalThis.Hooks = {on: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn])};
  globalThis.game = {
    i18n: {localize: key => `L:${key}`},
    system: {id: "dnd5e", title: "D&D", version: "5.3.3"},
    modules: new Map([["a", {id: "a", title: "A", version: "1", active: true, relationships: {conflicts: new Set([{id: "b", type: "module"}])}}],
      ["b", {id: "b", title: "B", version: "1", active: true, relationships: {conflicts: new Set()}}]]),
    keybindings: {
      actions: new Map([["a.open", {namespace: "a", name: "Open", onDown: () => true}], ["b.show", {namespace: "b", name: "Show", onDown: () => true}],
        ["core.undo", {namespace: "core", name: "Undo", onDown: () => true}], ["a.none", {namespace: "a", name: "None", onDown: () => true}]]),
      bindings: new Map([["a.open", [{key: "KeyK", modifiers: ["Control"]}]], ["b.show", [{key: "KeyK", modifiers: ["Control"]}]],
        ["core.undo", [{key: "KeyZ", modifiers: ["Control"]}]], ["a.none", []]])
    }
  };
  const {findConflicts, readKeyActions, startConflictWatch, wrapperLog} = await import("../scripts/conflicts.mjs");
  startConflictWatch();
  startConflictWatch();
  assert.equal(handlers.get("libWrapper.Register").length, 1, "listening twice installs once");
  const call = (name, ...args) => handlers.get(name).forEach(fn => fn(...args));
  call("libWrapper.Register", "a", "Token.prototype.draw", {name: "OVERRIDE"}, {}, 1);
  call("libWrapper.Register", "b", "Token.prototype.draw", "OVERRIDE", {}, 3);
  assert.equal(wrapperLog.registrations.size, 2);
  assert.equal(readKeyActions().length, 3, "an action without a binding is left out");
  assert.equal(readKeyActions()[0].name, "L:Open");
  let found = findConflicts();
  assert.deepEqual(found.findings.map(f => f.kind).sort(), ["declared", "key", "overrideTwice"]);
  assert.equal(found.counts.counted, 3);
  // The callbacks never return false, which would tell the library to ignore a conflict
  assert.equal(handlers.get("libWrapper.OverrideLost")[0]("a", "b", "x"), undefined);
  assert.equal(handlers.get("libWrapper.ConflictDetected")[0]("a", "b", "x"), undefined);
  // Unregistering takes a wrapper away again
  call("libWrapper.Unregister", "b", "Token.prototype.draw", 3);
  found = findConflicts();
  assert.ok(!found.findings.some(f => f.id.startsWith("overrideTwice") && !wrapperLog.lost.length));
  call("libWrapper.UnregisterAll", "a");
  assert.equal(wrapperLog.registrations.size, 0);
  delete globalThis.Hooks;
  delete globalThis.game;
});
