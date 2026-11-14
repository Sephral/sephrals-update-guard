/**
 * The conflict finder, the part that touches Foundry. Read only: nothing is wrapped, replaced or changed.
 *  - key bindings are read from game.keybindings,
 *  - wrappers are known from the public hooks of the wrapper library (libWrapper.Register and the others), which the
 *    module listens to from its first line, because the module loads as a library before the others,
 *  - declared conflicts come from the manifests (relationships.conflicts).
 * The detection itself is in conflicts-data.mjs.
 */

import {MODULE_ID} from "./config.mjs";
import {UNKNOWN, countConflicts, declaredConflicts, keyConflicts, mergeConflicts, wrapperConflicts} from "./conflicts-data.mjs";

/** What the hooks of the wrapper library told. */
export const wrapperLog = {
  listening: false,
  /** @type {Map<*, {id: string, target: string, type: *}>} */
  registrations: new Map(),
  /** @type {{lost: string, by: string, target: string}[]} */
  lost: [],
  /** @type {{id: string, other: string, target: string, confirmed: boolean}[]} */
  detected: []
};

/**
 * The owner key of a package id the wrapper library gave.
 * @param {string} id
 * @returns {string}
 */
function ownerOfPackage(id) {
  // The library names code it cannot attribute «unknown»
  if ( !id || /^«/.test(String(id)) ) return UNKNOWN;
  if ( game.modules?.has(id) ) return `module:${id}`;
  if ( game.system?.id === id ) return `system:${id}`;
  return (id === "world") ? "world" : `module:${id}`;
}

/**
 * Listen to the hooks of the wrapper library. Safe to call twice. The callbacks return nothing: a hook that returns
 * false tells the library to ignore a conflict, and this module must never change what the library does.
 */
export function startConflictWatch() {
  if ( wrapperLog.listening || !globalThis.Hooks ) return;
  wrapperLog.listening = true;
  const guard = fn => (...args) => {
    try {
      fn(...args);
    } catch(err) {
      console.warn(`${MODULE_ID} | The conflict watch could not read a hook of the wrapper library`, err);
    }
  };
  Hooks.on("libWrapper.Register", guard((id, target, type, options, wrapperId) => {
    wrapperLog.registrations.set(`${id}|${wrapperId ?? `${target}|${wrapperLog.registrations.size}`}`,
      {id: String(id), target: String(target), type});
  }));
  const forget = guard((id, target, wrapperId) => {
    wrapperLog.registrations.delete(`${id}|${wrapperId}`);
  });
  Hooks.on("libWrapper.Unregister", forget);
  Hooks.on("libWrapper.UnregisterAll", guard(id => {
    for ( const [key, entry] of wrapperLog.registrations ) {
      if ( entry.id === String(id) ) wrapperLog.registrations.delete(key);
    }
  }));
  Hooks.on("libWrapper.OverrideLost", guard((lostId, byId, target) => {
    wrapperLog.lost.push({id: String(lostId), by: String(byId), target: String(target)});
  }));
  // The library gives a target only when a registration failed (confirmed), a conflict it noticed by watching calls comes
  // without one and has the names of the method as the fourth argument
  Hooks.on("libWrapper.ConflictDetected", guard((id, otherId, target, names) => {
    wrapperLog.detected.push({id: String(id), other: String(otherId), target: String(target ?? names?.[0] ?? ""),
      confirmed: target != null});
  }));
}

/**
 * The owner key of the namespace of a key binding.
 * @param {string} namespace
 * @returns {string}
 */
function ownerOfNamespace(namespace) {
  if ( namespace === "core" ) return "core";
  if ( game.system?.id === namespace ) return `system:${namespace}`;
  if ( game.modules?.has(namespace) ) return `module:${namespace}`;
  return "world";
}

/**
 * Every registered key binding as plain data.
 * @returns {object[]}
 */
export function readKeyActions() {
  const keys = game.keybindings;
  if ( !keys?.actions || !keys.bindings ) return [];
  const result = [];
  for ( const [id, config] of keys.actions ) {
    const namespace = config.namespace ?? id.split(".")[0];
    const bindings = (keys.bindings.get(id) ?? []).filter(b => b?.key).map(b => ({key: b.key, modifiers: [...(b.modifiers ?? [])]}));
    if ( !bindings.length ) continue;
    let name = config.name ?? id;
    try {
      name = game.i18n.localize(name);
    } catch {
      name = String(name);
    }
    result.push({id, owner: ownerOfNamespace(namespace), name, bindings, down: typeof config.onDown === "function",
      up: typeof config.onUp === "function"});
  }
  return result;
}

/**
 * The conflicts the manifests declare, as plain data.
 * @returns {{system: object, modules: object[]}}
 */
export function readDeclared() {
  const range = compat => ({minimum: compat?.minimum ? String(compat.minimum) : "", maximum: compat?.maximum ? String(compat.maximum) : ""});
  return {
    system: {id: game.system.id, title: String(game.system.title ?? game.system.id), version: String(game.system.version ?? "")},
    modules: [...game.modules.values()].map(m => ({id: m.id, title: String(m.title ?? m.id), version: String(m.version ?? ""),
      active: !!m.active, conflicts: [...(m.relationships?.conflicts ?? [])].map(c => ({id: c.id, type: c.type ?? "module",
        compat: range(c.compatibility)}))}))
  };
}

/**
 * The wrappers as plain data for the detection.
 * @returns {object}
 */
export function readWrappers() {
  return {
    registrations: [...wrapperLog.registrations.values()].map(r => ({owner: ownerOfPackage(r.id), target: r.target, type: r.type})),
    lost: wrapperLog.lost.map(l => ({lost: ownerOfPackage(l.id), by: ownerOfPackage(l.by), target: l.target})),
    detected: wrapperLog.detected.map(d => ({owner: ownerOfPackage(d.id), other: ownerOfPackage(d.other), target: d.target,
      confirmed: d.confirmed}))
  };
}

/**
 * Look for conflicts between the active packages.
 * @returns {{findings: object[], counts: ReturnType<typeof countConflicts>, wrapperLibrary: boolean}}
 */
export function findConflicts() {
  let findings = [];
  try {
    findings = mergeConflicts(declaredConflicts(readDeclared()), wrapperConflicts(readWrappers()), keyConflicts(readKeyActions()));
  } catch(err) {
    console.error(`${MODULE_ID} | The conflict finder failed`, err);
  }
  return {findings, counts: countConflicts(findings), wrapperLibrary: !!game.modules.get("lib-wrapper")?.active};
}

/**
 * A key combination as the player knows it: Foundry's name of the key.
 * @param {string} key
 * @returns {string}
 */
export function displayKey(key) {
  try {
    return globalThis.KeyboardManager?.getKeycodeDisplayString?.(key) ?? key;
  } catch {
    return key;
  }
}

/** Open Foundry's key settings. */
export function openControls() {
  const ControlsConfig = foundry.applications?.sidebar?.apps?.ControlsConfig;
  if ( ControlsConfig ) return new ControlsConfig().render({force: true});
  return game.settings.sheet?.render?.({force: true});
}
