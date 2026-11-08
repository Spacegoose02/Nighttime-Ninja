# Contributing

Thanks for helping the raccoon. Bug reports, ideas, translations and code are all welcome.

## Asking and reporting

- **Found a bug?** Open an issue with the bug template. Say what you did, what you expected and what happened, plus your version (Settings shows it) and how you run the app (Docker, Unraid, Android, Windows).
- **Have an idea?** Open an issue with the feature template, or start a thread in Discussions.
- **Found a security problem?** Please don't open an issue. See [SECURITY.md](SECURITY.md).

## Sending a change

1. Fork the repo and make a branch from `main`.
2. Set up as in [docs/development.md](docs/development.md) (Node.js 24 or newer, then `npm install`).
3. Make your change. Keep it focused on one thing.
4. Run the same checks CI runs:

   ```bash
   npm run lint
   npm run typecheck
   npm test
   npm run build
   npm run test:e2e   # needs: npx playwright install chromium
   ```

5. Open a pull request and fill in the template. Screenshots help for anything you can see.

Issues labelled **good first issue** are small and well-described, a good place to start.

## How the code is laid out

| Folder | What's in it |
| --- | --- |
| `server/src/` | Fastify API. `routes/` has one file per area (recipes, shopping, pantry...). `db.ts` holds the database migrations. |
| `web/src/pages/` | One React component per page. |
| `web/src/components/` | Shared pieces: dialogs, icons, timers, the barcode scanner. |
| `web/src/styles/` | Styles, split into tokens, themes, layout, components, pages and print. |
| `shared/` | Code both sides use: units, the recipe format and importers, the item catalog and icons. |
| `e2e/` | Playwright browser tests. |

## House rules for code

- **Database changes:** add a new entry to the end of `MIGRATIONS` in `server/src/db.ts`. Never edit one that has shipped.
- **Request bodies:** describe them with the helpers in `server/src/schemas.ts`.
- **Icons:** use `<Icon name="..." />` from `web/src/components/Icon.tsx` for buttons and navigation. Emoji are for food.
- **Colours and spacing:** use the variables in `web/src/styles/tokens.css` and `themes.css`, not hard-coded values.
- **Words on screen:** short, plain, friendly sentences. Error messages say what to do next.
- **Tests:** add or update a test for anything you fix or add. Server tests sit next to the code (`*.test.ts`); web tests use Vitest.
- **No secrets** in code, tests or screenshots.

## Releases

Maintainers tag releases (`git tag vX.Y.Z && git push --tags`). GitHub Actions builds the Docker image, the Windows app and the Android app. Release notes go in [CHANGELOG.md](CHANGELOG.md).

By contributing you agree that your work is released under the [MIT licence](LICENSE) and that you'll follow the [Code of Conduct](CODE_OF_CONDUCT.md).
