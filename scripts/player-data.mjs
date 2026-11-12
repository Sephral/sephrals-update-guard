/**
 * Errors of the players and the versions their browsers run. Pure code, no Foundry globals. A player's browser sends
 * only a short message, a few stack lines and where it happened, never a name, an address of the server or a path on the
 * player's computer. The GM's client keeps what arrives, counts repeats and answers: which module, which player, how
 * often, where.
 */

import {clip} from "./watch-data.mjs";

/** The longest message that is sent. */
export const SEND_MESSAGE_LIMIT = 200;

/** How many stack lines are sent, and how long one may be. */
export const STACK_LINES = 5;
export const STACK_LINE_LIMIT = 150;

/** How many different errors one page reports, how many reports go out per minute, how long a repeat is held back. */
export const GATE_KEYS = 25;
export const GATE_PER_MINUTE = 8;
export const GATE_REPEAT_MS = 30000;

/** How many errors the GM keeps, and how many reports of one player are taken per minute. */
export const STORE_LIMIT = 200;
export const USER_PER_MINUTE = 30;

/** The owners that are reported: modules and the game system. */
const PACKAGE_OWNER = /^(module|system):[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** What a message may hold that points at a person or a place: addresses of servers and folders of a computer. */
const PERSONAL = [
  [/\b(?:https?|wss?|file|blob):\/\/[^\s/)'"]*/gi, ""],
  [/[A-Za-z]:\\Users\\[^\\\s)'"]+/g, "<user>"],
  [/\/(?:Users|home)\/[^/\s)'"]+/g, "<user>"],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<mail>"]
];

/**
 * A message without addresses of servers, folders of a computer and mail addresses, on one line and short.
 * @param {*} value
 * @param {number} [limit]
 * @returns {string}
 */
export function sanitizeMessage(value, limit = SEND_MESSAGE_LIMIT) {
  let text = String(value ?? "");
  for ( const [pattern, replacement] of PERSONAL ) text = text.replace(pattern, replacement);
  return clip(text, limit);
}

/**
 * One line of a stack trace as "function (path:line:column)", with the path starting at /modules/, /systems/ or the
 * file name. Lines of the browser's own code and of extensions are left out.
 * @param {string} line
 * @returns {string|null}
 */
function stackLine(line) {
  const match = String(line).match(/^\s*(?:at\s+)?(?:(.*?)\s*[@(]\s*)?((?:https?|file|blob|wss?):\/\/[^\s()]+?)(?::(\d+))(?::(\d+))?\)?\s*$/);
  if ( !match ) return null;
  const [, fn = "", url, row = "", col = ""] = match;
  let path = url.replace(/^[a-z]+:\/\/[^/]*/i, "").split(/[?#]/)[0];
  try {
    path = decodeURI(path);
  } catch {
    // Keep the raw path
  }
  const inside = path.match(/\/((?:modules|systems)\/.*)$/);
  path = inside ? inside[1] : path.split("/").filter(Boolean).slice(-2).join("/");
  const name = String(fn).replace(/^async\s+/, "").replace(/\s+\[as [^\]]+\]/, "").trim();
  const where = `${path}${row ? `:${row}` : ""}${col ? `:${col}` : ""}`;
  return clip(name ? `${name} (${where})` : where, STACK_LINE_LIMIT);
}

/**
 * The stack lines worth sending: the first lines that lead into a module or system, then the rest, up to a limit.
 * @param {string} stack
 * @param {number} [max]
 * @returns {string[]}
 */
export function sanitizeStack(stack, max = STACK_LINES) {
  const lines = String(stack ?? "").split("\n").map(stackLine).filter(Boolean);
  const own = lines.filter(line => /(?:^|[ (])(?:modules|systems)\//.test(line));
  const rest = lines.filter(line => !own.includes(line));
  return [...own, ...rest].slice(0, max);
}

/**
 * Where an error happened: in a sheet, a window, a hook or somewhere in a script. Foundry names a failed hook callback
 * with the hook, and render hooks are named after the window. Otherwise the function names on the stack tell.
 * @param {object} data
 * @param {string} [data.stack]
 * @param {string} [data.kind]   "error", "rejection" or "hook"
 * @param {string} [data.hook]   The name of the hook, for an error inside a hook
 * @returns {{type: "sheet"|"window"|"hook"|"script", name: string}}
 */
export function whereOf({stack = "", kind = "error", hook = ""} = {}) {
  const hookName = String(hook ?? "");
  const render = hookName.match(/^render(\w+)$/);
  if ( render ) return {type: /Sheet/.test(render[1]) ? "sheet" : "window", name: render[1]};
  if ( hookName ) return {type: "hook", name: hookName.slice(0, 60)};
  const text = String(stack ?? "");
  const sheet = text.match(/\b([A-Z]\w*Sheet\w*)\b/);
  if ( sheet ) return {type: "sheet", name: sheet[1]};
  const windowName = text.match(/\b([A-Z]\w*(?:App|Application|Dialog|Window|HUD|Config|Sidebar|Tracker|Directory|Popout|Menu)\w*)\b/);
  if ( windowName ) return {type: "window", name: windowName[1]};
  const hooks = /\bHooks\.(?:call|callAll|once|on)\b|#call\b|callbackFn/.test(text);
  if ( hooks || (kind === "hook") ) return {type: "hook", name: ""};
  return {type: "script", name: ""};
}

/**
 * The text that tells errors apart: the same message in the same place is the same error.
 * @param {{owner: string, kind: string, message: string, where?: {name?: string}}} item
 * @returns {string}
 */
export function fingerprint(item) {
  return [item.owner, item.kind, item.message, item.where?.name ?? ""].join("|").toLowerCase();
}

/**
 * Is this the owner of a package?
 * @param {*} owner
 * @returns {boolean}
 */
export function isReportable(owner) {
  return (typeof owner === "string") && PACKAGE_OWNER.test(owner);
}

/**
 * Make a report out of what the watch saw, in the form that is sent.
 * @param {{owner: string, kind: string, message: string, stack?: string, hook?: string}} item
 * @returns {{owner: string, kind: string, message: string, where: object, stack: string[], count: number}}
 */
export function buildReport(item) {
  const kind = ["error", "rejection", "hook"].includes(item.kind) ? item.kind : "error";
  return {owner: item.owner, kind, message: sanitizeMessage(item.message), where: whereOf({stack: item.stack, kind, hook: item.hook}),
    stack: sanitizeStack(item.stack), count: 1};
}

/**
 * The player's side: lets the first report of an error through at once and holds the repeats back. Repeats are
 * counted and go out together, at most one batch per error every 30 seconds and a few reports per minute altogether, so
 * a module that throws in a loop costs a few messages, not thousands.
 */
export class ErrorGate {
  /**
   * @param {object} [options]
   * @param {number} [options.repeatMs]
   * @param {number} [options.perMinute]
   * @param {number} [options.maxKeys]
   */
  constructor({repeatMs = GATE_REPEAT_MS, perMinute = GATE_PER_MINUTE, maxKeys = GATE_KEYS} = {}) {
    this.repeatMs = repeatMs;
    this.perMinute = perMinute;
    this.maxKeys = maxKeys;
    /** @type {Map<string, {report: object, held: number, sentAt: number}>} */
    this.keys = new Map();
    this.sent = [];
  }

  /**
   * May another report go out now?
   * @param {number} now
   * @returns {boolean}
   */
  #room(now) {
    this.sent = this.sent.filter(at => now - at < 60000);
    return this.sent.length < this.perMinute;
  }

  /**
   * A new error from the watch.
   * @param {object} report   From buildReport
   * @param {number} now      Milliseconds
   * @returns {object[]}      Reports to send now
   */
  add(report, now) {
    const key = fingerprint(report);
    let entry = this.keys.get(key);
    if ( !entry ) {
      if ( this.keys.size >= this.maxKeys ) return [];
      entry = {report, held: 0, sentAt: -Infinity};
      this.keys.set(key, entry);
      if ( this.#room(now) ) {
        entry.sentAt = now;
        this.sent.push(now);
        return [{...report, count: 1}];
      }
      entry.held = 1;
      return [];
    }
    entry.held++;
    return this.flush(now);
  }

  /**
   * The repeats that are due.
   * @param {number} now
   * @returns {object[]}
   */
  flush(now) {
    const out = [];
    for ( const entry of this.keys.values() ) {
      if ( !entry.held || ((now - entry.sentAt) < this.repeatMs) || !this.#room(now) ) continue;
      out.push({...entry.report, count: entry.held, repeat: true});
      entry.held = 0;
      entry.sentAt = now;
      this.sent.push(now);
    }
    return out;
  }
}

/**
 * Read what arrived over the socket. The sender may be anything, so only known fields are taken, as plain text of
 * limited length.
 * @param {*} value
 * @returns {object|null}   A report, or null when it is not one
 */
export function readReport(value) {
  if ( !value || (typeof value !== "object") || !isReportable(value.owner) ) return null;
  const kind = ["error", "rejection", "hook"].includes(value.kind) ? value.kind : "error";
  const where = value.where && (typeof value.where === "object") ? value.where : {};
  const type = ["sheet", "window", "hook", "script"].includes(where.type) ? where.type : "script";
  const stack = Array.isArray(value.stack) ? value.stack.slice(0, STACK_LINES).map(line => clip(line, STACK_LINE_LIMIT)) : [];
  const count = Math.min(9999, Math.max(1, Math.round(Number(value.count)) || 1));
  return {owner: value.owner, kind, message: sanitizeMessage(value.message), where: {type, name: clip(where.name ?? "", 60)}, stack, count};
}

/**
 * What the GM keeps: the errors of the players, per player, module and error.
 */
export class PlayerErrorStore {
  /**
   * @param {object} [options]
   * @param {number} [options.limit]
   * @param {number} [options.perMinute]
   */
  constructor({limit = STORE_LIMIT, perMinute = USER_PER_MINUTE} = {}) {
    this.limit = limit;
    this.perMinute = perMinute;
    /** @type {Map<string, object>} */
    this.entries = new Map();
    /** Everything up to this date counts as read (ISO date, or empty). */
    this.seenAt = "";
    this.taken = new Map();
  }

  /**
   * Take a report. A player that sends too many reports is ignored for the rest of the minute.
   * @param {{id: string, name: string}} user
   * @param {object} report   From readReport
   * @param {string} [at]     ISO date
   * @returns {{entry: object, isNew: boolean}|null}
   */
  add(user, report, at = new Date().toISOString()) {
    const now = Date.parse(at) || Date.now();
    const recent = (this.taken.get(user.id) ?? []).filter(time => now - time < 60000);
    if ( recent.length >= this.perMinute ) {
      this.taken.set(user.id, recent);
      return null;
    }
    recent.push(now);
    this.taken.set(user.id, recent);
    const key = `${user.id}|${fingerprint(report)}`;
    let entry = this.entries.get(key);
    const isNew = !entry;
    if ( !entry ) {
      entry = {key, userId: user.id, userName: clip(user.name, 60), owner: report.owner, kind: report.kind, message: report.message,
        where: report.where, stack: report.stack, count: 0, first: at, last: at};
      this.entries.set(key, entry);
    }
    entry.count += report.count;
    entry.last = at;
    entry.userName = clip(user.name, 60);
    this.#trim();
    return {entry, isNew};
  }

  /** Drop the oldest entries beyond the limit. */
  #trim() {
    if ( this.entries.size <= this.limit ) return;
    const oldest = [...this.entries.values()].sort((a, b) => a.last.localeCompare(b.last)).slice(0, this.entries.size - this.limit);
    for ( const entry of oldest ) this.entries.delete(entry.key);
  }

  /**
   * Is an entry newer than what was read?
   * @param {object} entry
   * @returns {boolean}
   */
  isNew(entry) {
    return !this.seenAt || (entry.last > this.seenAt);
  }

  /**
   * The entries, the newest first.
   * @param {object} [options]
   * @param {boolean} [options.unreadOnly]
   * @returns {object[]}
   */
  list({unreadOnly = false} = {}) {
    return [...this.entries.values()].filter(e => !unreadOnly || this.isNew(e)).sort((a, b) => b.last.localeCompare(a.last));
  }

  /**
   * The modules named by errors, with how many errors and players.
   * @param {object} [options]
   * @param {boolean} [options.unreadOnly]
   * @returns {{owner: string, count: number, players: string[]}[]}
   */
  byOwner({unreadOnly = false} = {}) {
    const map = new Map();
    for ( const e of this.list({unreadOnly}) ) {
      const row = map.get(e.owner) ?? {owner: e.owner, count: 0, players: []};
      row.count += e.count;
      if ( !row.players.includes(e.userName) ) row.players.push(e.userName);
      map.set(e.owner, row);
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.owner.localeCompare(b.owner));
  }

  /**
   * The list as groups: per player, per module, the errors.
   * @param {object} [options]
   * @returns {{userId: string, userName: string, modules: {owner: string, count: number, errors: object[]}[]}[]}
   */
  grouped(options) {
    const users = new Map();
    for ( const e of this.list(options) ) {
      const user = users.get(e.userId) ?? {userId: e.userId, userName: e.userName, modules: new Map()};
      const mod = user.modules.get(e.owner) ?? {owner: e.owner, count: 0, errors: []};
      mod.count += e.count;
      mod.errors.push(e);
      user.modules.set(e.owner, mod);
      users.set(e.userId, user);
    }
    return [...users.values()].sort((a, b) => a.userName.localeCompare(b.userName))
      .map(u => ({...u, modules: [...u.modules.values()].sort((a, b) => b.count - a.count)}));
  }

  /**
   * Mark everything as read.
   * @param {string} [at]
   */
  markRead(at = new Date().toISOString()) {
    this.seenAt = at;
  }

  /** Forget everything. */
  clear() {
    this.entries.clear();
    this.seenAt = "";
  }

  /**
   * The stored form.
   * @returns {string}
   */
  serialize() {
    return JSON.stringify({format: 1, seenAt: this.seenAt, entries: [...this.entries.values()]});
  }

  /**
   * Read the stored form. A broken value gives an empty store.
   * @param {string} text
   * @param {object} [options]
   * @returns {PlayerErrorStore}
   */
  static parse(text, options) {
    const store = new PlayerErrorStore(options);
    try {
      const data = JSON.parse(text);
      if ( data?.format !== 1 || !Array.isArray(data.entries) ) return store;
      store.seenAt = (typeof data.seenAt === "string") ? data.seenAt : "";
      for ( const e of data.entries.slice(0, store.limit) ) {
        const report = readReport(e);
        if ( !report || (typeof e.userId !== "string") ) continue;
        const key = `${e.userId}|${fingerprint(report)}`;
        store.entries.set(key, {key, userId: e.userId.slice(0, 40), userName: clip(e.userName ?? "", 60), ...report,
          count: report.count, first: String(e.first ?? ""), last: String(e.last ?? "")});
      }
    } catch {
      // An unreadable value starts a new list
    }
    return store;
  }
}

/* -------------------------------------------- */
/*  Versions                                    */
/* -------------------------------------------- */

/**
 * What a browser reports about itself: Foundry, the system and the active modules.
 * @param {{core: string, system: {id: string, version: string}, modules: [string, string][]}} data
 * @returns {object}
 */
export function readVersions(data) {
  if ( !data || (typeof data !== "object") ) return null;
  const text = (value, limit = 60) => String(value ?? "").slice(0, limit);
  const modules = Array.isArray(data.modules) ? data.modules.slice(0, 600).filter(m => Array.isArray(m)).map(m => [text(m[0], 100), text(m[1], 40)]) : [];
  return {core: text(data.core, 40), system: {id: text(data.system?.id, 100), version: text(data.system?.version, 40)}, modules};
}

/**
 * Compare what a player's browser runs with what the GM runs.
 * @param {ReturnType<typeof readVersions>} gm
 * @param {ReturnType<typeof readVersions>} player
 * @returns {{same: boolean, core: object|null, system: object|null, different: object[], missing: string[], extra: string[]}}
 */
export function compareVersions(gm, player) {
  const mine = new Map(gm.modules);
  const theirs = new Map(player.modules);
  const different = [];
  const missing = [];
  for ( const [id, version] of mine ) {
    if ( !theirs.has(id) ) missing.push(id);
    else if ( theirs.get(id) !== version ) different.push({id, gm: version, player: theirs.get(id)});
  }
  const extra = [...theirs.keys()].filter(id => !mine.has(id));
  const core = gm.core !== player.core ? {gm: gm.core, player: player.core} : null;
  const system = ((gm.system.id !== player.system.id) || (gm.system.version !== player.system.version))
    ? {gm: `${gm.system.id} ${gm.system.version}`, player: `${player.system.id} ${player.system.version}`} : null;
  return {same: !core && !system && !different.length && !missing.length && !extra.length, core, system, different, missing, extra};
}
