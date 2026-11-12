/**
 * The search for the module behind a problem. Pure code, no Foundry globals. The GM says whether the problem is still
 * there, the search switches modules off, one round per reload:
 *  - Round 1 switches all suspects off. If the problem stays, none of them is the cause.
 *  - After that it halves the candidates until one is left.
 * The state is plain data, it lives in a world setting and survives the reloads. The module configuration from before
 * the search is part of it, so everything can be restored at any time.
 */

/**
 * The modules that changed since a state: new, another version or switched on since then.
 * @param {object|null} good      The state to compare with
 * @param {object} current        The current state
 * @param {string} [self]         Never a suspect
 * @returns {string[]}            Module ids
 */
export function suspectsSince(good, current, self = "") {
  if ( !good ) return [];
  const before = new Map((good.modules ?? []).map(m => [m.id, m]));
  return (current.modules ?? []).filter(m => {
    if ( !m.active || (m.id === self) ) return false;
    const old = before.get(m.id);
    return !old || !old.active || (old.version !== m.version);
  }).map(m => m.id);
}

/**
 * Put the modules that other evidence points at, for example errors in the players' browsers, first among the suspects.
 * They come first, so the first rounds test them. A module that is not active or is never a suspect (self) is left out.
 * @param {string[]} ids            The suspects from the changes
 * @param {string[]} evidence       Module ids named by errors
 * @param {string[]} active         Ids of the active modules
 * @param {string} [self]
 * @returns {{ids: string[], evidence: string[]}}   evidence holds the ids that were named and are suspects now
 */
export function withEvidence(ids, evidence, active, self = "") {
  const on = new Set(active);
  const named = [...new Set(evidence)].filter(id => on.has(id) && (id !== self));
  const rest = ids.filter(id => !named.includes(id));
  return {ids: [...named, ...rest], evidence: named};
}

/**
 * The given modules and everything that needs them: a module cannot stay on when one it requires is off.
 * @param {string[]} ids
 * @param {Record<string, string[]>} requires   Required module ids by module id
 * @returns {Set<string>}
 */
export function withDependents(ids, requires = {}) {
  const off = new Set(ids);
  let grew = true;
  while ( grew ) {
    grew = false;
    for ( const [id, needs] of Object.entries(requires) ) {
      if ( !off.has(id) && needs.some(need => off.has(need)) ) {
        off.add(id);
        grew = true;
      }
    }
  }
  return off;
}

/**
 * Which candidates to switch off in the next round: about half of them, and enough that some stay on. When everything
 * hangs on the first half, one module nothing else depends on is tested alone.
 * @param {string[]} candidates
 * @param {Record<string, string[]>} requires
 * @returns {string[]}
 */
export function chooseHalf(candidates, requires = {}) {
  const half = candidates.slice(0, Math.ceil(candidates.length / 2));
  const closure = withDependents(half, requires);
  const tested = candidates.filter(id => closure.has(id));
  if ( tested.length < candidates.length ) return tested;
  const leaf = candidates.find(id => !candidates.some(other => (other !== id) && (requires[other] ?? []).includes(id)));
  return [leaf ?? candidates[0]];
}

/**
 * Start a search.
 * @param {object} options
 * @param {string[]} options.suspects                The modules under suspicion
 * @param {Record<string, boolean>} options.original The module configuration before the search
 * @param {"changed"|"all"} options.scope            Are the suspects the changed modules, or all of them?
 * @param {string} options.now                       ISO date
 * @param {string[]} [options.cleared]               Modules an earlier part of this search cleared
 * @returns {object}
 */
export function beginSearch({suspects, original, scope, now, cleared = []}) {
  return {active: true, phase: "testing", scope, first: true, round: 1, candidates: [...suspects], off: [...suspects],
    original: {...original}, culprit: null, cleared: [...cleared], startedAt: now};
}

/**
 * The next state after the GM's answer.
 * @param {object} search
 * @param {boolean} stillBroken                  Is the problem still there?
 * @param {Record<string, string[]>} requires
 * @returns {object}
 */
export function advanceSearch(search, stillBroken, requires = {}) {
  if ( search.phase !== "testing" ) return search;
  if ( search.first && stillBroken ) return {...search, phase: "none", off: []};
  let candidates;
  if ( search.first ) candidates = search.candidates;
  else if ( stillBroken ) candidates = search.candidates.filter(id => !search.off.includes(id));
  else candidates = search.candidates.filter(id => search.off.includes(id));
  if ( !candidates.length ) return {...search, phase: "none", candidates, off: []};
  if ( candidates.length === 1 ) return {...search, phase: "found", candidates, culprit: candidates[0], off: []};
  return {...search, first: false, round: search.round + 1, candidates, off: chooseHalf(candidates, requires)};
}

/**
 * The module configuration of the current round.
 * @param {object} search
 * @param {Record<string, string[]>} requires
 * @returns {Record<string, boolean>}
 */
export function searchConfig(search, requires = {}) {
  const config = {...search.original};
  for ( const id of withDependents(search.off, requires) ) config[id] = false;
  return config;
}

/**
 * The module configuration after the search.
 * @param {object} search
 * @param {string|null} keepOff                  A module that stays off, with what needs it
 * @param {Record<string, string[]>} requires
 * @returns {Record<string, boolean>}
 */
export function restoredConfig(search, keepOff = null, requires = {}) {
  const config = {...search.original};
  if ( keepOff ) for ( const id of withDependents([keepOff], requires) ) config[id] = false;
  return config;
}

/**
 * How many more rounds it can take at most, counting this one.
 * @param {object} search
 * @returns {number}
 */
export function roundsLeft(search) {
  if ( search.phase !== "testing" ) return 0;
  const n = search.candidates.length;
  if ( search.first ) return (n > 1 ? Math.ceil(Math.log2(n)) : 0) + 1;
  return Math.max(1, Math.ceil(Math.log2(n)));
}

/**
 * Is this a usable stored search?
 * @param {*} value
 * @returns {boolean}
 */
export function isSearch(value) {
  return !!value && (value.active === true) && Array.isArray(value.candidates) && Array.isArray(value.off)
    && !!value.original && (typeof value.original === "object");
}
