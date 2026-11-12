# Sephral’s Update Guard: Manual

Update Guard is a tool for the GM. Players never see its windows, and the module records and shows nothing for them.

## What it can and cannot do

* It runs only inside a started world. If the world does not start after an update, nothing appears. That is why the export exists: save it before you update.
* It cannot install, update or roll back anything. Foundry does that on its setup screen only. Update Guard shows the steps and the addresses. What it can do is switch modules on and off in this world, always after you asked for it.
* Everything it shows comes from manifests and lists, and every statement names its source. *Verified* is the author's claim in the manifest. It does not mean error free.
* It sends nothing over the network until the GM clicks *Look for newer versions*, and the window says what is sent.

## Opening the window

* The button *Update Guard* in the settings tab of the sidebar.
* *Open Update Guard* in the settings of the module.
* A key you choose in Foundry's key settings under Update Guard (no default).
* `game.modules.get("sephrals-update-guard").api.open()`.

At the start of a world the window opens on its own when something changed since the last start, unless you set *After an update* to a notice or to nothing. The gear in the title bar opens the settings of the module.

## The window

Three tabs, one question each. Under the name of each tab stands the short answer, and every tab starts with one sentence and the next step.

## Is everything working?

### Test run

*Start test run* opens one of each kind of window and closes it again: a sheet per actor type (up to three, player characters first), a sheet per item type (up to two), a journal, a roll table, the scene and token settings, the token HUD, a chat card with a roll, every tab of the sidebar, the scene tools, the settings, the module manager and a compendium. What the world does not have is left out. Every module that hooks into those windows runs its code, and the watch counts what throws.

The result names each module with errors, how many, where and the message. *Switch off* takes a module out of this world, together with the modules that need it, and reloads.

Nothing in the world is created or changed: the chat card exists only in memory, the sheets are only opened. Slow steps are marked. A run without a module error marks the current state as one that ran well at once. Calls of old Foundry functions that come up during the run land under *Can I update?*.

The run happens on the GM's screen only and takes about half a minute, the windows flash by.

### Something broken?

For a problem no error names. The search suspects what changed since the last state that ran well: new modules, other versions, modules switched on. If nothing changed, every active module is a suspect.

1. Round 1 switches all suspects off and reloads. You try what did not work and answer *The problem is gone* or *The problem is still there*.
2. If it stayed, it is none of them, and the search offers to go through the other active modules.
3. If it went away, the search halves the suspects round by round until one is left. Modules that need a module which is off go off with it.
4. At the end all modules are back on and the window names the module. You switch it off, or end the search.

*Cancel and restore everything* works in every round. The module configuration from before the search is stored in a world setting, the search survives reloads and closed browsers, and the window opens by itself until the search is over. Update Guard itself is never switched off. A search looks for one module: when two modules together cause a problem, it may name neither.

Other users notice nothing until they reload, so a search is best done without players.

### What the window lists

* **What no longer fits.** For active modules and the system: a minimum or maximum Foundry version that does not include the running one, a required module that is missing, switched off or outside the required range, a game system the module was not made for, and what Foundry itself reports. Shown only when there is something.
* **Errors since the start.** Per module and system: how many errors, of which kind (script errors, unhandled promises, errors inside hooks), and the first message. The count starts when the page loaded. Shown only when there is something, and not twice when the test run already named the module.
* **What changed.** Foundry, the game system and every module compared with the state of the last start: updated, new, removed, switched on, switched off, with links to the changelog, the project page and the readme.

A start is recorded by the active GM only. The window compares the last two different states, so a start without a change opens nothing.

## Can I update?

The sentence on top answers it for the next generation of Foundry. Type another version into the field if you plan something else: a number like `15` means the generation, `14.371` a build. The game system and every active module get one rating, and the list is grouped by what it means for you:

| Rating | Meaning |
| --- | --- |
| ready | The installed version, or its entry in the package list, is verified for the target. |
| update needed | A newer version is verified for the target, the installed one is not. When the newer version is only not blocked, the explanation says so. |
| not confirmed | The minimum version fits, the target is not verified, and no maximum is against it. |
| blocked | The maximum is below the target, or the minimum above it, and no newer version is known. |
| no data | The manifest has no compatibility data. |

*Will not run there* and *Needs an update first* are open. *Could break* lists modules that call functions the target removes. *Not confirmed yet* and *Ready* are folded: for a new version it is normal that authors have not confirmed it yet.

Without the online check the ratings use the installed manifests, so *blocked* may only mean that no newer version is known here. Each row opens to *What this is based on*: the compatibility of the installed manifest, and what the package list or a manifest said. A line above the list sums it up, for example *For 15: 38 ready, 3 unknown, 1 blocked: Pathfinder*.

### Look for newer versions

*Look for newer versions* sends one request per package to `forge-vtt.com/api/bazaar/package/<id>`, the public package list of The Forge, with the package ID only. For a package that list does not know, the manifest address of the installed package is requested from the host named there. Nothing else leaves the browser: no world data, no names, no settings, no cookies and no login. Like every request of a web page it carries the address of the Foundry server. Requests run two at a time with a pause between them, answers stay in memory for one hour, and a failed request does not stop the list. A second click asks only for what failed.

The Forge's list gives the newest version and the compatibility of every version. Which sources a browser may read, tested from Foundry pages on plain http in Chrome and in Firefox on 7 November 2026:

| Source | From the browser |
| --- | --- |
| forge-vtt.com package list | Works. |
| raw.githubusercontent.com | Works, so a manifest address there can be read. |
| api.github.com | Works, limited to 60 requests an hour. Used only to check an older release. |
| github.com release downloads | Blocked, the browser gets no permission (CORS). A package installed from a `releases/latest/download` address cannot be read this way. |
| foundryvtt.com package pages | Blocked. |
| foundryvtt.com package API | Answers 403 without a token, so it is not used. |
| A manifest on a server without CORS headers | Blocked. |

A blocked request is reported as *the browser could not reach it*. The browser does not say whether the cause was a missing permission, no network or a blocked connection.

### Old calls

Modules that called Foundry functions marked as deprecated since the page loaded are listed with the number of calls, the first message and the version in which Foundry removes the function. A call that Foundry removes in the target version or earlier is marked, because that is the clearest sign of trouble. Foundry's compatibility mode set to silent hides these warnings, and the window says so. Every call is counted, also those Foundry logs only once and those a module has hidden with its own pattern.

### Export and checklist

*Save as JSON* and *Save as text* write one file with every installed module and version, its manifest address, the rating for the target, what does not fit, errors, old calls and the recorded states. The checklist names the steps before an update, with Foundry's own button names.

## How do I get back?

A start counts as one that ran well after a test run without a module error, or when the world stayed open without an error from a module or the system for the time set in *Minutes without a module error* (10 by default). That check runs on the active GM's browser, so a short session never marks anything.

The window lists the modules whose version differs from the last state that ran well. For each module whose manifest address is a GitHub release address it derives the address of the older version, which you copy. It is a guess until you click *Check on GitHub*, which asks `api.github.com` whether a release of that version exists under the usual tag names and has the manifest file. For other addresses the window says that none can be derived. The steps lead through Foundry's setup: leave the world, restore a snapshot or backup, or install the older manifest. Foundry itself cannot be changed from inside a world. A world that a newer Foundry migrated does not open in an older one without a backup.

The last 12 different states are kept in a world setting. A state is saved only when something changed, otherwise only its date is updated.

## Settings

| Setting | Scope | Does |
| --- | --- | --- |
| Module language | This device | Like Foundry, English or German |
| Look | This device | Signature (warm paper) or Foundry (dark) for the windows |
| After an update | This device | Open the window, show a notice only, or nothing |
| Minutes without a module error | World | How long a start must stay quiet to count as one that ran well |
| Open Update Guard | GM | Opens the window |
| Run self test | GM | See below |
| Save debug file | GM | See below |

## Keys

One key without a default, set it in Foundry's key settings under Update Guard: *Open Update Guard*.

## Macro API

`const api = game.modules.get("sephrals-update-guard").api;`

| Call | Does |
| --- | --- |
| `api.open({tab})` | Opens the window (GM). The tab is `changes`, `check` or `back`. |
| `await api.check(target, {online})` | Rates the system and the active modules for a target such as `"15"`. Only with `{online: true}` it sends requests, so call that only after the GM agreed. Returns the target, the rated list, the counts and the verdict line. |
| `await api.trial()` | The test run (GM). Returns the checks, the modules with errors and the steps. |
| `api.snapshot()` | The current state: Foundry, system and modules with version, compatibility and manifest address. |
| `api.history()` | The recorded states, newest first. |
| `api.export()` | The export as plain data. |
| `api.watch()` | Errors and old calls counted since the page loaded, by package. |
| `await api.runSelfTest()` | The self test. |
| `api.saveDebugFile()` | The debug file. |

## Self test

*Run self test* in the module settings checks what Update Guard relies on: how Foundry names package data and availability, that its version comparison agrees with Foundry's, the stored history, the early watch for errors and the counter for old calls, saving files and the texts it uses. The result comes as a notification and a chat message only you see, with the Foundry version the module was verified with. After a Foundry update you get a one time notice to run it.

## Debug file

For bug reports, the GM saves one file about all of Sephral’s modules in this world: `Save debug file` in the module settings, or `Save Debug File (Sephral’s Modules)` in the context menu of a chat message. For Update Guard it holds the Foundry and system version, the recorded states with their marks, the counts of errors and old calls per package (no messages), and what the watch has installed.

The file contains chat text and whispers. Check it before you share it.

## Sephral’s Modules

The first button in the module settings, *Sephral’s Modules* (GMs only), opens one window for all of Sephral's modules in the world: the version, self test, settings, manual and demo video of each, a button that switches on an installed module that is off (Foundry then reloads the world for everyone), and the debug file. Below, *More from Sephral* lists other modules that fit the game system of the world, shown only after a click, each with its demo video and an *Install* button. Foundry installs modules only on its setup screen, so the button copies the module's link (manifest URL) and shows the steps with a short clip. When the GM launches the world again, the window opens once with the new module and its *Enable* button. The list is part of the module. Only a video you start is loaded, from the module page on GitHub.

## Usage statistics

The module can take part in a small usage report shared by all of Sephral’s modules. Nothing is counted or sent until the GM agrees: shortly after the world starts, the active GM is asked, and the question comes back at every start until there is an answer. The answer counts for all of Sephral’s modules in the world. *Share usage statistics* in the module settings turns the report on or off at any time, and *Manage statistics* below it shows what the report contains right now.

With the GM’s consent only the active GM’s browser counts, and it sends at most one report a day. The counts are kept in a hidden world setting, so all browsers and computers of the GM count together, and turning the statistics off deletes them. A copy of a world gets its own world ID. The question lists everything the report contains, from the Foundry version to a random world ID. For Update Guard it holds:

* on how many of the last 30 days the module was used
* how often the GM opens the window, how often it opens by itself after a change, runs a test run, starts a search, finds a module, switches a module off, changes the target, looks for newer versions, saves an export and copies an older manifest address
* the settings *Look*, *After an update* and *Minutes without a module error* (only the chosen option or number)
* where errors occur in the module code: file, line and error type, never the error message

No names, notes, pictures or other content of the world are sent.
