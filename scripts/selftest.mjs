/**
 * Self test: what the module relies on in Foundry, its storage and its texts.
 */

import {MODULE_ID, TESTED_VERSIONS, esc, t} from "./config.mjs";
import {declaredConflicts, keyConflicts, mergeConflicts, wrapperConflicts} from "./conflicts-data.mjs";
import {findConflicts, wrapperLog} from "./conflicts.mjs";
import {ErrorGate, PlayerErrorStore, buildReport, compareVersions, readReport, sanitizeMessage} from "./player-data.mjs";
import {repositoryOf} from "./report-data.mjs";
import {parseHistory} from "./snapshots.mjs";
import {availabilityName, collectState} from "./state.mjs";
import {isNewer} from "./versions.mjs";
import {watchState} from "./watch.mjs";

/**
 * Does the logic for the errors of the players work: the clean message, the gate, the list and the comparison?
 * @returns {boolean}
 */
function playersLogicWorks() {
  try {
    const clean = sanitizeMessage("Failed at http://example.test:30000/modules/a/b.js for C:\\Users\\someone\\x");
    const report = buildReport({owner: "module:a", kind: "error", message: clean, stack: "Error\n    at f (http://x.test/modules/a/b.js:1:2)"});
    const gate = new ErrorGate();
    const first = gate.add(report, 0);
    const again = gate.add(report, 1000);
    const store = new PlayerErrorStore();
    const stored = store.add({id: "u", name: "n"}, readReport(report));
    const diff = compareVersions({core: "1", system: {id: "s", version: "1"}, modules: [["a", "1"]]},
      {core: "1", system: {id: "s", version: "1"}, modules: [["a", "2"]]});
    return !/example\.test|someone/.test(clean) && (first.length === 1) && (again.length === 0) && !!stored?.isNew
      && (diff.different.length === 1) && PlayerErrorStore.parse(store.serialize()).entries.size === 1;
  } catch {
    return false;
  }
}

/**
 * Does the conflict finder work: the logic on made up data, the real registries readable, the hooks of the wrapper
 * library heard?
 * @returns {boolean}
 */
function conflictsWork() {
  try {
    const keys = keyConflicts([
      {id: "module:a.x", owner: "module:a", name: "x", bindings: [{key: "KeyK", modifiers: ["Shift", "Control"]}], down: true},
      {id: "module:b.y", owner: "module:b", name: "y", bindings: [{key: "KeyK", modifiers: ["Control", "Shift"]}], down: true},
      {id: "module:c.z", owner: "module:c", name: "z", bindings: [{key: "ShiftLeft"}], down: true},
      {id: "module:d.z", owner: "module:d", name: "z", bindings: [{key: "ShiftLeft"}], down: true}]);
    const wrappers = wrapperConflicts({registrations: [{owner: "module:a", target: "T.prototype.m", type: "OVERRIDE"},
      {owner: "module:b", target: "T.prototype.m", type: "OVERRIDE"}]});
    const declared = declaredConflicts({system: {id: "s", version: "1"}, modules: [{id: "a", version: "1", active: true,
      conflicts: [{id: "b", type: "module", compat: {}}]}, {id: "b", version: "1", active: true}]});
    const merged = mergeConflicts(keys, wrappers, declared);
    const live = findConflicts();
    return (keys.length === 1) && (wrappers.length === 1) && (declared.length === 1) && (merged.length === 3)
      && Array.isArray(live.findings) && !!wrapperLog.listening;
  } catch {
    return false;
  }
}

/**
 * Run all checks.
 * @returns {Promise<{problems: string[], checks: number}>}
 */
async function checkAll() {
  const problems = [];
  let checks = 0;
  const check = (ok, key, data) => {
    checks++;
    if ( !ok ) problems.push(game.i18n.has(key) ? t(key, data) : key);
  };
  check(typeof foundry.applications?.api?.DialogV2 === "function", "SUG.SELFTEST.Dialog");
  check(typeof foundry.utils?.isNewerVersion === "function", "SUG.SELFTEST.IsNewer");
  // Our own version rules must agree with Foundry's on the cases the rating relies on
  const cases = [["14.370", "14.369"], ["14.9", "14.10"], ["15", "14.999"], ["14", "14.370"], ["14.370", "14"]];
  check(cases.every(([a, b]) => isNewer(a, b) === foundry.utils.isNewerVersion(a, b)), "SUG.SELFTEST.VersionRules");
  const codes = CONST.PACKAGE_AVAILABILITY_CODES;
  check(!!codes && ["VERIFIED", "UNKNOWN", "UNVERIFIED_BUILD"].every(name => availabilityName(codes[name]) === name),
    "SUG.SELFTEST.Availability");
  let state = null;
  try {
    state = collectState();
  } catch(err) {
    console.warn(`${MODULE_ID} | The self test could not read the installation`, err);
  }
  const own = state?.modules.find(m => m.id === MODULE_ID);
  check(!!state && !!state.core && !!state.system?.id && !!own?.version && !!own?.compat && Array.isArray(own?.requires),
    "SUG.SELFTEST.Packages");
  check(game.users.activeGM !== undefined, "SUG.SELFTEST.ActiveGM");
  let history = true;
  try {
    history = Array.isArray(parseHistory(game.settings.get(MODULE_ID, "history")));
  } catch {
    history = false;
  }
  check(history, "SUG.SELFTEST.History");
  check(watchState.listeners && watchState.hook, "SUG.SELFTEST.Watch");
  check(watchState.probeInstalled && CONFIG.compatibility?.excludePatterns?.includes(watchState.probe), "SUG.SELFTEST.Probe");
  check(typeof foundry.utils?.saveDataToFile === "function", "SUG.SELFTEST.Save");
  check(typeof game.socket?.emit === "function" && !!game.modules.get(MODULE_ID)?.socket, "SUG.SELFTEST.Socket");
  check(playersLogicWorks(), "SUG.SELFTEST.Players");
  check(conflictsWork(), "SUG.SELFTEST.Conflicts");
  check(typeof game.settings.settings.has === "function" && ["collectPlayerErrors", "playerNotice", "playerErrors"]
    .every(key => game.settings.settings.has(`${MODULE_ID}.${key}`)), "SUG.SELFTEST.PlayerSettings");
  check(!!repositoryOf({url: game.modules.get(MODULE_ID)?.url}), "SUG.SELFTEST.Repository");
  const loadouts = game.modules.get("sephrals-module-loadouts");
  check(!loadouts?.active || (typeof loadouts.api?.saveCurrent === "function"), "SUG.SELFTEST.Loadouts");
  const coreKeys = ["SETUP.BACKUPS.CreateSnapshot", "SETUP.Modules", "SETUP.InstallModule", "SETUP.ManifestURL", "GAME.ReturnSetup"];
  const coreMissing = coreKeys.filter(key => !game.i18n.has(key));
  check(!coreMissing.length, "SUG.SELFTEST.CoreTexts", {keys: coreMissing.join(", ")});
  const keys = ["SUG.gear", "SUG.SELFTEST.Title", "SUG.Window.title", "SUG.Honest", "SUG.Players.title", "SUG.Report.title",
    "SUG.Ready.run", "SUG.Safety.save"];
  const missing = keys.filter(key => !game.i18n.has(key));
  check(!missing.length, "SUG.SELFTEST.Texts", {keys: missing.join(", ")});
  return {problems, checks};
}

/**
 * Run the self test and report the result.
 * @param {object} [options]
 * @param {boolean} [options.report=true]
 * @returns {Promise<{problems: string[], checks: number}>}
 */
export async function runSelfTest({report = true} = {}) {
  const {problems, checks} = await checkAll();
  const summary = problems.length ? t("SUG.SELFTEST.Problems", {problems: problems.length, checks})
    : t("SUG.SELFTEST.Passed", {checks});
  if ( problems.length ) ui.notifications.warn(summary, {permanent: true});
  else ui.notifications.info(summary);
  if ( report ) {
    const versions = t("SUG.SELFTEST.Version", {current: game.version, tested: TESTED_VERSIONS.core});
    let content = `<h3>${esc(t("SUG.SELFTEST.Title"))}</h3><p>${esc(summary)}</p><p><small>${esc(versions)}</small></p>`;
    if ( problems.length ) content += `<ul>${problems.map(p => `<li>${esc(p)}</li>`).join("")}</ul>`;
    await ChatMessage.implementation.create({content, whisper: [game.user.id],
      speaker: {alias: game.modules.get(MODULE_ID).title}});
  }
  return {problems, checks};
}

/**
 * Tell the GM once when Foundry is newer than the version the module was verified against.
 */
export function noticeNewVersions() {
  if ( !game.user.isGM ) return;
  if ( !foundry.utils.isNewerVersion(game.version, TESTED_VERSIONS.core) ) return;
  const signature = `core ${game.version}`;
  if ( game.settings.get(MODULE_ID, "acknowledgedVersions") === signature ) return;
  game.settings.set(MODULE_ID, "acknowledgedVersions", signature);
  ui.notifications.info(t("SUG.SELFTEST.NewVersions", {versions: signature}), {permanent: true});
}
