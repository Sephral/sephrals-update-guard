/**
 * Reporting a problem to the author of a module. Pure code, no Foundry globals. Finds the GitHub repository of a module
 * from its manifest, the key words of an error for the search of open issues, and the text of a bug report. Nothing here
 * sends anything: the window asks the GM first.
 */

import {safeHttpUrl} from "./links.mjs";

/** How many key words are used to search, how many issues are shown. */
export const TERM_LIMIT = 6;
export const ISSUE_LIMIT = 5;

/** The longest address that is opened with a prefilled text. */
export const URL_LIMIT = 7000;

/** Words that every error message has and that tell nothing. */
const COMMON = new Set(["cannot", "read", "properties", "property", "of", "undefined", "null", "reading", "is", "not", "a", "an",
  "the", "function", "error", "uncaught", "typeerror", "referenceerror", "syntaxerror", "unhandled", "rejection", "failed", "to",
  "in", "at", "for", "or", "and", "with", "from", "object", "string", "number", "value", "set", "get", "no", "of", "be", "has",
  "have", "was", "this", "that", "it", "on", "as", "by", "when", "can", "t", "s"]);

/**
 * The GitHub repository behind an address: a page, an issues page, a release download or a raw file.
 * @param {*} value
 * @returns {{owner: string, repo: string}|null}
 */
export function githubRepoOf(value) {
  const clean = safeHttpUrl(typeof value === "string" ? value : "");
  if ( !clean ) return null;
  const url = new URL(clean);
  if ( !["github.com", "www.github.com", "raw.githubusercontent.com"].includes(url.hostname) ) return null;
  const [owner, rawRepo] = url.pathname.split("/").filter(Boolean);
  const repo = String(rawRepo ?? "").replace(/\.git$/i, "");
  const part = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/;
  if ( !owner || !repo || !part.test(owner) || !part.test(repo) ) return null;
  return {owner, repo};
}

/**
 * The repository of a module: the address for bug reports first, then the project page, the manifest, the readme and the
 * changelog.
 * @param {{bugs?: string, url?: string, manifest?: string, readme?: string, changelog?: string}} pkg
 * @returns {{owner: string, repo: string, source: string}|null}
 */
export function repositoryOf(pkg) {
  for ( const source of ["bugs", "url", "manifest", "readme", "changelog"] ) {
    const found = githubRepoOf(pkg?.[source]);
    if ( found ) return {...found, source};
  }
  return null;
}

/**
 * The key words of an error message for the search: names and unusual words, not the phrases every message has.
 * @param {string} message
 * @param {number} [limit]
 * @returns {string[]}
 */
export function issueTerms(message, limit = TERM_LIMIT) {
  const words = String(message ?? "").replace(/\(.*?\bat\b.*?\)/g, " ").split(/[^A-Za-z0-9_$]+/).filter(Boolean);
  const seen = new Set();
  const terms = [];
  for ( const word of words ) {
    const key = word.toLowerCase();
    if ( (word.length < 3) || COMMON.has(key) || /^\d+$/.test(word) || seen.has(key) ) continue;
    seen.add(key);
    terms.push(word);
    if ( terms.length >= limit ) break;
  }
  return terms;
}

/**
 * The address of the search for open issues.
 * @param {{owner: string, repo: string}} repo
 * @param {string[]} terms
 * @returns {string}
 */
export function issueSearchUrl({owner, repo}, terms) {
  const query = [...terms, `repo:${owner}/${repo}`, "is:issue", "is:open"].join(" ");
  return `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=${ISSUE_LIMIT}&sort=updated`;
}

/**
 * Read the answer of the search. Only plain strings and numbers are taken, links only when they are http or https.
 * @param {*} json
 * @returns {{total: number, issues: {number: number, title: string, url: string, comments: number, updated: string}[]}|null}
 */
export function parseIssues(json) {
  if ( !json || (typeof json !== "object") || !Array.isArray(json.items) ) return null;
  const issues = json.items.slice(0, ISSUE_LIMIT).filter(i => i && !i.pull_request).map(i => ({
    number: Number.isInteger(i.number) ? i.number : 0,
    title: String(i.title ?? "").slice(0, 200),
    url: safeHttpUrl(i.html_url),
    comments: Number.isInteger(i.comments) ? i.comments : 0,
    updated: String(i.updated_at ?? "").slice(0, 30)
  })).filter(i => i.number && i.url && /^https:\/\/github\.com\//.test(i.url));
  return {total: Number.isInteger(json.total_count) ? json.total_count : issues.length, issues};
}

/**
 * The text of a bug report. English, because the authors of modules read English and a report in one language helps
 * everyone who looks for it later.
 * @param {object} data
 * @param {{id: string, title: string, version: string}} data.module
 * @param {string} data.foundry
 * @param {{id: string, version: string}} data.system
 * @param {{message: string, kind?: string, where?: {type: string, name: string}, stack?: string[], source?: string}} data.error
 * @param {number} data.others    How many other modules are active
 * @param {string} [data.who]     Where the error appeared: "player", "test run", "this session"
 * @returns {{title: string, body: string}}
 */
export function buildReportText({module, foundry, system, error, others, who = ""}) {
  const message = String(error?.message ?? "").trim();
  const kinds = {error: "script error", rejection: "unhandled promise", hook: "error inside a hook"};
  const where = error?.where?.type && (error.where.type !== "script")
    ? `${error.where.type}${error.where.name ? ` ${error.where.name}` : ""}` : "";
  const lines = [
    `Module: ${module.title} (${module.id}) ${module.version}`,
    `Foundry VTT: ${foundry}`,
    `Game system: ${system.id} ${system.version}`,
    `Other active modules: ${others}`,
    "",
    "What happened:",
    message ? `"${message}"` : "(no error message was recorded)",
    [kinds[error?.kind] ?? "", where ? `in ${where}` : "", who ? `seen ${who}` : ""].filter(Boolean).join(", ")
  ].filter((line, i, all) => line || (all[i - 1] !== ""));
  const stack = (error?.stack ?? []).filter(Boolean);
  if ( stack.length ) lines.push("", "Stack:", ...stack.map(line => `  ${line}`));
  lines.push("", "Steps to reproduce:", "1. (what you did just before it happened)", "", "Expected: it works without an error.");
  const title = message ? `${module.title}: ${message}`.slice(0, 120) : `${module.title}: error`;
  return {title, body: lines.join("\n")};
}

/**
 * The address that opens a new issue with the text filled in. Too long a text is cut, the rest stays in the clipboard.
 * @param {{owner: string, repo: string}} repo
 * @param {{title: string, body: string}} text
 * @returns {string}
 */
export function newIssueUrl({owner, repo}, {title, body}) {
  const base = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/new`;
  let cut = body;
  let url = `${base}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(cut)}`;
  while ( (url.length > URL_LIMIT) && cut.length > 200 ) {
    cut = cut.slice(0, Math.floor(cut.length * 0.8));
    url = `${base}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(cut)}`;
  }
  // Built from a fixed address and encoded parts only, so it is safe although it is longer than safeHttpUrl allows
  return url;
}
