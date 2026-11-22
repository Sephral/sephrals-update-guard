# Sephral’s Update Guard: Manual

Update Guard is a tool for the GM. Players never see its windows or any notice of the module. In the background their browsers report errors of modules to the GM, see *Errors of the players*, and that can be switched off.

## What it can and cannot do

* It runs only inside a started world. If the world does not start after an update, nothing appears. That is why the export exists: save it before you update.
* It cannot install, update or roll back anything. Foundry does that on its setup screen only. Update Guard shows the steps and the addresses. What it can do is switch modules on and off in this world, always after you asked for it.
* Everything it shows comes from manifests and lists, and every statement names its source. *Verified* is the author's claim in the manifest. It does not mean error free.
* It sends nothing over the network until the GM clicks *Look for newer versions* or *Look for open issues*, and the window says what is sent. The reports of the players travel over Foundry's own connection to the GM, never to another server.

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

### Ready for tonight?

One click before a session. *Ready for tonight?* runs the test run, collects the errors your players had since you last marked them as read, asks the connected players' browsers which versions they run, and gives one answer with the next step. The order of the answers is: errors in the test run, errors of the players, browsers that differ, things that no longer fit, modules that get in each other's way. Under the answer stand the details.

* **Browsers that differ.** Every connected player's browser answers with the version of Foundry, of the game system and of every active module, and the window compares them with yours. It names the player and what differs: a module with another version, a module that is missing there or only there. A page that was opened before an update still runs the old versions, so the usual next step is to reload the page with F5, and if that does not help, to clear the cache of the browser. A browser that does not answer within a few seconds is named too, it is most likely an old page. Only versions of Foundry, the system and the active modules are exchanged.
* **No players connected.** Then only your side is checked, and the answer says so.

Nothing in the world is changed. The versions are what the browser loaded with the page. Update Guard cannot see which files the browser cache holds, so a stale cache shows up only when it shows up as another version.

### Errors of the players

The browsers of your players report errors of modules and of the game system to the GM. Update Guard already counts errors and unhandled promises in your own browser, and it reads the module an error comes from out of the stack trace. The same watch runs in the players' browsers and tells you:

* **which module**, and which player,
* **where**: in a sheet, a window, a hook or somewhere in a script, read from the name of the hook (render hooks carry the name of the window) and from the stack,
* **how often**: the same error from the same player counts up, it is not listed again.

The window shows them in the first tab, per player and per module, with the stack lines folded under each error. New ones are marked until you click *Mark as read*, and they turn the answer of the tab to *causing trouble*. While you play, a quiet notice names the player and the module when a new error arrives, at most once a minute per module. *Notice for errors of the players* turns that off. The list is kept in a world setting, so it is still there after a restart, and *Clear the list* empties it.

What is sent, and to whom:

* Only to the GMs who are online, over the module socket. Players do not receive anything from other players.
* Per error: the module or system, the kind (script error, unhandled promise, error inside a hook), a message of at most 200 characters, up to 5 stack lines, the place and a count. Nothing else. The sender is taken from the server's connection, not from the report.
* The message loses addresses of servers, folders of the computer (`C:\Users\...`, `/home/...`) and mail addresses. Stack lines keep only the path inside `modules/` or `systems/`, the function and the line.
* Errors of Foundry itself, of code that belongs to no package and of Update Guard are not reported.
* Throttled: the first report of an error goes out at once, repeats are counted and sent together at most every 30 seconds, at most 8 reports a minute leave a browser, and at most 25 different errors per page load are tracked. The GM's side accepts at most 30 reports a minute from one player. A module that throws in a loop costs a few messages.
* Without a GM online the newest 30 reports wait in the browser and go out when a GM connects.

Players see nothing: no window, no notice, no button. The setting *Errors of the players* (world) switches the reports off for everyone. The reports also count as evidence for *Something broken?*: the modules they name are suspects first, even if they did not change.

### Report this problem

For a module that is to blame, the test run, the error list, the list of the players' errors and the result of the search have the button *Report this problem*. It opens a window with the module, the error and two steps. Nothing is sent by Update Guard itself.

1. **Is it known already?** The window finds the GitHub repository of the module in this order: the `bugs` address of its manifest, then `url`, `manifest`, `readme`, `changelog`. On the click of *Look for open issues* it asks `api.github.com`, the public search of GitHub, for open issues of that repository that match the key words of the error (names and unusual words, not the phrases every error message has). The window shows what is sent before you click: the name of the repository and the key words, no cookies, no referrer. Matching issues are listed as links. The limit of GitHub for requests without a login (a few searches a minute) is reported as such. Answers stay in memory for one hour.
2. **A bug report text.** Module, version, Foundry and game system version, the number of other active modules, the error with the place it appeared, a few stack lines and a line for the steps. The text is always in English, because authors read English. It holds no player names. You can edit it and *Copy text*. When the repository is on GitHub, *Open a new issue on GitHub* opens the new issue page in a new tab with the title and the text filled in (and the text is in the clipboard as well, because an address can only hold so much). Nothing is sent until you press the button on GitHub. When no repository is known, the window says so and links the project page.

### Something broken?

For a problem no error names. The search suspects what changed since the last state that ran well: new modules, other versions, modules switched on. If nothing changed, every active module is a suspect.

1. Round 1 switches all suspects off and reloads. You try what did not work and answer *The problem is gone* or *The problem is still there*.
   Modules that the errors of the players point at are suspects first, also when nothing changed in them, and they are tested in the first rounds. The question before the search says so.
2. If it stayed, it is none of them, and the search offers to go through the other active modules.
3. If it went away, the search halves the suspects round by round until one is left. Modules that need a module which is off go off with it.
4. At the end all modules are back on and the window names the module. You switch it off, or end the search.

*Cancel and restore everything* works in every round. The module configuration from before the search is stored in a world setting, the search survives reloads and closed browsers, and the window opens by itself until the search is over. Update Guard itself is never switched off. A search looks for one module: when two modules together cause a problem, it may name neither.

Other users notice nothing until they reload, so a search is best done without players.

### Modules in each other's way

Update Guard shows where two active modules get in each other's way before something breaks. It only reads what the modules registered, nothing is wrapped, replaced or changed. Every finding is one sentence with both module titles, a level and the next step. A world without findings shows one quiet line and no section.

The levels: *Confirmed* is red, *Likely* is yellow, *Note* is grey and folded under *Good to know*. Only confirmed and likely findings count in *Ready for tonight?*, and only confirmed ones count as trouble in the headline of the first tab.

* **Keys.** Two modules that react to the same key with the same modifiers (Ctrl, Shift, Alt in any order) are *Likely*, because usually only the first handler that takes the key press gets it. Actions count only when both listen to the same event (key down or key up). A key that is only held down as a modifier (Shift, Ctrl, Alt, Meta) is never reported, because several modules listening to it is normal. A module that shares a key with Foundry itself is a *Note*, modules do that on purpose with a higher precedence. Foundry and the game system sharing keys are not reported at all. *Change keys* opens Foundry's key settings.
* **Declared conflicts.** A module can say in its manifest that it does not work together with another module or with a game system, optionally for a range of versions. If both are active and the version is inside that range, the finding is *Confirmed*.
* **Wrappers.** When the wrapper library is active, Update Guard listens to its public hooks from the first moment, because it loads before the other modules. Two modules that replace the same method completely are *Confirmed*: the library says either that the second registration failed or that an override was replaced. A module that replaces a method completely while another module changes it as well is a *Note*. Plain wraps of one method by several modules are normal and never reported. When the library itself notices that a wrapper does not pass the call on, or that a wrapped method was replaced without it, that is *Likely*, and when the library cannot tell who replaced it, the finding is a *Note* that says the owner is unknown. Without the wrapper library nothing of this is checked, and the window says so.
* **Sephral’s own modules.** They are made to cooperate, so a clash between them is never red or yellow, at most a note.

What is not checked, and why. Methods that modules replace without the wrapper library cannot be attributed to a module afterwards, and a single replaced method is no proof of a conflict, so Update Guard does not guess. The same goes for classes in `CONFIG` and for sheets registered as the default for the same type: once the last module has set them, nothing tells how many modules wanted them. Two wrapped methods are the same one only when the modules spell the target the same way, so a conflict can slip through when they do not.

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

### Deprecated calls

Modules that called Foundry functions marked as deprecated since the page loaded are listed with the number of calls, the first message and the version in which Foundry removes the function. A call that Foundry removes in the target version or earlier is marked, because that is the clearest sign of trouble. Foundry's compatibility mode set to silent hides these warnings, and the window says so. Every call is counted, also those Foundry logs only once and those a module has hidden with its own pattern.

### Before you update

The section *Before you update* on the second tab opens by itself as soon as the window shows that updates are available, and is there on demand otherwise.

* **Save the module list.** When Module Loadouts by Sephral is active, *Save module list as loadout* saves the active modules as a world loadout named `Update Guard <date> (Foundry <version>)`, so you can come back to exactly this list. It uses only the `saveCurrent` call of the API of Module Loadouts. A loadout of the same name is replaced, and nothing else of Module Loadouts is touched. *Open Module Loadouts* opens its manager. Without Module Loadouts the section says so, and the export below keeps the list of modules and versions.
* **Backup.** A reminder to back up what you cannot lose before you update. When Content Backup & Restore by Sephral is active, the reminder names it, says where its entry is (the context menu of scenes, actors, items and journals) and links its page. Otherwise it points at Foundry's own snapshot in the setup and at copying the Data folder.

### Export and checklist

*Save as JSON* and *Save as text* write one file with every installed module and version, its manifest address, the rating for the target, what does not fit, errors, deprecated calls and the recorded states. The checklist names the steps before an update, with Foundry's own button names.

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
| Errors of the players | World | The players' browsers report errors of modules to the GM. On by default |
| Notice for errors of the players | This device | A quiet notice for the GM when a player's browser reports a new error. On by default |
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
| `await api.ready()` | *Ready for tonight?* (GM). Opens the window, runs the test run, asks the players' browsers for their versions and returns `{at, answer, trialModules, playerModules, players, connected, fitProblems}`. `answer` has `level`, `key`, `count` and `next`. |
| `api.lastReady()` | The result of the last *Ready for tonight?*, or `null`. |
| `api.playerErrors()` | The errors the players' browsers reported (GM), newest first: `owner`, `userName`, `kind`, `message`, `where`, `stack`, `count`, `first`, `last`. |
| `await api.playerVersions({wait})` | Asks the connected players' browsers which versions they run and compares them with this browser. `wait` is the time to wait in milliseconds, 2500 by default. |
| `api.report(id, {kind, key})` | Opens *Report this problem* for a module (GM). `kind` is `module` or `system`, `key` names an error from `api.playerErrors()`. Sends nothing. |
| `api.reportText(id, {kind, key})` | The bug report text, the repository and the key words as data. Sends nothing. |
| `await api.saveModuleList()` | Saves the active modules as a loadout of Module Loadouts when that module is active (GM). Returns `{ok, name}`. |
| `api.snapshot()` | The current state: Foundry, system and modules with version, compatibility and manifest address. |
| `api.history()` | The recorded states, newest first. |
| `api.export()` | The export as plain data. |
| `api.conflicts()` | The modules that get in each other's way, read only (GM): `{findings, counts, wrapperLibrary}`. A finding has `kind`, `level` (`bad`, `warn`, `note`), `owners` (such as `module:id`) and `data`. |
| `api.watch()` | Errors and deprecated calls counted since the page loaded, by package. |
| `api.samples()` | The sample windows: the window with its three questions in every state, the search, *Ready for tonight?*, *Report this problem*, the questions and the export text, filled with made-up modules and results. Nothing in them runs a test run, switches a module off, starts a search, asks the network or is saved or counted. Sephral’s Translator lists them so translators see every text in its place |
| `await api.runSelfTest()` | The self test. |
| `api.saveDebugFile()` | The debug file. |

## Self test

*Run self test* in the module settings checks what Update Guard relies on: how Foundry names package data and availability, that its version comparison agrees with Foundry's, the stored history, the early watch for errors and the counter for deprecated calls, saving files, the module socket, the logic that cleans and counts the players' reports, the conflict finder with made up data and that it hears the wrapper library, the settings for them, that its own manifest names a GitHub repository, that the API of Module Loadouts has what the safety net uses when that module is active, and the texts it uses. The result comes as a notification and a chat message only you see, with the Foundry version the module was verified with. After a Foundry update you get a one time notice to run it.

## Debug file

For bug reports, the GM saves one file about all of Sephral’s modules in this world: `Save debug file` in the module settings, or `Save Debug File (Sephral’s Modules)` in the context menu of a chat message. For Update Guard it holds the Foundry and system version, the recorded states with their marks, the counts of errors and deprecated calls per package (no messages), for the errors of the players only how many there are per module and from how many players, how many conflicts of each level there are, and what the watch has installed.

The file contains chat text and whispers. Check it before you share it.

## Sephral’s Modules

The first button in the module settings, *Sephral’s Modules* (GMs only), opens one window for all of Sephral's modules in the world: the version, self test, settings, manual and demo video of each, a button that switches on an installed module that is off (Foundry then reloads the world for everyone), and the debug file. Below, *More from Sephral* lists other modules that fit the game system of the world, shown only after a click, each with its demo video and an *Install* button. Foundry installs modules only on its setup screen, so the button copies the module's link (manifest URL) and shows the steps with a short clip. When the GM launches the world again, the window opens once with the new module and its *Enable* button. The list is part of the module. Only a video you start is loaded, from the module page on GitHub. If the GM agreed to the usage statistics, the window also counts how it is used: opened, the other modules shown, a video or install link of one of them, a module installed or switched on from it. It never records which module.

## Usage statistics

The module can take part in a small usage report shared by all of Sephral’s modules. Nothing is counted or sent until the GM agrees: shortly after the world starts, the active GM is asked, and the question comes back at every start until there is an answer. The answer counts for all of Sephral’s modules in the world. *Share usage statistics* in the module settings turns the report on or off at any time, and *Manage statistics* below it shows what the report contains right now.

With the GM’s consent only the active GM’s browser counts, and it sends at most one report a day. The counts are kept in a hidden world setting, so all browsers and computers of the GM count together, and turning the statistics off deletes them. A copy of a world gets its own world ID. The question lists everything the report contains, from the Foundry version to a random world ID. For Update Guard it holds:

* on how many of the last 30 days the module was used
* how often the GM opens the window, how often it opens by itself after a change, runs a test run, runs *Ready for tonight?*, sees modules in each other's way (once per page load), opens the key settings from there, starts a search, finds a module, switches a module off, changes the target, looks for newer versions, saves an export, copies an older manifest address, opens *Report this problem*, looks for open issues, saves the module list as a loadout, and how many errors of players arrived (a number, no content)
* the settings *Look*, *After an update*, *Minutes without a module error*, *Errors of the players* and *Notice for errors of the players* (only the chosen option or number)
* where errors occur in the module code: file, line, error type and whether the error arose in the module itself, in Foundry, in the game system or in another module, never the error message or the name of another module

No names, notes, pictures or other content of the world are sent.
