/**
 * "Report this problem": a window for a module that is named by the test run, the search or the errors of the players.
 * It looks for open issues of the module's GitHub repository, only after the GM clicks and only with the key words of the
 * error, and it offers a ready bug report text and a link that opens a new issue with that text filled in. Nothing is
 * sent by the module itself, the GM sends the report on GitHub.
 */

import {MODULE_ID, TEMPLATES, addSettingsGear, copyText, isShown, setting, t} from "./config.mjs";
import {OnlineChecker} from "./online.mjs";
import {buildReportText, issueTerms, newIssueUrl, repositoryOf} from "./report-data.mjs";
import {safeHttpUrl} from "./links.mjs";
import {countFeature} from "./usage.mjs";

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;

/** The lookups of issues, with their memory. */
let checker = null;

/** The open window. */
let instance = null;

/** What the window is about. */
let current = null;

/**
 * The lookup with its memory of one hour.
 * @returns {OnlineChecker}
 */
function lookup() {
  checker ??= new OnlineChecker({onLine: () => navigator.onLine});
  return checker;
}

/** Where an error was seen, as words for the report text. */
const SEEN = {player: "in a player's browser", trial: "during a test run of Update Guard", gm: "in the GM's browser"};

/**
 * What the report is about, read from the installed package and the error.
 * @param {object} options
 * @param {string} options.id
 * @param {"module"|"system"} [options.kind]
 * @param {object} options.error    {message, kind, where, stack, source}
 * @returns {object}
 */
export function describeReport({id, kind = "module", error}) {
  const pkg = (kind === "system") ? game.system : game.modules.get(id);
  const title = String(pkg?.title ?? id);
  const version = String(pkg?.version ?? "");
  const repo = pkg ? repositoryOf({bugs: pkg.bugs, url: pkg.url, manifest: pkg.manifest, readme: pkg.readme, changelog: pkg.changelog}) : null;
  const others = [...game.modules.values()].filter(m => m.active && (m.id !== id)).length;
  const text = buildReportText({module: {id, title, version}, foundry: game.version,
    system: {id: game.system.id, version: String(game.system.version)}, error, others, who: SEEN[error?.source] ?? ""});
  return {id, kind, title, version, repo, error, text, terms: issueTerms(error?.message), pageUrl: safeHttpUrl(pkg?.url)};
}

export class ReportApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** What a sample window is about (made-up, see sample-windows.mjs), null for the real window. */
  sampleData = null;

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "sug-report",
    classes: ["sug-app", "sug-report"],
    tag: "section",
    window: {title: "SUG.Report.title", icon: "fa-solid fa-bug", resizable: true},
    position: {width: 620, height: 640},
    actions: {
      lookupIssues: ReportApp.#onLookup,
      copyReport: ReportApp.#onCopy,
      openIssue: ReportApp.#onOpenIssue
    }
  };

  /** @override */
  static PARTS = {main: {template: `${TEMPLATES}/report.hbs`, scrollable: [".sug-body"]}};

  /** @override */
  get title() {
    return t("SUG.Report.title");
  }

  /** @override */
  async _prepareContext() {
    const r = this.sampleData ?? current;
    const found = r.lookup;
    const where = r.error?.where?.type && (r.error.where.type !== "script")
      ? t(`SUG.Players.where.${r.error.where.type}`, {name: r.error.where.name}).trim() : "";
    const name = r.repo ? `${r.repo.owner}/${r.repo.repo}` : "";
    return {
      title: r.title, version: r.version, message: r.error?.message || t("SUG.Report.noMessage"), where,
      repo: name, hasRepo: !!r.repo,
      terms: r.terms.join(" "), hasTerms: r.terms.length > 0,
      sends: r.repo ? t("SUG.Report.sends", {repo: name, terms: r.terms.join(" ")}) : "",
      pageUrl: r.pageUrl,
      loading: found?.state === "loading",
      failed: found?.state === "error" ? t(`SUG.ERR.${found.error}`, {detail: found.detail ?? ""}) : "",
      issues: found?.state === "ok" ? found.issues.map(i => ({...i, comments: t("SUG.Report.comments", {count: i.comments})})) : [],
      none: found?.state === "ok" && !found.issues.length,
      body: r.text.body
    };
  }

  /** @override */
  _onRender(context, options) {
    super._onRender?.(context, options);
    this.element.dataset.sugTheme = setting("theme");
    addSettingsGear(this.element);
    this.element.querySelector("textarea[name=reportText]")?.addEventListener("input", event => {
      const r = this.sampleData ?? current;
      r.text = {...r.text, body: event.currentTarget.value};
    });
  }

  /** @override */
  _onClose(options) {
    super._onClose?.(options);
    // A sample window must not forget the real one
    if ( instance === this ) instance = null;
  }

  /** @this {ReportApp} */
  static async #onLookup() {
    const r = current;
    if ( !r?.repo || (r.lookup?.state === "loading") ) return;
    countFeature(MODULE_ID, "issueLookup");
    r.lookup = {state: "loading"};
    this.render();
    r.lookup = await lookup().issues(r.repo, r.terms);
    if ( isShown(this) ) this.render();
  }

  /** @this {ReportApp} */
  static async #onCopy() {
    const ok = await copyText(current.text.body);
    if ( ok ) ui.notifications.info(t("SUG.Report.copied"));
    else ui.notifications.warn(t("SUG.Back.copyFailed"));
  }

  /** @this {ReportApp} */
  static async #onOpenIssue() {
    const r = current;
    if ( !r?.repo ) return;
    // The text is in the clipboard as well: an address has a limit, and the cut text can be pasted whole
    await copyText(r.text.body);
    const url = newIssueUrl(r.repo, r.text);
    if ( url ) window.open(url, "_blank", "noopener,noreferrer");
  }
}

/**
 * Open the window for a problem.
 * @param {object} options   See describeReport
 * @returns {Promise<ReportApp|null>}
 */
export async function openReport(options) {
  if ( !game.user.isGM ) {
    ui.notifications.warn(t("SUG.gmOnly"));
    return null;
  }
  current = {...describeReport(options), lookup: null};
  countFeature(MODULE_ID, "reportOpened");
  instance ??= new ReportApp();
  await instance.render({force: true});
  instance.bringToFront?.();
  return instance;
}
