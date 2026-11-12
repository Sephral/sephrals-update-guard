/**
 * Rating of packages for a target version of Foundry. Pure code, no Foundry globals. The input is the compatibility
 * data of manifests (installed ones, and the lists of the Forge when the GM asked for them), the output says what each
 * statement is based on, so the window can show the source next to every result.
 */

import {generationOf, hasVersion, isGeneration, isNewer} from "./versions.mjs";

/** The ratings, in the order they are listed. */
export const STATUSES = ["blocked", "update", "likely", "unknown", "ready"];

/**
 * Does the minimum version of a package allow the target? A target without a build ("15") is compared by generation.
 * @param {string} [minimum]
 * @param {string} target
 * @returns {boolean}
 */
export function minimumFits(minimum, target) {
  if ( !hasVersion(minimum) ) return true;
  if ( isGeneration(target) ) return generationOf(minimum) <= generationOf(target);
  return !isNewer(minimum, target);
}

/**
 * Does the maximum version of a package reach the target? A maximum like "14" covers every 14.x.
 * @param {string} [maximum]
 * @param {string} target
 * @returns {boolean}
 */
export function maximumReaches(maximum, target) {
  if ( !hasVersion(maximum) ) return true;
  if ( isGeneration(target) ) return generationOf(target) <= generationOf(maximum);
  return !isNewer(target, maximum, {majorOnly: isGeneration(maximum)});
}

/**
 * Is the target covered by the version the author verified? A bare "14" covers every 14.x.
 * @param {string} [verified]
 * @param {string} target
 * @returns {boolean}
 */
export function verifiedCovers(verified, target) {
  if ( !hasVersion(verified) ) return false;
  if ( isGeneration(verified) || isGeneration(target) ) return generationOf(target) <= generationOf(verified);
  return !isNewer(target, verified);
}

/**
 * What a compatibility block says about a target.
 * @param {{minimum?: string, verified?: string, maximum?: string}|null|undefined} compat
 * @param {string} target
 * @returns {{level: "verified"|"likely"|"blocked"|"unknown", reason: string}}
 *   reason: "verified", "minimumHigh", "maximumLow", "minimumFits", "maximumFits" or "noData"
 */
export function assess(compat, target) {
  const {minimum, verified, maximum} = compat ?? {};
  const hasMin = hasVersion(minimum);
  const hasVerified = hasVersion(verified);
  const hasMax = hasVersion(maximum);
  if ( !hasMin && !hasVerified && !hasMax ) return {level: "unknown", reason: "noData"};
  if ( !minimumFits(minimum, target) ) return {level: "blocked", reason: "minimumHigh"};
  if ( !maximumReaches(maximum, target) ) return {level: "blocked", reason: "maximumLow"};
  if ( verifiedCovers(verified, target) ) return {level: "verified", reason: "verified"};
  return {level: "likely", reason: hasMin ? "minimumFits" : "maximumFits"};
}

/**
 * A compatibility block as plain strings, or null when it has nothing.
 * @param {*} compat
 * @returns {{minimum: string, verified: string, maximum: string}|null}
 */
export function cleanCompat(compat) {
  if ( !compat || (typeof compat !== "object") ) return null;
  const pick = value => (hasVersion(value) ? String(value).trim() : "");
  const result = {minimum: pick(compat.minimum), verified: pick(compat.verified), maximum: pick(compat.maximum)};
  return (result.minimum || result.verified || result.maximum) ? result : null;
}

/**
 * Rate one package for a target.
 * @param {object} item
 * @param {string} item.id
 * @param {string} item.title
 * @param {string} item.kind                  "system" or "module"
 * @param {string} item.version               The installed version
 * @param {object} [item.compat]              The compatibility block of the installed manifest
 * @param {object} [remote]                   What an online check found, or nothing
 * @param {string} [remote.state]             "ok", "notListed" or "error"
 * @param {string} [remote.source]            "forge" or "manifest"
 * @param {string} [remote.latest]            The newest version
 * @param {Record<string, object>} [remote.compat]   Compatibility blocks by version
 * @param {string} target
 * @returns {{status: string, reason: string, latestVerified: boolean, installed: object, latest: object|null,
 *   evidence: object[]}}
 */
export function ratePackage(item, remote, target) {
  const evidence = [];
  const local = cleanCompat(item.compat);
  evidence.push({source: "manifest", kind: "installed", version: item.version, compat: local});

  let installed = assess(local, target);
  // The author may have confirmed the installed version after its release: the list of the Forge has it per version
  const remoteInstalled = (remote?.state === "ok") ? cleanCompat(remote.compat?.[item.version]) : null;
  if ( remoteInstalled ) {
    const sameAsLocal = local && Object.keys(remoteInstalled).every(k => remoteInstalled[k] === local[k]);
    if ( !sameAsLocal ) {
      evidence.push({source: remote.source ?? "forge", kind: "installed", version: item.version, compat: remoteInstalled});
      const better = assess(remoteInstalled, target);
      if ( (installed.level !== "verified") && (better.level === "verified") ) installed = better;
    }
  }

  let latest = null;
  if ( (remote?.state === "ok") && hasVersion(remote.latest) && isNewer(remote.latest, item.version) ) {
    const compat = cleanCompat(remote.compat?.[remote.latest]);
    latest = {version: remote.latest, compat, ...assess(compat, target)};
    evidence.push({source: remote.source ?? "forge", kind: "latest", version: remote.latest, compat});
  } else if ( remote?.state === "ok" ) {
    evidence.push({source: remote.source ?? "forge", kind: "noNewer", version: remote.latest ?? ""});
  } else if ( remote?.state === "notListed" ) {
    evidence.push({source: remote.source ?? "forge", kind: "notListed"});
    if ( remote.manifestError ) evidence.push({source: "manifest", kind: "failed", error: remote.manifestError});
  } else if ( remote?.state === "error" ) {
    evidence.push({source: remote.source ?? "forge", kind: "failed", error: remote.error ?? ""});
  }

  let status;
  let reason = installed.reason;
  let latestVerified = false;
  if ( installed.level === "verified" ) {
    status = "ready";
  } else if ( latest?.level === "verified" ) {
    status = "update";
    reason = "latestVerified";
    latestVerified = true;
  } else if ( (installed.level === "blocked") && latest && (latest.level === "likely") ) {
    status = "update";
    reason = "latestNotBlocked";
  } else if ( installed.level === "blocked" ) {
    status = "blocked";
  } else if ( installed.level === "likely" ) {
    status = "likely";
  } else {
    status = "unknown";
  }
  return {status, reason, latestVerified, installed: {version: item.version, compat: local, ...installed}, latest,
    evidence};
}

/**
 * Rate a list of packages.
 * @param {object[]} items
 * @param {Map<string, object>|Record<string, object>} remotes   Online results by package id
 * @param {string} target
 * @returns {object[]}   The items with their rating, blocked first, then by title
 */
export function rateAll(items, remotes, target) {
  const get = id => ((remotes instanceof Map) ? remotes.get(id) : remotes?.[id]);
  const order = Object.fromEntries(STATUSES.map((s, i) => [s, i]));
  return items.map(item => ({...item, ...ratePackage(item, get(item.id), target)}))
    .sort((a, b) => (order[a.status] - order[b.status]) || String(a.title).localeCompare(String(b.title)));
}

/**
 * How many packages have each rating.
 * @param {{status: string}[]} rated
 * @returns {Record<string, number>}
 */
export function countStatuses(rated) {
  const counts = Object.fromEntries(STATUSES.map(s => [s, 0]));
  for ( const entry of rated ) counts[entry.status] = (counts[entry.status] ?? 0) + 1;
  return counts;
}

/**
 * The one line verdict: "38 ready, 3 unknown, 1 blocked: Pathfinder".
 * @param {Record<string, number>} counts
 * @param {string[]} blockedTitles
 * @param {Record<string, string>} labels   The localized words for the ratings
 * @param {number} [named=3]                How many blocked packages to name
 * @returns {string}
 */
export function verdictLine(counts, blockedTitles, labels, named = 3) {
  const parts = [];
  for ( const status of ["ready", "update", "likely", "unknown", "blocked"] ) {
    if ( counts[status] ) parts.push(`${counts[status]} ${labels[status] ?? status}`);
  }
  if ( !parts.length ) return "";
  let line = parts.join(", ");
  if ( blockedTitles?.length ) {
    const shown = blockedTitles.slice(0, named).join(", ");
    line += `: ${shown}${blockedTitles.length > named ? ", ..." : ""}`;
  }
  return line;
}
