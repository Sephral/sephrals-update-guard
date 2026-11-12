/**
 * The search for the module behind a problem, on the Foundry side: reads and stores the search, switches the modules
 * and reloads. The decisions are in culprit.mjs. While a search runs the start of a world records nothing, so the
 * rounds do not end up in the history.
 */

import {MODULE_ID} from "./config.mjs";
import {advanceSearch, beginSearch, isSearch, restoredConfig, searchConfig, suspectsSince, withDependents, withEvidence} from "./culprit.mjs";
import {playerEvidence} from "./players.mjs";
import {lastGood} from "./snapshots.mjs";
import {collectState, readHistory} from "./state.mjs";

/**
 * Which modules each active module needs.
 * @param {object} [state]
 * @returns {Record<string, string[]>}
 */
export function moduleNeeds(state = collectState()) {
  return Object.fromEntries(state.modules.filter(m => m.active)
    .map(m => [m.id, m.requires.filter(r => (r.type ?? "module") === "module").map(r => r.id)]));
}

/**
 * The search that is running, or null.
 * @returns {object|null}
 */
export function readSearch() {
  const value = game.settings.get(MODULE_ID, "search");
  return isSearch(value) ? value : null;
}

/** The module configuration right now. */
function currentConfig() {
  return foundry.utils.deepClone(game.settings.get("core", "moduleConfiguration"));
}

/**
 * Write a module configuration and the search, then reload.
 * @param {Record<string, boolean>} config
 * @param {object|null} search
 */
async function apply(config, search) {
  await game.settings.set(MODULE_ID, "search", search ?? {});
  await game.settings.set("core", "moduleConfiguration", config);
  foundry.utils.debouncedReload();
}

/**
 * Who is under suspicion: the modules that changed since the last state that ran well, otherwise every active module.
 * Modules that errors in the players' browsers point at come first, and are suspects even when nothing changed in them.
 * @returns {{ids: string[], scope: "changed"|"all", since: string, evidence: string[]}}
 */
export function suspects() {
  const state = collectState();
  const history = readHistory();
  const reference = lastGood(history.slice(1)) ?? history[1] ?? null;
  const active = state.modules.filter(m => m.active).map(m => m.id);
  const changed = suspectsSince(reference, state, MODULE_ID);
  const hints = playerEvidence();
  if ( changed.length ) {
    const found = withEvidence(changed, hints, active, MODULE_ID);
    return {ids: found.ids, scope: "changed", since: reference.goodAt ?? reference.at, evidence: found.evidence};
  }
  const found = withEvidence(active.filter(id => id !== MODULE_ID), hints, active, MODULE_ID);
  return {ids: found.ids, scope: "all", since: "", evidence: found.evidence};
}

/** Start a search with the given suspects. */
export async function startSearch({ids, scope}) {
  const search = beginSearch({suspects: ids, original: currentConfig(), scope, now: new Date().toISOString()});
  await apply(searchConfig(search, moduleNeeds()), search);
}

/**
 * The GM's answer. The dependencies are taken from the installed manifests, not only from what is on right now: a
 * module that is off in this round has no say otherwise.
 * @param {boolean} stillBroken
 * @returns {Promise<boolean>}   Is a reload coming?
 */
export async function answerSearch(stillBroken) {
  const search = readSearch();
  if ( !search ) return false;
  const needs = allNeeds();
  const next = advanceSearch(search, stillBroken, needs);
  // At the end of a search everything comes back on, the GM sees the result in a complete world
  if ( next.phase !== "testing" ) await apply(next.original, next);
  else await apply(searchConfig(next, needs), next);
  return true;
}

/** Which modules each module of the original configuration needs. */
function allNeeds() {
  const state = collectState();
  const on = readSearch()?.original ?? {};
  return Object.fromEntries(state.modules.filter(m => on[m.id])
    .map(m => [m.id, m.requires.filter(r => (r.type ?? "module") === "module").map(r => r.id)]));
}

/** The changed modules were not it: search the other active modules. */
export async function widenSearch() {
  const search = readSearch();
  if ( !search ) return;
  const cleared = search.scope === "changed" ? [...search.candidates] : [];
  const others = Object.entries(search.original).filter(([id, on]) => on && (id !== MODULE_ID) && !cleared.includes(id)
    && game.modules.has(id)).map(([id]) => id);
  const next = beginSearch({suspects: others, original: search.original, scope: "all", now: new Date().toISOString(), cleared});
  await apply(searchConfig(next, allNeeds()), next);
}

/**
 * End the search and restore the modules. When the modules are as they should be already, no reload is needed.
 * @param {string|null} [keepOff]   A module that stays off, with what needs it
 * @returns {Promise<boolean>}       Is a reload coming?
 */
export async function stopSearch(keepOff = null) {
  const search = readSearch();
  if ( !search ) return false;
  const config = restoredConfig(search, keepOff, allNeeds());
  const current = game.settings.get("core", "moduleConfiguration");
  const same = Object.keys({...config, ...current}).every(id => !!config[id] === !!current[id]);
  if ( same ) {
    await game.settings.set(MODULE_ID, "search", {});
    return false;
  }
  await apply(config, null);
  return true;
}

/**
 * Switch a module off, with what needs it, and reload.
 * @param {string} id
 */
export async function switchOff(id) {
  const config = currentConfig();
  for ( const off of withDependents([id], moduleNeeds()) ) config[off] = false;
  await game.settings.set("core", "moduleConfiguration", config);
  foundry.utils.debouncedReload();
}

/**
 * What goes off with a module.
 * @param {string} id
 * @returns {string[]}   Ids of the modules that need it
 */
export function dependentsOf(id) {
  return [...withDependents([id], moduleNeeds())].filter(other => other !== id);
}
