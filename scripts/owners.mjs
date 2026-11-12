/**
 * Which package a piece of running code belongs to, read from a stack trace. Pure code, no Foundry globals. A package
 * is named by the address of its files: /modules/<id>/ or /systems/<id>/. The code of a package that only passes a
 * call on (a wrapper library, a socket library) does not count while another package takes part in the same stack.
 */

/** Packages whose frames are only a passage for the calls of other packages. */
export const PASS_THROUGH = new Set(["module:lib-wrapper", "module:socketlib"]);

/**
 * The path of an address without origin, query and hash.
 * @param {string} url
 * @returns {string}
 */
export function urlPath(url) {
  const text = String(url ?? "");
  const match = text.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]*(\/[^?#]*)?/i);
  let path = match ? (match[1] ?? "/") : text.split(/[?#]/)[0];
  try {
    path = decodeURI(path);
  } catch {
    // Keep the raw path when it holds a broken escape
  }
  return path;
}

/**
 * Which package a file belongs to.
 * @param {string} url
 * @returns {string|null}   "module:<id>", "system:<id>", "world", "extension", "core", or null without an address
 */
export function ownerFromUrl(url) {
  if ( !url ) return null;
  if ( /^(?:chrome|moz|safari-web|ms-browser)-extension:/i.test(url) ) return "extension";
  const path = urlPath(url);
  const pkg = path.match(/\/(modules|systems)\/([^/]+)\//);
  if ( pkg ) return `${pkg[1] === "modules" ? "module" : "system"}:${pkg[2]}`;
  if ( /\/worlds\/[^/]+\//.test(path) ) return "world";
  return "core";
}

/**
 * The addresses in a stack trace, innermost first. Reads the format of Chromium ("at fn (url:1:2)") and of Firefox and
 * Safari ("fn@url:1:2").
 * @param {string} stack
 * @returns {string[]}
 */
export function stackUrls(stack) {
  const urls = [];
  for ( const line of String(stack ?? "").split("\n") ) {
    const match = line.match(/((?:https?|file|blob|(?:chrome|moz|safari-web)-extension):\/\/[^\s()]+?)(?::\d+){1,2}\)?\s*$/i);
    if ( match ) urls.push(match[1]);
  }
  return urls;
}

/**
 * The owner of the code behind a stack: the innermost package that is not a passage and not ignored.
 * @param {string} stack
 * @param {object} [options]
 * @param {Set<string>|string[]} [options.ignore]      Owners to leave out (the code that looks at the stack)
 * @param {Set<string>} [options.passThrough]          Owners that only pass calls on
 * @returns {string}   An owner key, "core" when no package takes part
 */
export function ownerFromStack(stack, {ignore = [], passThrough = PASS_THROUGH} = {}) {
  const skip = new Set(ignore);
  let fallback = null;
  let sawWorld = false;
  for ( const url of stackUrls(stack) ) {
    const owner = ownerFromUrl(url);
    if ( !owner || (owner === "core") || skip.has(owner) ) continue;
    if ( owner === "extension" ) continue;
    if ( owner === "world" ) {
      sawWorld = true;
      continue;
    }
    if ( passThrough.has(owner) ) {
      fallback ??= owner;
      continue;
    }
    return owner;
  }
  return fallback ?? (sawWorld ? "world" : "core");
}

/**
 * A readable name for an owner key.
 * @param {string} owner
 * @returns {{kind: string, id: string}}   kind is "module", "system", "world" or "other"
 */
export function splitOwner(owner) {
  const match = String(owner).match(/^(module|system):(.+)$/);
  if ( match ) return {kind: match[1], id: match[2]};
  return {kind: owner === "world" ? "world" : "other", id: String(owner)};
}
