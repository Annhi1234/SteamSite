# SteamSite

SteamSite is a small Node.js app that serves the game catalog and stores user accounts, sessions, carts, libraries, and categories in a JSON file.

## Run locally

Install Node.js 20 or newer, then run:

```powershell
npm start
```

Open [http://127.0.0.1:8767](http://127.0.0.1:8767). The first run creates `data/store.json` and a random `.app-secret`. Keep `.app-secret` private and backed up: changing or losing it makes existing email hashes and sessions unusable.

## Data and account security

- The public catalog, including UUIDs and Steam app IDs, is in `data/games.json`.
- Private account and game ownership data is stored in the ignored `data/store.json`.
- Email addresses are normalized and HMAC-hashed with `.app-secret`; they are not saved as plain text.
- Passwords use salted scrypt hashes. Session cookies contain random tokens; only their hashes are persisted.
- Existing browser-based accounts are not imported. Register again with the same email; the old library, categories, and cart are migrated after successful authentication.
- Do not commit `.app-secret` or `data/store.json`. This project does not connect to a payment provider: checkout is a local demo that moves cart games into the library.
- The game prices and discounts are a snapshot, not live Steam pricing, and may change.

The server binds to `127.0.0.1` by default. Do not expose it directly to the public internet; hosting requires HTTPS, secure secret management, and additional operational protections.

## Tests

```powershell
npm test
```
