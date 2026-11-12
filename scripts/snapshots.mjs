/**
 * States of the installation (Foundry, system, modules), their history and the comparison of two states. Pure code, no
 * Foundry globals. A state is a plain object:
 *   {at, seen, core, system: {id, title, version}, modules: [{id, title, version, active, minimum, verified, maximum,
 *   manifest}], good, goodAt, errors}
 */

import {compareVersions, isNewer} from "./versions.mjs";

/** How many different states the history keeps. */
export const HISTORY_LIMIT = 12;

/** Version of the stored format. */
export const FORMAT = 1;

/**
 * What makes two states the same: Foundry, system and the version and activation of every module.
 * @param {object} state
 * @returns {string}
 */
export function stateKey(state) {
  const modules = [...(state.modules ?? [])].sort((a, b) => a.id.localeCompare(b.id))
    .map(m => `${m.id}@${m.version}${m.active ? "+" : "-"}`);
  return JSON.stringify([state.core, state.system?.id ?? "", state.system?.version ?? "", modules]);
}

/**
 * Compare two states.
 * @param {object|null} previous
 * @param {object} current
 * @returns {{any: boolean, core: object|null, system: object|null, updated: object[], added: object[],
 *   removed: object[], activated: object[], deactivated: object[]}}
 */
export function diffStates(previous, current) {
  const result = {any: false, core: null, system: null, updated: [], added: [], removed: [], activated: [],
    deactivated: []};
  if ( !previous ) return result;
  if ( previous.core !== current.core ) {
    result.core = {from: previous.core, to: current.core, newer: isNewer(current.core, previous.core)};
  }
  const ps = previous.system ?? {};
  const cs = current.system ?? {};
  if ( (ps.id !== cs.id) || (ps.version !== cs.version) ) {
    result.system = {id: cs.id, title: cs.title ?? cs.id, fromId: ps.id, from: ps.version, to: cs.version,
      newId: ps.id !== cs.id, newer: isNewer(cs.version, ps.version)};
  }
  const before = new Map((previous.modules ?? []).map(m => [m.id, m]));
  const now = new Map((current.modules ?? []).map(m => [m.id, m]));
  for ( const [id, m] of now ) {
    const old = before.get(id);
    if ( !old ) {
      result.added.push({id, title: m.title, version: m.version, active: !!m.active});
      continue;
    }
    if ( old.version !== m.version ) {
      result.updated.push({id, title: m.title, from: old.version, to: m.version, newer: isNewer(m.version, old.version),
        active: !!m.active});
    }
    if ( !old.active && m.active ) result.activated.push({id, title: m.title, version: m.version});
    if ( old.active && !m.active ) result.deactivated.push({id, title: m.title, version: m.version});
  }
  for ( const [id, m] of before ) {
    if ( !now.has(id) ) {
      result.removed.push({id, title: m.title, version: m.version, wasActive: !!m.active, minimum: m.minimum ?? "",
        verified: m.verified ?? "", maximum: m.maximum ?? ""});
    }
  }
  const byTitle = (a, b) => String(a.title).localeCompare(String(b.title));
  for ( const key of ["updated", "added", "removed", "activated", "deactivated"] ) result[key].sort(byTitle);
  result.any = !!(result.core || result.system || result.updated.length || result.added.length
    || result.removed.length || result.activated.length || result.deactivated.length);
  return result;
}

/**
 * How many things changed, for a short notice.
 * @param {ReturnType<typeof diffStates>} diff
 * @returns {number}
 */
export function countChanges(diff) {
  return (diff.core ? 1 : 0) + (diff.system ? 1 : 0) + diff.updated.length + diff.added.length + diff.removed.length
    + diff.activated.length + diff.deactivated.length;
}

/**
 * Put a state into the history. Only a changed state creates an entry, an unchanged one only updates the date. A
 * state that equals an older entry moves that entry to the front (keeping its "good" mark), so the history holds
 * different states only.
 * @param {object[]} history   Newest first
 * @param {object} state
 * @param {string} now         ISO date
 * @param {number} [limit]
 * @returns {{history: object[], changed: boolean, first: boolean, previous: object|null, current: object}}
 */
export function recordState(history, state, now, limit = HISTORY_LIMIT) {
  const list = [...(history ?? [])];
  const key = stateKey(state);
  const latest = list[0] ?? null;
  if ( latest && (stateKey(latest) === key) ) {
    list[0] = {...latest, seen: now};
    return {history: list, changed: false, first: false, previous: list[1] ?? null, current: list[0]};
  }
  const older = list.findIndex(entry => stateKey(entry) === key);
  let entry;
  if ( older >= 0 ) {
    const [old] = list.splice(older, 1);
    entry = {...state, at: now, seen: now, good: !!old.good, goodAt: old.goodAt ?? null, errors: old.errors ?? null};
  } else {
    entry = {...state, at: now, seen: now, good: false, goodAt: null, errors: null};
  }
  list.unshift(entry);
  list.length = Math.min(list.length, limit);
  return {history: list, changed: !!latest, first: !latest, previous: latest, current: entry};
}

/**
 * Mark the newest state after the check time: good when no module reported an error, otherwise only the errors are
 * kept.
 * @param {object[]} history
 * @param {Record<string, number>} errors   Error counts by module id
 * @param {string} now
 * @returns {{history: object[], good: boolean}}
 */
export function settleLatest(history, errors, now) {
  const list = [...history];
  if ( !list.length ) return {history: list, good: false};
  const total = Object.values(errors ?? {}).reduce((sum, n) => sum + n, 0);
  const good = total === 0;
  list[0] = {...list[0], good: good || list[0].good, goodAt: good ? now : (list[0].goodAt ?? null),
    errors: total ? {...errors} : null};
  return {history: list, good};
}

/**
 * Store a test run with the newest state. A run without a module error shows that the state works: it counts as good
 * at once, without waiting for the quiet time.
 * @param {object[]} history
 * @param {{owners: {owner: string, count: number}[]}} trial
 * @param {string} now
 * @returns {{history: object[], good: boolean}}
 */
export function noteTrial(history, trial, now) {
  const list = [...(history ?? [])];
  if ( !list.length ) return {history: list, good: false};
  const clean = !trial.owners.length;
  const errors = Object.fromEntries(trial.owners.map(o => [o.owner, o.count]));
  list[0] = {...list[0], trial, good: clean || !!list[0].good, goodAt: clean ? now : (list[0].goodAt ?? null),
    errors: clean ? null : errors};
  return {history: list, good: clean};
}

/**
 * The module versions of the newest state that was marked good.
 * @param {object[]} history
 * @returns {object|null}
 */
export function lastGood(history) {
  return (history ?? []).find(entry => entry.good) ?? null;
}

/**
 * For every module of the current state: the version that last worked, the newest good state that held it.
 * @param {object[]} history   Newest first, with the current state first
 * @param {object} current     The current state
 * @returns {{id: string, title: string, current: string, good: string|null, changed: boolean, downgrade: boolean,
 *   goodAt: string|null}[]}   Only modules whose version differs from the last good one come first
 */
export function rollbackTargets(history, current) {
  const goods = (history ?? []).filter(entry => entry.good && (stateKey(entry) !== stateKey(current)));
  const rows = [];
  for ( const m of current.modules ?? [] ) {
    const found = goods.find(entry => (entry.modules ?? []).some(x => x.id === m.id));
    const past = found?.modules.find(x => x.id === m.id);
    rows.push({id: m.id, title: m.title, current: m.version, good: past?.version ?? null,
      changed: !!past && (past.version !== m.version), downgrade: !!past && isNewer(m.version, past.version),
      goodAt: found?.goodAt ?? null, active: !!m.active});
  }
  rows.sort((a, b) => (Number(b.changed) - Number(a.changed)) || String(a.title).localeCompare(String(b.title)));
  return rows;
}

/**
 * Parse the stored history. Anything that is not a valid history becomes an empty one.
 * @param {string} text
 * @returns {object[]}
 */
export function parseHistory(text) {
  if ( !text ) return [];
  try {
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : data?.history;
    if ( !Array.isArray(list) ) return [];
    return list.filter(e => e && (typeof e === "object") && Array.isArray(e.modules) && (typeof e.core === "string"))
      .slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

/**
 * The text to store.
 * @param {object[]} history
 * @returns {string}
 */
export function serializeHistory(history) {
  return JSON.stringify({format: FORMAT, history});
}

/**
 * Sort versions text for display, newest first.
 * @param {string[]} versions
 * @returns {string[]}
 */
export function newestFirst(versions) {
  return [...versions].sort((a, b) => compareVersions(b, a));
}
