---
title: Google sign-in and Calendar
nav_order: 6
---

# Google sign-in and Calendar

1. Go to the [Google Cloud console credentials page](https://console.cloud.google.com/apis/credentials) and create a project if you don't have one.
2. Set up the **OAuth consent screen**: user type **External**, app name “Nighttime Ninja”, and add the people who'll use it as test users (or publish the app).
3. **Create credentials → OAuth client ID → Web application**.
4. Under **Authorized redirect URIs** add `PUBLIC_URL/api/auth/google/callback`, for example `https://kitchen.example.com/api/auth/google/callback`.
5. Put the client ID and secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` and restart.

Google only allows `https://` redirect addresses, or `http://localhost`. If you reach the server by a plain LAN address like `http://192.168.1.20:8080`, put it behind a reverse proxy with HTTPS (Nginx Proxy Manager, SWAG, Caddy, Cloudflare Tunnel or Tailscale all work), or keep using local sign-in on your home network.

Once Google is set up, name-only sign-in turns off unless you set `ALLOW_LOCAL_LOGIN=true`.

## Tablets and the apps

Google blocks sign-in inside embedded app browsers. On a tablet or in the Android/Windows app, sign in with a **pairing code** instead: on a device that's already signed in, open **Settings → Pair a device**, then choose **I have a pairing code** on the tablet.

## Google Calendar

There are two ways to see the meal plan in Google Calendar.

### Two-way sync

With Google set up (the steps above), a home manager can connect Google Calendar in **Settings → Home → Google Calendar**. Nighttime Ninja makes a calendar of its own called "*Home name* meals" and keeps it in step with the plan:

- Every meal from a week ago to two months ahead is an event. Breakfast is at 8:00, lunch at 12:00, a snack at 15:00 and dinner at 18:00, in the server's time zone (`TZ`).
- Move an event to another day or time and the meal moves. The time picks the meal: before 11:00 is breakfast, before 15:00 lunch, before 17:00 a snack, and later is dinner. All-day events count as dinner.
- Delete an event and the meal comes off the plan. Take a meal off the plan and its event goes.
- Add an event to that calendar ("Pizza night" on Friday at 7pm) and it joins the plan as a meal.
- Rename a meal that isn't from the recipe book by renaming its event.

Changes go out a few seconds after the plan changes, and Google's changes come in every 15 minutes, or straight away with **Sync now**.

It only asks Google for permission to manage the calendars it creates, so it can't see or change your other calendars. **Disconnect** stops syncing and tells Google to forget the permission; the calendar stays in Google with what it had, and you can delete it there.

Setting it up needs two extra steps in the Google Cloud console, in the same project as Google sign-in:

1. **APIs & Services → Library**: turn on the **Google Calendar API**.
2. In your OAuth client, add a second **Authorized redirect URI**: `PUBLIC_URL/api/gcal/callback`, for example `https://kitchen.example.com/api/gcal/callback`.

If the OAuth consent screen is in testing, add the calendar permission (`.../auth/calendar.app.created`) under **Data access**, and make sure whoever connects is a test user. Google ends a testing app's permissions after 7 days; publish the app so the connection lasts.

### A calendar link (one way)

The meal plan is also published as a private calendar link, which works without setting up Google. In **Settings → Home**, copy the calendar link, then in Google Calendar choose **Other calendars → ＋ → From URL**. Google refreshes subscribed calendars every few hours. **Reset link** turns off the old address if it ever leaks.
