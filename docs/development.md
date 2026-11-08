---
title: Development
nav_order: 9
---

# Development

Requires Node.js 24 or newer.

```bash
npm install
npm run dev:server   # API on http://localhost:8080
npm run dev:web      # app on http://localhost:5173 (proxies /api)
npm test
npm run typecheck
```

| Folder | What's in it |
| --- | --- |
| `server/` | Fastify API using Node's built-in SQLite. TypeScript runs directly on Node 24, no build step. |
| `web/` | React + Vite app, plus the Capacitor Android config. |
| `shared/` | Unit conversion, the standard recipe format and importers, item icons. Used by both. |
| `apps/launcher/` | The “pick your server” page used by the Android and Windows apps. |
| `apps/desktop/` | Electron wrapper for the Windows EXE. |
| `unraid/` | Unraid Community Applications template. |

Building the apps yourself:

```bash
npm run dist --workspace apps/desktop          # Windows installer + portable EXE in apps/desktop/release
cd web && npx cap add android && npx cap open android   # then Build → Build APK in Android Studio
```

Tagging a release (`git tag v0.1.0 && git push --tags`) builds the Docker image, the EXE and the APK in GitHub Actions.

To publish a signed Android release instead of a debug build, add four repository secrets: `ANDROID_KEYSTORE_BASE64` (your `.jks` file, base64-encoded), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`. Keep the keystore safe: every future update has to be signed with the same key. Phones that installed an older debug-signed APK need to uninstall it once before installing the signed one.

See [CONTRIBUTING.md](https://github.com/Spacegoose02/Nighttime-Ninja/blob/main/CONTRIBUTING.md) for how to send a change.
