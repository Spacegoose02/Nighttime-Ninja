# Google sign-in

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

The meal plan is published as a private calendar link. In **Settings → Home**, copy the calendar link, then in Google Calendar choose **Other calendars → ＋ → From URL**. Google refreshes subscribed calendars every few hours. **Reset link** turns off the old address if it ever leaks.
