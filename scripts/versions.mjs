/**
 * Version numbers of packages and of Foundry. Pure code, no Foundry globals. It follows the rules of
 * foundry.utils.isNewerVersion (dotted parts, numbers compared as numbers) and adds what Foundry 13 lacks: comparing
 * only the generation, which Foundry 14 does for a bare "verified" or "maximum" like "14".
 */

/**
 * Is the text a bare whole number such as "14" (a generation without a build)?
 * @param {*} value
 * @returns {boolean}
 */
export function isGeneration(value) {
  return /^\d+$/.test(String(value ?? "").trim());
}

/**
 * The generation of a version: 14 for "14.370".
 * @param {*} value
 * @returns {number}   NaN when the text starts with no number
 */
export function generationOf(value) {
  return Number.parseInt(String(value ?? "").trim().split(".")[0], 10);
}

/**
 * Is a version text usable? Empty values are not.
 * @param {*} value
 * @returns {boolean}
 */
export function hasVersion(value) {
  return (typeof value === "string") ? value.trim().length > 0 : Number.isFinite(value);
}

/**
 * Is v1 a more advanced version than v0? Same result as Foundry's isNewerVersion for the same input.
 * @param {*} v1
 * @param {*} v0
 * @param {object} [options]
 * @param {boolean} [options.majorOnly]   Compare only the generation
 * @returns {boolean}
 */
export function isNewer(v1, v0, {majorOnly = false} = {}) {
  if ( (v1 === null) || (v1 === undefined) ) return false;
  if ( (v0 === null) || (v0 === undefined) ) return true;
  if ( (typeof v1 === "number") && (typeof v0 === "number") ) return v1 > v0;
  let a = String(v1).split(".");
  let b = String(v0).split(".");
  if ( majorOnly ) {
    a = a.slice(0, 1);
    b = b.slice(0, 1);
  }
  const numeric = part => (part !== "") && Number.isFinite(Number(part));
  for ( const [i, p1] of a.entries() ) {
    const p0 = b[i];
    if ( p0 === undefined ) return true;
    if ( numeric(p0) && numeric(p1) ) {
      if ( Number(p1) !== Number(p0) ) return Number(p1) > Number(p0);
    }
    if ( p1 !== p0 ) return p1 > p0;
  }
  return false;
}

/**
 * Two versions as a sort order for Array#sort, oldest first.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareVersions(a, b) {
  if ( isNewer(a, b) ) return 1;
  if ( isNewer(b, a) ) return -1;
  return 0;
}

/**
 * The default target for a check: the generation after the running one.
 * @param {string} coreVersion   For example "14.370"
 * @returns {string}   "15"
 */
export function defaultTarget(coreVersion) {
  const generation = generationOf(coreVersion);
  return Number.isFinite(generation) ? String(generation + 1) : "";
}

/**
 * Clean up a target the GM typed. Only digits and dots are allowed, "v14.3" becomes "14.3".
 * @param {string} text
 * @returns {string}   The target, or "" when it is no version
 */
export function parseTarget(text) {
  const clean = String(text ?? "").trim().replace(/^v/i, "");
  return /^\d+(\.\d+){0,2}$/.test(clean) ? clean : "";
}
