---
title: Single sign-on (Tinyauth)
nav_order: 6.5
---

# Single sign-on with a reverse proxy (Tinyauth and friends)

Besides passwords, passkeys and Google, Nighttime Ninja can let your **reverse proxy** sign people in: Tinyauth, Authelia, Authentik's proxy outpost, oauth2-proxy and so on. The proxy checks who someone is and passes their username in a header. Nighttime Ninja trusts that header **only on requests that come straight from your proxy's address**.

| Variable | Default | Notes |
| --- | --- | --- |
| `FORWARD_AUTH_HEADER` | (off) | The username header. Tinyauth and Authelia use `Remote-User`. Setting this turns forward-auth on. |
| `FORWARD_AUTH_EMAIL_HEADER` | `Remote-Email` | Optional. Used to link an existing account with the same email. |
| `FORWARD_AUTH_NAME_HEADER` | `Remote-Name` | Optional. The display name for new accounts. |
| `FORWARD_AUTH_TRUSTED` | `private` | Addresses allowed to send the header: `private` (loopback, LAN and Docker networks), single IPs and IPv4 CIDRs, comma-separated, e.g. `172.18.0.0/16`. |

How it behaves:

- The header username is linked to an account the first time, or to an existing account with the same email (unless that account is already linked to a different proxy username). The very first account on a server is still the admin.
- New people get an account straight away, because the proxy already decided they may come in. They still create a home or join one with its code. Only `closed` sign-up stops new accounts.
- The address checked is the one the request really came from, not `X-Forwarded-For`, so nobody can pretend to be the proxy.
- The person is signed in on every request the proxy forwards, so **Sign out** in the app has no effect; sign out at your proxy.
- Nighttime Ninja's own two-factor isn't asked for; your proxy's login is the gate.
- Name-only quick sign-in can't be used to get into an account the proxy signs in.
- Tablets and apps that signed in with a session (pairing code, password) keep working, and so do home API tokens (Home Assistant, Den Duty, BookBandit). A request with a session or token never looks at the header.
- **Keep the container off the internet except through the proxy.** If you publish its port directly, set `FORWARD_AUTH_TRUSTED` to your proxy's exact address.

## One Tinyauth for Nighttime Ninja, Den Duty and BookBandit

If you run the family's apps together, one Tinyauth login can cover all three. Each app trusts Tinyauth's headers only from the Docker network Traefik is on.

```yaml
services:
  traefik:
    image: traefik:v3
    command:
      - --providers.docker=true
      - --entrypoints.websecure.address=:443
    ports: ["443:443"]
    volumes: ["/var/run/docker.sock:/var/run/docker.sock:ro"]
    networks: [proxy]

  tinyauth:
    image: ghcr.io/steveiliop56/tinyauth:v3
    environment:
      APP_URL: https://auth.example.com
      SECRET_FILE: /run/secrets/tinyauth   # 32 random characters
      USERS: mom:$$2a$$10$$…,dad:$$2a$$10$$…  # tinyauth user create --interactive
    labels:
      traefik.http.routers.tinyauth.rule: Host(`auth.example.com`)
      traefik.http.middlewares.tinyauth.forwardauth.address: http://tinyauth:3000/api/auth/traefik
      traefik.http.middlewares.tinyauth.forwardauth.authResponseHeaders: Remote-User,Remote-Email,Remote-Name
    networks: [proxy]

  nighttime-ninja:
    image: ghcr.io/spacegoose02/nighttime-ninja:latest
    environment:
      PUBLIC_URL: https://kitchen.example.com
      FORWARD_AUTH_HEADER: Remote-User
      FORWARD_AUTH_TRUSTED: 172.18.0.0/16      # the proxy network below
    labels:
      traefik.http.routers.kitchen.rule: Host(`kitchen.example.com`)
      traefik.http.routers.kitchen.middlewares: tinyauth
    networks: [proxy]

  den-duty:
    image: ghcr.io/spacegoose02/den-duty:latest
    environment:
      PUBLIC_URL: https://chores.example.com
      FORWARD_AUTH_HEADER: Remote-User
      FORWARD_AUTH_TRUSTED: 172.18.0.0/16
    labels:
      traefik.http.routers.chores.rule: Host(`chores.example.com`)
      traefik.http.routers.chores.middlewares: tinyauth
    networks: [proxy]

  bookbandit:
    image: ghcr.io/spacegoose02/bookbandit:latest
    environment:
      TRUSTED_PROXIES: 172.18.0.0/16           # BookBandit signs people in by email
      AUTH_HEADER_EMAIL: remote-email
    labels:
      traefik.http.routers.books.rule: Host(`books.example.com`)
      traefik.http.routers.books.middlewares: tinyauth
    networks: [proxy]

networks:
  proxy:
    ipam:
      config: [{ subnet: 172.18.0.0/16 }]
```

Things to know:

- **Give every Tinyauth user an email.** Nighttime Ninja and Den Duty go by the username (and use the email to find an account you already had); BookBandit goes by the email alone. With OAuth logins (Google, GitHub) in Tinyauth the email comes from the provider.
- **Set the same subnet in all three apps,** and pin it on the network as above so it doesn't change when Docker recreates it.
- **The apps talk to each other without the proxy.** Den Duty, Nighttime Ninja and BookBandit link with API tokens. Point each link at the other app's address on the Docker network (for example `http://nighttime-ninja:8080`), or make sure your proxy lets requests with an `Authorization: Bearer` header through to `/api/` without a Tinyauth login.
- **Phone and desktop apps** that can't do a browser login can still sign in with a pairing code; add a Traefik rule without the Tinyauth middleware for `/api/` if your apps can't get past it.
