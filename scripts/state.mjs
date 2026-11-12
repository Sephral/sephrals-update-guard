/**
 * The bridge between Foundry and the pure code: reading the installation into plain data, and the stored history in a
 * world setting.
 */

import {MODULE_ID, setting} from "./config.mjs";
import {hasVersion} from "./versions.mjs";
import {noteTrial, parseHistory, recordState, serializeHistory, settleLatest} from "./snapshots.mjs";
import {log} from "./watch.mjs";

/**
 * The name of an availability code of Foundry. The numbers differ between Foundry 13 and 14, so the names are read from
 * the constants of the running version.
 * @param {number} code
 * @returns {string|null}
 */
export function availabilityName(code) {
  const codes = CONST.PACKAGE_AVAILABILITY_CODES ?? {};
  return Object.entries(codes).find(([, value]) => value === code)?.[0] ?? null;
}

/**
 * A compatibility block of a package as plain strings.
 * @param {object} [compat]
 * @returns {{minimum: string, verified: string, maximum: string}}
 */
function compatOf(compat) {
  const pick = value => (hasVersion(value) ? String(value) : "");
  return {minimum: pick(compat?.minimum), verified: pick(compat?.verified), maximum: pick(compat?.maximum)};
}

/**
 * The relationships of a package as plain lists.
 * @param {Set|Array|undefined} list
 * @returns {object[]}
 */
function listOf(list) {
  return [...(list ?? [])].map(entry => ({id: entry.id, type: entry.type ?? "module",
    compat: compatOf(entry.compatibility), manifest: entry.manifest ?? ""}));
}

/**
 * Read the installation: Foundry, the system and every installed module.
 * @returns {object}   A state (see snapshots.mjs) with extra fields for the live checks: requires, systems,
 *   availability, urls
 */
export function collectState() {
  const system = game.system;
  const modules = [...game.modules.values()].map(m => {
    const compat = compatOf(m.compatibility);
    return {
      id: m.id, title: String(m.title ?? m.id), version: String(m.version ?? ""), active: !!m.active,
      ...compat, manifest: m.manifest ?? "",
      compat,
      requires: listOf(m.relationships?.requires),
      systems: listOf(m.relationships?.systems),
      availability: availabilityName(m.availability),
      url: m.url ?? "", changelog: m.changelog ?? "", readme: m.readme ?? "", bugs: m.bugs ?? ""
    };
  }).sort((a, b) => a.title.localeCompare(b.title));
  const systemCompat = compatOf(system.compatibility);
  return {
    core: game.version,
    system: {id: system.id, title: String(system.title ?? system.id), version: String(system.version ?? ""),
      ...systemCompat, compat: systemCompat, manifest: system.manifest ?? "", url: system.url ?? "",
      changelog: system.changelog ?? "", availability: availabilityName(system.availability)},
    modules
  };
}

/**
 * The part of a state that is stored: only what a later start needs for the comparison and the way back.
 * @param {object} state   From collectState
 * @returns {object}
 */
export function storable(state) {
  return {
    core: state.core,
    system: {id: state.system.id, title: state.system.title, version: state.system.version},
    modules: state.modules.map(m => ({id: m.id, title: m.title, version: m.version, active: m.active, minimum: m.minimum,
      verified: m.verified, maximum: m.maximum, manifest: m.manifest}))
  };
}

/**
 * The items to rate: the system and every active module.
 * @param {object} state
 * @returns {object[]}
 */
export function ratingItems(state) {
  const items = [{id: state.system.id, title: state.system.title, kind: "system", version: state.system.version,
    compat: state.system.compat, manifest: state.system.manifest}];
  for ( const m of state.modules ) {
    if ( m.active ) items.push({id: m.id, title: m.title, kind: "module", version: m.version, compat: m.compat,
      manifest: m.manifest});
  }
  return items;
}

/* -------------------------------------------- */
/*  History                                     */
/* -------------------------------------------- */

/**
 * The stored history, newest first.
 * @returns {object[]}
 */
export function readHistory() {
  return parseHistory(game.settings.get(MODULE_ID, "history"));
}

/**
 * Store a history.
 * @param {object[]} history
 * @returns {Promise<void>}
 */
export async function writeHistory(history) {
  await game.settings.set(MODULE_ID, "history", serializeHistory(history));
}

/**
 * Record the state of this start. Only the active GM writes.
 * @param {object} state   From collectState
 * @returns {Promise<ReturnType<typeof recordState>>}
 */
export async function recordStart(state) {
  const result = recordState(readHistory(), storable(state), new Date().toISOString());
  await writeHistory(result.history);
  return result;
}

/**
 * After the quiet time: mark the newest state as one that ran well, or keep the errors that were counted.
 * @returns {Promise<{good: boolean, errors: Record<string, number>}>}
 */
export async function settleStart() {
  const counts = log.errorCounts();
  const errors = Object.fromEntries(Object.entries(counts).filter(([owner]) => /^(module|system):/.test(owner)));
  const {history, good} = settleLatest(readHistory(), errors, new Date().toISOString());
  await writeHistory(history);
  return {good, errors};
}

/**
 * Store a test run with the current state.
 * @param {object} trial   From storedTrial
 * @returns {Promise<void>}
 */
export async function recordTrial(trial) {
  const {history} = noteTrial(readHistory(), trial, new Date().toISOString());
  await writeHistory(history);
}

/**
 * Is this client the one that records the state? The active GM.
 * @returns {boolean}
 */
export function isRecorder() {
  return !!game.user?.isGM && (game.users.activeGM?.id === game.user.id);
}

/**
 * The setting for the quiet time, in minutes.
 * @returns {number}
 */
export function goodAfterMinutes() {
  const value = Number(setting("goodAfter"));
  return Number.isFinite(value) ? Math.min(120, Math.max(1, Math.round(value))) : 10;
}
