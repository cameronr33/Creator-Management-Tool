# Isolated local preview

Use this preview to work on the real app without a Neon branch or production
credentials. It runs PostgreSQL through PGlite, the app's unchanged Neon HTTP
driver, and five fictional HELLA creator records. This is a development and
verification environment; it does not connect Gmail, Apify, or Anthropic.

## Start it

After `npm install`, open two terminals in the repository:

```sh
# Terminal 1: keep the synthetic database running.
npm run preview:db

# Terminal 2: start the real app against that database.
npm run preview
```

Open **http://localhost:3003**. Sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`
from `.local-preview/settings.json`. The first preview command generates that
ignored file with fresh local credentials. It never reads credentials from
`.env.local`. The Next process can discover `.env.local`, but every variable in
the example env file has already been set to an isolated value or empty string.

The database listens only on `127.0.0.1:5544`; the app listens only on
`127.0.0.1:3003`. Your regular port 3002 server and `.next` output remain separate.
Stop each terminal with Ctrl+C. Records persist in `.local-preview/pgdata`.
Preview login uses separate session, callback and CSRF cookie names so signing
in on port 3003 does not overwrite the normal localhost app's login.
Do not run two database processes against that directory; startup reserves its
port before opening the database and rejects an existing listener.

## Verify changes

Keep the preview database running, then run:

```sh
# Boundary checks, existing DB feature checks, new workspace checks, and invariants.
npm run preview:verify

# Just the requested verification script, plus isolation boundary checks.
npm run preview:verify -- scripts/verify-workspace.ts

# Compile a real production build using synthetic database configuration.
# The build is written to .local-preview/build; it is never served by preview.
npm run preview:build
```

Verification scripts create and clean up their normal `__verify_` rows against
the local database. The final invariant check verifies that they left none
behind. Import fidelity (`npm run verify:import`) is separate because it requires
the original HELLA CSV files on the developer's machine.

Use a current Node release supported by the app. On Windows, Node 24.14 can crash
inside libuv at process exit after otherwise successful Gmail assertions;
Node 24.19 was verified to exit cleanly. To use another installed Node executable
for preview children, set `CREATOR_PREVIEW_NODE` to its absolute path, or invoke
`node scripts/preview/run.mjs verify` with that executable directly.

## Isolation boundaries

- Only the hard-coded local preview database URL is accepted by both the Node
  preload and the HTTP bridge. There is no remote-database fallback.
- Server-side `fetch` requests to external hosts fail. Optional integration
  credentials are blank, so real fetch/research/sync actions cannot run here.
  HTTP redirects are rejected, including redirects from permitted local URLs.
- Fresh auth, cron and encryption secrets stay in ignored local storage.
- The launcher permits only the preview commands and existing
  `scripts/verify-*.ts` files. It does not accept arbitrary Node commands.
- `next start` refuses `CREATOR_LOCAL_PREVIEW=1`. Preview builds are for the
  build gate; the synthetic environment is never served in production mode.
- Browser links to external social profiles are ordinary external links.
  Next's font compiler may download the actual Inter font during compilation.
  Those asset downloads are not mocked and contain no creator data.

This checks application behavior against real PostgreSQL semantics. It does not
verify Neon infrastructure, Google OAuth, Apify responses, provider quotas, or
production concurrency. Test those integrations separately on an authorized
isolated environment before rollout.

To reset, stop the preview app and database, then remove only this repository's
`.local-preview/pgdata` directory. Keep `settings.json` to retain your login;
the next `preview:db` run recreates the synthetic fixtures.
