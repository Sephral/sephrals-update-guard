/**
 * The safety net before an update: the list of active modules saved as a loadout of Sephral's Module Loadouts, and the
 * reminder for a backup, with Sephral's Content Backup & Restore when it is active. Only what those modules offer in their
 * API is used, and nothing is changed in them.
 */

import {MODULE_ID, t} from "./config.mjs";
import {foundryPackagePage, safeHttpUrl} from "./links.mjs";
import {canSaveLoadout, loadoutName} from "./ready-data.mjs";

/** The module that keeps loadouts, and the one that makes backups. */
export const LOADOUTS_ID = "sephrals-module-loadouts";
export const BACKUP_ID = "sephrals-content-backup-restore";

/**
 * What is available for the safety net.
 * @returns {{loadouts: boolean, openManager: boolean, backup: boolean, backupLink: string}}
 */
export function safetyOptions() {
  const loadouts = game.modules.get(LOADOUTS_ID);
  const backup = game.modules.get(BACKUP_ID);
  return {
    loadouts: canSaveLoadout(loadouts),
    openManager: !!loadouts?.active && (typeof loadouts.api?.openManager === "function"),
    backup: !!backup?.active,
    backupLink: safeHttpUrl(backup?.url) || foundryPackagePage(BACKUP_ID)
  };
}

/**
 * Save the active modules as a loadout of the world. A loadout of the same name is replaced by Module Loadouts.
 * @returns {Promise<{ok: boolean, name: string}>}
 */
export async function saveModuleList() {
  const api = game.modules.get(LOADOUTS_ID)?.api;
  const name = loadoutName(new Date().toISOString(), game.version);
  if ( !canSaveLoadout(game.modules.get(LOADOUTS_ID)) ) return {ok: false, name};
  try {
    const profile = await api.saveCurrent(name, {
      description: t("SUG.Safety.description")});
    return {ok: !!profile, name};
  } catch(err) {
    console.error(`${MODULE_ID} | The module list could not be saved`, err);
    return {ok: false, name};
  }
}

/** Open the manager of Module Loadouts. */
export function openLoadouts() {
  game.modules.get(LOADOUTS_ID)?.api?.openManager?.();
}
