---
title: Settings
nav_order: 2
---

# Settings

All settings are environment variables. See [.env.example](https://github.com/Spacegoose02/Nighttime-Ninja/blob/main/.env.example).

| Variable | What it does |
| --- | --- |
| `PUBLIC_URL` | The address people use, e.g. `https://kitchen.example.com`. Needed for Google sign-in and calendar links. |
| `DATA_DIR` | Where the SQLite database and photos live (`/data` in Docker). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Turn on Google sign-in. See [docs/google-sign-in.md](google-sign-in.md). |
| `SIGNUP_MODE` | `invite` (default, needs a home join code), `open`, or `closed`. Admins can change it in Settings. |
| `LOCAL_LOGIN` | Name-only quick sign-in: `lan` (home network only), `off`, or `anywhere`. |
| `TRUST_PROXY` | Reverse proxies allowed to set X-Forwarded headers. Defaults to loopback and private networks. |
| `SESSION_SECRET` | Optional. Generated and saved in the data folder if empty. |
| `KROGER_CLIENT_ID`, `KROGER_CLIENT_SECRET` | Optional, free from [developer.kroger.com](https://developer.kroger.com). Turns on live prices and sale matching. |
| `ANTHROPIC_API_KEY` | Optional, from [console.anthropic.com](https://console.anthropic.com). Turns on every AI feature: Chef Gordy, the Mixologist (Rocco), Plan my week, recipe photos and video import, nutrition estimates and receipt scanning. `ANTHROPIC_MODEL` sets the default Claude model (`claude-opus-5-5`); admins can switch it in **Settings → Server admin**. Gordy and Rocco can also search the web (up to 3 searches a reply, billed to the same key, with sources listed under the reply); admins can turn that off in the same place. |
| `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY` | Optional. Use your own AI server (Ollama, LM Studio, llama.cpp, vLLM) instead of Claude. See [AI helpers](ai.md). |
| `AI_MESSAGES_PER_HOUR` | How many AI requests one person can send per hour, so a busy household can't run up the Claude bill. Default `30`; `0` turns the cap off. |
| `ALLOW_PRIVATE_FETCH` | Recipe import and feeds won't fetch links that point into your home network. Set to `true` if you import from your own LAN servers. |
| `TZ` | Your time zone, e.g. `America/Chicago`. Reminders go out at 9 am (food about to expire) and 5 pm (tomorrow's meals) in this zone. Phone and browser reminders also need the site on https. |

## Putting it on the internet

1. Put it behind a reverse proxy with HTTPS (Nginx Proxy Manager, SWAG, Caddy, Traefik or a Cloudflare Tunnel) and set `PUBLIC_URL` to the https address. Passkeys and Google sign-in need this.
2. Keep `SIGNUP_MODE=invite` so only people with one of your homes' join codes can make accounts.
3. Everyone should set a password and turn on two-factor or add a passkey in **Settings → Sign-in and security**. Quick sign-in keeps working at home but is refused from the internet. (The app tells home from internet by IP address, so always go through the reverse proxy. If you forward a port straight to the container, set `LOCAL_LOGIN=off`.)
4. If someone gets locked out, an admin can hand them a temporary password or clear their two-factor in **Settings → Server admin**.

## Backups

The server copies its database into `backups/` inside the data folder every night (the last 7 are kept) and before every upgrade (the last 3). Admins can make one by hand and download any of them in **Settings → Server admin → Backups**.

Photos are stored in `uploads/` in the same data folder. To keep everything, back up the whole data folder.

To restore, stop the server, replace `nighttime-ninja.db` in the data folder with the backup file, and start it again.
