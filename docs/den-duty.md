---
title: Den Duty (chores)
nav_order: 7.5
---

# Den Duty: kids' grocery asks and kitchen chores

[Den Duty](https://github.com/Spacegoose02/den-duty) is the family's chore app. The two link both ways:

- **Groceries kids ask for** come from Den Duty into **Shopping → Requests** (set up in Den Duty with a Nighttime Ninja home API token).
- **Little helpers jobs** on a recipe go from here to Den Duty as chores, set up below.

## Ask a kid to help

1. In Den Duty, go to Settings, Home Assistant and API tokens, and make a **control** token (it needs to create chores). Note the home id shown there.
2. In Nighttime Ninja, a home manager opens **Settings → Home → Den Duty** and fills in Den Duty's address, the home id, the token and how many points a kitchen job is worth. Nighttime Ninja checks them with Den Duty before saving. The token is stored encrypted and never sent back to the browser.
3. On any recipe, pick an age under **Little helpers**. Each job gets an **Ask … to help** button for every Den Duty kid old enough for it (kids without a birthday in Den Duty get every job). Tapping it creates a one-off chore for today in Den Duty, titled with the recipe and the job, for the points you set.

Anyone in the home can use the buttons; only managers can link or unlink. Home API tokens (Home Assistant) can't create chores.

## The API

| Endpoint | Who | What |
| --- | --- | --- |
| `GET /api/homes/:homeId/denduty` | members | `{ linked, url, denHomeId, denHomeName, points }` |
| `PUT /api/homes/:homeId/denduty` | managers | `{ url, denHomeId, token?, points? }` checks with Den Duty and saves; `url: ""` unlinks; leaving out `token` keeps the saved one. |
| `GET /api/homes/:homeId/denduty/kids` | members | The linked home's kids: `[{ id, name, avatar, color, age }]` (empty when not linked). |
| `POST /api/homes/:homeId/denduty/chores` | people | `{ kidId, task, recipeId?, dueDate? (YYYY-MM-DD, default today), dueTime? (HH:MM), points? }` creates the chore with Den Duty's `POST /api/v1/homes/:homeId/chores` (schedule `once`). |
