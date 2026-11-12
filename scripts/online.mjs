/**
 * The online check. Nothing in this file runs without a click of the GM: the window calls it. Pure code, no Foundry
 * globals, the network function is passed in so tests can fake it. Answers from the network are data: only plain
 * strings are taken from them, links only when they are http or https, and a failed request is a result, never an
 * error that stops the list.
 *
 * Sources, as tested from a browser page on plain http (see MANUAL):
 *  - forge-vtt.com/api/bazaar/package/<id>: allows the page (CORS), gives the latest version and the compatibility of
 *    every version.
 *  - The manifest address of the installed package: allowed only when its host sends CORS headers (raw.githubusercontent.com
 *    does, github.com release downloads do not).
 *  - api.github.com: allowed (CORS), used to check that the release of an older version exists.
 */

import {cleanCompat} from "./rating.mjs";
import {forgePackageApi, githubTagApi, isPackageId, safeHttpUrl, tagCandidates} from "./links.mjs";
import {issueSearchUrl, parseIssues} from "./report-data.mjs";
import {hasVersion} from "./versions.mjs";

/** How long answers stay in memory: one hour. */
export const CACHE_MS = 60 * 60 * 1000;

/** The biggest answer that is read, in characters. */
export const MAX_TEXT = 3_000_000;

/** How many versions of one package are kept. */
const MAX_VERSIONS = 400;

/* -------------------------------------------- */
/*  Parsing                                     */
/* -------------------------------------------- */

/**
 * Read the answer of the Forge's package list.
 * @param {*} json
 * @returns {object}   {state: "ok", ...} or {state: "notListed"}; throws an Error with code "invalid" for other shapes
 */
export function parseForge(json) {
  if ( !json || (typeof json !== "object") || (typeof json.success !== "boolean") ) throw codeError("invalid");
  if ( !json.success ) throw codeError("invalid");
  if ( json.package === null ) return {state: "notListed", source: "forge"};
  const pkg = json.package;
  if ( !pkg || (typeof pkg !== "object") ) throw codeError("invalid");
  const versions = Array.isArray(pkg.versions) ? pkg.versions.filter(v => typeof v === "string").slice(0, MAX_VERSIONS) : [];
  const compat = {};
  if ( pkg.compatibility && (typeof pkg.compatibility === "object") ) {
    for ( const [version, block] of Object.entries(pkg.compatibility).slice(0, MAX_VERSIONS) ) {
      const clean = cleanCompat(block);
      if ( clean ) compat[version] = clean;
    }
  }
  return {
    state: "ok",
    source: "forge",
    title: (typeof pkg.title === "string") ? pkg.title.slice(0, 200) : "",
    latest: hasVersion(pkg.latest) ? String(pkg.latest) : "",
    versions,
    compat,
    notes: safeHttpUrl(pkg.notes),
    url: safeHttpUrl(pkg.url)
  };
}

/**
 * Read a manifest (module.json or system.json).
 * @param {*} json
 * @param {string} id   The package id that was asked for
 * @returns {object}
 */
export function parseManifest(json, id) {
  if ( !json || (typeof json !== "object") || Array.isArray(json) ) throw codeError("invalid");
  if ( json.id !== id ) throw codeError("otherPackage");
  const version = hasVersion(json.version) ? String(json.version) : "";
  if ( !version ) throw codeError("invalid");
  const block = json.compatibility ?? {minimum: json.minimumCoreVersion, verified: json.compatibleCoreVersion};
  const compat = {};
  const clean = cleanCompat(block);
  if ( clean ) compat[version] = clean;
  return {
    state: "ok",
    source: "manifest",
    title: (typeof json.title === "string") ? json.title.slice(0, 200) : "",
    latest: version,
    versions: [version],
    compat,
    notes: safeHttpUrl(json.changelog),
    url: safeHttpUrl(json.url)
  };
}

/**
 * An Error that carries a code the window can translate.
 * @param {string} code
 * @param {string} [detail]
 * @returns {Error}
 */
function codeError(code, detail = "") {
  const error = new Error(code);
  error.code = code;
  error.detail = detail;
  return error;
}

/**
 * Turn whatever went wrong into a short code: "offline", "blocked", "timeout", "http", "invalid", "otherPackage",
 * "tooLarge", "rateLimit". "blocked" means the browser refused or could not reach the address: the browser does not
 * say whether it was a missing CORS permission, a network failure or a mixed content block.
 * @param {*} error
 * @param {{onLine?: boolean}} [env]
 * @returns {{code: string, detail: string}}
 */
export function describeFailure(error, env = {}) {
  // The check for the abort comes first: a DOMException has a number as its code, an abort has 20
  if ( error?.name === "AbortError" ) return {code: "timeout", detail: ""};
  if ( typeof error?.code === "string" ) return {code: error.code, detail: error.detail ?? ""};
  if ( env.onLine === false ) return {code: "offline", detail: ""};
  if ( error instanceof SyntaxError ) return {code: "invalid", detail: ""};
  return {code: "blocked", detail: ""};
}

/* -------------------------------------------- */
/*  Checker                                     */
/* -------------------------------------------- */

/**
 * The online checker: throttled, with a one hour memory.
 */
export class OnlineChecker {
  /**
   * @param {object} [options]
   * @param {Function} [options.fetchFn]       Same signature as fetch
   * @param {Function} [options.now]           Returns milliseconds
   * @param {Function} [options.sleep]         Returns a promise that resolves after the milliseconds
   * @param {number} [options.delay=200]       Pause between the requests of one worker
   * @param {number} [options.timeout=10000]
   * @param {number} [options.concurrency=2]
   * @param {number} [options.ttl]
   * @param {Function} [options.onLine]        Returns false when the browser knows it is offline
   */
  constructor({fetchFn, now = () => Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms)), delay = 200,
    timeout = 10000, concurrency = 2, ttl = CACHE_MS, onLine = () => true} = {}) {
    this.fetchFn = fetchFn ?? ((...args) => globalThis.fetch(...args));
    this.now = now;
    this.sleep = sleep;
    this.delay = delay;
    this.timeout = timeout;
    this.concurrency = Math.max(1, concurrency);
    this.ttl = ttl;
    this.onLine = onLine;
    /** @type {Map<string, {at: number, result: object}>} */
    this.cache = new Map();
    /** How many requests went out (for tests and the debug file). */
    this.requests = 0;
  }

  /** Forget the answers in memory. */
  clear() {
    this.cache.clear();
  }

  /**
   * Get an address as JSON.
   * @param {string} url
   * @param {object} [options]
   * @returns {Promise<{status: number, json: *}>}
   */
  async #getJson(url, {headers} = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    this.requests++;
    try {
      const response = await this.fetchFn(url, {method: "GET", mode: "cors", credentials: "omit",
        referrerPolicy: "no-referrer", redirect: "follow", signal: controller.signal, headers});
      if ( (response.status === 403) || (response.status === 429) ) {
        if ( response.headers?.get?.("x-ratelimit-remaining") === "0" ) throw codeError("rateLimit");
      }
      if ( !response.ok ) return {status: response.status, json: null};
      const text = await response.text();
      if ( text.length > MAX_TEXT ) throw codeError("tooLarge");
      return {status: response.status, json: JSON.parse(text)};
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Run a lookup with the memory of the checker.
   * @param {string} key
   * @param {Function} lookup   Returns a result object, may throw
   * @returns {Promise<object>}
   */
  async #cached(key, lookup) {
    const hit = this.cache.get(key);
    if ( hit && ((this.now() - hit.at) < this.ttl) ) return {...hit.result, cached: true};
    let result;
    try {
      result = await lookup();
    } catch(err) {
      const {code, detail} = describeFailure(err, {onLine: this.onLine()});
      // Failures are not remembered: the next click tries again
      return {state: "error", error: code, detail};
    }
    this.cache.set(key, {at: this.now(), result});
    return result;
  }

  /**
   * The Forge's entry for a package id.
   * @param {string} id
   * @returns {Promise<object>}
   */
  forge(id) {
    if ( !isPackageId(id) ) return Promise.resolve({state: "error", error: "invalid", detail: "", source: "forge"});
    return this.#cached(`forge:${id}`, async () => {
      const {status, json} = await this.#getJson(forgePackageApi(id));
      if ( status !== 200 ) throw codeError("http", String(status));
      return parseForge(json);
    }).then(result => ({source: "forge", ...result}));
  }

  /**
   * The manifest of a package at an address.
   * @param {string} id
   * @param {string} url
   * @returns {Promise<object>}
   */
  manifest(id, url) {
    const clean = safeHttpUrl(url);
    if ( !clean ) return Promise.resolve({state: "error", error: "noManifest", detail: "", source: "manifest"});
    return this.#cached(`manifest:${clean}`, async () => {
      const {status, json} = await this.#getJson(clean);
      if ( status !== 200 ) throw codeError("http", String(status));
      return parseManifest(json, id);
    }).then(result => ({source: "manifest", ...result}));
  }

  /**
   * Does the release of an older version exist on GitHub, with the manifest file?
   * @param {{owner: string, repo: string, file: string}} repo
   * @param {string} version
   * @returns {Promise<{state: "found"|"notFound"|"error", tag?: string, url?: string, error?: string}>}
   */
  async githubRelease({owner, repo, file}, version) {
    for ( const tag of tagCandidates(version) ) {
      const result = await this.#cached(`github:${owner}/${repo}/${tag}`, async () => {
        const {status, json} = await this.#getJson(githubTagApi(owner, repo, tag), {headers: {Accept: "application/vnd.github+json"}});
        if ( status === 404 ) return {state: "notFound"};
        if ( status !== 200 ) throw codeError("http", String(status));
        const assets = Array.isArray(json?.assets) ? json.assets.map(a => a?.name) : [];
        const real = (typeof json?.tag_name === "string") ? json.tag_name : tag;
        if ( !assets.includes(file) ) return {state: "noFile", tag: real};
        return {state: "found", tag: real,
          url: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/download/${encodeURIComponent(real)}/${encodeURIComponent(file)}`};
      });
      if ( result.state === "error" ) return result;
      if ( result.state === "found" || result.state === "noFile" ) return result;
      await this.sleep(this.delay);
    }
    return {state: "notFound"};
  }

  /**
   * Open issues of a repository that match the key words of an error.
   * @param {{owner: string, repo: string}} repo
   * @param {string[]} terms
   * @returns {Promise<{state: "ok"|"error", total?: number, issues?: object[], error?: string, detail?: string}>}
   */
  issues(repo, terms) {
    if ( !terms.length ) return Promise.resolve({state: "ok", total: 0, issues: []});
    const url = issueSearchUrl(repo, terms);
    return this.#cached(`issues:${url}`, async () => {
      const {status, json} = await this.#getJson(url, {headers: {Accept: "application/vnd.github+json"}});
      if ( status !== 200 ) throw codeError("http", String(status));
      const parsed = parseIssues(json);
      if ( !parsed ) throw codeError("invalid");
      return {state: "ok", ...parsed};
    });
  }

  /**
   * Check a list of packages: first the Forge list for every id, then the manifest of those the Forge did not answer.
   * @param {{id: string, manifest?: string}[]} items
   * @param {object} [options]
   * @param {Function} [options.onProgress]   Called with (done, total, id)
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<{results: Map<string, object>, report: object}>}
   */
  async checkPackages(items, {onProgress, signal} = {}) {
    const results = new Map();
    const report = {
      forge: {asked: 0, ok: 0, notListed: 0, failed: 0, cached: 0},
      manifest: {asked: 0, ok: 0, failed: 0, skipped: 0, cached: 0},
      failures: [],
      total: items.length
    };
    let done = 0;
    const total = items.length * 2;
    const step = id => onProgress?.(++done, total, id);

    const pool = async (list, work) => {
      let index = 0;
      const workers = Array.from({length: Math.min(this.concurrency, list.length)}, async () => {
        while ( index < list.length ) {
          if ( signal?.aborted ) return;
          const item = list[index++];
          await work(item);
          if ( signal?.aborted ) return;
          await this.sleep(this.delay);
        }
      });
      await Promise.all(workers);
    };

    await pool(items, async item => {
      report.forge.asked++;
      const result = await this.forge(item.id);
      if ( result.cached ) report.forge.cached++;
      results.set(item.id, result);
      if ( result.state === "ok" ) report.forge.ok++;
      else if ( result.state === "notListed" ) report.forge.notListed++;
      else {
        report.forge.failed++;
        report.failures.push({source: "forge", id: item.id, error: result.error, detail: result.detail});
      }
      step(item.id);
    });

    const second = items.filter(item => results.get(item.id)?.state !== "ok");
    done += (items.length - second.length);
    await pool(second, async item => {
      if ( !safeHttpUrl(item.manifest) ) {
        report.manifest.skipped++;
        step(item.id);
        return;
      }
      report.manifest.asked++;
      const forge = results.get(item.id);
      const result = await this.manifest(item.id, item.manifest);
      if ( result.cached ) report.manifest.cached++;
      if ( result.state === "ok" ) {
        report.manifest.ok++;
        results.set(item.id, result);
      } else {
        report.manifest.failed++;
        report.failures.push({source: "manifest", id: item.id, error: result.error, detail: result.detail});
        // Keep what the Forge said ("not listed" is a statement, a failure is not)
        results.set(item.id, forge?.state === "notListed" ? {...forge, manifestError: result.error} : result);
      }
      step(item.id);
    });
    return {results, report};
  }
}
