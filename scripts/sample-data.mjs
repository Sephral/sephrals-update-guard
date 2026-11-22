/**
 * Made-up data for the sample windows (api.samples): a small world with invented modules, their versions, errors,
 * conflicts and answers of an online check, all held in memory. Pure code, no Foundry globals, nothing is read from or
 * written to the real installation. The module names are invented on purpose and belong to no real package.
 *
 * A bundle {feed, session} is what the Update Guard window reads instead of the real installation (see
 * withSampleData in guard-app.mjs). The window itself decides what it shows, the real rules (ratings, problems,
 * conflicts, search) run over this data.
 */

import {countConflicts, declaredConflicts, keyConflicts, mergeConflicts, wrapperConflicts} from "./conflicts-data.mjs";
import {advanceSearch, beginSearch} from "./culprit.mjs";
import {PlayerErrorStore, compareVersions} from "./player-data.mjs";
import {readyAnswer} from "./ready-data.mjs";
import {buildReportText, issueTerms} from "./report-data.mjs";
import {summarizeTrial} from "./trial-data.mjs";
import {WatchLog} from "./watch-data.mjs";

/** The id of the made-up game system. */
export const SAMPLE_SYSTEM = "samplegame";

/** The made-up repository owner of the modules. */
const AUTHOR = "sample-author";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The modules of the made-up world: title, version, what the manifest declares, and what it needs. */
const ROSTER = {
  "lantern-light": {title: "Lantern Light", version: "2.4.1", compat: {minimum: "13", verified: "15"}},
  "tidy-quills": {title: "Tidy Quills", version: "1.8.0", compat: {minimum: "13", verified: "15"}},
  "map-weaver": {title: "Map Weaver", version: "3.0.2", compat: {minimum: "13", verified: "14"}},
  "banner-board": {title: "Banner Board", version: "0.9.4", compat: {minimum: "13", verified: "14", maximum: "14"}},
  "old-chronicle": {title: "Old Chronicle", version: "1.2.0", compat: {minimum: "12", verified: "13", maximum: "13"}},
  "rune-roller": {title: "Rune Roller", version: "5.1.0", compat: {minimum: "13", verified: "14"}},
  "pocket-tavern": {title: "Pocket Tavern", version: "2.0.3", compat: {minimum: "13", verified: "14", maximum: "14"}},
  "quiet-notes": {title: "Quiet Notes", version: "1.0.0", compat: {}},
  "echo-chamber": {title: "Echo Chamber", version: "4.2.0", compat: {minimum: "13", verified: "14"}},
  "dice-forge-lite": {title: "Dice Forge Lite", version: "1.3.0", compat: {minimum: "13", verified: "15"}},
  "harbor-guide": {title: "Harbor Guide", version: "1.1.0", compat: {minimum: "13", verified: "14"}},
  "chart-kit": {title: "Chart Kit", version: "0.5.2", compat: {minimum: "13", verified: "14"}},
  "glass-frames": {title: "Glass Frames", version: "2.2.2", compat: {minimum: "13", verified: "14"}},
  "wave-tracker": {title: "Wave Tracker", version: "1.0.0", compat: {minimum: "15"}},
  "ghost-lamp": {title: "Ghost Lamp", version: "1.4.0", compat: {minimum: "13", verified: "14"}}
};

/** The manifest address of the latest release of a module, the usual form on GitHub. */
function latestManifest(id) {
  return `https://github.com/${AUTHOR}/${id}/releases/latest/download/module.json`;
}

/**
 * One module as the window reads it (the shape of collectState).
 * @param {string} id        A key of the roster
 * @param {object} [over]    Changes: version, active, compat, manifest, requires, availability, title
 * @returns {object}
 */
export function sampleModule(id, over = {}) {
  const spec = {...ROSTER[id], ...over};
  const compat = {minimum: "", verified: "", maximum: "", ...(spec.compat ?? {})};
  return {
    id, title: spec.title, version: spec.version, active: over.active ?? true, ...compat, compat,
    manifest: ("manifest" in over) ? over.manifest : latestManifest(id),
    requires: (over.requires ?? []).map(r => ({id: r.id, type: "module", compat: {minimum: "", verified: "", maximum: "", ...(r.compat ?? {})}, manifest: ""})),
    systems: [], availability: over.availability ?? null,
    url: `https://example.org/modules/${id}`, changelog: `https://example.org/modules/${id}/changes`, readme: "", bugs: ""
  };
}

/**
 * The made-up game system.
 * @param {object} [over]
 * @returns {object}
 */
export function sampleSystem(over = {}) {
  const compat = {minimum: "13", verified: "14", maximum: "", ...(over.compat ?? {})};
  return {id: SAMPLE_SYSTEM, title: "Sample Game System", version: "3.2.1", ...compat, compat,
    manifest: `https://github.com/${AUTHOR}/${SAMPLE_SYSTEM}/releases/latest/download/system.json`,
    url: `https://example.org/systems/${SAMPLE_SYSTEM}`, changelog: `https://example.org/systems/${SAMPLE_SYSTEM}/changes`,
    availability: "VERIFIED", ...over, compat};
}

/** The state of an installation: Foundry, the system and the modules. */
function makeState(core, modules, system = sampleSystem()) {
  const sorted = [...modules].sort((a, b) => a.title.localeCompare(b.title));
  return {core, system, modules: sorted};
}

/** The stored form of a state, as the history keeps it. */
function entryOf(state, {at, good = false, goodAt = null, errors = null}) {
  return {
    at: new Date(at).toISOString(), seen: new Date(at).toISOString(), core: state.core,
    system: {id: state.system.id, title: state.system.title, version: state.system.version},
    modules: state.modules.map(m => ({id: m.id, title: m.title, version: m.version, active: m.active, minimum: m.minimum,
      verified: m.verified, maximum: m.maximum, manifest: m.manifest})),
    good, goodAt: goodAt ? new Date(goodAt).toISOString() : null, errors
  };
}

/** A build of Foundry next to another one: "14.370" and -1 give "14.369". */
function nearBuild(core, delta) {
  const [major, build = "0"] = String(core).split(".");
  return `${major}.${Math.max(0, Number.parseInt(build, 10) + delta)}`;
}

/** Time as the ISO text the stores keep. */
const iso = time => new Date(time).toISOString();

/* -------------------------------------------- */
/*  Feed and session                            */
/* -------------------------------------------- */

/** What the window can offer for the safety net. */
const SAFETY = {loadouts: true, openManager: true, backup: true, backupLink: "https://example.org/modules/content-backup"};

/**
 * A new, empty memory for a sample window (what the real window keeps between openings).
 * @param {object} [over]
 * @returns {object}
 */
function makeSession(over = {}) {
  return {
    tab: "changes", targetText: "15", checker: null, results: new Map(), report: null, checkedTarget: "", running: null,
    progress: null, verified: new Map(), copied: "", trial: null, trialStep: null, ready: null, readyRunning: null,
    // The conflict count of the usage statistics must never count a sample
    conflictsCounted: true, safety: null, ...over
  };
}

/** The data the window reads. */
function makeFeed({state, history, log = new WatchLog(), store = new PlayerErrorStore(), search = null, conflicts = noConflicts(),
  playersOn = true, safety = SAFETY}) {
  const modules = new Map(state.modules.map(m => [m.id, m]));
  // The window reads these once per render, the first start's state is "now"
  return {
    collectState: () => state,
    readHistory: () => history,
    readSearch: () => search,
    findConflicts: () => conflicts,
    safetyOptions: () => safety,
    log,
    playerStore: store,
    playersOn: () => playersOn,
    systemId: () => state.system.id,
    isRunning: id => (id === state.system.id) || !!modules.get(id)?.active,
    title: (kind, id) => ((kind === "system") ? ((id === state.system.id) ? state.system.title : id) : (modules.get(id)?.title ?? id)),
    package: (id, kind) => ((kind === "system") ? (id === state.system.id ? state.system : null) : (modules.get(id) ?? null))
  };
}

/** No conflicts, the wrapper library is there. */
function noConflicts() {
  return {findings: [], counts: countConflicts([]), wrapperLibrary: true};
}

/** The state of an earlier start, changed in the ways the scenario wants. */
function earlier(state, {core, system, version = {}, drop = [], inactive = [], active = [], extra = []}) {
  const modules = state.modules.filter(m => !drop.includes(m.id)).map(m => ({
    ...m, version: version[m.id] ?? m.version,
    active: inactive.includes(m.id) ? false : (active.includes(m.id) ? true : m.active)
  }));
  return makeState(core ?? state.core, [...modules, ...extra], system ?? state.system);
}

/* -------------------------------------------- */
/*  Pieces: errors, trial, players, conflicts   */
/* -------------------------------------------- */

/** A message of Foundry's compatibility warning for a function that goes. */
function deprecation(name, since, until) {
  return `The function ${name} is deprecated.\nDeprecated since Version ${since}\nBackwards-compatible support will be removed in Version ${until}`;
}

/**
 * Errors counted since the page loaded.
 * @param {number} now
 * @param {[string, string, string, number][]} list   owner, kind, message, how often
 * @returns {WatchLog}
 */
function watchLog(now, list = [], deprecated = []) {
  const log = new WatchLog();
  log.since = iso(now - 3 * HOUR);
  list.forEach(([owner, kind, message, times], index) => {
    for ( let i = 0; i < times; i++ ) log.addError(owner, kind, message, iso(now - (90 - index * 20 - i) * MINUTE));
  });
  deprecated.forEach(([owner, name, since, until, times], index) => {
    for ( let i = 0; i < times; i++ ) log.addDeprecation(owner, deprecation(name, since, until), iso(now - (120 - index * 10) * MINUTE));
  });
  return log;
}

/** The 13 steps of a test run, in the order of the real one. */
const STEPS = ["actor", "item", "journal", "table", "scene", "token", "hud", "chat", "sidebar", "tools", "settings", "modules", "compendium"];

/**
 * A test run that finished.
 * @param {number} now
 * @param {object} [options]
 * @param {Record<string, {owner: string, message: string, count?: number}>} [options.errors]   by step id
 * @param {string[]} [options.slow]      step ids that took long
 * @param {string[]} [options.timedOut]  step ids that did not finish in time
 * @param {number} [options.deprecated]
 * @returns {object}
 */
function trialRun(now, {errors = {}, slow = [], timedOut = [], deprecated = 0} = {}) {
  const names = {actor: "Aria", item: "Longsword", journal: "Harbor notes", table: "Wandering folk", scene: "Old harbor", token: "Aria",
    hud: "Aria", chat: "", sidebar: "", tools: "", settings: "", modules: "", compendium: "Gear"};
  const steps = STEPS.map((id, index) => {
    const failed = errors[id];
    return {id, name: names[id] ?? "", ms: slow.includes(id) ? 2600 : 180 + index * 35, timedOut: timedOut.includes(id), skipped: false,
      errors: failed ? [{owner: failed.owner, count: failed.count ?? 1, message: failed.message}] : []};
  });
  return summarizeTrial(steps, {at: iso(now - 8 * MINUTE), deprecated});
}

/**
 * The errors of players' browsers.
 * @param {number} now
 * @param {object[]} list   {user, owner, kind, message, where, stack, count, ago}   ago in minutes
 * @param {number} readAgo  Everything older than this many minutes counts as read
 * @returns {PlayerErrorStore}
 */
function playerErrors(now, list, readAgo) {
  const store = new PlayerErrorStore();
  for ( const item of list ) {
    store.add({id: `sample-${item.user.toLowerCase()}`, name: item.user},
      {owner: item.owner, kind: item.kind, message: item.message, where: item.where, stack: item.stack, count: item.count},
      iso(now - item.ago * MINUTE));
  }
  store.seenAt = iso(now - readAgo * MINUTE);
  return store;
}

/** The conflicts of the trouble scenario, found by the real rules over made-up key bindings and wrappers. */
function troubleConflicts() {
  const system = {id: SAMPLE_SYSTEM, title: "Sample Game System", version: "3.2.1"};
  const declared = declaredConflicts({system, modules: [
    {id: "echo-chamber", title: "Echo Chamber", version: "4.2.0", active: true, conflicts: [{id: "banner-board", type: "module", compat: {}}]},
    {id: "banner-board", title: "Banner Board", version: "0.9.4", active: true, conflicts: []}
  ]});
  const wrappers = wrapperConflicts({
    registrations: [
      {owner: "module:lantern-light", target: "Token.prototype._refreshVisibility", type: "OVERRIDE"},
      {owner: "module:harbor-guide", target: "Token.prototype._refreshVisibility", type: "OVERRIDE"},
      {owner: "module:echo-chamber", target: "Combat.prototype.nextTurn", type: "OVERRIDE"},
      {owner: "module:harbor-guide", target: "Combat.prototype.nextTurn", type: "WRAPPER"}
    ],
    lost: [],
    detected: [
      {owner: "module:map-weaver", other: "module:rune-roller", target: "Actor.prototype.rollAbility", confirmed: false},
      {owner: "unknown", other: "module:chart-kit", target: "Token.prototype.draw", confirmed: false}
    ]
  });
  const action = (id, owner, name, key) => ({id, owner, name, bindings: [{key, modifiers: []}], down: true, up: false});
  const keys = keyConflicts([
    action("lantern-light.toggle", "module:lantern-light", "Toggle the lantern", "KeyL"),
    action("tidy-quills.list", "module:tidy-quills", "Open the quill list", "KeyL"),
    action("map-weaver.pin", "module:map-weaver", "Drop a pin", "KeyM"),
    action("harbor-guide.map", "module:harbor-guide", "Show the harbor map", "KeyM"),
    action("banner-board.show", "module:banner-board", "Show the banner board", "KeyM"),
    action("harbor-guide.help", "module:harbor-guide", "Harbor help", "F1"),
    action("core.help", "core", "Help", "F1")
  ]);
  const findings = mergeConflicts(declared, wrappers, keys);
  return {findings, counts: countConflicts(findings), wrapperLibrary: true};
}

/** Two conflicts between modules of the calm world, for the answer of "Ready for tonight?". */
function smallConflicts() {
  const wrappers = wrapperConflicts({registrations: [
    {owner: "module:lantern-light", target: "Token.prototype._refreshVisibility", type: "OVERRIDE"},
    {owner: "module:harbor-guide", target: "Token.prototype._refreshVisibility", type: "OVERRIDE"}]});
  const action = (id, owner, name) => ({id, owner, name, bindings: [{key: "KeyL", modifiers: []}], down: true, up: false});
  const keys = keyConflicts([action("lantern-light.toggle", "module:lantern-light", "Toggle the lantern"),
    action("tidy-quills.list", "module:tidy-quills", "Open the quill list")]);
  const findings = mergeConflicts(wrappers, keys);
  return {findings, counts: countConflicts(findings), wrapperLibrary: true};
}

/* -------------------------------------------- */
/*  Scenarios of the first tab                  */
/* -------------------------------------------- */

/** The modules of the calm worlds. */
const CALM = ["lantern-light", "tidy-quills", "map-weaver", "rune-roller", "dice-forge-lite", "harbor-guide", "echo-chamber"];

function calmState(core) {
  return makeState(core, CALM.map(id => sampleModule(id, id === "rune-roller" ? {requires: [{id: "dice-forge-lite"}]} : {})));
}

/**
 * The scenarios of the first tab. kind is one of: trouble, one, tested, ran, changed, untested, first, trialRunning,
 * readyRunning, and the answers of "Ready for tonight?": readyErrors, readyPlayers, readyVersions, readyFit, readyConflicts,
 * readyGood, readyAlone.
 */
function firstTab(kind, now, core) {
  const state = calmState(core);
  const session = makeSession();
  const at = {previous: now - 3 * DAY, current: now - 2 * HOUR};
  let history = [entryOf(state, {at: at.current}), entryOf(state, {at: at.previous, good: true, goodAt: at.previous + 10 * MINUTE})];
  let log = watchLog(now);
  let store = new PlayerErrorStore();
  let conflicts = noConflicts();
  let playersOn = true;
  let current = state;
  if ( kind === "trouble" ) {
    const modules = [...CALM, "banner-board", "chart-kit", "ghost-lamp"].map(id => {
      if ( id === "rune-roller" ) return sampleModule(id, {requires: [{id: "dice-forge-lite"}]});
      if ( id === "chart-kit" ) return sampleModule(id, {requires: [{id: "data-bridge"}]});
      if ( id === "tidy-quills" ) return sampleModule(id, {requires: [{id: "dice-forge-lite", compat: {minimum: "2.0"}}]});
      if ( id === "ghost-lamp" ) return sampleModule(id, {availability: "UNVERIFIED_BUILD"});
      return sampleModule(id);
    });
    modules.push(sampleModule("glass-frames", {active: false}), sampleModule("wave-tracker", {active: false}));
    current = makeState(core, modules);
    const before = earlier(current, {core: nearBuild(core, -1), system: sampleSystem({version: "3.2.0"}), version: {"map-weaver": "2.9.0", "lantern-light": "2.5.0"},
      drop: ["glass-frames", "echo-chamber"], active: ["wave-tracker"], inactive: ["harbor-guide"],
      // Two modules that are gone: one fits Foundry, the manifest of the other stopped at Foundry 13
      extra: [{...sampleModule("quiet-notes", {compat: {minimum: "13", verified: "14"}}), id: "tiny-almanac", title: "Tiny Almanac", version: "0.3.0"},
        sampleModule("old-chronicle")]});
    history = [entryOf(current, {at: at.current}), entryOf(before, {at: at.previous, good: true, goodAt: at.previous + 10 * MINUTE})];
    log = watchLog(now, [
      ["module:banner-board", "error", "banner.items is not a function", 2],
      ["module:banner-board", "rejection", "Could not load the banner list", 1],
      ["module:echo-chamber", "hook", "Cannot read properties of undefined (reading 'echo') (renderChatMessageHTML)", 3],
      ["system:samplegame", "rejection", "Failed to load the sheet template", 1],
      ["core", "error", "ResizeObserver loop completed with undelivered notifications", 4]
    ], [["module:echo-chamber", "Application#render", "13", "15", 3], ["core", "ActorSheet#render", "13", "15", 2]]);
    store = playerErrors(now, [
      {user: "Lena", owner: "module:banner-board", kind: "error", message: "banner.items is not a function", count: 3, ago: 25,
        where: {type: "sheet", name: "ActorSheetPlayer"},
        stack: ["BannerBoard.items (modules/banner-board/scripts/board.js:88:14)", "ActorSheetPlayer._onRender (systems/samplegame/sheets/player.js:204:9)"]},
      {user: "Lena", owner: "module:map-weaver", kind: "rejection", message: "Could not read the pin layer", count: 1, ago: 26 * 60,
        where: {type: "window", name: "TokenConfig"}, stack: ["Weaver.pins (modules/map-weaver/scripts/pins.js:41:7)"]},
      {user: "Tom", owner: "module:echo-chamber", kind: "hook", message: "Cannot read properties of undefined (reading 'echo')", count: 5, ago: 110,
        where: {type: "hook", name: "renderChatMessageHTML"}, stack: []}
    ], 6 * 60);
    conflicts = troubleConflicts();
    session.trial = trialRun(now, {
      errors: {token: {owner: "module:map-weaver", message: "Cannot read properties of undefined (reading 'tokens')", count: 2},
        hud: {owner: "module:map-weaver", message: "Cannot read properties of undefined (reading 'tokens')"},
        chat: {owner: "module:rune-roller", message: "RuneRoller.render is not a function"}},
      slow: ["compendium"], deprecated: 6
    });
  } else if ( kind === "one" ) {
    log = watchLog(now, [["module:echo-chamber", "hook", "Cannot read properties of undefined (reading 'echo') (renderChatMessageHTML)", 3]]);
  } else if ( kind === "tested" ) {
    session.trial = trialRun(now, {slow: ["scene"], timedOut: ["compendium"], deprecated: 4});
    store = new PlayerErrorStore();
  } else if ( kind === "ran" ) {
    const before = earlier(state, {core: nearBuild(core, 1), system: sampleSystem({version: "3.3.0"}), version: {"tidy-quills": "1.9.0", "lantern-light": "2.4.2"}});
    history = [entryOf(state, {at: at.current, good: true, goodAt: now - 40 * MINUTE}), entryOf(before, {at: at.previous, good: true, goodAt: at.previous + 10 * MINUTE})];
  } else if ( kind === "changed" ) {
    const before = earlier(state, {system: {...sampleSystem({version: "1.4.0"}), id: "oldgame", title: "Old Game System"}, version: {"harbor-guide": "1.0.2", "tidy-quills": "1.7.5"}});
    history = [entryOf(state, {at: at.current}), entryOf(before, {at: at.previous, good: true, goodAt: at.previous + 10 * MINUTE})];
    playersOn = false;
    store = playerErrors(now, [{user: "Sam", owner: "module:echo-chamber", kind: "error", message: "Echo is not defined", count: 2, ago: 5 * 60,
      where: {type: "script", name: ""}, stack: []}], 60);
  } else if ( kind === "first" ) {
    history = [entryOf(state, {at: at.current})];
  } else if ( kind === "untested" ) {
    history = [entryOf(state, {at: at.current}), entryOf(state, {at: at.previous})];
  } else if ( kind === "trialRunning" ) {
    session.trialStep = {done: 5, total: STEPS.length, label: "Token settings"};
  }
  return {
    feed: makeFeed({state: current, history, log, store, conflicts, playersOn}),
    session
  };
}

/* -------------------------------------------- */
/*  Ready for tonight                           */
/* -------------------------------------------- */

/** The browsers of the made-up players, compared with the GM's. */
function playerBrowsers(core) {
  const gm = {core, system: {id: SAMPLE_SYSTEM, version: "3.2.1"}, modules: [["lantern-light", "2.4.1"], ["tidy-quills", "1.8.0"], ["map-weaver", "3.0.2"], ["echo-chamber", "4.2.0"]]};
  const lena = {core: nearBuild(core, -1), system: {id: SAMPLE_SYSTEM, version: "3.2.0"}, modules: [["lantern-light", "2.4.0"], ["tidy-quills", "1.8.0"], ["map-weaver", "3.0.2"], ["glass-frames", "2.2.2"]]};
  return {gm, lena, diff: compareVersions(gm, lena)};
}

/**
 * The data behind a result of "Ready for tonight?", without its texts (the window makes them, in the language of the
 * moment). Fields as buildReady in guard-app.mjs.
 * @param {string} kind
 * @param {string} core
 * @returns {object}
 */
export function readyData(kind, core, conflicts = noConflicts()) {
  const base = {trialModules: [], playerModules: [], players: [], connected: 3, fitProblems: 0, conflictModules: [], conflictLines: []};
  const result = {
    readyErrors: {...base, trialModules: ["Map Weaver", "Rune Roller"]},
    readyPlayers: {...base, playerModules: ["Echo Chamber"]},
    readyVersions: {...base, connected: 2, players: [
      {name: "Lena", answered: true, kinds: ["core", "system", "different", "missing", "extra"], diff: playerBrowsers(core).diff},
      {name: "Tom", answered: false, kinds: ["silent"], diff: null}]},
    readyFit: {...base, fitProblems: 2},
    readyConflicts: {...base, conflicts: conflicts.counts.counted,
      conflictModules: [...new Set(conflicts.counts.owners.map(o => ROSTER[o.slice(7)]?.title ?? o))]},
    readyGood: base,
    readyAlone: {...base, connected: 0}
  }[kind];
  return {...result, conflicts: result.conflicts ?? 0, answer: readyAnswer({...result, trialDone: true, conflicts: result.conflicts ?? 0})};
}

function readyScenario(kind, now, core) {
  let state = calmState(core);
  if ( kind === "readyFit" ) {
    // Two packages that no longer fit: a dependency is missing, another one is too old
    state = makeState(core, [...state.modules.filter(m => m.id !== "tidy-quills"), sampleModule("chart-kit", {requires: [{id: "data-bridge"}]}),
      sampleModule("tidy-quills", {requires: [{id: "dice-forge-lite", compat: {minimum: "2.0"}}]})]);
  }
  const session = makeSession();
  const history = [entryOf(state, {at: now - 2 * HOUR, good: true, goodAt: now - HOUR}), entryOf(state, {at: now - 3 * DAY, good: true, goodAt: now - 3 * DAY})];
  const log = watchLog(now);
  let store = new PlayerErrorStore();
  let conflicts = noConflicts();
  if ( kind === "readyRunning" ) {
    session.readyRunning = {phase: "players"};
  } else {
    if ( kind === "readyErrors" ) {
      session.trial = trialRun(now, {errors: {token: {owner: "module:map-weaver", message: "Cannot read properties of undefined (reading 'tokens')"},
        chat: {owner: "module:rune-roller", message: "RuneRoller.render is not a function"}}});
    } else session.trial = trialRun(now, {});
    if ( kind === "readyPlayers" ) {
      store = playerErrors(now, [
        {user: "Lena", owner: "module:echo-chamber", kind: "hook", message: "Cannot read properties of undefined (reading 'echo')", count: 2, ago: 30,
          where: {type: "hook", name: "renderChatMessageHTML"}, stack: []}], 24 * 60);
    }
    if ( kind === "readyConflicts" ) conflicts = smallConflicts();
  }
  return {feed: makeFeed({state, history, log, store, conflicts}), session, ready: kind === "readyRunning" ? null : readyData(kind, core, conflicts)};
}

/* -------------------------------------------- */
/*  The search for the module behind a problem  */
/* -------------------------------------------- */

/**
 * The search in each of its states, made by the real steps of the search.
 * @param {string} kind   "testing", "found", "noneChanged" or "noneAll"
 * @param {number} now
 * @param {string} core
 * @returns {object}
 */
function searchScenario(kind, now, core) {
  const state = calmState(core);
  const original = Object.fromEntries(state.modules.map(m => [m.id, m.active]));
  const suspects = ["map-weaver", "rune-roller", "echo-chamber", "tidy-quills", "harbor-guide", "lantern-light"];
  const start = scope => beginSearch({suspects, original, scope, now: iso(now - 20 * MINUTE)});
  const needs = {"rune-roller": ["dice-forge-lite"]};
  let search;
  if ( kind === "testing" ) {
    search = advanceSearch(start("changed"), false, needs);
  } else if ( kind === "found" ) {
    // Round 1: gone. Then the halves: the problem stays with the first half off, so it is not there.
    search = advanceSearch(start("changed"), false, needs);
    while ( search.phase === "testing" ) search = advanceSearch(search, true, needs);
  } else if ( kind === "noneChanged" ) {
    search = advanceSearch(start("changed"), true, needs);
  } else {
    search = advanceSearch(start("all"), true, needs);
  }
  const history = [entryOf(state, {at: now - 2 * HOUR}), entryOf(state, {at: now - 3 * DAY, good: true, goodAt: now - 3 * DAY})];
  return {feed: makeFeed({state, history, search}), session: makeSession()};
}

/* -------------------------------------------- */
/*  Can I update?                               */
/* -------------------------------------------- */

/** What the Forge's package list says about some modules, as the online check keeps it. */
function forgeAnswers() {
  const compat = (min, verified, max = "") => ({minimum: min, verified, maximum: max});
  return new Map([
    ["rune-roller", {state: "ok", source: "forge", latest: "5.2.0", compat: {"5.1.0": compat("13", "14"), "5.2.0": compat("13", "15")}}],
    ["pocket-tavern", {state: "ok", source: "forge", latest: "2.1.0", compat: {"2.0.3": compat("13", "14", "14"), "2.1.0": compat("13", "14")}}],
    ["map-weaver", {state: "ok", source: "forge", latest: "3.0.2", compat: {"3.0.2": compat("13", "14")}}],
    ["banner-board", {state: "ok", source: "forge", latest: "0.9.4", compat: {}}],
    ["quiet-notes", {state: "notListed", source: "forge", manifestError: "noManifest"}],
    ["harbor-guide", {state: "error", source: "forge", error: "http", detail: "503"}]
  ]);
}

/** The scenarios of the second tab, by the answer they show. */
const CHECKS = {
  blocked: {ids: ["lantern-light", "tidy-quills", "map-weaver", "banner-board", "old-chronicle", "rune-roller", "quiet-notes", "echo-chamber", "harbor-guide", "pocket-tavern"], online: true,
    deprecated: [["module:echo-chamber", "Application#render", "13", "15", 3], ["module:lantern-light", "Token#getBounds", "14", "16", 2], ["core", "ActorSheet#render", "13", "15", 4]]},
  blockedOne: {ids: ["lantern-light", "map-weaver", "banner-board", "quiet-notes"], online: false, safety: {loadouts: false, openManager: false, backup: false}},
  breaks: {ids: ["lantern-light", "tidy-quills", "map-weaver", "echo-chamber", "harbor-guide"], online: false,
    deprecated: [["module:echo-chamber", "Application#render", "13", "15", 3], ["module:map-weaver", "Scene#getFlag", "13", "15", 5]]},
  breaksOne: {ids: ["lantern-light", "map-weaver", "harbor-guide"], online: false, deprecated: [["module:map-weaver", "Scene#getFlag", "13", "15", 2]]},
  update: {ids: ["lantern-light", "tidy-quills", "rune-roller", "pocket-tavern", "dice-forge-lite"], online: true, saved: "ok"},
  updateOne: {ids: ["lantern-light", "rune-roller"], online: true, saved: "failed"},
  open: {ids: ["lantern-light", "map-weaver", "quiet-notes"], online: false},
  ready: {ids: ["lantern-light", "tidy-quills", "dice-forge-lite"], online: true, systemVerified: "15"}
};

function checkScenario(kind, now, core) {
  const spec = CHECKS[kind];
  const modules = spec.ids.map(id => sampleModule(id));
  const state = makeState(core, modules, sampleSystem(spec.systemVerified ? {compat: {verified: spec.systemVerified}} : {}));
  const history = [entryOf(state, {at: now - 2 * HOUR, good: true, goodAt: now - HOUR})];
  const session = makeSession({tab: "check", targetText: "15"});
  if ( spec.online ) {
    const answers = forgeAnswers();
    session.results = new Map([...answers].filter(([id]) => spec.ids.includes(id) || kind === "ready"));
    if ( kind === "ready" ) for ( const id of spec.ids ) session.results.set(id, {state: "ok", source: "forge", latest: ROSTER[id].version, compat: {}});
    const failures = [...session.results].filter(([, r]) => r.state === "error").map(([id, r]) => ({source: "forge", id, error: r.error, detail: r.detail}));
    for ( const [id, r] of session.results ) if ( r.manifestError ) failures.push({source: "manifest", id, error: r.manifestError, detail: ""});
    const count = state => [...session.results.values()].filter(r => r.state === state).length;
    session.report = {forge: {asked: session.results.size, cached: 0, ok: count("ok"), notListed: count("notListed"), failed: count("error")},
      manifest: {asked: 1, cached: 0, ok: 0, failed: failures.filter(f => f.source === "manifest").length, skipped: spec.ids.length}, failures};
    session.checkedTarget = "15";
  }
  if ( spec.saved === "ok" ) session.safety = {ok: true, name: "Update Guard 2026-11-22 (Foundry 14.370)"};
  if ( spec.saved === "failed" ) session.safety = {ok: false, name: ""};
  const log = watchLog(now, [], spec.deprecated ?? []);
  return {feed: makeFeed({state, history, log, safety: {...SAFETY, ...(spec.safety ?? {})}}), session};
}

/* -------------------------------------------- */
/*  How do I get back?                          */
/* -------------------------------------------- */

const BACK_MODULES = {
  "map-weaver": {version: "3.0.2", old: "2.9.0"},
  "tidy-quills": {version: "1.8.0", old: "1.7.5"},
  "lantern-light": {version: "2.4.1", old: "2.5.0", manifest: `https://github.com/${AUTHOR}/lantern-light/releases/download/v2.4.1/module.json`},
  "rune-roller": {version: "5.1.0", old: "5.0.3"},
  "quiet-notes": {version: "1.0.0", old: "0.9.0", manifest: ""},
  "echo-chamber": {version: "4.2.0", old: "4.1.0", manifest: "https://example.org/files/echo-chamber/4.2.0/module.json"},
  "harbor-guide": {version: "1.1.0", old: "1.1.0"}
};

function backScenario(kind, now, core) {
  const modules = Object.entries(BACK_MODULES).map(([id, spec]) => sampleModule(id, {version: spec.version, ...("manifest" in spec ? {manifest: spec.manifest} : {})}));
  const state = makeState(core, modules);
  const session = makeSession({tab: "back"});
  let history;
  if ( kind === "older" ) {
    const old = earlier(state, {core: nearBuild(core, -1), system: sampleSystem({version: "3.1.0"}), version: Object.fromEntries(Object.entries(BACK_MODULES).map(([id, s]) => [id, s.old]))});
    const noisy = earlier(state, {version: {"echo-chamber": "4.0.0"}});
    const open = earlier(state, {version: {"map-weaver": "2.8.0"}});
    history = [entryOf(state, {at: now - 2 * HOUR}),
      entryOf(noisy, {at: now - 1 * DAY, errors: {"module:echo-chamber": 4}}),
      entryOf(old, {at: now - 3 * DAY, good: true, goodAt: now - 3 * DAY + 20 * MINUTE}),
      entryOf(open, {at: now - 9 * DAY})];
    session.verified = new Map([
      ["map-weaver", {state: "found", tag: "v2.9.0", url: `https://github.com/${AUTHOR}/map-weaver/releases/download/v2.9.0/module.json`}],
      ["tidy-quills", {state: "noFile", tag: "v1.7.5"}],
      ["lantern-light", {state: "notFound"}],
      ["rune-roller", {state: "error", error: "timeout", detail: ""}]
    ]);
  } else if ( kind === "same" ) {
    const old = earlier(state, {core: nearBuild(core, -1)});
    history = [entryOf(state, {at: now - 2 * HOUR}), entryOf(old, {at: now - 3 * DAY, good: true, goodAt: now - 3 * DAY + 20 * MINUTE})];
  } else if ( kind === "current" ) {
    history = [entryOf(state, {at: now - 2 * HOUR, good: true, goodAt: now - HOUR})];
  } else {
    history = [entryOf(state, {at: now - 2 * HOUR})];
  }
  return {feed: makeFeed({state, history}), session};
}

/* -------------------------------------------- */
/*  The bundles                                 */
/* -------------------------------------------- */

/** All scenarios of the Update Guard window: the key is the first part of the id, the rest names the variation. */
export const WINDOW_KINDS = {
  first: ["trouble", "one", "tested", "ran", "changed", "untested", "first", "trialRunning"],
  ready: ["readyRunning", "readyErrors", "readyPlayers", "readyVersions", "readyFit", "readyConflicts", "readyGood", "readyAlone"],
  search: ["testing", "found", "noneChanged", "noneAll"],
  check: Object.keys(CHECKS),
  back: ["older", "same", "current", "none"]
};

/**
 * The made-up data of one scenario.
 * @param {"first"|"ready"|"search"|"check"|"back"} family
 * @param {string} kind
 * @param {object} [options]
 * @param {number} [options.now]
 * @param {string} [options.core]   The version of Foundry to show, the running one in the window
 * @returns {{feed: object, session: object, ready?: object|null}}
 */
export function sampleBundle(family, kind, {now = Date.now(), core = "14.370"} = {}) {
  if ( family === "first" ) return firstTab(kind, now, core);
  if ( family === "ready" ) return readyScenario(kind, now, core);
  if ( family === "search" ) return searchScenario(kind, now, core);
  if ( family === "check" ) return checkScenario(kind, now, core);
  return backScenario(kind, now, core);
}

/**
 * A report of a problem as the Report window shows it, made up.
 * @param {string} id
 * @param {string} kind    "start", "found", "none", "failed", "loading", "noRepo", "noMessage"
 * @param {object} [options]
 * @param {string} [options.core]
 * @returns {object}
 */
export function sampleReport(id, kind, {core = "14.370"} = {}) {
  const spec = ROSTER[id] ?? ROSTER["banner-board"];
  const error = {message: kind === "noMessage" ? "" : "banner.items is not a function (reading the banner list)", kind: "error",
    where: {type: "sheet", name: "ActorSheetPlayer"},
    stack: ["BannerBoard.items (modules/banner-board/scripts/board.js:88:14)", "ActorSheetPlayer._onRender (systems/samplegame/sheets/player.js:204:9)"],
    source: "player"};
  const text = buildReportText({module: {id, title: spec.title, version: spec.version}, foundry: core,
    system: {id: SAMPLE_SYSTEM, version: "3.2.1"}, error, others: 11, who: "in a player's browser"});
  const issues = [
    {number: 41, title: "Banner list fails to open on player sheets", url: `https://github.com/${AUTHOR}/${id}/issues/41`, comments: 3, updated: ""},
    {number: 37, title: "Error when the banner list is empty", url: `https://github.com/${AUTHOR}/${id}/issues/37`, comments: 0, updated: ""}
  ];
  const lookup = {found: {state: "ok", issues}, none: {state: "ok", issues: []}, failed: {state: "error", error: "rateLimit", detail: ""},
    loading: {state: "loading"}}[kind] ?? null;
  return {id, kind: "module", title: spec.title, version: spec.version,
    repo: kind === "noRepo" ? null : {owner: AUTHOR, repo: id, source: "url"},
    error, text, terms: issueTerms(error.message), pageUrl: `https://example.org/modules/${id}`, lookup};
}

export const __test__ = {ROSTER, CHECKS, STEPS, firstTab, checkScenario, backScenario, searchScenario, readyScenario, troubleConflicts, entryOf, makeState};
