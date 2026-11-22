/**
 * Sample windows (api.samples, contract in samples.mjs): the Update Guard window in every state, the window "Report this
 * problem", the questions and the export text, filled with made-up modules and results (sample-data.mjs). Nothing here
 * runs a test run, switches a module off, starts a search, asks the network or writes a setting: the real window reads
 * its data from a made-up feed while its content is built, every button that would change something says that it does
 * nothing, no usage counter counts.
 */

import {MODULE_ID, t} from "./config.mjs";
import {buildExport, exportText} from "./export-data.mjs";
import {GuardApp, TABS, conflictRow, withSampleData} from "./guard-app.mjs";
import {findProblems} from "./problems.mjs";
import {rateAll} from "./rating.mjs";
import {ReportApp} from "./report-app.mjs";
import {WINDOW_KINDS, readyData, sampleBundle, sampleReport} from "./sample-data.mjs";
import {closeSample, markSample, openSampleDialog, openSampleText, sampleActions, sampleId} from "./samples.mjs";
import {ratingItems} from "./state.mjs";

/** Language key of the label of each entry. */
const entryLabel = key => t(`SUG.Sample.entry.${key}`);

/** The scenarios of the window: id, family and kind in sample-data.mjs, label key, and the heading in the translator's list. */
const WINDOWS = [
  ["run-trouble", "first", "trouble", "runTrouble"], ["run-one", "first", "one", "runOne"], ["run-tested", "first", "tested", "runTested"],
  ["run-ran", "first", "ran", "runRan"], ["run-changed", "first", "changed", "runChanged"], ["run-untested", "first", "untested", "runUntested"],
  ["run-first", "first", "first", "runFirst"], ["trial-running", "first", "trialRunning", "trialRunning"],
  ["ready-running", "ready", "readyRunning", "readyRunning"], ["ready-errors", "ready", "readyErrors", "readyErrors"],
  ["ready-players", "ready", "readyPlayers", "readyPlayers"], ["ready-versions", "ready", "readyVersions", "readyVersions"],
  ["ready-fit", "ready", "readyFit", "readyFit"], ["ready-conflicts", "ready", "readyConflicts", "readyConflicts"],
  ["ready-good", "ready", "readyGood", "readyGood"], ["ready-alone", "ready", "readyAlone", "readyAlone"],
  ["search-testing", "search", "testing", "searchTesting"], ["search-found", "search", "found", "searchFound"],
  ["search-none-changed", "search", "noneChanged", "searchNoneChanged"], ["search-none-all", "search", "noneAll", "searchNoneAll"],
  ["check-blocked", "check", "blocked", "checkBlocked"], ["check-blocked-one", "check", "blockedOne", "checkBlockedOne"],
  ["check-breaks", "check", "breaks", "checkBreaks"], ["check-breaks-one", "check", "breaksOne", "checkBreaksOne"],
  ["check-update", "check", "update", "checkUpdate"], ["check-update-one", "check", "updateOne", "checkUpdateOne"],
  ["check-open", "check", "open", "checkOpen"], ["check-ready", "check", "ready", "checkReady"],
  ["back-older", "back", "older", "backOlder"], ["back-same", "back", "same", "backSame"],
  ["back-current", "back", "current", "backCurrent"], ["back-none", "back", "none", "backNone"]
];

/** The group of a scenario in the translator's list: the tab it shows. */
function groupOf(family) {
  return t(`SUG.Tab.${{first: "changes", ready: "changes", search: "changes", check: "check", back: "back"}[family]}`);
}

/** The reports of a problem. */
const REPORTS = [["report-start", "start", "reportStart"], ["report-found", "found", "reportFound"], ["report-none", "none", "reportNone"],
  ["report-failed", "failed", "reportFailed"], ["report-loading", "loading", "reportLoading"], ["report-no-repo", "noRepo", "reportNoRepo"],
  ["report-no-message", "noMessage", "reportNoMessage"]];

/* -------------------------------------------- */
/*  The windows                                 */
/* -------------------------------------------- */

/** Switching the tab only looks: it is kept in the memory of the sample window. */
function sampleTab(event, target) {
  const tab = target.dataset.tab;
  if ( !TABS.includes(tab) ) return;
  this.sampleBundle.session.tab = tab;
  this.render();
}

/** "Report this problem" opens a sample of that window for the module named on the button. */
function sampleReportButton(event, target) {
  openSampleReport("click", "start", target.dataset.id);
}

/**
 * The Update Guard window over made-up data. The real class builds its content, the data is swapped for the length of that
 * (synchronous) work, so nothing of the real installation is read and nothing is written.
 */
class SampleGuardApp extends GuardApp {
  constructor(key, bundle) {
    super({id: sampleId(MODULE_ID, key), actions: {...sampleActions(GuardApp, []), switchTab: sampleTab, reportBug: sampleReportButton}});
    this.sampleBundle = bundle;
    markSample(this);
  }

  /** @override */
  async _prepareContext(options) {
    return withSampleData(this.sampleBundle, () => super._prepareContext(options));
  }
}

/**
 * The result of "Ready for tonight?" as the window keeps it, made from the made-up data. Built at every render, so its texts
 * follow the language.
 * @param {{feed: object, ready: object}} bundle
 * @returns {object}
 */
function readyResult(bundle) {
  const {feed, ready} = bundle;
  const title = id => feed.title("module", id);
  const players = ready.players.map(p => {
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
  const list = new Intl.ListFormat(game.i18n.lang || "en", {style: "long", type: "conjunction"});
  const conflictLines = withSampleData(bundle, () => feed.findConflicts().findings.filter(f => f.level !== "note").map(f => conflictRow(f, list).text));
  return {at: new Date().toISOString(), answer: ready.answer, trialModules: ready.trialModules, playerModules: ready.playerModules, players,
    connected: ready.connected, fitProblems: ready.fitProblems, conflictLines, conflictModules: ready.conflictModules};
}

/**
 * Open a sample of the Update Guard window.
 * @param {string} id
 * @param {string} family
 * @param {string} kind
 * @returns {Promise<SampleGuardApp>}
 */
async function openWindow(id, family, kind) {
  await closeSample(sampleId(MODULE_ID, id));
  const bundle = sampleBundle(family, kind, {core: String(game.version)});
  if ( bundle.ready ) {
    Object.defineProperty(bundle.session, "ready", {configurable: true, enumerable: true, get: () => readyResult(bundle)});
  }
  const app = new SampleGuardApp(id, bundle);
  await app.render({force: true});
  return app;
}

/** The window "Report this problem" over a made-up problem. */
class SampleReportApp extends ReportApp {
  constructor(key, data) {
    super({id: sampleId(MODULE_ID, key), actions: sampleActions(ReportApp, [])});
    this.sampleData = data;
    markSample(this);
  }
}

/**
 * Open a sample of the report window.
 * @param {string} id       Entry id
 * @param {string} kind     See sampleReport
 * @param {string} [moduleId]
 * @returns {Promise<SampleReportApp>}
 */
async function openSampleReport(id, kind, moduleId = "banner-board") {
  await closeSample(sampleId(MODULE_ID, id));
  const app = new SampleReportApp(id, sampleReport(moduleId, kind, {core: String(game.version)}));
  await app.render({force: true});
  return app;
}

/* -------------------------------------------- */
/*  Questions and texts                         */
/* -------------------------------------------- */

/** Paragraphs as the HTML the real questions put into their dialog. */
function paragraphs(list) {
  const content = document.createElement("div");
  for ( const text of list.filter(Boolean) ) content.append(Object.assign(document.createElement("p"), {textContent: text}));
  return content.innerHTML;
}

/** The question before the search starts, for the suspects that changed or for all modules. */
function searchQuestion(id, all) {
  const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toLocaleDateString(game.i18n.lang || undefined, {dateStyle: "medium"});
  const text = [t("SUG.Search.intro"),
    all ? t("SUG.Search.introAll", {count: 9, since: ""}) : t("SUG.Search.introChanged", {count: 4, since}),
    all ? "" : t("SUG.Search.introEvidence", {count: 1}), t("SUG.Search.others", {count: 2})];
  return openSampleDialog({moduleId: MODULE_ID, id, title: t("SUG.Search.title"), content: () => paragraphs(text),
    buttons: [{label: t("SUG.Search.begin"), icon: "fa-solid fa-check", default: true}, {label: t("SUG.Search.not"), icon: "fa-solid fa-xmark"}]});
}

/** The question before a module is switched off, with what goes off with it. */
function switchOffQuestion() {
  return openSampleDialog({moduleId: MODULE_ID, id: "switch-off", title: t("SUG.Off.title"),
    content: () => paragraphs([t("SUG.Off.text", {name: "Echo Chamber"}), t("SUG.Off.also", {names: "Rune Roller"})]),
    buttons: [{label: t("SUG.Off.yes"), icon: "fa-solid fa-check", default: true}, {label: t("SUG.Search.not"), icon: "fa-solid fa-xmark"}]});
}

/** The text of the export before an update, over the made-up world of the first scenario. */
function sampleExportText() {
  const {feed, session} = sampleBundle("first", "trouble", {core: String(game.version)});
  const state = feed.collectState();
  const target = "15";
  const rated = rateAll(ratingItems(state), session.results, target);
  const problems = findProblems({core: state.core, system: state.system, modules: state.modules});
  const deprecations = [...feed.log.deprecations].map(([owner, e]) => ({id: owner, count: e.count, message: e.first.message, until: e.until}));
  const errors = [...feed.log.errors].map(([owner, e]) => ({id: owner, count: e.count, message: e.first.message}));
  const data = buildExport({generatedAt: new Date().toISOString(), state, history: feed.readHistory(), target, rated, report: null, problems, deprecations, errors});
  return exportText(data, t);
}

/* -------------------------------------------- */
/*  The list                                    */
/* -------------------------------------------- */

/**
 * The sample windows of the module (api.samples).
 * @returns {{id: string, label: string, group: string, open: () => Promise<object>}[]}
 */
export function sampleWindows() {
  const entries = WINDOWS.map(([id, family, kind, key]) => ({id, group: groupOf(family), label: entryLabel(key), open: () => openWindow(id, family, kind)}));
  for ( const [id, kind, key] of REPORTS ) {
    entries.push({id, group: t("SUG.Report.title"), label: entryLabel(key), open: () => openSampleReport(id, kind)});
  }
  const questions = t("SUG.Sample.group.questions");
  entries.push({id: "search-intro", group: questions, label: entryLabel("searchIntro"), open: () => searchQuestion("search-intro", false)},
    {id: "search-intro-all", group: questions, label: entryLabel("searchIntroAll"), open: () => searchQuestion("search-intro-all", true)},
    {id: "switch-off", group: questions, label: t("SUG.Off.title"), open: () => switchOffQuestion()},
    {id: "export-text", group: t("SUG.Sample.group.texts"), label: entryLabel("exportText"),
      open: () => openSampleText({moduleId: MODULE_ID, id: "export-text", title: entryLabel("exportText"), text: sampleExportText})});
  return entries;
}

export const __test__ = {WINDOWS, REPORTS, WINDOW_KINDS, readyData};
