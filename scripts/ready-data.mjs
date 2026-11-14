/**
 * "Ready for tonight?": one answer from the test run, the errors of the players and the versions their browsers run.
 * Pure code, no Foundry globals. The window turns the keys into text.
 */

/**
 * The answer, the most important finding first.
 * @param {object} data
 * @param {string[]} data.trialModules      Titles of the modules that threw during the test run
 * @param {string[]} data.playerModules     Titles of the modules named by errors of the players that are not read yet
 * @param {{name: string, silent?: boolean, kinds: string[]}[]} data.players   Players whose browsers differ or did not answer
 * @param {number} data.connected           How many players are connected
 * @param {number} data.fitProblems         How many packages no longer fit (manifest ranges, dependencies)
 * @param {number} [data.conflicts]         How many modules get in each other's way (confirmed or likely)
 * @param {string[]} [data.conflictModules] Titles of the modules that are part of those conflicts
 * @param {boolean} data.trialDone          Did the test run finish?
 * @returns {{level: "good"|"warn"|"bad", key: string, count: number, next: string, findings: string[]}}
 */
export function readyAnswer({trialModules = [], playerModules = [], players = [], connected = 0, fitProblems = 0, trialDone = true,
  conflicts = 0}) {
  const findings = [];
  if ( !trialDone ) return {level: "warn", key: "notRun", count: 0, next: "run", findings};
  if ( trialModules.length ) findings.push("errors");
  if ( playerModules.length ) findings.push("playerErrors");
  if ( players.length ) findings.push("versions");
  if ( fitProblems ) findings.push("fit");
  if ( conflicts ) findings.push("conflicts");
  if ( trialModules.length ) return {level: "bad", key: "errors", count: trialModules.length, next: "fixModules", findings};
  if ( playerModules.length ) return {level: "warn", key: "playerErrors", count: playerModules.length, next: "playerList", findings};
  if ( players.length ) return {level: "warn", key: "versions", count: players.length, next: "reload", findings};
  if ( fitProblems ) return {level: "warn", key: "fit", count: fitProblems, next: "fitList", findings};
  if ( conflicts ) return {level: "warn", key: "conflicts", count: conflicts, next: "conflictList", findings};
  return {level: "good", key: connected ? "ready" : "readyAlone", count: connected, next: "play", findings};
}

/**
 * What a player's browser differs in, as short codes for the window.
 * @param {ReturnType<import("./player-data.mjs").compareVersions>} diff
 * @returns {string[]}   "core", "system", "different", "missing", "extra"
 */
export function differenceKinds(diff) {
  const kinds = [];
  if ( diff.core ) kinds.push("core");
  if ( diff.system ) kinds.push("system");
  if ( diff.different.length ) kinds.push("different");
  if ( diff.missing.length ) kinds.push("missing");
  if ( diff.extra.length ) kinds.push("extra");
  return kinds;
}

/**
 * The name of the loadout saved before an update.
 * @param {string} iso      ISO date
 * @param {string} core     The version of Foundry
 * @returns {string}
 */
export function loadoutName(iso, core) {
  const date = new Date(iso);
  const day = Number.isNaN(date.getTime()) ? String(iso).slice(0, 10) : date.toISOString().slice(0, 10);
  return `Update Guard ${day} (Foundry ${core})`;
}

/**
 * Can the module list be saved through Module Loadouts?
 * @param {{active?: boolean, api?: object}|undefined} module   The module Module Loadouts, or nothing
 * @returns {boolean}
 */
export function canSaveLoadout(module) {
  return !!module?.active && (typeof module.api?.saveCurrent === "function");
}
