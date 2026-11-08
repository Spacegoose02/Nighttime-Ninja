---
title: AI assistants (MCP)
nav_order: 8
---

# Use your kitchen from an AI assistant

Nighttime Ninja is a [Model Context Protocol](https://modelcontextprotocol.io) server, so an AI assistant such as Claude Desktop or Claude Code can look in your pantry, read your recipes and meal plan, and add things to your shopping list. Ask "what can I make tonight with what's in the fridge?" or "put everything for Thursday's dinner on the list".

## Set it up

1. In Nighttime Ninja, open **Settings → Home → API tokens** and make a token. Copy it; it's shown once.
2. Add a server to your assistant with this address and the token as a Bearer header:

   - Address: `https://your-kitchen.example.com/api/mcp`
   - Header: `Authorization: Bearer nnk_…`

   For Claude Code:

   ```bash
   claude mcp add --transport http nighttime-ninja https://your-kitchen.example.com/api/mcp --header "Authorization: Bearer nnk_your_token"
   ```

   For Claude Desktop and claude.ai, add it as a custom connector with the same address and header.

A token reaches one home, acts as a member (it can't change settings or members), and can be revoked in the same place.

## What it can do

| Tool | Does |
| --- | --- |
| `list_pantry` | What's in the pantry, fridge and freezer, with amounts and expiry dates |
| `get_shopping_list` | Everything still to buy, on every list |
| `add_to_shopping_list` | Adds lines like "2 lb chicken thighs" to the Main list |
| `search_recipes` | Finds recipes by title or tag |
| `get_recipe` | One recipe in full |
| `get_meal_plan` | What's planned for the coming days |

Changes show up on every open screen right away, the same as changes made in the app.
