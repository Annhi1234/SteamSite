# SteamSite

SteamSite is a small Node.js app. Locally it stores user accounts, sessions,
carts, libraries, and categories in a JSON file; on Vercel it uses Neon Postgres.

## Run locally

Install Node.js 20 or newer, then run:

```powershell
npm start
```

Open [http://127.0.0.1:8767](http://127.0.0.1:8767). The first run creates `data/store.json` and a random `.app-secret`. Keep `.app-secret` private and backed up: changing or losing it makes existing email hashes and sessions unusable.

## Deploy to Vercel

Use the **Other** framework preset. Vercel serves the static site and deploys
`api/[...path].js` as a Node.js Function. Create a Neon Postgres database, then
add these environment variables to the Vercel project for each environment:

- `DATABASE_URL`: the Neon connection string.
- `STEAMSITE_APP_SECRET`: a private base64-encoded key generated with
  `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`.

The database table is created automatically on the first API request. Redeploy
after adding or changing environment variables. Do not use the local JSON store
as Vercel persistence; Vercel function files are not durable storage.

Existing local accounts in `data/store.json` are not copied to Neon automatically.

## Data and account security

- The public catalog, including UUIDs and Steam app IDs, is in `data/games.json`.
- Private account and game ownership data is stored in the ignored `data/store.json` locally or in Neon on Vercel.
- Email addresses are normalized and HMAC-hashed with `.app-secret` locally or `STEAMSITE_APP_SECRET` on Vercel; they are not saved as plain text.
- Passwords use salted scrypt hashes. Session cookies contain random tokens; only their hashes are persisted.
- Existing browser-based accounts are not imported. Register again with the same email; the old library, categories, and cart are migrated after successful authentication.
- Do not commit `.app-secret` or `data/store.json`. This project does not connect to a payment provider: checkout is a local demo that moves cart games into the library.
- The game prices and discounts are a snapshot, not live Steam pricing, and may change.

The local server binds to `127.0.0.1` by default. For Vercel, configure the
database and secret environment variables described above.

## Tests

```powershell
npm test
```
