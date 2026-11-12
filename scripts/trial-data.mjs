/**
 * The results of a test run. Pure code, no Foundry globals: what changed in the error counts during a step, and the
 * summary of all steps.
 */

/** From this many milliseconds on a step counts as slow. */
export const SLOW_MS = 2000;

/** How many modules with errors are kept with the stored state. */
export const STORED_OWNERS = 10;

/**
 * What was added to a count per owner between two moments.
 * @param {Record<string, number>} before
 * @param {Record<string, number>} after
 * @returns {{owner: string, count: number}[]}
 */
export function countDelta(before, after) {
  const result = [];
  for ( const [owner, count] of Object.entries(after) ) {
    const added = count - (before[owner] ?? 0);
    if ( added > 0 ) result.push({owner, count: added});
  }
  return result;
}

/**
 * Does an owner key belong to a package?
 * @param {string} owner
 * @returns {boolean}
 */
export function isPackageOwner(owner) {
  return /^(module|system):/.test(owner);
}

/**
 * The summary of a test run.
 * @param {object[]} steps   {id, name, ms, timedOut, skipped, errors: [{owner, count, message}]}
 * @param {object} [extra]
 * @param {string} [extra.at]          ISO date
 * @param {number} [extra.deprecated]  Deprecated calls that came up during the run
 * @returns {object}
 */
export function summarizeTrial(steps, {at = "", deprecated = 0} = {}) {
  const owners = new Map();
  let other = 0;
  for ( const step of steps ) {
    for ( const error of step.errors ?? [] ) {
      if ( !isPackageOwner(error.owner) ) {
        other += error.count;
        continue;
      }
      const entry = owners.get(error.owner) ?? {owner: error.owner, count: 0, message: error.message ?? "", steps: []};
      entry.count += error.count;
      if ( !entry.steps.includes(step.id) ) entry.steps.push(step.id);
      owners.set(error.owner, entry);
    }
  }
  const done = steps.filter(step => !step.skipped);
  return {
    at,
    checks: done.length,
    ms: done.reduce((sum, step) => sum + (step.ms ?? 0), 0),
    owners: [...owners.values()].sort((a, b) => b.count - a.count || a.owner.localeCompare(b.owner)),
    other,
    slow: done.filter(step => step.timedOut || (step.ms >= SLOW_MS)).map(step => step.id),
    deprecated,
    steps
  };
}

/**
 * What of a summary is kept with the stored state: enough for the headline after a reload.
 * @param {object} summary
 * @returns {{at: string, checks: number, owners: object[], other: number}}
 */
export function storedTrial(summary) {
  return {at: summary.at, checks: summary.checks, other: summary.other,
    owners: summary.owners.slice(0, STORED_OWNERS).map(({owner, count, message, steps}) => ({owner, count, message, steps}))};
}
