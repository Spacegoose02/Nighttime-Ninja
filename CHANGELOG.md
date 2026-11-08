# Changelog

Every release, newest first. The full notes for each one are on its [GitHub release page](https://github.com/Spacegoose02/Nighttime-Ninja/releases).

## 0.16.0 - unreleased

Cooking as a household: prep the week in one go, give the kids a job, and keep the plan in Google Calendar both ways.

- **Prep sessions:** Meal plan → 🔪 Prep session. Gordy turns the week's planned recipes into one batch-prep list that does shared work once (all the onions at once, grains in one pot), says how to store each thing, and lists what to leave for the day. Tick steps off as you go. Needs AI.
- **Little helpers:** every recipe suggests jobs kids can do on it, for ages 3, 5, 8 and 11 and up. It works from the recipe itself, with no AI needed.
- **Two-way Google Calendar sync:** a home manager connects Google Calendar in Settings → Home. Meals become events in a calendar of their own; moving or deleting an event changes the plan, and events added there join it. Needs Google set up (see docs/google-sign-in.md), with the Calendar API turned on.

## 0.15.0 - unreleased

Less waste, more help: photograph the fridge to update the pantry, see what gets thrown out, make recipes your own, and let an AI assistant use your kitchen.

- **Stock-take from photos:** Pantry → Stock-take. Snap the fridge, freezer or a cupboard, check the list, and the pantry updates. Needs AI.
- **Food waste log:** "Thrown out" on any pantry item, and Pantry → History shows what went in the bin this month and roughly what it cost.
- **Make it my way:** save your own version of any recipe, linked to the original. Each shows the other.
- **AI assistants (MCP):** Claude Desktop, Claude Code and other MCP clients can check the pantry, read recipes and the meal plan, and add to the shopping list with a home API token. See docs/mcp.md.
- **Send the list:** share the shopping list to a message, a note or a grocery app, or copy it.
- **Plan my week** leans on what's in season.

## 0.14.0 - unreleased

Open to other apps and other AI: move recipes in and out of Mealie, Tandoor and Paprika, run the AI helpers on your own computer, and see what the AI costs.

- **Import from Mealie, Tandoor and Paprika**, photos included, in Recipes → Import.
- **Export a Paprika file** of every recipe (Settings → Home → Backup). Paprika opens it, and Mealie and Tandoor can import it.
- **Your own AI server:** set `AI_BASE_URL` and `AI_MODEL` to use Ollama, LM Studio, llama.cpp or any OpenAI-compatible server instead of Claude.
- **What the AI costs:** Settings → Server admin shows this month's AI requests and estimated cost by model.
- **Smaller photos:** recipe photos are saved as WebP.
- **Documentation site** at spacegoose02.github.io/Nighttime-Ninja, built from the `docs` folder, with new pages on AI helpers and import and export.
- For contributors: a bundle size budget runs in CI (`npm run budget`).

## 0.13.0 - unreleased

Works for more people: more languages, more countries, bigger text and checked accessibility.

- **Español:** pick a language in Settings → On this device. The main screens are translated, and more languages are easy to add (see CONTRIBUTING).
- **Set up in three steps:** a new home asks where your kitchen is (which sets its currency and measurements), your language, and how you'd like to start.
- **Any currency:** prices, spending and recipe costs show in the home's currency. Change it in Settings → Home.
- **Bigger text and an easy-to-read font** (Atkinson Hyperlegible) in Settings → On this device.
- **High contrast theme.**
- Accessibility is now checked automatically on every change, for every page and every theme. Fixed low-contrast status pills, an unlabeled checkbox and the shopping list tabs for screen readers.

## 0.12.0 - unreleased

Faster everyday use: dinner ideas on Home, one search for everything, and what recipes cost.

- **Tonight on Home:** tonight's planned recipe one tap away, or three ideas you can make now, starting with ones that use up food about to expire. "Tonight" plans it.
- **Search everything (Ctrl+K, or Search in the menu):** pages, recipes, pantry items and settings, plus "add … to the shopping list" and "ask Gordy …".
- **Swipe shopping items** right to check them off, left to remove them (on touch screens).
- **What it costs:** recipes show their cost and cost per serving from what you last paid, and the meal plan shows the week's total.
- **Settings** has a search box and You / Home / Kitchen / Server admin sections.
- **Hide pages** a home doesn't use (Meal Plan, Gordy, Mixologist, Deals, Feed) in Settings → Home.
- On a tablet, a recipe's ingredients stay in view while you scroll the steps.

## 0.11.0 - unreleased

A calmer, more consistent look, a tidier shopping list, and automatic backups.

- **Backups:** the database is copied every night and before every upgrade. Download them in Settings → Server admin.
- **New look for buttons and navigation:** one set of line icons that looks the same on every device. Food keeps its emoji.
- **Shopping list, items first:** list tools, aisle order, print and "put checked items in the pantry" moved into one ⋯ menu. The quick-add box stays at the top as you scroll. Removing an item has Undo, and "1 milk" now reads "milk".
- **Recipe covers:** recipes without a photo get a dish picture and colour of their own, and the recipe page has an Add a photo button.
- **Match my device theme:** Forest in light mode, Midnight in dark mode.
- Checkboxes and toggles follow your theme colour.
- The health check reports the running version.
- For contributors: CONTRIBUTING, Code of Conduct, Security policy, issue and pull request templates, this changelog, and docs split into `docs/`.

## [0.10.0](https://github.com/Spacegoose02/Nighttime-Ninja/releases/tag/v0.10.0) - 2026-11-01

Tell the app what kitchen gear you have, pick from many more pantry icons, and Gordy and Rocco now ask before saving a recipe.

## [0.9.0](https://github.com/Spacegoose02/Nighttime-Ninja/releases/tag/v0.9.0) - 2026-11-01

Gordy and Rocco can now look things up on the web, and saving recipes from their chats works again on the newest Claude models.

## [0.8.0](https://github.com/Spacegoose02/Nighttime-Ninja/releases/tag/v0.8.0) - 2026-10-31

Multiple shopping lists. Keep a Main list for the weekly shop, plus as many others as you like, such as Quick trip or Long term.

## [0.7.2](https://github.com/Spacegoose02/Nighttime-Ninja/releases/tag/v0.7.2) - 2026-10-31

Going back to a list now puts you right where you were.

## [0.7.1](https://github.com/Spacegoose02/Nighttime-Ninja/releases/tag/v0.7.1) - 2026-10-31

Bug fixes from a full bug hunt after 0.7.0, plus camera barcode scanning in the Windows app.

## [0.7.0](https://github.com/Spacegoose02/Nighttime-Ninja/releases/tag/v0.7.0) - 2026-10-31

The biggest update yet: 23 new kitchen features, a faster and more reliable app that keeps working offline, and a security and quality pass under the hood.

## [0.6.1](https://github.com/Spacegoose02/Nighttime-Ninja/releases/tag/v0.6.1) - 2026-10-30

## [0.6.0](https://github.com/Spacegoose02/Nighttime-Ninja/releases/tag/v0.6.0) - 2026-10-30

## [0.5.1](https://github.com/Spacegoose02/Nighttime-Ninja/releases/tag/v0.5.1) - 2026-10-30

## [0.5.0](https://github.com/Spacegoose02/Nighttime-Ninja/releases/tag/v0.5.0) - 2026-10-26

## [0.4.4](https://github.com/Spacegoose02/Nighttime-Ninja/releases/tag/v0.4.4) - 2026-10-25

## [0.4.3](https://github.com/Spacegoose02/Nighttime-Ninja/releases/tag/v0.4.3) - 2026-10-25

## [0.4.2](https://github.com/Spacegoose02/Nighttime-Ninja/releases/tag/v0.4.2) - 2026-10-25

## [0.4.1](https://github.com/Spacegoose02/Nighttime-Ninja/releases/tag/v0.4.1) - 2026-10-25

## [0.4.0](https://github.com/Spacegoose02/Nighttime-Ninja/releases/tag/v0.4.0) - 2026-10-25

## [0.3.3](https://github.com/Spacegoose02/Nighttime-Ninja/releases/tag/v0.3.3) - 2026-10-23

## [0.3.2](https://github.com/Spacegoose02/Nighttime-Ninja/releases/tag/v0.3.2) - 2026-10-23

## [0.3.1](https://github.com/Spacegoose02/Nighttime-Ninja/releases/tag/v0.3.1) - 2026-10-23

## [0.3.0](https://github.com/Spacegoose02/Nighttime-Ninja/releases/tag/v0.3.0) - 2026-10-23

## [0.2.6](https://github.com/Spacegoose02/Nighttime-Ninja/releases/tag/v0.2.6) - 2026-10-23

## [0.2.5](https://github.com/Spacegoose02/Nighttime-Ninja/releases/tag/v0.2.5) - 2026-10-18

## [0.2.4](https://github.com/Spacegoose02/Nighttime-Ninja/releases/tag/v0.2.4) - 2026-10-18

## [0.2.3](https://github.com/Spacegoose02/Nighttime-Ninja/releases/tag/v0.2.3) - 2026-10-17

## [0.2.2](https://github.com/Spacegoose02/Nighttime-Ninja/releases/tag/v0.2.2) - 2026-10-17

## [0.2.1](https://github.com/Spacegoose02/Nighttime-Ninja/releases/tag/v0.2.1) - 2026-10-17

## [0.2.0](https://github.com/Spacegoose02/Nighttime-Ninja/releases/tag/v0.2.0) - 2026-10-17

## [0.1.1](https://github.com/Spacegoose02/Nighttime-Ninja/releases/tag/v0.1.1) - 2026-10-17

## [0.1.0](https://github.com/Spacegoose02/Nighttime-Ninja/releases/tag/v0.1.0) - 2026-10-17
