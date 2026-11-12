/**
 * The export before an update: one JSON file and one text file with every version, the rating for a target, what does
 * not fit, errors and deprecated calls. Pure code, no Foundry globals. The file is made for the GM: when the world does
 * not start after the update, it is the only record of what was installed.
 */

/** Version of the export format. */
export const EXPORT_FORMAT = 1;

/**
 * Shorten a history entry to what the export needs.
 * @param {object} entry
 * @returns {object}
 */
function slimState(entry) {
  return {
    at: entry.at, seen: entry.seen, core: entry.core, system: entry.system, good: !!entry.good,
    goodAt: entry.goodAt ?? null, errors: entry.errors ?? null,
    modules: (entry.modules ?? []).map(m => ({id: m.id, version: m.version, active: !!m.active}))
  };
}

/**
 * The data of the export.
 * @param {object} input
 * @param {string} input.generatedAt
 * @param {object} input.state       The current state (core, system, modules with compatibility and manifest)
 * @param {object[]} input.history
 * @param {string} [input.target]
 * @param {object[]} [input.rated]   The rating of every checked package
 * @param {object} [input.report]    What the online check did, if it ran
 * @param {object[]} [input.problems]
 * @param {object[]} [input.deprecations]   {id, count, message, until}
 * @param {object[]} [input.errors]         {id, count, message}
 * @returns {object}
 */
export function buildExport({generatedAt, state, history, target = "", rated = [], report = null, problems = [],
  deprecations = [], errors = []}) {
  return {
    format: EXPORT_FORMAT,
    generator: "Sephral's Update Guard",
    generatedAt,
    note: "Compatibility data comes from manifests and from the lists named in each entry. Verified means the author said so.",
    foundry: state.core,
    system: state.system,
    modules: state.modules.map(m => ({id: m.id, title: m.title, version: m.version, active: !!m.active,
      minimum: m.minimum ?? "", verified: m.verified ?? "", maximum: m.maximum ?? "", manifest: m.manifest ?? ""})),
    target,
    check: rated.map(r => ({id: r.id, title: r.title, kind: r.kind, version: r.version, status: r.status,
      reason: r.reason, latest: r.latest?.version ?? null,
      sources: [...new Set((r.evidence ?? []).map(e => e.source))]})),
    onlineCheck: report ? {forge: report.forge, manifest: report.manifest, failures: report.failures} : null,
    problems: problems.map(p => ({id: p.id, kind: p.kind, severity: p.severity, data: p.data})),
    deprecated: deprecations,
    errors,
    history: history.map(slimState)
  };
}

/**
 * The same as readable text.
 * @param {object} data      From buildExport
 * @param {Function} t       Localize: t(key, data)
 * @returns {string}
 */
export function exportText(data, t) {
  const lines = [];
  lines.push(`${t("SUG.Export.title")} (${data.generatedAt})`);
  lines.push(`Foundry ${data.foundry}, ${data.system?.id} ${data.system?.version}`);
  lines.push("");
  lines.push(t("SUG.Export.modules"));
  for ( const m of data.modules ) {
    lines.push(`  ${m.active ? "[x]" : "[ ]"} ${m.title} (${m.id}) ${m.version}${m.manifest ? `  ${m.manifest}` : ""}`);
  }
  if ( data.target ) {
    lines.push("");
    lines.push(t("SUG.Export.check", {target: data.target}));
    for ( const r of data.check ) {
      lines.push(`  ${t(`SUG.STATUS.${r.status}`)}: ${r.title} ${r.version}${r.latest ? ` (${t("SUG.Export.latest", {version: r.latest})})` : ""}`);
    }
    if ( data.onlineCheck ) {
      const {forge, manifest} = data.onlineCheck;
      lines.push(`  ${t("SUG.Export.sources", {forgeOk: forge.ok, forgeFailed: forge.failed, forgeNone: forge.notListed,
        manifestOk: manifest.ok, manifestFailed: manifest.failed})}`);
    }
  }
  if ( data.problems.length ) {
    lines.push("");
    lines.push(t("SUG.Export.problems"));
    for ( const p of data.problems ) lines.push(`  ${p.id}: ${p.kind} ${JSON.stringify(p.data)}`);
  }
  if ( data.deprecated.length ) {
    lines.push("");
    lines.push(t("SUG.Export.deprecated"));
    for ( const d of data.deprecated ) lines.push(`  ${d.id}: ${d.count}x ${d.message}${d.until?.length ? ` (${d.until.join(", ")})` : ""}`);
  }
  if ( data.errors.length ) {
    lines.push("");
    lines.push(t("SUG.Export.errors"));
    for ( const e of data.errors ) lines.push(`  ${e.id}: ${e.count}x ${e.message}`);
  }
  lines.push("");
  lines.push(t("SUG.Export.history"));
  for ( const h of data.history ) {
    lines.push(`  ${h.at}${h.good ? ` (${t("SUG.Export.good")})` : ""}: Foundry ${h.core}, ${h.system?.id} ${h.system?.version}, ${h.modules.length} ${t("SUG.Export.modulesShort")}`);
  }
  return lines.join("\n");
}

/**
 * A file name for the export.
 * @param {string} date   ISO date
 * @param {string} extension
 * @returns {string}
 */
export function exportFileName(date, extension) {
  return `update-guard-${String(date).slice(0, 10)}.${extension}`;
}
