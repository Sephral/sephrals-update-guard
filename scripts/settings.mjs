/**
 * Settings of the module. Like in every Sephral module, all options appear in Foundry's settings dialog under this
 * module, starting with the module language.
 */

import {MODULE_ID, isShown} from "./config.mjs";
import {FOLLOW_FOUNDRY, applyModuleLanguage} from "./language.mjs";
import {runSelfTest} from "./selftest.mjs";

/**
 * The settings of the module, in the order they appear in the settings dialog.
 * @type {Record<string, object>}
 */
export const SETTINGS = {
  uiLanguage: {type: String, default: FOLLOW_FOUNDRY, scope: "client", onChange: "language", choices: {
    [FOLLOW_FOUNDRY]: "SUG.LANGUAGE.default", de: "SUG.LANGUAGE.de", en: "SUG.LANGUAGE.en"}},
  windowMode: {type: String, default: "window", scope: "client", choices: {
    window: "SUG.SETTINGS.windowMode.window", notice: "SUG.SETTINGS.windowMode.notice", none: "SUG.SETTINGS.windowMode.none"}},
  goodAfter: {type: Number, default: 10, scope: "world", range: {min: 1, max: 120, step: 1}},
  collectPlayerErrors: {type: Boolean, default: true, scope: "world"},
  playerNotice: {type: Boolean, default: true, scope: "client"},
  theme: {type: String, default: "signature", scope: "client", onChange: "redraw", choices: {
    signature: "SUG.SETTINGS.theme.signature", foundry: "SUG.SETTINGS.theme.foundry"}}
};

/**
 * Register all settings of the module and its menus.
 * @param {{language: Function, redraw: Function, open: Function}} handlers
 */
export function registerSettings(handlers) {
  handlersRef = handlers;
  for ( const [key, def] of Object.entries(SETTINGS) ) {
    game.settings.register(MODULE_ID, key, {
      name: `SUG.SETTINGS.${key}.name`,
      hint: `SUG.SETTINGS.${key}.hint`,
      scope: def.scope ?? "world",
      config: true,
      type: def.type,
      choices: def.choices,
      range: def.range,
      default: def.default,
      onChange: def.onChange ? value => handlers[def.onChange]?.(value) : undefined
    });
  }
  game.settings.register(MODULE_ID, "history", {scope: "world", config: false, type: String, default: ""});
  game.settings.register(MODULE_ID, "playerErrors", {scope: "world", config: false, type: String, default: ""});
  game.settings.register(MODULE_ID, "search", {scope: "world", config: false, type: Object, default: {}});
  game.settings.registerMenu(MODULE_ID, "guard", {
    name: "SUG.SETTINGS.guard.name",
    label: "SUG.SETTINGS.guard.label",
    hint: "SUG.SETTINGS.guard.hint",
    icon: "fa-solid fa-shield-halved",
    type: GuardMenu,
    restricted: true
  });
  game.settings.register(MODULE_ID, "acknowledgedVersions", {scope: "client", config: false, type: String, default: ""});
  game.settings.registerMenu(MODULE_ID, "selfTest", {
    name: "SUG.SELFTEST.Title",
    label: "SUG.SELFTEST.Run",
    hint: "SUG.SELFTEST.Hint",
    icon: "fa-solid fa-stethoscope",
    type: SelfTestMenu,
    restricted: true
  });
}

/** The menu button which opens the window. */
class GuardMenu extends foundry.applications.api.ApplicationV2 {
  /** @override */
  async render() {
    if ( game.user.isGM ) await handlersRef.open();
    return this;
  }
}

/** The handlers given at registration, for the menu classes. */
let handlersRef = {};

/** The menu button which runs the self test. Foundry only accepts application classes as menus. */
class SelfTestMenu extends foundry.applications.api.ApplicationV2 {
  /** @override */
  async render() {
    if ( game.user.isGM ) await runSelfTest();
    return this;
  }
}

/**
 * Switch the module strings when the user picks another module language, then redraw.
 * @param {string} value
 * @param {Function} redraw
 */
export function changeLanguage(value, redraw) {
  applyModuleLanguage(value).then(() => {
    redraw();
    if ( game.settings.sheet?.rendered ) game.settings.sheet.render();
  });
}
