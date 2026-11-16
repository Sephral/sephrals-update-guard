/**
 * The answers on top of the window: for each of the three questions a level and which sentence to show. Pure code, no
 * Foundry globals. The window turns the keys into text.
 */

/**
 * Is everything working?
 * @param {object} data
 * @param {boolean} data.hasPrevious   Is there an earlier state to compare with?
 * @param {number} data.changes        How many things changed since the last start
 * @param {number} data.troubled       How many packages have errors or no longer fit
 * @param {object|null} data.trial     The test run of this state
 * @param {boolean} data.good          Did this state already count as one that ran well?
 * @returns {{level: "good"|"warn"|"bad"|"new", key: string}}
 */
export function runStatus({hasPrevious, changes, troubled, trial, good}) {
  if ( troubled > 0 ) return {level: "bad", key: "trouble"};
  if ( trial ) return {level: "good", key: "tested"};
  if ( good ) return {level: "good", key: "ran"};
  if ( changes > 0 ) return {level: "warn", key: "changed"};
  if ( !hasPrevious ) return {level: "new", key: "first"};
  return {level: "warn", key: "untested"};
}

/**
 * The packages the headline of the first tab counts as trouble, each once. Errors, fit problems, the test run and conflicts
 * always count (a module Foundry switched off because it does not fit is trouble). The players' errors are stored and
 * stay until they are read: an old one about a module that is switched off or gone cannot be acted on, so it only
 * counts while that package runs (it stays listed in its own section until it is marked as read).
 * @param {string[][]} lists              Package ids from errors, fit problems, test run and conflicts
 * @param {string[]} playerIds            Package ids of the unread players' errors
 * @param {(id: string) => boolean} isRunning   Is the package active now?
 * @returns {number}
 */
export function countTroubled(lists, playerIds, isRunning) {
  return new Set([...lists.flat(), ...playerIds.filter(id => isRunning(id))]).size;
}

/**
 * Can I update?
 * @param {Record<string, number>} counts   Packages per rating
 * @param {number} breaks                   Packages that call functions the target removes, among the rest
 * @returns {{level: "good"|"warn"|"bad", key: string, count: number, open: number}}
 */
export function updateStatus(counts, breaks = 0) {
  const open = (counts.likely ?? 0) + (counts.unknown ?? 0);
  if ( counts.blocked ) return {level: "bad", key: "blocked", count: counts.blocked, open};
  if ( breaks ) return {level: "warn", key: "breaks", count: breaks, open};
  if ( counts.update ) return {level: "warn", key: "update", count: counts.update, open};
  if ( open ) return {level: "good", key: "open", count: open, open};
  return {level: "good", key: "ready", count: counts.ready ?? 0, open: 0};
}

/**
 * How do I get back?
 * @param {object} data
 * @param {boolean} data.older     Is there an earlier state that ran well?
 * @param {boolean} data.current   Does the current state count as one that ran well?
 * @returns {{level: "good"|"new", key: string}}
 */
export function backStatus({older, current}) {
  if ( older ) return {level: "good", key: "older"};
  if ( current ) return {level: "good", key: "current"};
  return {level: "new", key: "none"};
}

/**
 * The rows of the check, in the groups the window shows. What needs attention comes first and is open, the rest is
 * folded away. A row is in one group only.
 * @param {{status: string, breaks: boolean}[]} rows
 * @returns {{key: string, rows: object[], open: boolean, compact: boolean}[]}   Only groups with rows
 */
export function groupRows(rows) {
  const groups = [
    {key: "blocked", test: r => r.status === "blocked", open: true, compact: false},
    {key: "update", test: r => r.status === "update", open: true, compact: false},
    {key: "breaks", test: r => r.breaks && (r.status !== "ready"), open: true, compact: false},
    {key: "waiting", test: r => ["likely", "unknown"].includes(r.status), open: false, compact: true},
    {key: "ready", test: r => r.status === "ready", open: false, compact: true}
  ];
  const left = new Set(rows);
  const result = [];
  for ( const {key, test, open, compact} of groups ) {
    const hits = [...left].filter(test);
    for ( const row of hits ) left.delete(row);
    if ( hits.length ) result.push({key, rows: hits, open, compact});
  }
  return result;
}
