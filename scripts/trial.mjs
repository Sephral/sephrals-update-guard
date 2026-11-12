/**
 * The test run: opens what a game night opens, one thing of each kind, and closes it again. Every module that hooks
 * into those windows runs its code, the watch counts what throws. Nothing is created, changed or sent: sheets of
 * existing documents, a chat message that exists only in memory, the sidebar and the scene tools.
 */

import {MODULE_ID} from "./config.mjs";
import {countDelta, summarizeTrial} from "./trial-data.mjs";
import {log, noteError} from "./watch.mjs";

/** How long a step may take. */
const STEP_LIMIT = 10000;

/** Time for late errors of a step to arrive. */
const SETTLE_MS = 150;

/** How long windows with a search field stay open. */
const SEARCH_HOLD = 400;

/** How many documents of one kind are opened. */
const ACTOR_TYPES = 3;
const ITEM_TYPES = 2;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Wait until a condition holds.
 * @param {() => boolean} test
 * @param {number} limit
 * @returns {Promise<boolean>}
 */
async function until(test, limit) {
  const end = Date.now() + limit;
  while ( Date.now() < end ) {
    if ( test() ) return true;
    await sleep(40);
  }
  return test();
}

/**
 * Open a window and close it. A window the GM already had open stays open.
 * @param {Application|ApplicationV2} app
 * @param {number} [hold]   How long it stays open. Foundry's windows with a search field filter a moment after they
 *   open, and fail when they are closed before that.
 */
async function openAndClose(app, hold = 80) {
  if ( !app ) return;
  const wasOpen = !!app.rendered;
  await app.render(true);
  await until(() => app.rendered, 4000);
  await sleep(hold);
  if ( !wasOpen ) await app.close({animate: false, force: true});
}

/**
 * One document per type, in the given order.
 * @param {Document[]} documents
 * @param {number} limit
 * @returns {Document[]}
 */
function onePerType(documents, limit) {
  const seen = new Set();
  const picked = [];
  for ( const doc of documents ) {
    if ( seen.has(doc.type) ) continue;
    seen.add(doc.type);
    picked.push(doc);
    if ( picked.length >= limit ) break;
  }
  return picked;
}

/** A roll with its chat card, in memory only: every module that decorates chat cards gets to work on it. */
async function renderChatCard() {
  const roll = await new Roll("1d20").evaluate();
  const message = new ChatMessage.implementation({_id: foundry.utils.randomID(), author: game.user.id,
    content: String(roll.total), rolls: [roll.toJSON()], speaker: {alias: game.user.name}});
  await message.renderHTML();
}

/** Every tab of the sidebar, then back to the one that was open. */
async function walkSidebar() {
  const active = ui.sidebar?.tabGroups?.primary ?? ui.sidebar?.activeTab;
  for ( const tab of ["actors", "items", "journal", "tables", "cards", "macros", "playlists", "compendium", "combat", "settings", "chat"] ) {
    if ( !ui[tab] ) continue;
    ui.sidebar.changeTab(tab, "primary");
    await ui[tab].render?.();
    await sleep(30);
  }
  if ( active ) ui.sidebar.changeTab(active, "primary");
}

/** The tools of the scene, then back to the layer that was active. */
async function walkLayers() {
  const active = canvas.activeLayer;
  for ( const name of ["tokens", "templates", "tiles", "drawings", "walls", "lighting", "sounds", "regions", "notes"] ) {
    const layer = canvas[name];
    if ( !layer?.activate ) continue;
    layer.activate();
    await sleep(40);
  }
  active?.activate?.();
}

/** The token HUD of a token. */
async function showHud(token) {
  const hud = canvas.hud?.token;
  if ( !hud ) return;
  await hud.bind(token);
  await sleep(80);
  await hud.close?.();
}

/** Foundry's list of modules. */
async function openModules() {
  const Manager = foundry.applications?.sidebar?.apps?.ModuleManagement;
  if ( Manager ) await openAndClose(new Manager(), SEARCH_HOLD);
}

/** The first compendium with entries. */
async function openCompendium() {
  const pack = game.packs.find(p => (p.index.size > 0) && p.visible);
  if ( !pack ) return;
  await pack.render(true);
  await until(() => pack.apps?.some(app => app.rendered), 4000);
  await sleep(80);
  for ( const app of [...(pack.apps ?? [])] ) await app.close({animate: false, force: true});
}

/**
 * The plan of a run. What the world does not have is left out, not reported as a problem.
 * @returns {{id: string, name: string, run: Function}[]}
 */
function plan() {
  const steps = [];
  const add = (id, name, run) => steps.push({id, name, run});
  const heroes = [...game.actors.contents].sort((a, b) => Number(b.hasPlayerOwner) - Number(a.hasPlayerOwner));
  const actors = onePerType(heroes, ACTOR_TYPES);
  for ( const actor of actors ) add("actor", actor.name, () => openAndClose(actor.sheet));
  const worldItems = onePerType(game.items.contents, ITEM_TYPES);
  const items = worldItems.length ? worldItems : onePerType(actors.flatMap(a => a.items.contents), ITEM_TYPES);
  for ( const item of items ) add("item", item.name, () => openAndClose(item.sheet));
  const journal = game.journal.contents[0];
  if ( journal ) add("journal", journal.name, () => openAndClose(journal.sheet));
  const table = game.tables.contents[0];
  if ( table ) add("table", table.name, () => openAndClose(table.sheet));
  const scene = canvas?.scene;
  if ( scene ) add("scene", scene.name, () => openAndClose(scene.sheet));
  const token = canvas?.ready ? canvas.tokens?.placeables[0] : null;
  if ( token ) {
    add("token", token.name, () => openAndClose(token.document.sheet));
    add("hud", token.name, () => showHud(token));
  }
  add("chat", "", renderChatCard);
  add("sidebar", "", walkSidebar);
  if ( canvas?.ready ) add("tools", "", walkLayers);
  add("settings", "", () => openAndClose(game.settings.sheet, SEARCH_HOLD));
  add("modules", "", openModules);
  if ( game.packs.size ) add("compendium", "", openCompendium);
  return steps;
}

/**
 * Run the test.
 * @param {object} [options]
 * @param {(done: number, total: number, step: object) => void} [options.onStep]
 * @returns {Promise<object>}   See summarizeTrial
 */
export async function runTrial({onStep = () => {}} = {}) {
  const steps = plan();
  const deprecatedBefore = log.deprecationTotal();
  const results = [];
  for ( const [index, step] of steps.entries() ) {
    onStep(index, steps.length, step);
    const before = log.errorCounts();
    const started = performance.now();
    let timedOut = false;
    try {
      const outcome = await Promise.race([Promise.resolve().then(step.run), sleep(STEP_LIMIT).then(() => "limit")]);
      timedOut = outcome === "limit";
    } catch(err) {
      console.error(`${MODULE_ID} | Test run step ${step.id}`, err);
      noteError(err);
    }
    const ms = Math.round(performance.now() - started);
    await sleep(SETTLE_MS);
    const errors = countDelta(before, log.errorCounts()).map(e => ({...e, message: log.errors.get(e.owner)?.last?.message ?? ""}));
    results.push({id: step.id, name: step.name, ms, timedOut, errors});
  }
  return summarizeTrial(results, {at: new Date().toISOString(), deprecated: log.deprecationTotal() - deprecatedBefore});
}
