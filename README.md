# Sephral’s Update Guard

**Is my world still working after the update? One click and half a minute later you know. If something broke, Update Guard finds the module behind it, and it tells you what is ready for the next Foundry and how to get back.**

[![Install by link](https://img.shields.io/badge/Foundry%20VTT-Install%20by%20link-fe6a1f?logo=foundryvirtualtabletop&logoColor=white)](#install)
[![Join Discord](https://img.shields.io/badge/Discord-Join%20the%20community-5865F2?logo=discord&logoColor=white)](https://discord.gg/7BjCgDYaBP)
[![More modules by Sephral](https://img.shields.io/badge/GitHub-More%20modules%20by%20Sephral-181717?logo=github&logoColor=white)](https://github.com/Sephral)

![Update Guard demo](media/demo.gif)

## Highlights

* **Test run:** one click opens what a game night opens, sheets, journal, chat cards, scene tools, settings, and closes it again. You see which module threw an error and where, before your players do. Your world is not changed.
* **Find the module:** something does not work and no error says why? Update Guard suspects what changed since the last good state first, switches modules off, you say whether the problem is gone. After a few rounds the module is known and everything is as it was.
* **Three questions, three answers:** Is everything working? Can I update? How do I get back? The answer stands on each tab, with the next step right below it.
* **Can I update?** Pick a Foundry version and see in one sentence what stands in the way: modules that will not run, modules that need an update first, modules that call functions Foundry removes. Everything that is fine stays folded away.
* **Newer versions on your click:** asks the public package list of The Forge what is new. The window tells you what is sent, and nothing leaves your browser before you click.
* **What changed:** at the next start you see Foundry, the system and every module that changed, each with a link to its changelog.
* **The way back:** the last state that worked, every version that differs from it, the address of the older manifest and the steps in Foundry's setup.

## How it works

1. Enable the module.
2. After an update the window opens by itself. Click *Start test run*.
3. All good? Play. Something wrong? Switch the module off or let the search find it.

## Good to know

Update Guard runs only in a started world and cannot install or roll back anything, because Foundry does that on its setup screen. It shows the way and gives you the addresses. Verified means what the author wrote into the manifest, it is no promise that nothing breaks. Only the GM sees the windows.

## Install

Update Guard is not in Foundry's module search. Copy this link:

```text
https://github.com/Sephral/sephrals-update-guard/releases/latest/download/module.json
```

1. In Foundry's setup screen open **Add-on Modules** and click **Install Module**.
2. Paste the link into **Manifest URL** at the bottom of the window.
3. Click **Install**, then enable the module in your world.

On The Forge open the Bazaar, click **Install From Manifest** and paste the link.

![How to install a module by its link](https://raw.githubusercontent.com/Sephral/Sephral/main/media/install.gif)

Foundry VTT 13 and 14 · any game system · English and German

## Learn more

What each rating means, what the online check sends and every setting are explained in the [manual](MANUAL.md). Questions or ideas? Join us on [Discord](https://discord.gg/7BjCgDYaBP). Looking for more? See [all modules by Sephral](https://github.com/Sephral).

## License

See [LICENSE.md](LICENSE.md).
