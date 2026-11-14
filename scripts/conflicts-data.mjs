/**
 * Where two active packages get in each other's way. Pure code, no Foundry globals: the bridge (conflicts.mjs) reads
 * Foundry into plain data, this file decides what is a conflict. Nothing here is a guess about code: every finding is
 * based on something a package declared (a key binding, a registered wrapper, a conflict in its manifest) or on what the
 * wrapper library itself reported.
 *
 * Owner keys are the ones of owners.mjs: "module:<id>", "system:<id>", "core", "world".
 *
 * Levels:
 *  - "bad":  confirmed. The authors declared the conflict, or the wrapper library says an override was lost.
 *  - "warn": two modules want the same thing. Probably a conflict, nothing proves it breaks.
 *  - "note": worth knowing, normally harmless. Shown folded and not counted.
 */

import {inRange} from "./problems.mjs";

/** Keys that are held down as a modifier. Several packages listening to them is normal, so they are never a conflict. */
export const HELD_KEYS = new Set(["ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft",
  "MetaRight"]);

/** Owners that belong to Sephral's modules. They are made to cooperate, so a clash between them never shows red. */
const OWN = /^module:sephrals-/;

/** The owner key for code that the wrapper library could not attribute to a package. */
export const UNKNOWN = "unknown";

/** The order of the levels, most important first. */
export const LEVEL_ORDER = {bad: 0, warn: 1, note: 2};

/** Packages that are only the passage for the calls of others and never a party of a conflict. */
const IGNORED_OWNERS = new Set(["module:lib-wrapper", "core", "world"]);

/**
 * The normal form of a key combination, the same for the same key whatever the order of the modifiers.
 * @param {string} key
 * @param {string[]} [modifiers]
 * @returns {string}
 */
export function comboOf(key, modifiers = []) {
  const order = ["Control", "Shift", "Alt", "Meta"];
  const mods = [...new Set(modifiers)].sort((a, b) => (order.indexOf(a) - order.indexOf(b)) || a.localeCompare(b));
  return [...mods, key].join("+");
}

/**
 * Key combinations that several packages react to.
 * @param {object[]} actions   {id, owner, name, bindings: [{key, modifiers}], down: boolean, up: boolean}
 *   down and up say whether the action has a handler for pressing and releasing the key
 * @returns {object[]}   Findings {id, kind: "key", level, owners, data: {combo, key, modifiers, names: [{owner, name}]}}
 */
export function keyConflicts(actions) {
  const byCombo = new Map();
  for ( const action of actions ) {
    for ( const binding of action.bindings ?? [] ) {
      if ( !binding?.key || HELD_KEYS.has(binding.key) ) continue;
      const combo = comboOf(binding.key, binding.modifiers);
      const entry = byCombo.get(combo) ?? {combo, key: binding.key, modifiers: [...(binding.modifiers ?? [])], list: []};
      // The same action twice on one combination (two bindings that only differ in order) counts once
      if ( !entry.list.some(other => other.id === action.id) ) entry.list.push(action);
      byCombo.set(combo, entry);
    }
  }
  const found = [];
  for ( const entry of byCombo.values() ) {
    // Two actions only get in each other's way when both listen to the same kind of event
    const down = entry.list.filter(a => a.down);
    const up = entry.list.filter(a => a.up);
    const rivals = new Map();
    for ( const group of [down, up] ) {
      if ( group.length < 2 ) continue;
      for ( const action of group ) rivals.set(action.id, action);
    }
    const list = [...rivals.values()];
    const owners = [...new Set(list.map(a => a.owner))];
    if ( owners.length < 2 ) continue;
    const modules = owners.filter(o => o.startsWith("module:"));
    // Foundry and the system share keys with each other all the time
    if ( !modules.length ) continue;
    // Two modules: they want the same key. A module with Foundry or the system: modules do this on purpose at a
    // higher precedence, so it is only a note
    const level = (modules.length >= 2) ? "warn" : "note";
    found.push({id: `key:${entry.combo}`, kind: "key", level, owners,
      data: {combo: entry.combo, key: entry.key, modifiers: entry.modifiers,
        names: list.map(a => ({owner: a.owner, name: a.name}))}});
  }
  return found;
}

/**
 * The name of a wrapper type as an upper case word. The wrapper library takes the word or its own constant, whose name
 * is the word.
 * @param {*} type
 * @returns {string}
 */
export function wrapperType(type) {
  const name = (typeof type === "string") ? type : (type?.name ?? String(type ?? ""));
  return String(name).toUpperCase() || "MIXED";
}

/**
 * Who wraps what, from the registrations the wrapper library announced. Two modules that replace the same method
 * completely cannot both win. A module that replaces it completely and another one that changes it as well is only
 * something to know.
 * @param {object} data
 * @param {{owner: string, target: string, type: string, id?: *}[]} [data.registrations]   Wrappers that are active
 * @param {{lost: string, by: string, target: string}[]} [data.lost]      Overrides the library says were replaced
 * @param {{owner: string, other: string, target: string, confirmed?: boolean}[]} [data.detected]   Conflicts the library
 *   detected itself. owner is the package that did it ("unknown" when the library could not tell), other the one it
 *   got in the way of. confirmed means a wrapper could not be registered at all.
 * @returns {object[]}   Findings: kind "overrideTwice" (bad), "libraryConflict" (warn), "replacedUnknown" and
 *   "overrideAndWrap" (note)
 */
export function wrapperConflicts({registrations = [], lost = [], detected = []} = {}) {
  const found = new Map();
  const pairKey = (kind, owners) => `${kind}:${[...owners].sort().join("|")}`;
  const add = (kind, level, owners, target) => {
    const id = pairKey(kind, owners);
    const entry = found.get(id) ?? {id, kind, level, owners: [...owners].sort(), data: {targets: []}};
    if ( target && !entry.data.targets.includes(target) ) entry.data.targets.push(target);
    found.set(id, entry);
    return entry;
  };
  const real = owner => owner && !IGNORED_OWNERS.has(owner);
  const unknown = owner => owner === UNKNOWN;

  const byTarget = new Map();
  for ( const reg of registrations ) {
    if ( !real(reg.owner) ) continue;
    const list = byTarget.get(reg.target) ?? [];
    list.push({...reg, type: wrapperType(reg.type)});
    byTarget.set(reg.target, list);
  }
  for ( const [target, list] of byTarget ) {
    const overriders = [...new Set(list.filter(r => r.type === "OVERRIDE").map(r => r.owner))];
    if ( overriders.length >= 2 ) add("overrideTwice", "bad", overriders, target);
    else if ( overriders.length === 1 ) {
      const others = [...new Set(list.filter(r => (r.type !== "OVERRIDE") && (r.type !== "LISTENER") && (r.owner !== overriders[0]))
        .map(r => r.owner))];
      for ( const other of others ) add("overrideAndWrap", "note", [overriders[0], other], target).data.overrider = overriders[0];
    }
  }
  for ( const entry of lost ) {
    if ( real(entry.lost) && real(entry.by) && (entry.lost !== entry.by) ) add("overrideTwice", "bad", [entry.lost, entry.by], entry.target);
  }
  for ( const entry of detected ) {
    if ( !real(entry.owner) || !real(entry.other) || (entry.owner === entry.other) || unknown(entry.other) ) continue;
    const owners = [entry.owner, entry.other];
    // The registration of a second override failed: confirmed
    if ( entry.confirmed && !unknown(entry.owner) ) add("overrideTwice", "bad", owners, entry.target);
    // Already named more exactly
    else if ( found.has(pairKey("overrideTwice", owners)) ) continue;
    // Something replaced a wrapped method without the library and the library could not say who
    else if ( unknown(entry.owner) ) add("replacedUnknown", "note", [entry.other], entry.target);
    else add("libraryConflict", "warn", owners, entry.target);
  }
  // A pair named as a conflict is not named a second time as a note
  for ( const [id, entry] of [...found] ) {
    if ( entry.kind !== "overrideAndWrap" ) continue;
    if ( ["overrideTwice", "libraryConflict"].some(kind => found.has(pairKey(kind, entry.owners))) ) found.delete(id);
  }
  return [...found.values()];
}

/**
 * Conflicts the authors declared in their manifests (relationships.conflicts). A declaration may be limited to a range
 * of versions of the other package.
 * @param {object} env
 * @param {{id: string, title: string, version: string}} env.system
 * @param {{id: string, title: string, version: string, active: boolean, conflicts?: {id: string, type?: string,
 *   compat?: {minimum?: string, maximum?: string}}[]}[]} env.modules
 * @returns {object[]}   Findings of the kind "declared", level "bad"
 */
export function declaredConflicts(env) {
  const active = new Map(env.modules.filter(m => m.active).map(m => [m.id, m]));
  const found = new Map();
  const consider = (owner, ownerKey, conflicts) => {
    for ( const entry of conflicts ?? [] ) {
      const isSystem = (entry.type ?? "module") === "system";
      const other = isSystem ? ((entry.id === env.system.id) ? env.system : null) : active.get(entry.id);
      if ( !other || !inRange(other.version, entry.compat) ) continue;
      const otherKey = `${isSystem ? "system" : "module"}:${other.id}`;
      if ( otherKey === ownerKey ) continue;
      const owners = [ownerKey, otherKey].sort();
      const id = `declared:${owners.join("|")}`;
      const existing = found.get(id);
      // Remember who declared it, in the order of the declarations
      if ( existing ) {
        if ( !existing.data.declaredBy.includes(ownerKey) ) existing.data.declaredBy.push(ownerKey);
      } else found.set(id, {id, kind: "declared", level: "bad", owners, data: {declaredBy: [ownerKey]}});
    }
  };
  for ( const m of env.modules ) {
    if ( m.active ) consider(m, `module:${m.id}`, m.conflicts);
  }
  return [...found.values()];
}

/**
 * Put all findings together: sorted by importance, Sephral's own modules never red, one finding per id.
 * @param {object[][]} lists
 * @returns {object[]}
 */
export function mergeConflicts(...lists) {
  const byId = new Map();
  for ( const finding of lists.flat() ) {
    if ( byId.has(finding.id) ) continue;
    const own = finding.owners.length && finding.owners.every(o => OWN.test(o) || (o === "core"));
    byId.set(finding.id, own && (finding.level !== "note") ? {...finding, level: "note", own: true} : finding);
  }
  return [...byId.values()].sort((a, b) => (LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]) || a.id.localeCompare(b.id));
}

/**
 * How many findings of each level.
 * @param {{level: string}[]} findings
 * @returns {{bad: number, warn: number, note: number, counted: number, owners: string[]}}   counted is bad plus warn,
 *   owners the module owner keys of the findings that are counted
 */
export function countConflicts(findings) {
  const result = {bad: 0, warn: 0, note: 0, counted: 0, owners: []};
  const owners = new Set();
  for ( const f of findings ) {
    result[f.level]++;
    if ( f.level !== "note" ) {
      result.counted++;
      f.owners.forEach(o => owners.add(o));
    }
  }
  result.owners = [...owners];
  return result;
}

/**
 * A readable key combination. Foundry's display names are used when the caller gives a function for them.
 * @param {string} key
 * @param {string[]} modifiers
 * @param {(key: string) => string} [display]
 * @returns {string}
 */
export function comboText(key, modifiers = [], display = k => k) {
  const names = {Control: "Ctrl", Shift: "Shift", Alt: "Alt", Meta: "Meta"};
  const shown = String(display(key) || key);
  return [...modifiers.map(m => names[m] ?? m), shown].join(" + ");
}
