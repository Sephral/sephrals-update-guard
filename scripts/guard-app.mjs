/**
 * The Update Guard window: three questions, each a tab with its answer on it. Is everything working? Can I update?
 * How do I get back? Every tab starts with one sentence and the next step, the lists follow. Everything that comes from
 * manifests, error messages and the network is plain text for Handlebars, which escapes it, and links are only used
 * after safeHttpUrl.
 */

import {MODULE_ID, TEMPLATES, addSettingsGear, copyText, isShown, setting, t} from "./config.mjs";
import {roundsLeft} from "./culprit.mjs";
import {buildExport, exportFileName, exportText} from "./export-data.mjs";
import {foundryPackagePage, hostOf, olderManifest, parseGithubManifest, safeHttpUrl} from "./links.mjs";
import {OnlineChecker} from "./online.mjs";
import {backStatus, groupRows, runStatus, updateStatus} from "./overview.mjs";
import {findProblems} from "./problems.mjs";
import {countStatuses, maximumReaches, minimumFits, rateAll, verdictLine} from "./rating.mjs";
import {countChanges, diffStates, lastGood, rollbackTargets} from "./snapshots.mjs";
import {answerSearch, dependentsOf, readSearch, startSearch, stopSearch, suspects, switchOff, widenSearch} from "./search.mjs";
import {collectState, isRecorder, ratingItems, readHistory, recordTrial} from "./state.mjs";
import {clearPlayerErrors, markPlayerErrorsRead, requestVersions, store as playerStore} from "./players.mjs";
import {readyAnswer} from "./ready-data.mjs";
import {openReport} from "./report-app.mjs";
import {openLoadouts, safetyOptions, saveModuleList} from "./safety.mjs";
import {runTrial} from "./trial.mjs";
import {storedTrial} from "./trial-data.mjs";
import {countFeature, markUsed} from "./usage.mjs";
import {defaultTarget, generationOf, parseTarget} from "./versions.mjs";
import {log, watchState} from "./watch.mjs";
import {splitOwner} from "./owners.mjs";

const {ApplicationV2, DialogV2, HandlebarsApplicationMixin} = foundry.applications.api;

/** The tabs of the window. */
export const TABS = ["changes", "check", "back"];

/**
 * What the window keeps between openings: the target, the online results of the last hour, the open tab.
 */
const session = {
  tab: "changes",
  targetText: "",
  checker: null,
  results: new Map(),
  report: null,
  checkedTarget: "",
  running: null,
  progress: null,
  verified: new Map(),
  copied: "",
  trial: null,
  trialStep: null,
  ready: null,
  readyRunning: null,
  safety: null
};

/** Where in the world each step of the test run happens, for a report. */
const TRIAL_WHERE = {actor: "sheet", item: "sheet", journal: "sheet", table: "sheet", scene: "window", token: "window", hud: "window",
  chat: "window", sidebar: "window", tools: "window", settings: "window", modules: "window", compendium: "window"};

/** The icon of each level of an answer. */
const LEVEL_ICONS = {good: "fa-circle-check", warn: "fa-circle-exclamation", bad: "fa-triangle-exclamation", new: "fa-shield-halved"};

/** The checker with its memory. */
function checker() {
  session.checker ??= new OnlineChecker({onLine: () => navigator.onLine});
  return session.checker;
}

/**
 * Localize a key when it exists, otherwise use the fallback.
 * @param {string} key
 * @param {string} fallback
 * @returns {string}
 */
function localizeOr(key, fallback) {
  return game.i18n.has(key) ? game.i18n.localize(key) : fallback;
}

/**
 * A date for display.
 * @param {string} iso
 * @returns {string}
 */
function dateText(iso) {
  if ( !iso ) return "";
  const date = new Date(iso);
  if ( Number.isNaN(date.getTime()) ) return "";
  // The dates follow the module language when one is chosen, otherwise Foundry's
  const chosen = setting("uiLanguage");
  const locale = ["de", "en"].includes(chosen) ? chosen : (game.i18n.lang || undefined);
  return date.toLocaleString(locale, {dateStyle: "medium", timeStyle: "short"});
}

/**
 * A day for display, without the time.
 * @param {string} iso
 * @returns {string}
 */
function dayText(iso) {
  const date = new Date(iso);
  if ( !iso || Number.isNaN(date.getTime()) ) return "";
  const chosen = setting("uiLanguage");
  return date.toLocaleDateString(["de", "en"].includes(chosen) ? chosen : (game.i18n.lang || undefined), {dateStyle: "medium"});
}

/**
 * The compatibility of a package as one line, "minimum 13, verified 14, maximum none".
 * @param {{minimum?: string, verified?: string, maximum?: string}|null} compat
 * @returns {string}
 */
export function compatText(compat) {
  if ( !compat ) return t("SUG.noData");
  const none = t("SUG.none");
  return t("SUG.compat", {minimum: compat.minimum || none, verified: compat.verified || none, maximum: compat.maximum || none});
}

/**
 * The title of the package behind an owner key.
 * @param {string} owner
 * @returns {{title: string, id: string, kind: string}}
 */
function ownerInfo(owner) {
  const {kind, id} = splitOwner(owner);
  if ( kind === "module" ) return {kind, id, title: game.modules.get(id)?.title ?? id};
  if ( kind === "system" ) return {kind, id, title: game.system.id === id ? game.system.title : id};
  return {kind, id, title: kind === "world" ? t("SUG.Errors.world") : t("SUG.Errors.other")};
}

/**
 * The links of a package: changelog, project page, readme, from its manifest.
 * @param {string} id
 * @param {"module"|"system"} [kind]
 * @returns {{label: string, href: string}[]}
 */
function packageLinks(id, kind = "module") {
  const pkg = (kind === "system") ? game.system : game.modules.get(id);
  if ( !pkg ) return [];
  const links = [];
  const add = (label, value) => {
    const href = safeHttpUrl(value);
    if ( href && !links.some(l => l.href === href) ) links.push({label: t(label), href});
  };
  add("SUG.link.changelog", pkg.changelog);
  add("SUG.link.page", pkg.url);
  add("SUG.link.readme", pkg.readme);
  return links;
}

export class GuardApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: "sug-guard",
    classes: ["sug-app", "sug-guard"],
    tag: "section",
    window: {title: "SUG.Window.title", icon: "fa-solid fa-shield-halved", resizable: true},
    position: {width: 700, height: "auto"},
    actions: {
      switchTab: GuardApp.#onTab,
      runTrial: GuardApp.#onRunTrial,
      startSearch: GuardApp.#onStartSearch,
      searchAnswer: GuardApp.#onSearchAnswer,
      searchWiden: GuardApp.#onSearchWiden,
      searchStop: GuardApp.#onSearchStop,
      switchOff: GuardApp.#onSwitchOff,
      online: GuardApp.#onOnline,
      cancelOnline: GuardApp.#onCancelOnline,
      exportJson: GuardApp.#onExportJson,
      exportText: GuardApp.#onExportText,
      copyUrl: GuardApp.#onCopyUrl,
      verifyOlder: GuardApp.#onVerifyOlder,
      clearErrors: GuardApp.#onClearErrors,
      runReady: GuardApp.#onRunReady,
      reportBug: GuardApp.#onReportBug,
      readPlayers: GuardApp.#onReadPlayers,
      clearPlayers: GuardApp.#onClearPlayers,
      saveLoadout: GuardApp.#onSaveLoadout,
      openLoadouts: GuardApp.#onOpenLoadouts
    }
  };

  /** @override */
  static PARTS = {main: {template: `${TEMPLATES}/guard.hbs`, scrollable: [".sug-body"]}};

  /** The tab to show first on the next render. */
  static openTab = null;

  /** @override */
  get title() {
    return t("SUG.Window.title");
  }

  /** @override */
  async _prepareContext() {
    const state = collectState();
    const history = readHistory();
    const target = parseTarget(session.targetText) || defaultTarget(game.version);
    // All three questions are answered on every render: the answers stand on the tabs
    const parts = {
      changes: this.#changes(state, history),
      check: this.#check(state, history, target),
      back: this.#back(state, history)
    };
    const search = this.#search(state);
    return {
      ...parts[session.tab],
      tab: session.tab,
      tabs: TABS.map(id => ({id, label: t(`SUG.Tab.${id}`), active: id === session.tab, level: parts[id].status.level,
        answer: parts[id].status.answer})),
      search,
      theme: setting("theme"),
      // During a round the window asks one question and nothing else
      showRun: (session.tab === "changes") && !search?.testing,
      isCheck: session.tab === "check",
      isBack: session.tab === "back"
    };
  }

  /** @override */
  _onPosition(position) {
    super._onPosition?.(position);
    // The window fits its content until the user resizes it, then the chosen height counts
    this.element?.classList.toggle("sug-sized", position.height !== "auto");
  }

  /** @override */
  _onRender(context, options) {
    super._onRender?.(context, options);
    this.element.dataset.sugTheme = setting("theme");
    addSettingsGear(this.element);
    const input = this.element.querySelector("input[name=target]");
    const apply = () => {
      if ( input.value === session.targetText ) return;
      session.targetText = input.value;
      countFeature(MODULE_ID, "checkRun");
      this.render();
    };
    input?.addEventListener("keydown", event => {
      if ( event.key !== "Enter" ) return;
      event.preventDefault();
      apply();
    });
    input?.addEventListener("change", apply);
  }

  /* -------------------------------------------- */
  /*  Search for the module behind a problem      */
  /* -------------------------------------------- */

  /**
   * The search that is running, as text for the top of the window.
   * @param {object} state
   * @returns {object|null}
   */
  #search(state) {
    const search = readSearch();
    if ( !search ) return null;
    const title = id => state.modules.find(m => m.id === id)?.title ?? id;
    const base = {phase: search.phase, testing: search.phase === "testing", found: search.phase === "found",
      none: search.phase === "none", culprit: search.culprit ?? ""};
    if ( base.found ) {
      const name = title(search.culprit);
      return {...base, title: t("SUG.Search.foundTitle", {name}), text: t("SUG.Search.foundText"),
        keepOff: t("SUG.Search.keepOff", {name})};
    }
    if ( base.none ) {
      const changed = search.scope === "changed";
      return {...base, canWiden: changed, title: t(changed ? "SUG.Search.noneChangedTitle" : "SUG.Search.noneAllTitle"),
        text: t(changed ? "SUG.Search.noneChangedText" : "SUG.Search.noneAllText")};
    }
    return {...base, title: t("SUG.Search.round", {round: search.round}),
      text: t("SUG.Search.testing", {off: search.off.length, total: search.candidates.length}),
      left: t(roundsLeft(search) === 1 ? "SUG.Search.leftOne" : "SUG.Search.left", {count: roundsLeft(search)}),
      namesTitle: t("SUG.Search.names"), names: search.off.map(title).sort((a, b) => a.localeCompare(b))};
  }

  /* -------------------------------------------- */
  /*  Answers                                     */
  /* -------------------------------------------- */

  /**
   * An answer with its icon and texts.
   * @param {{level: string, key: string}} status
   * @param {string} prefix                 The language keys of this question
   * @param {object} [data]
   * @param {string} [variant]              The sentences to use, when they are not the ones of the status
   * @returns {object}
   */
  #answer(status, prefix, data = {}, variant = status.key) {
    return {...status, icon: LEVEL_ICONS[status.level], headline: t(`${prefix}${variant}`, data),
      sub: t(`${prefix}${variant}Sub`, data), answer: t(`${prefix}${variant}Tab`, data)};
  }

  /**
   * The test run as text.
   * @param {object|null} current   The newest stored state
   * @returns {object}
   */
  #trial(current) {
    const live = session.trial;
    const stored = current?.trial ?? null;
    const summary = live ?? stored;
    const running = session.trialStep;
    const result = {running: !!running, shown: false,
      progress: running ? t("SUG.Trial.progress", {done: running.done, total: running.total, label: running.label}) : ""};
    if ( !summary ) return result;
    const owners = summary.owners.map(o => {
      const info = ownerInfo(o.owner);
      const where = (o.steps ?? []).map(id => t(`SUG.Trial.step.${id}`)).join(", ");
      return {...info, count: o.count, message: o.message, where, canOff: info.kind === "module"};
    });
    const total = owners.length;
    return {
      ...result, shown: true, stored: !live,
      at: dateText(summary.at),
      owners,
      summary: t(!total ? "SUG.Trial.summaryGood" : (total === 1 ? "SUG.Trial.summaryBadOne" : "SUG.Trial.summaryBad"),
        {checks: summary.checks, count: total}),
      deprecated: summary.deprecated ? t("SUG.Trial.deprecated", {count: summary.deprecated}) : "",
      stepsTitle: t("SUG.Trial.steps", {count: live?.checks ?? 0}),
      steps: (live?.steps ?? []).map(step => {
        const bad = step.errors.some(e => e.owner.startsWith("module:") || e.owner.startsWith("system:"));
        const slow = step.timedOut || live.slow.includes(step.id);
        return {id: step.id, label: t(`SUG.Trial.step.${step.id}`), name: step.name, time: step.timedOut ? t("SUG.Trial.timedOut")
          : `${(step.ms / 1000).toLocaleString(game.i18n.lang, {maximumFractionDigits: 1})} s`,
        state: bad ? "bad" : (slow ? "slow" : "good"),
        icon: bad ? "fa-xmark" : (slow ? "fa-hourglass-half" : "fa-check")};
      })
    };
  }

  /**
   * Is the module allowed to be switched off from here?
   * @param {{kind: string, id: string}} row
   * @returns {boolean}
   */
  #canSwitchOff(row) {
    return (row.kind === "module") && (row.id !== MODULE_ID) && !readSearch();
  }

  /* -------------------------------------------- */
  /*  Tab: since the last start                   */
  /* -------------------------------------------- */

  /**
   * The data of the first tab.
   * @param {object} state
   * @param {object[]} history   Newest first, the first entry is the state of this start
   * @returns {object}
   */
  #changes(state, history) {
    const current = history[0] ?? null;
    const previous = history[1] ?? null;
    const diff = diffStates(previous, current ?? state);
    const withLinks = item => ({...item, links: packageLinks(item.id)});
    const changes = {
      hasHistory: !!current,
      hasPrevious: !!previous,
      since: previous ? dateText(previous.at) : "",
      seen: current ? dateText(current.at) : "",
      any: diff.any,
      count: countChanges(diff),
      core: diff.core ? t(diff.core.newer ? "SUG.Changes.coreUp" : "SUG.Changes.coreDown", diff.core) : "",
      system: diff.system ? {
        text: diff.system.newId ? t("SUG.Changes.systemOther", {from: diff.system.fromId, to: diff.system.id})
          : t(diff.system.newer ? "SUG.Changes.systemUp" : "SUG.Changes.systemDown",
            {title: diff.system.title, from: diff.system.from, to: diff.system.to}),
        links: packageLinks(game.system.id, "system")
      } : null,
      updated: diff.updated.map(m => withLinks({...m, text: t(m.newer ? "SUG.Changes.up" : "SUG.Changes.down", m),
        inactive: !m.active})),
      added: diff.added.map(m => withLinks({...m, text: t(m.active ? "SUG.Changes.addedActive" : "SUG.Changes.added", m)})),
      removed: diff.removed.map(m => {
        // Foundry leaves a package out of game.modules when its manifest does not fit the running Foundry
        const fits = minimumFits(m.minimum, state.core) && maximumReaches(m.maximum, state.core);
        const compat = {minimum: m.minimum, verified: m.verified, maximum: m.maximum};
        return {...m, text: fits ? t("SUG.Changes.removed", m)
          : t("SUG.Changes.removedIncompatible", {...m, core: state.core, compat: compatText(compat)})};
      }),
      activated: diff.activated.map(m => withLinks({...m, text: t("SUG.Changes.activated", m)})),
      deactivated: []
    };
    const env = {core: state.core, system: state.system, modules: state.modules};
    // Say why Foundry may have switched a module off: what does not fit for it now
    const off = new Set(diff.deactivated.map(m => m.id));
    const offReasons = off.size ? findProblems(env, {also: off}).filter(p => off.has(p.id) && (p.severity === "problem")) : [];
    changes.deactivated = diff.deactivated.map(m => ({...m, text: t("SUG.Changes.deactivated", m),
      reasons: offReasons.filter(p => p.id === m.id).map(p => this.#problemRow(p))}));
    const problems = findProblems(env);
    const fits = problems.map(p => this.#problemRow(p));
    const errors = this.#errorRows();
    const trial = this.#trial(current);
    trial.owners = trial.owners?.map(o => ({...o, canOff: this.#canSwitchOff(o), canReport: o.kind === "module"}));
    const players = this.#players();
    const hasProblems = fits.some(p => p.severity === "problem");
    const troubled = new Set([...errors.map(e => e.id), ...fits.filter(p => p.severity === "problem").map(p => p.id),
      ...(trial.owners ?? []).map(o => o.id), ...players.unreadIds]).size;
    const verdict = runStatus({hasPrevious: !!previous, changes: changes.count, troubled, trial: session.trial ?? current?.trial ?? null,
      good: !!current?.good});
    const lastCheck = session.trial ?? current?.trial;
    const status = this.#answer(verdict, "SUG.Run.", {count: troubled, day: previous ? dayText(previous.at) : "",
      at: lastCheck ? dateText(lastCheck.at) : (current?.goodAt ? dateText(current.goodAt) : ""), checks: lastCheck?.checks ?? 0},
    ((verdict.key === "trouble") && (troubled === 1)) ? "troubleOne" : verdict.key);
    return {
      ...changes,
      status,
      trial,
      problems: fits.filter(p => p.severity === "problem"),
      notes: fits.filter(p => p.severity === "note"),
      hasProblems,
      hasNotes: fits.some(p => p.severity === "note"),
      // What the test run already named is not listed a second time
      errors: errors.filter(e => !trial.owners?.some(o => o.id === e.id)).map(e => ({...e, canOff: this.#canSwitchOff(e),
        canReport: e.kind === "module"})),
      players,
      ready: this.#ready(),
      errorsTotal: log.errorTotal(),
      errorsSince: dateText(log.since),
      otherErrors: this.#otherErrors(),
      compatNote: this.#compatNote()
    };
  }

  /**
   * The errors of the players as text: per player, per module, with what the GM needs to judge them.
   * @returns {object}
   */
  #players() {
    const on = !!setting("collectPlayerErrors");
    const unread = playerStore.list({unreadOnly: true});
    const groups = playerStore.grouped().map(user => ({
      userName: user.userName,
      modules: user.modules.map(m => {
        const info = ownerInfo(m.owner);
        return {title: info.title, id: info.id, kind: info.kind, count: m.count, canOff: this.#canSwitchOff(info),
          canReport: info.kind === "module",
          errors: m.errors.map(e => ({key: e.key, message: e.message, count: e.count, isNew: playerStore.isNew(e),
            meta: [e.where.type === "script" ? "" : t(`SUG.Players.where.${e.where.type}`, {name: e.where.name}).trim(),
              t(`SUG.Errors.kind.${e.kind}`), `${e.count}x`, dateText(e.last)].filter(Boolean).join(", "),
            stack: e.stack.join("\n"), hasStack: e.stack.length > 0}))};
      })
    }));
    return {
      on, shown: on || (groups.length > 0), groups, any: groups.length > 0,
      unread: unread.length, unreadIds: [...new Set(unread.filter(e => e.owner.startsWith("module:")).map(e => e.owner.slice(7)))],
      hint: t(on ? "SUG.Players.hint" : "SUG.Players.off"),
      empty: t("SUG.Players.empty"),
      newText: t("SUG.Players.new", {count: unread.length})
    };
  }

  /**
   * The result of the check "Ready for tonight?" as text.
   * @returns {object|null}
   */
  #ready() {
    const running = session.readyRunning;
    const ready = session.ready;
    if ( !running && !ready ) return null;
    if ( running ) {
      return {running: true, progress: t(running.phase === "players" ? "SUG.Ready.askingPlayers" : "SUG.Ready.testing")};
    }
    const a = ready.answer;
    const names = {names: ready.trialModules.concat(ready.playerModules).slice(0, 3).join(", ")};
    const players = ready.players.map(p => ({name: p.name, lines: p.lines}));
    return {
      running: false, level: a.level, key: a.key, at: dateText(ready.at),
      icon: LEVEL_ICONS[a.level],
      headline: t(`SUG.Ready.${a.key}`, {count: a.count, ...names, players: ready.players.map(p => p.name).join(", ")}),
      next: t(`SUG.Ready.next.${a.next}`),
      trial: ready.trialModules, playerModules: ready.playerModules, players, hasPlayers: players.length > 0,
      connected: !ready.connected ? t("SUG.Ready.connectedNone") : (ready.connected === 1 ? t("SUG.Ready.connectedOne") : t("SUG.Ready.connected", {count: ready.connected})),
      fit: ready.fitProblems ? t("SUG.Ready.fit", {count: ready.fitProblems}) : "",
      trialTitle: t("SUG.Ready.trialTitle"), playerTitle: t("SUG.Ready.playerTitle"), versionTitle: t("SUG.Ready.versionTitle")
    };
  }

  /**
   * One finding of the "no longer fits" list as text with its source.
   * @param {object} problem
   * @returns {object}
   */
  #problemRow(problem) {
    const data = {...problem.data};
    if ( problem.kind === "foundry" ) {
      data.text = localizeOr(`SUG.AVAIL.${data.name}`, data.name);
    }
    const none = t("SUG.none");
    data.minimum ||= none;
    data.maximum ||= none;
    const source = (problem.kind === "foundry") ? t("SUG.Source.foundry")
      : (["dependencyVersion", "missingDependency", "inactiveDependency", "missingSystem"].includes(problem.kind)
        ? t("SUG.Source.requires") : (["otherSystem", "systemRange"].includes(problem.kind) ? t("SUG.Source.systems")
          : t("SUG.Source.compatibility")));
    return {id: problem.id, title: problem.title, severity: problem.severity, source,
      text: t(`SUG.Problem.${problem.kind}`, data), links: packageLinks(problem.id, problem.id === game.system.id ? "system" : "module")};
  }

  /**
   * The modules with errors since the page loaded.
   * @returns {object[]}
   */
  #errorRows() {
    const rows = [];
    for ( const [owner, entry] of log.errors ) {
      const info = ownerInfo(owner);
      if ( (info.kind !== "module") && (info.kind !== "system") ) continue;
      rows.push({title: info.title, id: info.id, kind: info.kind, count: entry.count, message: entry.first.message,
        at: dateText(entry.first.at),
        kinds: Object.entries(entry.kinds).map(([k, n]) => `${t(`SUG.Errors.kind.${k}`)} ${n}`).join(", ")});
    }
    return rows.sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
  }

  /**
   * Errors that belong to no module or system.
   * @returns {number}
   */
  #otherErrors() {
    let sum = 0;
    for ( const [owner, entry] of log.errors ) {
      const {kind} = splitOwner(owner);
      if ( (kind !== "module") && (kind !== "system") ) sum += entry.count;
    }
    return sum;
  }

  /**
   * A note when Foundry's own settings keep deprecation warnings away from the count.
   * @returns {string}
   */
  #compatNote() {
    const compat = CONFIG.compatibility;
    if ( !compat ) return "";
    if ( compat.mode === CONST.COMPATIBILITY_MODES?.SILENT ) return t("SUG.Check.compatSilent");
    if ( !watchState.probeInstalled ) return t("SUG.Check.noProbe");
    if ( compat.includePatterns?.length ) return t("SUG.Check.compatFilter");
    return "";
  }

  /* -------------------------------------------- */
  /*  Tab: before the update                      */
  /* -------------------------------------------- */

  /**
   * The data of the second tab.
   * @param {object} state
   * @param {object[]} history
   * @param {string} target
   * @returns {object}
   */
  #check(state, history, target) {
    const items = ratingItems(state);
    const rated = rateAll(items, session.results, target);
    const counts = countStatuses(rated);
    const labels = Object.fromEntries(["ready", "update", "likely", "unknown", "blocked"].map(s => [s, t(`SUG.STATUS.${s}`)]));
    const blocked = rated.filter(r => r.status === "blocked").map(r => r.title);
    const online = session.results.size > 0;
    const targetGeneration = generationOf(target);
    const rows = rated.map(r => {
      const detail = r.evidence.map(e => this.#evidenceLine(e));
      const dep = log.deprecations.get(`${r.kind}:${r.id}`);
      const breaks = !!dep?.until.some(u => generationOf(u) <= targetGeneration);
      return {
        id: r.id, title: r.title, kind: r.kind, kindLabel: t(`SUG.Kind.${r.kind}`), isSystem: r.kind === "system", version: r.version,
        status: r.status, statusLabel: t(`SUG.STATUS.${r.status}`),
        reason: t(`SUG.REASON.${r.reason}`, {target, version: r.latest?.version ?? ""}),
        hint: (r.status === "blocked" && !online) ? t("SUG.Check.blockedOffline") : "",
        latest: r.latest?.version ?? "",
        detail,
        deprecated: dep ? t(breaks ? "SUG.Check.deprecatedBreaks" : "SUG.Check.deprecatedCalls",
          {count: dep.count, until: dep.until.join(", "), target}) : "",
        breaks,
        links: packageLinks(r.id, r.kind)
      };
    });
    const deprecated = this.#deprecatedRows(target);
    const verdict = verdictLine(counts, blocked, labels);
    const report = session.report;
    const breaking = rows.filter(r => r.breaks && (r.status !== "ready") && (r.status !== "blocked") && (r.status !== "update")).length;
    const answer = updateStatus(counts, breaking);
    const named = blocked.slice(0, 3).join(", ") + (blocked.length > 3 ? ", ..." : "");
    const single = (answer.count === 1) && ["blocked", "breaks", "update"].includes(answer.key);
    const status = this.#answer(answer, "SUG.Update.", {target, count: answer.count, open: answer.open, names: named},
      single ? `${answer.key}One` : answer.key);
    if ( (answer.key === "blocked") && !answer.open ) status.sub = named;
    const groups = groupRows(rows).map(g => ({...g, title: t(`SUG.Group.${g.key}`, {target}), hint: t(`SUG.Group.${g.key}Hint`, {target})}));
    return {
      status,
      groups,
      target,
      targetText: session.targetText || target,
      targetValid: !session.targetText || !!parseTarget(session.targetText),
      rows,
      verdict,
      counts,
      count: rows.length,
      online,
      running: !!session.running,
      progress: session.progress ? t("SUG.Online.progress", session.progress) : "",
      sendText: t("SUG.Online.sends", {count: items.length}),
      report: report ? {
        forge: t("SUG.Online.forge", report.forge),
        manifest: t("SUG.Online.manifest", report.manifest),
        failures: report.failures.slice(0, 20).map(f => ({title: items.find(i => i.id === f.id)?.title ?? f.id,
          source: t(`SUG.Source.${f.source}`), error: t(`SUG.ERR.${f.error}`, {detail: f.detail})})),
        moreFailures: Math.max(0, report.failures.length - 20),
        target: session.checkedTarget,
        stale: session.checkedTarget && (session.checkedTarget !== target)
      } : null,
      deprecated,
      deprecatedTotal: log.deprecationTotal(),
      deprecatedOther: this.#deprecatedOther(),
      compatNote: this.#compatNote(),
      checklist: this.#checklist(),
      safety: this.#safety(counts.update > 0),
      hasHistory: history.length > 0
    };
  }

  /**
   * The safety net before an update.
   * @param {boolean} updates   Does the window show that updates are available?
   * @returns {object}
   */
  #safety(updates) {
    const options = safetyOptions();
    const saved = session.safety;
    return {
      open: updates || !!saved, updates, ...options,
      summary: t(updates ? "SUG.Safety.summaryUpdates" : "SUG.Safety.summary"),
      saved: saved?.ok ? t("SUG.Safety.saved", {name: saved.name}) : "",
      savedFailed: saved && !saved.ok ? t("SUG.Safety.failed") : "",
      loadoutHint: options.loadouts ? t("SUG.Safety.loadoutOn") : t("SUG.Safety.loadoutOff"),
      backupHint: options.backup ? t("SUG.Safety.backupOn")
        : t("SUG.Safety.backupOff", {snapshot: localizeOr("SETUP.BACKUPS.CreateSnapshot", "Create a Snapshot")})
    };
  }

  /**
   * One line of evidence: what a source said.
   * @param {object} e
   * @returns {string}
   */
  #evidenceLine(e) {
    const source = t(`SUG.Source.${e.source}`);
    const data = {source, version: e.version ?? "", compat: compatText(e.compat ?? null), error: t(`SUG.ERR.${e.error || "blocked"}`, {detail: ""})};
    return t(`SUG.EVIDENCE.${e.kind}`, data);
  }

  /**
   * Packages that call deprecated Foundry functions.
   * @param {string} target
   * @returns {object[]}
   */
  #deprecatedRows(target) {
    const generation = generationOf(target);
    const rows = [];
    for ( const [owner, entry] of log.deprecations ) {
      const info = ownerInfo(owner);
      if ( (info.kind !== "module") && (info.kind !== "system") ) continue;
      const breaks = entry.until.some(u => generationOf(u) <= generation);
      rows.push({title: info.title, id: info.id, count: entry.count, message: entry.first.message, breaks,
        until: entry.until.join(", "), since: entry.first.since, links: packageLinks(info.id, info.kind)});
    }
    return rows.sort((a, b) => (Number(b.breaks) - Number(a.breaks)) || b.count - a.count || a.title.localeCompare(b.title));
  }

  /**
   * Deprecated calls of Foundry's own code or of no package.
   * @returns {number}
   */
  #deprecatedOther() {
    let sum = 0;
    for ( const [owner, entry] of log.deprecations ) {
      const {kind} = splitOwner(owner);
      if ( (kind !== "module") && (kind !== "system") ) sum += entry.count;
    }
    return sum;
  }

  /**
   * The checklist before an update. Names of Foundry's own buttons come from Foundry's translation.
   * @returns {string[]}
   */
  #checklist() {
    const snapshot = localizeOr("SETUP.BACKUPS.CreateSnapshot", "Create a Snapshot");
    return [
      t("SUG.Checklist.export"),
      t("SUG.Checklist.snapshot", {snapshot}),
      t("SUG.Checklist.copy"),
      t("SUG.Checklist.order"),
      t("SUG.Checklist.test")
    ];
  }

  /* -------------------------------------------- */
  /*  Tab: the way back                           */
  /* -------------------------------------------- */

  /**
   * The data of the third tab.
   * @param {object} state
   * @param {object[]} history
   * @returns {object}
   */
  #back(state, history) {
    const current = history[0] ?? null;
    const good = lastGood(history.slice(current ? 1 : 0));
    const rows = current ? rollbackTargets(history, current).filter(r => r.changed) : [];
    const manifests = new Map(state.modules.map(m => [m.id, m]));
    const items = rows.map(r => {
      const live = manifests.get(r.id);
      const derived = live?.manifest ? olderManifest(live.manifest, r.current, r.good) : null;
      const verified = session.verified.get(r.id);
      const github = live?.manifest ? parseGithubManifest(live.manifest) : null;
      const page = safeHttpUrl(live?.url);
      return {
        id: r.id, title: r.title, current: r.current, good: r.good, active: r.active,
        text: t(r.downgrade ? "SUG.Back.rowDown" : "SUG.Back.rowUp", {current: r.current, good: r.good}),
        manifest: derived?.url ?? "",
        manifestHost: derived ? hostOf(derived.url) : "",
        canVerify: derived?.kind === "github",
        verifyText: verified ? this.#verifyText(verified) : "",
        verifyState: verified?.state ?? "",
        verifiedUrl: verified?.state === "found" ? verified.url : "",
        noManifest: !derived,
        page,
        foundryPage: foundryPackagePage(r.id),
        pageNote: github || derived ? "" : t("SUG.Back.noDerive")
      };
    });
    const systemRow = this.#systemBack(state, current, history);
    const core = (good && (good.core !== state.core)) ? t("SUG.Back.core", {current: state.core, good: good.core}) : "";
    const differs = items.length + (systemRow ? 1 : 0);
    const status = this.#answer(backStatus({older: !!good, current: !!current?.good}), "SUG.Back.", {
      at: good ? dateText(good.goodAt ?? good.at) : "", day: good ? dayText(good.goodAt ?? good.at) : "", core: good?.core ?? "",
      system: `${good?.system?.id ?? ""} ${good?.system?.version ?? ""}`, count: differs});
    if ( good && !differs ) status.sub = t("SUG.Back.olderSame", {core: good.core, system: `${good.system?.id} ${good.system?.version}`});
    return {
      status,
      hasBackRows: differs > 0,
      good: good ? {at: dateText(good.goodAt ?? good.at), core: good.core, system: `${good.system?.id} ${good.system?.version}`,
        modules: good.modules.length} : null,
      currentGood: current?.good ? dateText(current.goodAt ?? current.at) : "",
      hasCurrent: !!current,
      rows: items,
      systemRow,
      core,
      history: history.map((h, i) => ({
        at: dateText(h.at), seen: dateText(h.seen), core: h.core, system: `${h.system?.id} ${h.system?.version}`,
        modules: h.modules.length, current: i === 0,
        mark: h.good ? t("SUG.History.good") : (h.errors ? t("SUG.History.errors", {count: Object.values(h.errors).reduce((s, n) => s + n, 0)}) : t("SUG.History.open")),
        markClass: h.good ? "good" : (h.errors ? "bad" : "open")
      })),
      steps: this.#backSteps(),
      hasHistory: history.length > 0
    };
  }

  /**
   * The way back for the game system.
   * @param {object} state
   * @param {object|null} current
   * @param {object[]} history
   * @returns {object|null}
   */
  #systemBack(state, current, history) {
    if ( !current ) return null;
    const goods = history.slice(1).filter(h => h.good && (h.system?.id === state.system.id));
    const older = goods.find(h => h.system.version !== state.system.version);
    if ( !older ) return null;
    const derived = state.system.manifest ? olderManifest(state.system.manifest, state.system.version, older.system.version) : null;
    return {title: state.system.title, current: state.system.version, good: older.system.version,
      text: t("SUG.Back.rowDown", {current: state.system.version, good: older.system.version}),
      manifest: derived?.url ?? "", manifestHost: derived ? hostOf(derived.url) : "", page: safeHttpUrl(state.system.url)};
  }

  /**
   * The text of a check of an older release.
   * @param {object} result
   * @returns {string}
   */
  #verifyText(result) {
    if ( result.state === "found" ) return t("SUG.Back.verifyFound", {tag: result.tag});
    if ( result.state === "noFile" ) return t("SUG.Back.verifyNoFile", {tag: result.tag});
    if ( result.state === "notFound" ) return t("SUG.Back.verifyNotFound");
    return t("SUG.Back.verifyFailed", {error: t(`SUG.ERR.${result.error ?? "blocked"}`, {detail: result.detail ?? ""})});
  }

  /**
   * The steps back, with Foundry's own button names.
   * @returns {string[]}
   */
  #backSteps() {
    const modules = localizeOr("SETUP.Modules", "Add-on Modules");
    const install = localizeOr("SETUP.InstallModule", "Install Module");
    const manifest = localizeOr("SETUP.ManifestURL", "Manifest URL");
    const ret = localizeOr("GAME.ReturnSetup", "Return to Setup");
    const snapshot = localizeOr("SETUP.BACKUPS.CreateSnapshot", "Create a Snapshot");
    return [
      t("SUG.Back.step.setup", {setup: ret}),
      t("SUG.Back.step.snapshot", {snapshot}),
      t("SUG.Back.step.install", {modules, install, manifest}),
      t("SUG.Back.step.world")
    ];
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /** @this {GuardApp} */
  static #onTab(event, target) {
    const tab = target.dataset.tab;
    if ( !TABS.includes(tab) ) return;
    session.tab = tab;
    this.render();
  }

  /** @this {GuardApp} */
  static async #onRunTrial() {
    await startTrial();
  }

  /** @this {GuardApp} */
  static async #onStartSearch() {
    const found = suspects();
    if ( !found.ids.length ) {
      ui.notifications.info(t("SUG.Search.nothing"));
      return;
    }
    const others = game.users.filter(u => u.active && (u.id !== game.user.id)).length;
    const intro = t(found.scope === "changed" ? "SUG.Search.introChanged" : "SUG.Search.introAll",
      {count: found.ids.length, since: found.since ? dayText(found.since) : ""});
    const hints = found.evidence?.length ? t("SUG.Search.introEvidence", {count: found.evidence.length}) : "";
    const paragraphs = [t("SUG.Search.intro"), intro, hints, others ? t("SUG.Search.others", {count: others}) : ""].filter(Boolean);
    const content = document.createElement("div");
    for ( const text of paragraphs ) content.append(Object.assign(document.createElement("p"), {textContent: text}));
    const sure = await DialogV2.confirm({window: {title: t("SUG.Search.title"), icon: "fa-solid fa-magnifying-glass"},
      content: content.innerHTML, yes: {label: t("SUG.Search.begin")}, no: {label: t("SUG.Search.not")}, rejectClose: false});
    if ( !sure ) return;
    countFeature(MODULE_ID, "searchStarted");
    await startSearch(found);
  }

  /** @this {GuardApp} */
  static async #onSearchAnswer(event, target) {
    this.element.querySelectorAll("[data-section=search] button").forEach(b => { b.disabled = true; });
    await answerSearch(target.dataset.answer === "there");
    if ( readSearch()?.phase === "found" ) countFeature(MODULE_ID, "searchFound");
  }

  /** @this {GuardApp} */
  static async #onSearchWiden() {
    await widenSearch();
  }

  /** @this {GuardApp} */
  static async #onSearchStop(event, target) {
    this.element.querySelectorAll("[data-section=search] button").forEach(b => { b.disabled = true; });
    const reloads = await stopSearch(target.dataset.keep || null);
    if ( !reloads ) this.render();
  }

  /** @this {GuardApp} */
  static async #onSwitchOff(event, target) {
    const id = target.dataset.id;
    const title = id2 => game.modules.get(id2)?.title ?? id2;
    const also = dependentsOf(id).map(title);
    const content = document.createElement("div");
    content.append(Object.assign(document.createElement("p"), {textContent: t("SUG.Off.text", {name: title(id)})}));
    if ( also.length ) content.append(Object.assign(document.createElement("p"), {textContent: t("SUG.Off.also", {names: also.join(", ")})}));
    const sure = await DialogV2.confirm({window: {title: t("SUG.Off.title"), icon: "fa-solid fa-power-off"}, content: content.innerHTML,
      yes: {label: t("SUG.Off.yes")}, no: {label: t("SUG.Search.not")}, rejectClose: false});
    if ( !sure ) return;
    countFeature(MODULE_ID, "moduleOff");
    await switchOff(id);
  }

  /** @this {GuardApp} */
  static async #onOnline() {
    if ( session.running ) return;
    const input = this.element.querySelector("input[name=target]");
    if ( input ) session.targetText = input.value;
    const target = parseTarget(session.targetText) || defaultTarget(game.version);
    const items = ratingItems(collectState());
    const controller = new AbortController();
    session.running = controller;
    session.progress = {done: 0, total: items.length * 2};
    countFeature(MODULE_ID, "onlineCheck");
    let queued = false;
    const redraw = () => {
      if ( queued ) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        if ( isShown(this) ) this.render();
      });
    };
    this.render();
    try {
      const {results, report} = await checker().checkPackages(items.map(i => ({id: i.id, manifest: i.manifest})), {
        signal: controller.signal,
        onProgress: (done, total) => {
          session.progress = {done, total};
          redraw();
        }
      });
      session.results = results;
      session.report = report;
      session.checkedTarget = target;
    } catch(err) {
      console.error(`${MODULE_ID} | The online check failed`, err);
      ui.notifications.error(t("SUG.Online.failed"));
    } finally {
      session.running = null;
      session.progress = null;
      if ( isShown(this) ) this.render();
    }
  }

  /** @this {GuardApp} */
  static #onCancelOnline() {
    session.running?.abort();
  }

  /** @this {GuardApp} */
  static async #onExportJson() {
    GuardApp.#export("json");
  }

  /** @this {GuardApp} */
  static async #onExportText() {
    GuardApp.#export("txt");
  }

  /**
   * Save the export as a file.
   * @param {"json"|"txt"} kind
   */
  static #export(kind) {
    const data = exportData();
    const date = data.generatedAt;
    if ( kind === "json" ) {
      foundry.utils.saveDataToFile(JSON.stringify(data, null, 2), "application/json", exportFileName(date, "json"));
    } else {
      foundry.utils.saveDataToFile(exportText(data, t), "text/plain", exportFileName(date, "txt"));
    }
    countFeature(MODULE_ID, "exportMade");
    ui.notifications.info(t("SUG.Export.saved", {file: exportFileName(date, kind)}));
  }

  /** @this {GuardApp} */
  static async #onCopyUrl(event, target) {
    const url = safeHttpUrl(target.dataset.url);
    if ( !url ) return;
    const ok = await copyText(url);
    if ( ok ) ui.notifications.info(t("SUG.Back.copied"));
    else ui.notifications.warn(t("SUG.Back.copyFailed"));
    countFeature(MODULE_ID, "rollbackShown");
  }

  /** @this {GuardApp} */
  static async #onVerifyOlder(event, target) {
    const id = target.dataset.id;
    const state = collectState();
    const live = state.modules.find(m => m.id === id);
    const history = readHistory();
    const row = rollbackTargets(history, history[0] ?? state).find(r => r.id === id);
    const github = live?.manifest ? parseGithubManifest(live.manifest) : null;
    if ( !github || !row?.good ) return;
    target.disabled = true;
    const result = await checker().githubRelease(github, row.good);
    session.verified.set(id, result);
    if ( isShown(this) ) this.render();
  }

  /** @this {GuardApp} */
  static #onClearErrors() {
    log.clear();
    this.render();
  }

  /** @this {GuardApp} */
  static async #onRunReady() {
    await startReady();
  }

  /** @this {GuardApp} */
  static async #onReportBug(event, target) {
    const id = target.dataset.id;
    if ( !id ) return;
    await openReport({id, kind: target.dataset.kind === "system" ? "system" : "module", error: errorFor(id, target.dataset.key)});
  }

  /** @this {GuardApp} */
  static async #onReadPlayers() {
    await markPlayerErrorsRead();
  }

  /** @this {GuardApp} */
  static async #onClearPlayers() {
    await clearPlayerErrors();
  }

  /** @this {GuardApp} */
  static async #onSaveLoadout(event, target) {
    target.disabled = true;
    session.safety = {...(await saveModuleList()), at: new Date().toISOString()};
    if ( session.safety.ok ) countFeature(MODULE_ID, "loadoutSaved");
    if ( isShown(this) ) this.render();
  }

  /** @this {GuardApp} */
  static #onOpenLoadouts() {
    openLoadouts();
  }
}

/**
 * What is known about an error of a module, for the bug report: the entry of a player, the test run, or what the watch of
 * this browser counted.
 * @param {string} id          Module id
 * @param {string} [key]       The key of an entry in the list of the players' errors
 * @returns {{message: string, kind: string, where: object, stack: string[], source: string}}
 */
export function errorFor(id, key = "") {
  const owner = `module:${id}`;
  const entry = (key && playerStore.entries.get(key)) || playerStore.list().find(e => e.owner === owner);
  if ( entry ) return {message: entry.message, kind: entry.kind, where: entry.where, stack: entry.stack, source: "player"};
  const trial = (session.trial ?? readHistory()[0]?.trial)?.owners?.find(o => o.owner === owner);
  if ( trial ) {
    const step = (trial.steps ?? []).find(s => TRIAL_WHERE[s]);
    return {message: trial.message, kind: "error", where: step ? {type: TRIAL_WHERE[step], name: step} : {type: "script", name: ""},
      stack: [], source: "trial"};
  }
  const seen = log.errors.get(owner);
  if ( seen ) {
    return {message: seen.last?.message ?? seen.first.message, kind: seen.last?.kind ?? "error", where: {type: "script", name: ""},
      stack: [], source: "gm"};
  }
  return {message: "", kind: "error", where: {type: "script", name: ""}, stack: [], source: ""};
}

/**
 * The data for an export, from the current state and what the window knows.
 * @returns {object}
 */
export function exportData() {
  const state = collectState();
  const history = readHistory();
  const target = parseTarget(session.targetText) || defaultTarget(game.version);
  const rated = rateAll(ratingItems(state), session.results, target);
  const problems = findProblems({core: state.core, system: state.system, modules: state.modules});
  const deprecations = [...log.deprecations].map(([owner, e]) => ({id: owner, count: e.count, message: e.first.message,
    until: e.until}));
  const errors = [...log.errors].map(([owner, e]) => ({id: owner, count: e.count, message: e.first.message}));
  return buildExport({generatedAt: new Date().toISOString(), state, history, target, rated,
    report: session.report, problems, deprecations, errors});
}

/** The result of the last check before a session, for the API. */
export function lastReady() {
  return session.ready;
}

/** The open window, if any. */
let instance = null;

/**
 * Run the test run, with the window open. The result stays in the window and goes with the state of this start.
 * @returns {Promise<object|null>}   The summary, or null when one is running already
 */
export async function startTrial() {
  if ( session.trialStep ) return null;
  session.tab = "changes";
  session.trial = null;
  session.trialStep = {done: 0, total: 1, label: ""};
  const app = await openGuard();
  countFeature(MODULE_ID, "trialRun");
  let result = null;
  try {
    result = await runTrial({onStep: (done, total, step) => {
      session.trialStep = {done: done + 1, total, label: t(`SUG.Trial.step.${step.id}`)};
      if ( isShown(app) ) app.render();
    }});
    session.trial = result;
    if ( isRecorder() ) await recordTrial(storedTrial(result));
  } catch(err) {
    console.error(`${MODULE_ID} | The test run failed`, err);
    ui.notifications.error(t("SUG.Trial.failed"));
  } finally {
    session.trialStep = null;
    if ( isShown(app) ) {
      await app.render();
      app.bringToFront?.();
    }
  }
  return result;
}

/**
 * "Ready for tonight?": the test run, the errors of the players since the last read, and the versions of the players'
 * browsers, with one answer and the next step.
 * @returns {Promise<object|null>}   The result, or null when a run is going on
 */
export async function startReady() {
  if ( session.readyRunning || session.trialStep ) return null;
  session.tab = "changes";
  session.readyRunning = {phase: "trial"};
  session.ready = null;
  const app = await openGuard();
  countFeature(MODULE_ID, "readyRun");
  try {
    const trial = await startTrial();
    session.readyRunning = {phase: "players"};
    if ( isShown(app) ) app.render();
    const versions = await requestVersions();
    session.ready = buildReady(trial, versions);
  } catch(err) {
    console.error(`${MODULE_ID} | The check before the session failed`, err);
    ui.notifications.error(t("SUG.Ready.failed"));
  } finally {
    session.readyRunning = null;
    if ( isShown(app) ) {
      await app.render();
      app.bringToFront?.();
    }
  }
  return session.ready;
}

/**
 * Put the findings of the check together.
 * @param {object|null} trial
 * @param {{players: object[], mine: object}} versions
 * @returns {object}
 */
function buildReady(trial, versions) {
  const state = collectState();
  const title = id => game.modules.get(id)?.title ?? id;
  const trialModules = (trial?.owners ?? []).map(o => ownerInfo(o.owner).title);
  const playerModules = playerStore.byOwner({unreadOnly: true}).map(row => ownerInfo(row.owner).title);
  const players = versions.players.filter(p => p.kinds.length).map(p => {
    const lines = [];
    if ( !p.answered ) lines.push(t("SUG.Ready.diff.silent"));
    else {
      const d = p.diff;
      if ( d.core ) lines.push(t("SUG.Ready.diff.core", d.core));
      if ( d.system ) lines.push(t("SUG.Ready.diff.system", d.system));
      for ( const m of d.different ) lines.push(t("SUG.Ready.diff.different", {title: title(m.id), gm: m.gm, player: m.player}));
      if ( d.missing.length ) lines.push(t("SUG.Ready.diff.missing", {names: d.missing.map(title).join(", ")}));
      if ( d.extra.length ) lines.push(t("SUG.Ready.diff.extra", {names: d.extra.map(title).join(", ")}));
    }
    return {name: p.name, kinds: p.kinds, lines};
  });
  const fitProblems = findProblems({core: state.core, system: state.system, modules: state.modules})
    .filter(p => p.severity === "problem").length;
  const answer = readyAnswer({trialModules, playerModules, players, connected: versions.players.length, fitProblems, trialDone: !!trial});
  return {at: new Date().toISOString(), answer, trialModules, playerModules, players, connected: versions.players.length, fitProblems};
}

/**
 * Open the window.
 * @param {object} [options]
 * @param {string} [options.tab]
 * @returns {Promise<GuardApp>}
 */
export async function openGuard({tab} = {}) {
  if ( !game.user.isGM ) {
    ui.notifications.warn(t("SUG.gmOnly"));
    return null;
  }
  if ( TABS.includes(tab) ) session.tab = tab;
  if ( !instance ) instance = new GuardApp();
  markUsed(MODULE_ID);
  countFeature(MODULE_ID, "windowOpened");
  await instance.render({force: true});
  instance.bringToFront?.();
  return instance;
}

/** Redraw the window if it is open. */
export function refreshGuard() {
  if ( isShown(instance) ) instance.render();
}

/**
 * The checker of the window, for the API and for tests.
 * @returns {OnlineChecker}
 */
export function onlineChecker() {
  return checker();
}

/**
 * What the last online check found, for the API.
 * @returns {{target: string, results: Map<string, object>, report: object|null}}
 */
export function lastOnline() {
  return {target: session.checkedTarget, results: session.results, report: session.report};
}

/**
 * Run a check without a window.
 * @param {string} [targetText]
 * @param {object} [options]
 * @param {boolean} [options.online=false]   Ask the Forge and the manifests (the caller is responsible for consent)
 * @returns {Promise<object>}
 */
export async function runCheck(targetText, {online = false} = {}) {
  if ( online && !game.user.isGM ) throw new Error(t("SUG.gmOnly"));
  const target = parseTarget(targetText) || defaultTarget(game.version);
  const state = collectState();
  const items = ratingItems(state);
  if ( online ) {
    const {results, report} = await checker().checkPackages(items.map(i => ({id: i.id, manifest: i.manifest})));
    session.results = results;
    session.report = report;
    session.checkedTarget = target;
  }
  const rated = rateAll(items, session.results, target);
  const counts = countStatuses(rated);
  const labels = Object.fromEntries(["ready", "update", "likely", "unknown", "blocked"].map(s => [s, t(`SUG.STATUS.${s}`)]));
  return {target, rated, counts, verdict: verdictLine(counts, rated.filter(r => r.status === "blocked").map(r => r.title), labels),
    report: session.report};
}
