/**
 * The early watch: errors and deprecated calls per package since the page loaded. The module loads as a library, before
 * the system and the other modules, so it is listening when they start. Nothing is wrapped or replaced:
 *  - window "error" and "unhandledrejection" are listened to, never stopped or prevented,
 *  - Foundry's own "error" hook says when a callback of a hook threw (Foundry catches those errors, they never reach
 *    the window),
 *  - deprecated calls come through foundry.utils.logCompatibilityWarning, which tests every message and its stack
 *    against CONFIG.compatibility.excludePatterns before it logs. A pattern that never matches but remembers what it
 *    saw lets us count them without touching console.warn or any function of Foundry. The stack at that moment names the
 *    package that made the call.
 */

import {MODULE_ID} from "./config.mjs";
import {ownerFromStack, ownerFromUrl} from "./owners.mjs";
import {WatchLog} from "./watch-data.mjs";

/** The memory of the watch. */
export const log = new WatchLog();

/** The owner key of this module. */
const SELF = `module:${MODULE_ID}`;

/** What the watch installed, for the self test and the debug file. */
export const watchState = {listeners: false, hook: false, probe: null, probeInstalled: false};

/**
 * The owner of code that called something: the stack names the packages. Chromium cuts stacks after 10 frames, a module
 * is often deeper below Foundry's own calls, so the limit is raised for this one trace.
 * @param {string[]} [ignore]
 * @returns {string}
 */
function captureOwner(ignore = [SELF]) {
  const limit = Error.stackTraceLimit;
  try {
    Error.stackTraceLimit = 60;
    return ownerFromStack(new Error().stack, {ignore});
  } catch {
    return "core";
  } finally {
    Error.stackTraceLimit = limit;
  }
}

/**
 * The owner of an error: its stack, or the file address the browser gave.
 * @param {*} error
 * @param {string} [filename]
 * @returns {string}
 */
function ownerOfError(error, filename = "") {
  let owner = "core";
  for ( const stack of [error?.cause?.stack, error?.stack] ) {
    if ( !stack ) continue;
    owner = ownerFromStack(stack);
    if ( owner !== "core" ) return owner;
  }
  if ( filename ) {
    const byFile = ownerFromUrl(filename);
    if ( byFile && (byFile !== "core") && (byFile !== "extension") ) return byFile;
  }
  return owner;
}

/**
 * Count an error that was caught by the caller.
 * @param {*} error
 */
export function noteError(error) {
  log.addError(ownerOfError(error), "error", error?.message ?? error, undefined, {stack: error?.stack});
}

/**
 * Remember a deprecated call. The pattern is tested twice per warning, first with the message, then with the stack.
 */
class CompatibilityProbe extends RegExp {
  #expect = "message";

  #message = "";

  constructor() {
    super("(?!)");
  }

  /** @override */
  test(text) {
    try {
      if ( this.#expect === "message" ) {
        this.#message = String(text ?? "");
        this.#expect = "stack";
      } else {
        this.#expect = "message";
        log.addDeprecation(captureOwner(), this.#message);
      }
    } catch {
      this.#expect = "message";
    }
    return false;
  }
}

/**
 * Put the probe into Foundry's list of compatibility patterns, if it is not there.
 * @returns {boolean}   Is it installed?
 */
export function installProbe() {
  const list = globalThis.CONFIG?.compatibility?.excludePatterns;
  if ( !Array.isArray(list) ) return false;
  watchState.probe ??= new CompatibilityProbe();
  if ( !list.includes(watchState.probe) ) list.push(watchState.probe);
  watchState.probeInstalled = list.includes(watchState.probe);
  return watchState.probeInstalled;
}

/**
 * Start listening. Safe to call twice.
 */
export function startWatch() {
  if ( !watchState.listeners ) {
    watchState.listeners = true;
    window.addEventListener("error", event => {
      try {
        if ( !(event instanceof ErrorEvent) ) return;
        log.addError(ownerOfError(event.error, event.filename), "error", event.error?.message ?? event.message, undefined,
          {stack: event.error?.stack || `at ${event.filename}:${event.lineno}:${event.colno}`});
      } catch {
        // The watch never throws
      }
    });
    window.addEventListener("unhandledrejection", event => {
      try {
        const reason = event.reason;
        log.addError(ownerOfError(reason), "rejection", reason?.message ?? reason, undefined, {stack: reason?.stack});
      } catch {
        // The watch never throws
      }
    });
  }
  if ( !watchState.hook && globalThis.Hooks ) {
    watchState.hook = true;
    Hooks.on("error", (location, error, data) => {
      try {
        const cause = error?.cause ?? error;
        const where = data?.hook ? ` (${data.hook})` : "";
        log.addError(ownerOfError(error), "hook", `${cause?.message ?? error?.message ?? ""}${where}`, undefined,
          {stack: cause?.stack ?? error?.stack, hook: data?.hook});
      } catch {
        // The watch never throws
      }
    });
  }
  installProbe();
}
