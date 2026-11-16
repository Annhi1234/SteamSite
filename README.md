# SteamSite

SteamSite is a small Node.js app. Locally it stores user accounts, sessions,
carts, libraries, and categories in a JSON file; on Vercel it uses Neon Postgres.

## Run locally

Install Node.js 20 or newer, then run:

```powershell
npm start
```

Open [http://127.0.0.1:8767](http://127.0.0.1:8767). Copy `.env.example` to `.env`
if you want real confirmation emails (see [BREVO.md](BREVO.md)); without it the
confirmation link is printed in the server log. The first run creates
`data/store.json` and a random `.app-secret`. Keep `.app-secret` private and
backed up: changing or losing it makes existing email hashes and sessions
unusable.

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

### Email confirmation (Brevo)

New accounts get a confirmation email through Brevo's transactional API and
must confirm the address before they can sign in. Configuration:

- `BREVO_API_KEY`: API key from Brevo → **SMTP & API** → **API Keys**.
- `BREVO_SENDER_EMAIL`: a sender address verified in Brevo → **Senders & IP** →
  **Senders**.
- `BREVO_SENDER_NAME` (optional): display name, defaults to `SteamSite`.
- `PUBLIC_BASE_URL` (optional): public site URL used in confirmation links. When
  it is missing the request host is used, which is correct for Vercel.

Put them in `.env` for local runs (see `.env.example`, the file is git-ignored)
or add them as Vercel environment variables and redeploy.

Without `BREVO_API_KEY` and `BREVO_SENDER_EMAIL` the app keeps working: no email
is sent, but the confirmation link is printed to the server log and written to
`data/outbox/*.json`, so the whole flow can be tested offline.

Step-by-step instructions for creating the Brevo account, sender and API key are
in [BREVO.md](BREVO.md).

The confirmation letter itself (subject, HTML layout, button, fallback link and
the plain-text twin) is built in `api/_lib/email.js` and sent as `htmlContent`,
so no template has to be created in the Brevo dashboard. Useful commands:

```powershell
npm run email:preview            # writes email-preview/verification.html
npm run email:test -- you@mail   # sends a real test letter through Brevo
```

Existing local accounts in `data/store.json` are not copied to Neon automatically.

## Data and account security

- The public catalog, including UUIDs and Steam app IDs, is in `data/games.json`.
- Private account and game ownership data is stored in the ignored `data/store.json` locally or in Neon on Vercel.
- Email addresses are normalized and HMAC-hashed with `.app-secret` locally or `STEAMSITE_APP_SECRET` on Vercel; they are not saved as plain text. Until an address is confirmed, an AES-GCM-encrypted copy is kept so the confirmation email can be resent; it is deleted as soon as the address is confirmed.
- Confirmation and "waiting" tokens are random, stored only as HMAC hashes, and expire after 24 hours (waiting token: 30 minutes).
- Accounts must confirm their email before signing in. Accounts created before this feature stay usable.
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
