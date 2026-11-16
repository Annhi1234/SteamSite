"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");

const root = path.resolve(__dirname, "..");
let dataDirectory;
let serverProcess;
let baseUrl;
let cookie;

async function findAvailablePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  return port;
}

async function waitForServer() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error("The test server exited before becoming ready.");
    }
    try {
      const response = await fetch(`${baseUrl}/api/games`);
      if (response.ok) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("The test server did not start in time.");
}

async function request(pathname, { method = "GET", body, origin } = {}) {
  const headers = {};
  if (cookie) {
    headers.Cookie = cookie;
  }
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (origin) {
    headers.Origin = origin;
  }
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const result = await response.json();
  return { response, result };
}

async function latestVerificationEmail(email) {
  const directory = path.join(dataDirectory, "outbox");
  const files = (await fs.readdir(directory)).sort();
  for (let index = files.length - 1; index >= 0; index -= 1) {
    const entry = JSON.parse(
      await fs.readFile(path.join(directory, files[index]), "utf8")
    );
    if (entry.type === "verification" && entry.to === email) {
      return entry;
    }
  }
  throw new Error(`No verification email for ${email} was written to the outbox.`);
}

async function verifyAccount(email) {
  const message = await latestVerificationEmail(email);
  assert.match(message.link, /\/verify\.html\?token=/);
  const token = new URL(message.link).searchParams.get("token");
  const response = await request("/api/verify", {
    method: "POST",
    body: { token }
  });
  assert.equal(response.response.status, 200);
  assert.equal(response.result.ok, true);
  assert.match(response.response.headers.get("set-cookie"), /HttpOnly/);
  return response.response.headers.get("set-cookie").split(";")[0];
}

async function registerVerifiedAccount(email, password) {
  const registration = await request("/api/register", {
    method: "POST",
    body: { email, password }
  });
  assert.equal(registration.response.status, 201);
  return verifyAccount(email.toLowerCase());
}

before(async () => {
  dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "steamsite-test-"));
  const port = await findAvailablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  const childEnvironment = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    STEAMSITE_APP_SECRET: crypto.randomBytes(32).toString("base64"),
    STEAMSITE_DATA_DIR: dataDirectory,
    STEAMSITE_SKIP_ENV_FILE: "1"
  };
  delete childEnvironment.BREVO_API_KEY;
  delete childEnvironment.BREVO_SENDER_EMAIL;
  delete childEnvironment.PUBLIC_BASE_URL;
  serverProcess = spawn(
    process.execPath,
    [path.join(root, "api", "_lib", "server.js")],
    {
      cwd: root,
      env: childEnvironment,
      stdio: ["ignore", "ignore", "pipe"]
    }
  );
  let serverError = "";
  serverProcess.stderr.on("data", (chunk) => {
    serverError += chunk.toString();
  });
  serverProcess.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(serverError);
    }
  });
  await waitForServer();
});

after(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill();
    await new Promise((resolve) => serverProcess.once("exit", resolve));
  }
  if (dataDirectory) {
    await fs.rm(dataDirectory, { recursive: true, force: true });
  }
});

test("JSON API authenticates users and manages libraries, categories, and sale carts", async () => {
  const { response: catalogResponse, result: catalogResult } =
    await request("/api/games");
  assert.equal(catalogResponse.status, 200);
  assert.equal(catalogResult.games.length, 18);
  const saleGames = catalogResult.games.filter(
    (game) => game.discountPercent > 0
  );
  assert.equal(saleGames.length, 10);
  assert.equal(
    saleGames.find((game) => game.steamAppId === "227300").salePrice,
    100
  );
  assert.equal((await request("/server.js")).response.status, 404);
  assert.equal((await request("/data/games.json")).response.status, 404);
  assert.equal((await fetch(`${baseUrl}/verify.html`)).status, 200);
  assert.equal((await fetch(`${baseUrl}/verify.js`)).status, 200);

  const guestLibrary = await request("/api/library");
  assert.equal(guestLibrary.response.status, 401);

  const account = await request("/api/register", {
    method: "POST",
    body: { email: "Player@example.com", password: "example-pass-123" }
  });
  assert.equal(account.response.status, 201);
  assert.equal(account.response.headers.get("set-cookie"), null);
  assert.equal(account.result.user.emailVerified, false);
  assert.ok(account.result.waitToken);
  assert.ok(account.result.verification.sent === false);

  const storeFile = path.join(dataDirectory, "store.json");
  let storeText = await fs.readFile(storeFile, "utf8");
  assert.equal(storeText.includes("Player@example.com"), false);
  assert.equal(storeText.includes("player@example.com"), false);
  assert.equal(storeText.includes("example-pass-123"), false);

  const unverifiedLogin = await request("/api/login", {
    method: "POST",
    body: { email: "player@example.com", password: "example-pass-123" }
  });
  assert.equal(unverifiedLogin.response.status, 403);
  assert.equal(unverifiedLogin.result.code, "email_not_verified");

  const unchangedLibrary = await request("/api/library");
  assert.equal(unchangedLibrary.response.status, 401);

  cookie = await verifyAccount("player@example.com");
  const verifiedLibrary = await request("/api/library");
  assert.equal(verifiedLibrary.response.status, 200);
  storeText = await fs.readFile(storeFile, "utf8");
  assert.equal(storeText.includes("pendingEmail"), false);

  const migration = await request("/api/migrate/legacy", {
    method: "POST",
    body: {
      library: {
        categories: [{ id: "local-favorites", name: "Улюблені" }],
        games: [
          {
            id: "730",
            categoryId: "local-favorites",
            favorite: true,
            lastPlayedAt: 123
          }
        ]
      },
      cart: []
    }
  });
  assert.equal(migration.response.status, 200);
  assert.equal(migration.result.libraryAdded, 1);

  let library = await request("/api/library");
  const counterStrike = library.result.games.find(
    (game) => game.id === "d8c70fe2-f11d-47cf-a134-41d092947587"
  );
  assert.ok(counterStrike);
  assert.equal(counterStrike.favorite, true);
  assert.match(counterStrike.categoryId, /^[0-9a-f-]{36}$/i);
  assert.equal(counterStrike.steamAppId, "730");
  assert.ok(counterStrike.addedAt > 0);
  assert.ok(Array.isArray(counterStrike.minimum));
  assert.ok(Array.isArray(counterStrike.recommended));

  const createdCategory = await request("/api/categories", {
    method: "POST",
    body: { name: "Перевірка" }
  });
  assert.equal(createdCategory.response.status, 201);
  const categoryId = createdCategory.result.category.id;
  const assigned = await request(`/api/library/games/${counterStrike.id}`, {
    method: "PATCH",
    body: { categoryId }
  });
  assert.equal(assigned.response.status, 200);
  const deletedCategory = await request(`/api/categories/${categoryId}`, {
    method: "DELETE"
  });
  assert.equal(deletedCategory.response.status, 200);
  library = await request("/api/library");
  assert.equal(
    library.result.games.find((game) => game.id === counterStrike.id).categoryId,
    null
  );
  const playedAt = Date.now();
  const markedPlayed = await request(`/api/library/games/${counterStrike.id}`, {
    method: "PATCH",
    body: { lastPlayedAt: playedAt }
  });
  assert.equal(markedPlayed.response.status, 200);
  library = await request("/api/library");
  assert.equal(
    library.result.games.find((game) => game.id === counterStrike.id).lastPlayedAt,
    playedAt
  );

  const freeGame = await request("/api/library/games", {
    method: "POST",
    body: { gameId: "1eae2cb3-23dc-4589-9da2-c218ca8d7056" }
  });
  assert.equal(freeGame.response.status, 201);
  const duplicateFreeGame = await request("/api/library/games", {
    method: "POST",
    body: { gameId: "1eae2cb3-23dc-4589-9da2-c218ca8d7056" }
  });
  assert.equal(duplicateFreeGame.result.added, false);

  const paidFreeLibraryEntry = await request("/api/library/games", {
    method: "POST",
    body: { gameId: "2fffae13-d44d-4b32-857a-aa83cdc75b84" }
  });
  assert.equal(paidFreeLibraryEntry.response.status, 400);

  const cart = await request("/api/cart", {
    method: "POST",
    body: { gameId: "2fffae13-d44d-4b32-857a-aa83cdc75b84" }
  });
  assert.equal(cart.response.status, 200);
  assert.equal(cart.result.total, 100);
  assert.equal(cart.result.items[0].unitPrice, 100);
  const repeatedCartItem = await request("/api/cart", {
    method: "POST",
    body: { gameId: "2fffae13-d44d-4b32-857a-aa83cdc75b84" }
  });
  assert.equal(repeatedCartItem.response.status, 200);
  assert.equal(repeatedCartItem.result.added, false);
  assert.equal(repeatedCartItem.result.items[0].quantity, 1);
  assert.equal(repeatedCartItem.result.total, 100);
  const checkout = await request("/api/checkout", {
    method: "POST",
    body: {}
  });
  assert.equal(checkout.response.status, 200);
  assert.equal(checkout.result.purchasedCount, 1);
  const emptyCart = await request("/api/cart");
  assert.equal(emptyCart.result.items.length, 0);
  const alreadyOwnedCart = await request("/api/cart", {
    method: "POST",
    body: { gameId: "2fffae13-d44d-4b32-857a-aa83cdc75b84" }
  });
  assert.equal(alreadyOwnedCart.response.status, 409);

  const hostileOrigin = await request("/api/categories", {
    method: "POST",
    origin: "https://attacker.example",
    body: { name: "Заборонено" }
  });
  assert.equal(hostileOrigin.response.status, 403);

  const duplicateAccount = await request("/api/register", {
    method: "POST",
    body: { email: "player@example.com", password: "example-pass-123" }
  });
  assert.equal(duplicateAccount.response.status, 409);

  const logout = await request("/api/logout", { method: "POST", body: {} });
  assert.equal(logout.response.status, 200);
  cookie = "";
  const signedOutLibrary = await request("/api/library");
  assert.equal(signedOutLibrary.response.status, 401);

  const invalidLogin = await request("/api/login", {
    method: "POST",
    body: { email: "PLAYER@example.com", password: "incorrect-pass-123" }
  });
  assert.equal(invalidLogin.response.status, 401);
  const login = await request("/api/login", {
    method: "POST",
    body: { email: "PLAYER@example.com", password: "example-pass-123" }
  });
  assert.equal(login.response.status, 200);
  cookie = login.response.headers.get("set-cookie").split(";")[0];
  library = await request("/api/library");
  assert.equal(library.result.games.length, 3);

  const removedGame = await request(
    "/api/library/games/d8c70fe2-f11d-47cf-a134-41d092947587",
    { method: "DELETE" }
  );
  assert.equal(removedGame.response.status, 200);
  library = await request("/api/library");
  assert.equal(library.result.games.length, 2);

  await request("/api/logout", { method: "POST", body: {} });
  cookie = "";
  const secondAccount = await request("/api/register", {
    method: "POST",
    body: { email: "second@example.com", password: "another-pass-123" }
  });
  assert.equal(secondAccount.response.status, 201);
  cookie = await verifyAccount("second@example.com");
  library = await request("/api/library");
  assert.equal(library.result.games.length, 0);
  storeText = await fs.readFile(storeFile, "utf8");
  assert.equal(storeText.includes("second@example.com"), false);

  const lockEmail = "locked@example.com";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const failedLogin = await request("/api/login", {
      method: "POST",
      body: { email: lockEmail, password: "wrong-pass-123" }
    });
    if (attempt < 3) {
      assert.equal(failedLogin.response.status, 401);
      assert.equal(failedLogin.result.attemptsLeft, 3 - attempt);
    } else {
      assert.equal(failedLogin.response.status, 429);
      assert.equal(failedLogin.result.attemptsLeft, 0);
      assert.ok(failedLogin.result.retryAfterSeconds > 0);
    }
  }

  const lockedLogin = await request("/api/login", {
    method: "POST",
    body: { email: lockEmail, password: "wrong-pass-123" }
  });
  assert.equal(lockedLogin.response.status, 429);
  assert.ok(lockedLogin.result.retryAfterSeconds > 0);
});

test("verification links, resend, and the registration wait token work", async () => {
  const registration = await request("/api/register", {
    method: "POST",
    body: { email: "waiter@example.com", password: "wait-pass-123" }
  });
  assert.equal(registration.response.status, 201);
  const waitToken = registration.result.waitToken;
  assert.ok(waitToken);

  const pending = await request(
    `/api/verify/wait?token=${encodeURIComponent(waitToken)}`
  );
  assert.equal(pending.response.status, 200);
  assert.equal(pending.result.verified, false);
  assert.equal(pending.result.status, "pending");

  const bogus = await request("/api/verify", {
    method: "POST",
    body: { token: "bogus" }
  });
  assert.equal(bogus.response.status, 400);
  assert.equal(bogus.result.code, "invalid_token");

  const originalEmail = await latestVerificationEmail("waiter@example.com");
  const resend = await request("/api/verify/resend", {
    method: "POST",
    body: { email: "waiter@example.com" }
  });
  assert.equal(resend.response.status, 200);
  assert.equal(resend.result.ok, true);
  assert.equal(resend.result.sent, false);
  assert.ok(resend.result.devLink);

  const unknownResend = await request("/api/verify/resend", {
    method: "POST",
    body: { email: "nobody@example.com" }
  });
  assert.equal(unknownResend.response.status, 200);
  assert.equal(unknownResend.result.ok, true);
  assert.equal(unknownResend.result.devLink, undefined);

  // The resend replaces the link from registration.
  const resentEmail = await latestVerificationEmail("waiter@example.com");
  assert.equal(resentEmail.link, resend.result.devLink);
  const resentToken = new URL(resend.result.devLink).searchParams.get("token");
  const verified = await request("/api/verify", {
    method: "POST",
    body: { token: resentToken }
  });
  assert.equal(verified.response.status, 200);
  assert.match(verified.response.headers.get("set-cookie"), /HttpOnly/);

  const replay = await request("/api/verify", {
    method: "POST",
    body: { token: resentToken }
  });
  assert.equal(replay.response.status, 400);
  assert.equal(replay.result.code, "invalid_token");

  const staleToken = new URL(originalEmail.link).searchParams.get("token");
  const staleLink = await request("/api/verify", {
    method: "POST",
    body: { token: staleToken }
  });
  assert.equal(staleLink.response.status, 400);
  assert.equal(staleLink.result.code, "invalid_token");

  const outdatedWait = await request(
    `/api/verify/wait?token=${encodeURIComponent(waitToken)}`
  );
  assert.equal(outdatedWait.result.verified, false);
  assert.equal(outdatedWait.result.status, "expired");

  const login = await request("/api/login", {
    method: "POST",
    body: { email: "waiter@example.com", password: "wait-pass-123" }
  });
  assert.equal(login.response.status, 200);
  cookie = login.response.headers.get("set-cookie").split(";")[0];

  const secondRegistration = await request("/api/register", {
    method: "POST",
    body: { email: "tab-waiter@example.com", password: "tab-pass-123" }
  });
  assert.equal(secondRegistration.response.status, 201);
  await verifyAccount("tab-waiter@example.com");
  const confirmed = await request(
    `/api/verify/wait?token=${encodeURIComponent(secondRegistration.result.waitToken)}`
  );
  assert.equal(confirmed.result.verified, true);
  assert.match(confirmed.response.headers.get("set-cookie"), /HttpOnly/);
  cookie = confirmed.response.headers.get("set-cookie").split(";")[0];
  const ownLibrary = await request("/api/library");
  assert.equal(ownLibrary.response.status, 200);
  assert.deepEqual(ownLibrary.result.games, []);
});
