/**
 * What no longer fits in the running installation: a module outside its compatibility range, a missing or switched off
 * dependency, a system outside the range a module was made for, and the status Foundry itself gave a package. Pure
 * code, no Foundry globals. Every finding names the declaration it is based on.
 */

import {minimumFits, maximumReaches} from "./rating.mjs";
import {hasVersion, isNewer} from "./versions.mjs";

/** Foundry's own availability names that are only a note: the package works, it just was not tested on this build. */
const NOTES = new Set(["UNVERIFIED_BUILD"]);

/** Availability names that mean nothing is wrong or nothing is known. */
const SILENT = new Set(["VERIFIED", "UNKNOWN"]);

/**
 * Is a version inside a range given as {minimum, maximum}?
 * @param {string} version
 * @param {{minimum?: string, maximum?: string}} [range]
 * @returns {boolean}
 */
export function inRange(version, range) {
  if ( !range ) return true;
  if ( hasVersion(range.minimum) && isNewer(range.minimum, version) ) return false;
  if ( hasVersion(range.maximum) && isNewer(version, range.maximum) ) return false;
  return true;
}

/**
 * Find what does not fit.
 * @param {object} env
 * @param {string} env.core
 * @param {{id: string, title: string, version: string, compat?: object}} env.system
 * @param {object[]} env.modules   {id, title, version, active, compat, requires: [{id, type, compat}],
 *                                  systems: [{id, compat}], availability: string|null}
 * @param {object} [options]
 * @param {Set<string>} [options.also]   Ids of switched off modules to check as well (to say why Foundry switched
 *                                       them off)
 * @returns {{id: string, title: string, kind: string, severity: "problem"|"note", data: object}[]}
 */
export function findProblems(env, {also = new Set()} = {}) {
  const found = [];
  const add = (item, kind, data = {}, severity = "problem") => found.push({id: item.id, title: item.title, kind,
    severity, data});
  const installed = new Map(env.modules.map(m => [m.id, m]));

  const checkCore = item => {
    const {minimum, maximum} = item.compat ?? {};
    if ( !minimumFits(minimum, env.core) ) add(item, "minimum", {minimum, core: env.core});
    else if ( !maximumReaches(maximum, env.core) ) add(item, "maximum", {maximum, core: env.core});
  };

  checkCore(env.system);
  if ( env.system.availability && !SILENT.has(env.system.availability) ) {
    add(env.system, "foundry", {name: env.system.availability}, NOTES.has(env.system.availability) ? "note" : "problem");
  }

  for ( const m of env.modules ) {
    if ( !m.active && !also.has(m.id) ) continue;
    checkCore(m);

    for ( const req of m.requires ?? [] ) {
      if ( (req.type ?? "module") === "system" ) {
        if ( req.id !== env.system.id ) add(m, "missingSystem", {id: req.id, system: env.system.id});
        else if ( !inRange(env.system.version, req.compat) ) {
          add(m, "dependencyVersion", {id: req.id, version: env.system.version, ...rangeOf(req.compat)});
        }
        continue;
      }
      const dep = installed.get(req.id);
      if ( !dep ) add(m, "missingDependency", {id: req.id});
      else if ( !dep.active ) add(m, "inactiveDependency", {id: req.id, title: dep.title});
      else if ( !inRange(dep.version, req.compat) ) {
        add(m, "dependencyVersion", {id: req.id, title: dep.title, version: dep.version, ...rangeOf(req.compat)});
      }
    }

    const systems = m.systems ?? [];
    if ( systems.length ) {
      const mine = systems.find(s => s.id === env.system.id);
      if ( !mine ) add(m, "otherSystem", {systems: systems.map(s => s.id).join(", "), system: env.system.id});
      else if ( !inRange(env.system.version, mine.compat) ) {
        add(m, "systemRange", {system: env.system.id, version: env.system.version, ...rangeOf(mine.compat)});
      }
    }

    if ( m.availability && !SILENT.has(m.availability) ) {
      add(m, "foundry", {name: m.availability}, NOTES.has(m.availability) ? "note" : "problem");
    }
  }
  const order = {problem: 0, note: 1};
  found.sort((a, b) => (order[a.severity] - order[b.severity]) || String(a.title).localeCompare(String(b.title)));
  return found;
}

/**
 * A range as two plain strings for display.
 * @param {{minimum?: string, maximum?: string}} [compat]
 * @returns {{minimum: string, maximum: string}}
 */
function rangeOf(compat) {
  return {minimum: hasVersion(compat?.minimum) ? String(compat.minimum) : "",
    maximum: hasVersion(compat?.maximum) ? String(compat.maximum) : ""};
}
