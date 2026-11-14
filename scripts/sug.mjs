import {MODULE_ID, TESTED_VERSIONS, setting, t} from "./config.mjs";
import {registerDebug} from "./debug.mjs";
import {saveDebugFile} from "./debug-file.mjs";
import {findConflicts, startConflictWatch} from "./conflicts.mjs";
import {errorFor, exportData, lastReady, openGuard, refreshGuard, runCheck, startReady, startTrial} from "./guard-app.mjs";
import {registerHubModule} from "./hub.mjs";
import {applyModuleLanguage} from "./language.mjs";
import {requestVersions, startPlayers, store as playerStore} from "./players.mjs";
import {describeReport, openReport} from "./report-app.mjs";
import {saveModuleList} from "./safety.mjs";
import {readSearch} from "./search.mjs";
import {noticeNewVersions, runSelfTest} from "./selftest.mjs";
import {changeLanguage, registerSettings} from "./settings.mjs";
import {countChanges, diffStates} from "./snapshots.mjs";
import {collectState, goodAfterMinutes, isRecorder, readHistory, recordStart, settleStart} from "./state.mjs";
import {countFeature, registerUsage} from "./usage.mjs";
import {installProbe, log, startWatch} from "./watch.mjs";

// The module loads as a library: this runs before the system and the other modules, so the watch is listening when
// they start
startWatch();
startConflictWatch();

/** The timer of the quiet time after the start. */
let goodTimer = null;

Hooks.once("init", () => {
  registerHubModule({moduleId: MODULE_ID, tested: TESTED_VERSIONS});
  registerSettings({
    language: value => changeLanguage(value, refreshGuard),
    redraw: refreshGuard,
    open: openGuard
  });
  // Counted only on the active GM's client, like every Sephral module
  registerUsage(MODULE_ID, {
    features: ["windowOpened", "mapShown", "checkRun", "onlineCheck", "exportMade", "rollbackShown", "trialRun", "searchStarted",
      "searchFound", "moduleOff", "readyRun", "playerErrorSeen", "reportOpened", "issueLookup", "loadoutSaved", "conflictsShown", "conflictKeys"],
    settings: ["theme", "windowMode", "goodAfter", "collectPlayerErrors", "playerNotice"]
  });
  registerDebug();
  registerKeys();
  Hooks.on("renderSettings", onRenderSettings);
  // The key settings may have fixed a conflict: show the answer again
  Hooks.on("closeControlsConfig", () => { if ( game.user.isGM ) refreshGuard(); });
  game.modules.get(MODULE_ID).api = {
    /** Open the window (GM). Options: {tab: "changes" | "check" | "back"}. */
    open: options => openGuard(options),
    /**
     * Rate the system and the active modules for a target version of Foundry, for example "15" or "14.371". Without
     * options only the installed manifests are read. With {online: true} the Forge's package list and the manifests of
     * unlisted packages are requested, so only call it after the GM agreed.
     */
    check: (target, options) => runCheck(target, options),
    /**
     * The test run (GM): opens one of each kind of window and closes it again, returns what threw, per package. Nothing
     * in the world is changed.
     */
    trial: () => startTrial(),
    /**
     * "Ready for tonight?" (GM): the test run, the errors of the players that are not read yet and the versions their
     * browsers run, with one answer. Returns {at, answer, trialModules, playerModules, players, connected, fitProblems}.
     */
    ready: () => startReady(),
    /** The result of the last "Ready for tonight?" check, or null. */
    lastReady: () => lastReady(),
    /** The errors that players' browsers reported (GM), newest first: module, player, message, where, count. */
    playerErrors: () => (game.user.isGM ? playerStore.list().map(e => ({...e})) : []),
    /** Ask the connected players' browsers which versions they run and compare with this browser (GM). */
    playerVersions: options => requestVersions(options),
    /**
     * Open "Report this problem" for a module (GM). Options: {kind: "module" | "system", key: key of an error of a player}.
     * Nothing is sent until the GM clicks in the window.
     */
    report: (id, options = {}) => openReport({id, kind: options.kind, error: errorFor(id, options.key)}),
    /** The bug report text for a module as data: {text: {title, body}, repo, terms}. Sends nothing. */
    reportText: (id, options = {}) => {
      const {text, repo, terms} = describeReport({id, kind: options.kind, error: errorFor(id, options.key)});
      return {text, repo, terms};
    },
    /**
     * Where two active packages get in each other's way, read only: {findings, counts, wrapperLibrary}. A finding has
     * kind ("key", "declared", "overrideTwice", "libraryConflict", "overrideAndWrap"), level ("bad", "warn", "note"),
     * owners (keys like "module:id") and data.
     */
    conflicts: () => (game.user.isGM ? findConflicts() : {findings: [], counts: {bad: 0, warn: 0, note: 0, counted: 0, owners: []}}),
    /** Save the active modules as a loadout of Module Loadouts, when that module is active (GM). */
    saveModuleList: () => saveModuleList(),
    /** The current state of the installation as plain data. */
    snapshot: () => collectState(),
    /** The stored history of states, newest first. */
    history: () => readHistory(),
    /** The export before an update as plain data (JSON compatible). */
    export: () => exportData(),
    /** Errors and deprecated calls counted since the page loaded, by package. */
    watch: () => ({errors: log.errorCounts(), deprecated: Object.fromEntries([...log.deprecations].map(([k, v]) => [k, v.count]))}),
    /** Check the module (GM). */
    runSelfTest,
    /** Save the debug file of Sephral's modules (GM). */
    saveDebugFile: messageId => saveDebugFile(messageId ?? null, {moduleId: MODULE_ID})
  };
});

/** Applying a fixed module language loads its file; the rest of "ready" waits for it. */
let languageReady = Promise.resolve();

Hooks.once("i18nInit", () => {
  languageReady = applyModuleLanguage(setting("uiLanguage"));
});

Hooks.once("ready", async () => {
  await languageReady;
  installProbe();
  startPlayers({changed: refreshGuard});
  noticeNewVersions();
  if ( !game.user.isGM || !isRecorder() ) return;
  // During a search the world starts with fewer modules on purpose: nothing is recorded, the GM goes on with the search
  if ( readSearch() ) {
    openGuard({tab: "changes"});
    return;
  }
  try {
    const result = await recordStart(collectState());
    scheduleGood();
    if ( result.changed ) announce(diffStates(result.previous, result.current));
  } catch(err) {
    console.error(`${MODULE_ID} | Could not record the state of this start`, err);
  }
});

/**
 * Tell the GM that something changed since the last start, as the setting says.
 * @param {ReturnType<typeof diffStates>} diff
 */
function announce(diff) {
  if ( !diff.any ) return;
  const mode = setting("windowMode");
  if ( mode === "window" ) {
    countFeature(MODULE_ID, "mapShown");
    openGuard({tab: "changes"});
  } else if ( mode === "notice" ) {
    ui.notifications.info(t("SUG.Changes.notice", {count: countChanges(diff)}));
  }
}

/**
 * After the quiet time without a module error the state counts as one that ran well.
 */
function scheduleGood() {
  clearTimeout(goodTimer);
  goodTimer = setTimeout(async () => {
    try {
      if ( isRecorder() ) await settleStart();
    } catch(err) {
      console.error(`${MODULE_ID} | Could not mark the state`, err);
    }
  }, goodAfterMinutes() * 60 * 1000);
}

/** The key without a default binding. */
function registerKeys() {
  game.keybindings.register(MODULE_ID, "openWindow", {
    name: "SUG.Keys.openWindow",
    editable: [],
    restricted: true,
    onDown: () => {
      openGuard();
      return true;
    }
  });
}

/**
 * A button in the sidebar's settings tab, for the GM.
 * @param {Application} app
 * @param {HTMLElement|jQuery} html
 */
function onRenderSettings(app, html) {
  if ( !game.user.isGM ) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if ( !root || root.querySelector(".sug-sidebar-button") ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sug-sidebar-button";
  button.innerHTML = '<i class="fa-solid fa-shield-halved" inert></i> ';
  button.append(document.createTextNode(t("SUG.Window.open")));
  button.addEventListener("click", () => openGuard());
  const anchor = root.querySelector("section.settings, .settings, #settings-game, #settings-documentation, #settings-access");
  if ( anchor?.parentElement && anchor.matches("section.settings") ) anchor.append(button);
  else (root.querySelector("section") ?? root).append(button);
}
