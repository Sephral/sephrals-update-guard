/**
 * The players' side and the GM's side of the module socket: errors from the players' browsers, and the versions their
 * browsers run. Players send only to the GMs who are online, a few short reports with throttling, and see nothing of it.
 * The GM keeps the reports in a world setting, so "since the last session" survives a restart.
 *
 * The server tells the receiver who sent a message. The sender in a report is taken from there, never from the report.
 */

import {MODULE_ID, setting, t} from "./config.mjs";
import {ErrorGate, PlayerErrorStore, buildReport, compareVersions, isReportable, readReport, readVersions} from "./player-data.mjs";
import {differenceKinds} from "./ready-data.mjs";
import {countFeature} from "./usage.mjs";
import {log} from "./watch.mjs";

/** The socket event of this module (the manifest sets "socket": true). */
export const SOCKET = `module.${MODULE_ID}`;

/** The owner key of this module: its own errors are not reported. */
const SELF = `module:${MODULE_ID}`;

/** What the GM keeps. */
export const store = new PlayerErrorStore();

/** What the window wants to know when something arrives. */
let onChange = () => {};

/** Versions asked for and answers received, by request id. */
const requests = new Map();

/** One notice per module and minute. */
const noticed = new Map();

let saveTimer = null;

/** Errors evidence counts for a search: the last two weeks. */
const EVIDENCE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * The GMs who are online.
 * @returns {User[]}
 */
function onlineGMs() {
  return game.users.filter(u => u.isGM && u.active);
}

/**
 * What this browser runs: Foundry, the system and the active modules.
 * @returns {{core: string, system: {id: string, version: string}, modules: [string, string][]}}
 */
export function myVersions() {
  return {
    core: game.version,
    system: {id: game.system.id, version: String(game.system.version)},
    modules: [...game.modules.values()].filter(m => m.active).map(m => [m.id, String(m.version)])
  };
}

/* -------------------------------------------- */
/*  Setup                                       */
/* -------------------------------------------- */

/**
 * Start listening at "ready". Players start the reporter, GMs load the list and receive.
 * @param {object} handlers
 * @param {Function} handlers.changed   Called when the list of player errors changed
 */
export function startPlayers({changed}) {
  onChange = changed;
  game.socket.on(SOCKET, (message, senderId) => {
    try {
      receive(message, game.users.get(senderId));
    } catch(err) {
      console.warn(`${MODULE_ID} | A message over the socket could not be read`, err);
    }
  });
  if ( game.user.isGM ) loadStore();
  else startReporter();
}

/** Read the stored list of the players' errors. */
function loadStore() {
  const loaded = PlayerErrorStore.parse(game.settings.get(MODULE_ID, "playerErrors"));
  store.entries = loaded.entries;
  store.seenAt = loaded.seenAt;
}

/** Store the list, a moment after the last change. Only the active GM writes. */
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 2500);
}

/**
 * Store the list now. Reports that arrive are stored by the active GM only, a GM who reads or clears writes at once.
 * @param {object} [options]
 * @param {boolean} [options.force]
 * @returns {Promise<void>}
 */
export async function save({force = false} = {}) {
  clearTimeout(saveTimer);
  if ( !game.user.isGM || (!force && (game.users.activeGM?.id !== game.user.id)) ) return;
  try {
    await game.settings.set(MODULE_ID, "playerErrors", store.serialize());
  } catch(err) {
    console.warn(`${MODULE_ID} | The errors of the players could not be stored`, err);
  }
}

/* -------------------------------------------- */
/*  Receiving                                   */
/* -------------------------------------------- */

/**
 * @param {*} message
 * @param {User|undefined} sender
 */
function receive(message, sender) {
  if ( !sender || !message || (typeof message !== "object") ) return;
  if ( game.user.isGM && !sender.isGM ) {
    if ( message.type === "errors" ) takeErrors(sender, message.items);
    else if ( message.type === "versions" ) takeVersions(sender, message);
  } else if ( !game.user.isGM && sender.isGM && (message.type === "versions?") ) {
    game.socket.emit(SOCKET, {type: "versions", id: String(message.id ?? "").slice(0, 40), data: myVersions()}, {recipients: [sender.id]});
  }
}

/**
 * Reports of a player's browser.
 * @param {User} sender
 * @param {*} items
 */
function takeErrors(sender, items) {
  if ( !Array.isArray(items) ) return;
  let any = false;
  for ( const raw of items.slice(0, 10) ) {
    const report = readReport(raw);
    if ( !report ) continue;
    const result = store.add({id: sender.id, name: sender.name}, report);
    if ( !result ) continue;
    any = true;
    countFeature(MODULE_ID, "playerErrorSeen");
    if ( result.isNew ) notice(sender, report.owner);
  }
  if ( !any ) return;
  scheduleSave();
  onChange();
}

/**
 * A quiet notice for the GM during play, once per module and minute.
 * @param {User} user
 * @param {string} owner
 */
function notice(user, owner) {
  if ( !setting("playerNotice") ) return;
  const now = Date.now();
  if ( (now - (noticed.get(owner) ?? 0)) < 60000 ) return;
  noticed.set(owner, now);
  const id = owner.split(":")[1];
  const title = (owner.startsWith("system:") ? game.system.title : game.modules.get(id)?.title) ?? id;
  ui.notifications.info(t("SUG.Players.notice", {user: user.name, module: title}), {console: false});
}

/**
 * The answer of a player to the question for versions.
 * @param {User} sender
 * @param {{id: string, data: object}} message
 */
function takeVersions(sender, message) {
  const request = requests.get(message.id);
  const data = readVersions(message.data);
  if ( !request || !data || !request.want.has(sender.id) ) return;
  request.got.set(sender.id, data);
  if ( request.got.size >= request.want.size ) request.done();
}

/* -------------------------------------------- */
/*  Sending (players)                           */
/* -------------------------------------------- */

/**
 * The reporter of a player's browser: errors of modules and the system go to the GMs, throttled.
 */
function startReporter() {
  const gate = new ErrorGate();
  const waiting = [];
  const flush = () => {
    const gms = onlineGMs();
    if ( !gms.length || !waiting.length ) return;
    game.socket.emit(SOCKET, {type: "errors", items: waiting.splice(0, 10)}, {recipients: gms.map(u => u.id)});
  };
  const push = reports => {
    waiting.push(...reports);
    // Without a GM online the newest reports wait, the oldest are dropped
    while ( waiting.length > 30 ) waiting.shift();
    flush();
  };
  const listener = item => {
    if ( !setting("collectPlayerErrors") || !isReportable(item.owner) || (item.owner === SELF) ) return;
    push(gate.add(buildReport(item), Date.now()));
  };
  // What went wrong before the world was ready is reported as well
  for ( const item of log.recent ) listener(item);
  log.listeners.add(listener);
  setInterval(() => {
    push(gate.flush(Date.now()));
    flush();
  }, 5000);
}

/* -------------------------------------------- */
/*  Asking for versions (GM)                    */
/* -------------------------------------------- */

/**
 * Ask the connected players' browsers which versions they run, and compare with this one.
 * @param {object} [options]
 * @param {number} [options.wait=2500]   Milliseconds to wait for the answers
 * @returns {Promise<{players: {id: string, name: string, answered: boolean, kinds: string[], diff: object|null}[], mine: object}>}
 */
export async function requestVersions({wait = 2500} = {}) {
  const mine = readVersions(myVersions());
  const players = game.users.filter(u => u.active && !u.isGM);
  if ( !players.length ) return {players: [], mine};
  const id = foundry.utils.randomID();
  const request = {want: new Set(players.map(u => u.id)), got: new Map(), done: () => {}};
  const finished = new Promise(resolve => {
    request.done = resolve;
    setTimeout(resolve, wait);
  });
  requests.set(id, request);
  game.socket.emit(SOCKET, {type: "versions?", id}, {recipients: [...request.want]});
  await finished;
  requests.delete(id);
  return {mine, players: players.map(u => {
    const data = request.got.get(u.id);
    const diff = data ? compareVersions(mine, data) : null;
    return {id: u.id, name: u.name, answered: !!data, diff, kinds: data ? differenceKinds(diff) : ["silent"]};
  })};
}

/* -------------------------------------------- */
/*  Using the list                              */
/* -------------------------------------------- */

/**
 * The modules that errors of players point at: evidence for the search.
 * @returns {string[]}   Module ids
 */
export function playerEvidence() {
  const from = Date.now() - EVIDENCE_MS;
  return [...new Set(store.list().filter(e => (Date.parse(e.last) || 0) >= from && e.owner.startsWith("module:"))
    .map(e => e.owner.slice(7)))];
}

/**
 * Mark the errors as read.
 * @returns {Promise<void>}
 */
export async function markPlayerErrorsRead() {
  store.markRead();
  onChange();
  await save({force: true});
}

/**
 * Forget the errors of the players.
 * @returns {Promise<void>}
 */
export async function clearPlayerErrors() {
  store.clear();
  onChange();
  await save({force: true});
}
