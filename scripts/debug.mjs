/**
 * Update Guard's part of the debug file of Sephral's modules. Fill describeState with what helps a bug report, without
 * personal texts.
 */

import {MODULE_ID, t} from "./config.mjs";
import {findConflicts, wrapperLog} from "./conflicts.mjs";
import {DebugTrace, registerDebugMenu, registerDebugProvider} from "./debug-file.mjs";
import {store as playerStore} from "./players.mjs";
import {parseHistory} from "./snapshots.mjs";
import {goodAfterMinutes, isRecorder} from "./state.mjs";
import {log, watchState} from "./watch.mjs";

/** The recent decisions of the module. */
export const trace = new DebugTrace();

/**
 * What the module knows right now.
 * @returns {object}
 */
export function describeState() {
  const history = parseHistory(game.settings.get(MODULE_ID, "history"));
  const packages = (map, keep) => Object.fromEntries([...map].map(([owner, e]) => [owner, keep(e)]));
  return {
    foundry: game.version,
    system: `${game.system.id} ${game.system.version}`,
    recorder: isRecorder(),
    goodAfterMinutes: goodAfterMinutes(),
    historyLength: history.length,
    history: history.map(h => ({at: h.at, seen: h.seen, core: h.core, system: h.system?.version, modules: h.modules.length,
      good: !!h.good, errors: h.errors ?? null})),
    watch: {listeners: watchState.listeners, hook: watchState.hook, probe: watchState.probeInstalled, since: log.since,
      compatibilityMode: CONFIG.compatibility?.mode, patterns: {
        include: CONFIG.compatibility?.includePatterns?.length ?? 0, exclude: CONFIG.compatibility?.excludePatterns?.length ?? 0}},
    conflicts: (() => {
      const {counts, wrapperLibrary} = findConflicts();
      return {bad: counts.bad, warn: counts.warn, note: counts.note, wrapperLibrary, wrappersSeen: wrapperLog.registrations.size,
        listening: wrapperLog.listening};
    })(),
    errors: packages(log.errors, e => ({count: e.count, kinds: e.kinds})),
    players: {collecting: !!game.settings.get(MODULE_ID, "collectPlayerErrors"), notice: !!game.settings.get(MODULE_ID, "playerNotice"),
      entries: playerStore.entries.size, unread: playerStore.list({unreadOnly: true}).length,
      byModule: Object.fromEntries(playerStore.byOwner().map(r => [r.owner, {count: r.count, players: r.players.length}]))},
    deprecated: packages(log.deprecations, e => ({count: e.count, until: e.until}))
  };
}

/**
 * The button in the settings and the module's part of the file. Call in "init".
 */
export function registerDebug() {
  registerDebugMenu(MODULE_ID, {name: "SUG.DEBUG.Title", label: "SUG.DEBUG.Save", hint: "SUG.DEBUG.Hint"});
  registerDebugProvider({
    moduleId: MODULE_ID,
    label: () => t("SUG.DEBUG.Entry"),
    notice: file => t("SUG.DEBUG.Saved", {file}),
    recent: () => ({details: describeState()}),
    trace
  });
}
