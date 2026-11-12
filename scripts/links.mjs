/**
 * Links and manifest addresses. Pure code, no Foundry globals. Text from manifests and answers from the network is
 * data: a link is only used when it is a plain http or https address.
 */

/**
 * The address when it is http or https, otherwise an empty string. Nothing else is ever put into a link: no
 * javascript:, data: or blob: addresses and no addresses with a user name.
 * @param {*} value
 * @returns {string}
 */
export function safeHttpUrl(value) {
  if ( (typeof value !== "string") || (value.length > 2000) ) return "";
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return "";
  }
  if ( (url.protocol !== "https:") && (url.protocol !== "http:") ) return "";
  if ( url.username || url.password ) return "";
  return url.href;
}

/**
 * The host of an address for display, or an empty string.
 * @param {string} value
 * @returns {string}
 */
export function hostOf(value) {
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}

/**
 * The GitHub repository behind a manifest address, if it is a release download address.
 * @param {string} manifest
 * @returns {{owner: string, repo: string, file: string, latest: boolean, tag: string}|null}
 */
export function parseGithubManifest(manifest) {
  const clean = safeHttpUrl(manifest);
  if ( !clean ) return null;
  const url = new URL(clean);
  if ( url.hostname !== "github.com" ) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if ( (parts.length === 6) && (parts[2] === "releases") && (parts[3] === "latest") && (parts[4] === "download") ) {
    return {owner: parts[0], repo: parts[1], file: parts[5], latest: true, tag: ""};
  }
  if ( (parts.length === 6) && (parts[2] === "releases") && (parts[3] === "download") ) {
    return {owner: parts[0], repo: parts[1], file: parts[5], latest: false, tag: decodeURIComponent(parts[4])};
  }
  return null;
}

/**
 * The tag names a release of a version may have been given. Authors differ: "v1.2.3", "1.2.3", "release-1.2.3".
 * @param {string} version
 * @returns {string[]}
 */
export function tagCandidates(version) {
  const v = String(version ?? "").trim();
  if ( !v ) return [];
  return [`v${v}`, v, `release-${v}`];
}

/**
 * The manifest address of an older version, as far as it can be derived. It is a guess until it was checked.
 * @param {string} manifest   The manifest address of the installed package
 * @param {string} version    The installed version
 * @param {string} older      The version to go back to
 * @returns {{kind: "github"|"replaced", url: string, owner?: string, repo?: string, file?: string, tag?: string}|null}
 */
export function olderManifest(manifest, version, older) {
  const github = parseGithubManifest(manifest);
  if ( github?.latest ) {
    const tag = tagCandidates(older)[0];
    if ( !tag ) return null;
    return {kind: "github", url: `https://github.com/${github.owner}/${github.repo}/releases/download/${tag}/${github.file}`,
      owner: github.owner, repo: github.repo, file: github.file, tag};
  }
  if ( github && !github.latest && version && github.tag.includes(version) ) {
    const tag = github.tag.replace(version, older);
    return {kind: "github", url: `https://github.com/${github.owner}/${github.repo}/releases/download/${encodeURIComponent(tag)}/${github.file}`,
      owner: github.owner, repo: github.repo, file: github.file, tag};
  }
  const clean = safeHttpUrl(manifest);
  if ( clean && version && (clean.split(version).length === 2) ) {
    const url = safeHttpUrl(clean.replace(version, older));
    if ( url ) return {kind: "replaced", url};
  }
  return null;
}

/**
 * The address of the release of one tag in the GitHub API.
 * @param {string} owner
 * @param {string} repo
 * @param {string} tag
 * @returns {string}
 */
export function githubTagApi(owner, repo, tag) {
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/tags/${encodeURIComponent(tag)}`;
}

/**
 * The address of a package on the list of the Forge.
 * @param {string} id
 * @returns {string}
 */
export function forgePackageApi(id) {
  return `https://forge-vtt.com/api/bazaar/package/${encodeURIComponent(id)}`;
}

/**
 * The page of a package on foundryvtt.com.
 * @param {string} id
 * @returns {string}
 */
export function foundryPackagePage(id) {
  return `https://foundryvtt.com/packages/${encodeURIComponent(id)}`;
}

/**
 * Is the id a package id Foundry allows (letters, digits, dash, underscore, dot)? Only such ids are sent anywhere.
 * @param {*} id
 * @returns {boolean}
 */
export function isPackageId(id) {
  return (typeof id === "string") && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(id);
}
