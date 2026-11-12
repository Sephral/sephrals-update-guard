/**
 * The memory of errors and deprecated calls since the page loaded. Pure code, no Foundry globals. Per package it keeps
 * only a count and the first message, so nothing grows without a limit.
 */

/** The longest message that is kept. */
export const MESSAGE_LIMIT = 300;

/** How many packages are tracked apart, the rest is counted together. */
export const OWNER_LIMIT = 80;

/** How many removal versions are kept per package. */
const UNTIL_LIMIT = 6;

/** The key for packages beyond the limit. */
export const OVERFLOW = "other:overflow";

/**
 * Shorten a message to one line of limited length.
 * @param {*} value
 * @param {number} [limit]
 * @returns {string}
 */
export function clip(value, limit = MESSAGE_LIMIT) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return (text.length > limit) ? `${text.slice(0, limit - 1)}…` : text;
}

/**
 * What Foundry's compatibility warnings say about the version of the change and of its removal.
 * @param {string} message
 * @returns {{text: string, since: string, until: string}}
 */
export function parseDeprecation(message) {
  const lines = String(message ?? "").split("\n").map(line => line.trim()).filter(Boolean);
  const since = String(message ?? "").match(/Deprecated since Version\s+([0-9][0-9.]*)/i)?.[1] ?? "";
  const until = String(message ?? "").match(/support will be removed in Version\s+([0-9][0-9.]*)/i)?.[1] ?? "";
  const text = lines.find(line => !/^(Deprecated since Version|Backwards-compatible support)/i.test(line)) ?? lines[0] ?? "";
  return {text: clip(text), since, until};
}

/**
 * The memory.
 */
export class WatchLog {
  constructor({ownerLimit = OWNER_LIMIT} = {}) {
    this.ownerLimit = ownerLimit;
    /** @type {Map<string, {count: number, first: object, kinds: Record<string, number>}>} */
    this.errors = new Map();
    /** @type {Map<string, {count: number, first: object, until: string[]}>} */
    this.deprecations = new Map();
    this.since = new Date().toISOString();
  }

  /**
   * The key under which an owner is tracked.
   * @param {Map} map
   * @param {string} owner
   * @returns {string}
   */
  #slot(map, owner) {
    if ( map.has(owner) || (map.size < this.ownerLimit) ) return owner;
    return OVERFLOW;
  }

  /**
   * Count an error.
   * @param {string} owner     Owner key
   * @param {string} kind      "error", "rejection" or "hook"
   * @param {*} message
   * @param {string} [at]      ISO date
   */
  addError(owner, kind, message, at = new Date().toISOString()) {
    const key = this.#slot(this.errors, owner);
    let entry = this.errors.get(key);
    if ( !entry ) {
      entry = {count: 0, first: {message: clip(message), kind, at}, kinds: {}};
      this.errors.set(key, entry);
    }
    entry.count++;
    entry.last = {message: clip(message), kind, at};
    entry.kinds[kind] = (entry.kinds[kind] ?? 0) + 1;
  }

  /**
   * Count a deprecated call.
   * @param {string} owner
   * @param {string} message   The message of Foundry's compatibility warning
   * @param {string} [at]
   */
  addDeprecation(owner, message, at = new Date().toISOString()) {
    const key = this.#slot(this.deprecations, owner);
    const info = parseDeprecation(message);
    let entry = this.deprecations.get(key);
    if ( !entry ) {
      entry = {count: 0, first: {message: info.text, since: info.since, until: info.until, at}, until: []};
      this.deprecations.set(key, entry);
    }
    entry.count++;
    if ( info.until && !entry.until.includes(info.until) && (entry.until.length < UNTIL_LIMIT) ) {
      entry.until.push(info.until);
    }
  }

  /**
   * Error counts by owner key.
   * @returns {Record<string, number>}
   */
  errorCounts() {
    return Object.fromEntries([...this.errors].map(([owner, e]) => [owner, e.count]));
  }

  /**
   * Total number of errors.
   * @returns {number}
   */
  errorTotal() {
    return [...this.errors.values()].reduce((sum, e) => sum + e.count, 0);
  }

  /**
   * Total number of deprecated calls.
   * @returns {number}
   */
  deprecationTotal() {
    return [...this.deprecations.values()].reduce((sum, e) => sum + e.count, 0);
  }

  /** Forget everything counted so far. */
  clear() {
    this.errors.clear();
    this.deprecations.clear();
    this.since = new Date().toISOString();
  }
}
