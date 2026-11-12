/**
 * Self test: what the module relies on in Foundry, its storage and its texts.
 */

import {MODULE_ID, TESTED_VERSIONS, esc, t} from "./config.mjs";
import {parseHistory} from "./snapshots.mjs";
import {availabilityName, collectState} from "./state.mjs";
import {isNewer} from "./versions.mjs";
import {watchState} from "./watch.mjs";

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
  const coreKeys = ["SETUP.BACKUPS.CreateSnapshot", "SETUP.Modules", "SETUP.InstallModule", "SETUP.ManifestURL", "GAME.ReturnSetup"];
  const coreMissing = coreKeys.filter(key => !game.i18n.has(key));
  check(!coreMissing.length, "SUG.SELFTEST.CoreTexts", {keys: coreMissing.join(", ")});
  const keys = ["SUG.gear", "SUG.SELFTEST.Title", "SUG.Window.title", "SUG.Honest"];
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
