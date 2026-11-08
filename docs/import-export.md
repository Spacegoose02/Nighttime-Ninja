---
title: Import and export
nav_order: 4
---

# Import and export

## Bringing recipes in

Open **Recipes → Import**.

| From | How |
| --- | --- |
| A recipe website | Paste the link. Anything with schema.org recipe data works, which is most big recipe sites. |
| Text, a web page, Markdown or JSON | Paste it or pick the file. |
| A photo of a cookbook page or a handwritten card | Needs [AI](ai.md). Up to 4 photos of one recipe. |
| **Mealie** | Settings → Data Management → Export in Mealie, then pick the .zip. |
| **Tandoor** | Export → Default format → all recipes in Tandoor, then pick the .zip. |
| **Paprika** | Select your recipes → Export → Paprika Recipe Format, then pick the .paprikarecipes file. |
| **KitchenOwl** | See [Moving from KitchenOwl](kitchenowl.md). It also brings over shopping lists and items. |

Photos come along. Recipes you already have (same name) are skipped, so it's safe to run an import again.

## Taking recipes out

In **Settings → Home → Backup**:

- **Download everything (JSON)**: the whole home (recipes, pantry, shopping lists, history, meal plan and feeds) in Nighttime Ninja's own format. Import it into another Nighttime Ninja server.
- **Recipes for another app (Paprika file)**: every recipe, with its photo, as a .paprikarecipes file. Paprika opens it, and Mealie and Tandoor can both import it.

The server also backs up its whole database every night. See [Backups](settings.md#backups).
