"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const {
  initializeDatabase,
  readDatabaseStore,
  updateDatabaseStore
} = require("./database");
const GAME_CATALOG = require("../../data/games.json");

const ROOT = path.resolve(__dirname, "../..");
const USE_DATABASE = Boolean(
  process.env.DATABASE_URL && !process.env.STEAMSITE_DATA_DIR
);
const DATA_DIR = process.env.STEAMSITE_DATA_DIR || path.join(ROOT, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");
const SECRET_FILE = process.env.STEAMSITE_SECRET_FILE || path.join(ROOT, ".app-secret");
const SESSION_COOKIE = "steamsite_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 1024 * 1024;
const PUBLIC_FILES = new Set([
  "api.js",
  "auth.js",
  "index.html",
  "libary.html",
  "library.html",
  "library.js",
  "login.html",
  "registry.html",
  "script.js",
  "style.css"
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};
const passwordLimits = new Map();
const loginFailures = new Map();
const LOGIN_MAX_FAILURES = 3;
const LOGIN_LOCK_MS = 60_000;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60_000;
let games = [];
let gamesById = new Map();
let gamesBySteamId = new Map();
let appSecret;
let storeWriteQueue = Promise.resolve();

class HttpError extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function createEmptyStore() {
  return {
    version: 1,
    users: [],
    emailIndex: {},
    sessions: {},
    libraries: {},
    categories: {},
    carts: {}
  };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateStore(store) {
  if (
    !isObject(store) ||
    store.version !== 1 ||
    !Array.isArray(store.users) ||
    !isObject(store.emailIndex) ||
    !isObject(store.sessions) ||
    !isObject(store.libraries) ||
    !isObject(store.categories) ||
    !isObject(store.carts)
  ) {
    throw new Error("The JSON store has an invalid or unsupported format.");
  }
}

function validateGames(list) {
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error("The game catalog must contain at least one game.");
  }

  const ids = new Set();
  const steamIds = new Set();
  for (const game of list) {
    if (
      !isObject(game) ||
      !UUID_PATTERN.test(game.id) ||
      typeof game.steamAppId !== "string" ||
      typeof game.title !== "string" ||
      typeof game.description !== "string" ||
      !Number.isInteger(game.price) ||
      game.price < 0 ||
      !Number.isInteger(game.discountPercent) ||
      game.discountPercent < 0 ||
      game.discountPercent > 100 ||
      (game.discountPercent === 0 && game.salePrice !== null) ||
      (game.discountPercent > 0 &&
        (!Number.isInteger(game.salePrice) ||
          game.salePrice < 0 ||
          game.salePrice >= game.price)) ||
      !Array.isArray(game.minimum) ||
      !Array.isArray(game.recommended)
    ) {
      throw new Error(`The game catalog has an invalid entry: ${game && game.title}.`);
    }

    if (ids.has(game.id) || steamIds.has(game.steamAppId)) {
      throw new Error("Game UUIDs and Steam app IDs must be unique.");
    }
    ids.add(game.id);
    steamIds.add(game.steamAppId);
  }

  return list;
}

async function loadSecret() {
  if (process.env.STEAMSITE_APP_SECRET) {
    const secret = Buffer.from(process.env.STEAMSITE_APP_SECRET, "base64");
    if (secret.length < 32) {
      throw new Error("STEAMSITE_APP_SECRET must contain at least 32 random bytes, base64 encoded.");
    }
    return secret;
  }

  try {
    const secret = await fs.readFile(SECRET_FILE);
    if (secret.length < 32) {
      throw new Error(`The secret file must contain at least 32 random bytes: ${SECRET_FILE}`);
    }
    return secret;
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  const secret = crypto.randomBytes(32);
  try {
    await fs.writeFile(SECRET_FILE, secret, { flag: "wx", mode: 0o600 });
    return secret;
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
    const existingSecret = await fs.readFile(SECRET_FILE);
    if (existingSecret.length < 32) {
      throw new Error("The concurrently created secret file is invalid.");
    }
    return existingSecret;
  }
}

function hmac(value, purpose) {
  return crypto
    .createHmac("sha256", appSecret)
    .update(`${purpose}\0${value}`, "utf8")
    .digest("hex");
}

function normalizeEmail(value) {
  if (typeof value !== "string") {
    throw new HttpError(400, "Введи коректну пошту.");
  }
  const email = value.trim().toLowerCase();
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new HttpError(400, "Введи коректну пошту.");
  }
  return email;
}

function validatePassword(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 256) {
    throw new HttpError(400, "Пароль має містити від 8 до 256 символів.");
  }
  return value;
}

function derivePassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey.toString("hex"));
      }
    );
  });
}

function passwordMatches(expected, actual) {
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");
  return (
    expectedBuffer.length === actualBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function readStore() {
  if (USE_DATABASE) {
    const store = await readDatabaseStore();
    validateStore(store);
    return store;
  }

  let contents;
  try {
    contents = await fs.readFile(STORE_FILE, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`The JSON store is missing: ${STORE_FILE}`);
    }
    throw error;
  }

  let store;
  try {
    store = JSON.parse(contents);
  } catch {
    throw new Error(`The JSON store cannot be parsed: ${STORE_FILE}`);
  }
  validateStore(store);
  return store;
}

async function writeStore(store) {
  if (USE_DATABASE) {
    throw new Error("The Neon store must be updated with compare-and-swap.");
  }

  const temporaryFile = `${STORE_FILE}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.writeFile(temporaryFile, `${JSON.stringify(store, null, 2)}\n`, {
      mode: 0o600
    });
    await fs.rename(temporaryFile, STORE_FILE);
  } catch (error) {
    await fs.rm(temporaryFile, { force: true });
    throw error;
  }
}

function updateStore(update) {
  if (USE_DATABASE) {
    return updateDatabaseStore(update, clone);
  }

  const operation = storeWriteQueue.then(async () => {
    const draft = clone(await readStore());
    const result = await update(draft);
    await writeStore(draft);
    return result;
  });
  storeWriteQueue = operation.catch(() => undefined);
  return operation;
}

async function initialize() {
  appSecret = await loadSecret();

  games = validateGames(GAME_CATALOG);
  gamesById = new Map(games.map((game) => [game.id, game]));
  gamesBySteamId = new Map(games.map((game) => [game.steamAppId, game]));

  if (USE_DATABASE) {
    await initializeDatabase(createEmptyStore());
    return;
  }

  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(STORE_FILE);
    validateStore(JSON.parse(await fs.readFile(STORE_FILE, "utf8")));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    await writeStore(createEmptyStore());
  }
}

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  response.end(JSON.stringify(value));
}

async function readJsonBody(request) {
  if (request.body !== undefined) {
    if (!isObject(request.body)) {
      throw new HttpError(400, "Request body must be a JSON object.");
    }
    return request.body;
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, "Request body is too large.");
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!isObject(body)) {
      throw new HttpError(400, "Request body must be a JSON object.");
    }
    return body;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(400, "Request body contains invalid JSON.");
  }
}

function parseCookies(header) {
  const cookies = {};
  for (const part of (header || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    cookies[name] = value;
  }
  return cookies;
}

function sessionCookie(token, request) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(
    SESSION_TTL_MS / 1000
  )}${secure}`;
}

function clearSessionCookie(request) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

function checkOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) {
    return;
  }
  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new HttpError(403, "Запит з цього джерела заборонений.");
  }
  if (parsedOrigin.host !== request.headers.host) {
    throw new HttpError(403, "Запит з цього джерела заборонений.");
  }
}

function checkRateLimit(request, action) {
  const key = `${action}:${request.socket.remoteAddress || "unknown"}`;
  const now = Date.now();
  const recentAttempts = (passwordLimits.get(key) || []).filter(
    (timestamp) => now - timestamp < 60_000
  );
  if (recentAttempts.length >= 10) {
    throw new HttpError(429, "Забагато спроб. Спробуй ще раз за хвилину.");
  }
  recentAttempts.push(now);
  passwordLimits.set(key, recentAttempts);
}

function loginAttemptKey(request, email) {
  return `${request.socket.remoteAddress || "unknown"}:${email}`;
}

function assertLoginAllowed(key) {
  const entry = loginFailures.get(key);
  if (!entry || !entry.lockedUntil) {
    return;
  }
  const now = Date.now();
  if (entry.lockedUntil <= now) {
    loginFailures.delete(key);
    return;
  }
  const retryAfterSeconds = Math.ceil((entry.lockedUntil - now) / 1000);
  throw new HttpError(
    429,
    `Забагато невдалих спроб. Спробуй ще раз через ${retryAfterSeconds} с.`,
    { retryAfterSeconds, attemptsLeft: 0 }
  );
}

function recordLoginFailure(key) {
  const now = Date.now();
  const entry = loginFailures.get(key) || {
    count: 0,
    lockedUntil: 0,
    updatedAt: 0
  };
  if (
    (entry.lockedUntil && entry.lockedUntil <= now) ||
    now - entry.updatedAt > LOGIN_FAILURE_WINDOW_MS
  ) {
    entry.count = 0;
    entry.lockedUntil = 0;
  }
  entry.count += 1;
  entry.updatedAt = now;
  if (entry.count >= LOGIN_MAX_FAILURES) {
    entry.count = 0;
    entry.lockedUntil = now + LOGIN_LOCK_MS;
    loginFailures.set(key, entry);
    throw new HttpError(
      429,
      "Забагато невдалих спроб. Вхід тимчасово заблоковано на 60 секунд.",
      { retryAfterSeconds: 60, attemptsLeft: 0 }
    );
  }
  loginFailures.set(key, entry);
  throw new HttpError(401, "Неправильна пошта або пароль.", {
    attemptsLeft: LOGIN_MAX_FAILURES - entry.count
  });
}

async function getCurrentUser(request) {
  const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
  if (!token || token.length > 256) {
    return null;
  }

  const store = await readStore();
  const session = store.sessions[hmac(token, "session")];
  if (!session || session.expiresAt <= Date.now()) {
    return null;
  }
  return store.users.find((user) => user.id === session.userId) || null;
}

async function requireUser(request) {
  const user = await getCurrentUser(request);
  if (!user) {
    throw new HttpError(401, "Увійди в акаунт, щоб продовжити.");
  }
  return user;
}

function getGame(gameId) {
  const game = gamesById.get(gameId);
  if (!game) {
    throw new HttpError(404, "Гру не знайдено.");
  }
  return game;
}

function createLibraryEntry(
  gameId,
  categoryId = null,
  favorite = false,
  lastPlayedAt = 0,
  addedAt = Date.now()
) {
  return {
    gameId,
    categoryId,
    favorite: Boolean(favorite),
    lastPlayedAt: Number.isFinite(lastPlayedAt) ? lastPlayedAt : 0,
    addedAt: Number.isFinite(addedAt) ? addedAt : Date.now()
  };
}

function serializeLibrary(store, userId) {
  const categories = store.categories[userId] || [];
  const libraryGames = store.libraries[userId] || [];
  return {
    categories,
    games: libraryGames
      .map((entry) => {
        const game = gamesById.get(entry.gameId);
        if (!game) {
          return null;
        }
        return {
          id: game.id,
          steamAppId: game.steamAppId,
          title: game.title,
          description: game.description,
          release: game.release,
          developer: game.developer,
          publisher: game.publisher,
          type: "game",
          image: game.image,
          minimum: game.minimum,
          recommended: game.recommended,
          categoryId: entry.categoryId,
          favorite: entry.favorite,
          lastPlayedAt: entry.lastPlayedAt || 0,
          addedAt: entry.addedAt || 0
        };
      })
      .filter(Boolean)
  };
}

function serializeCart(store, userId) {
  const items = (store.carts[userId] || []).flatMap((item) => {
    const game = gamesById.get(item.gameId);
    if (!game) {
      return [];
    }
    const unitPrice = game.salePrice === null ? game.price : game.salePrice;
    return [
      {
        gameId: game.id,
        quantity: item.quantity,
        title: game.title,
        image: game.image,
        unitPrice,
        lineTotal: unitPrice * item.quantity
      }
    ];
  });
  return {
    items,
    total: items.reduce((sum, item) => sum + item.lineTotal, 0)
  };
}

function ensureUserMaps(store, userId) {
  store.libraries[userId] ||= [];
  store.categories[userId] ||= [];
  store.carts[userId] ||= [];
}

function upsertLibraryGame(store, userId, gameId) {
  ensureUserMaps(store, userId);
  if (!store.libraries[userId].some((entry) => entry.gameId === gameId)) {
    store.libraries[userId].push(createLibraryEntry(gameId));
    return true;
  }
  return false;
}

function makeSession(store, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  store.sessions[hmac(token, "session")] = {
    userId,
    expiresAt: Date.now() + SESSION_TTL_MS
  };
  return token;
}

async function register(request, response) {
  checkOrigin(request);
  checkRateLimit(request, "register");
  const body = await readJsonBody(request);
  const emailHash = hmac(normalizeEmail(body.email), "email");
  const password = validatePassword(body.password);
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = await derivePassword(password, salt);
  const userId = crypto.randomUUID();

  const token = await updateStore((store) => {
    if (store.emailIndex[emailHash]) {
      throw new HttpError(409, "Акаунт із такою поштою вже існує.");
    }
    store.users.push({
      id: userId,
      emailHash,
      passwordSalt: salt,
      passwordHash,
      createdAt: new Date().toISOString()
    });
    store.emailIndex[emailHash] = userId;
    ensureUserMaps(store, userId);
    return makeSession(store, userId);
  });

  sendJson(response, 201, { user: { id: userId } }, {
    "Set-Cookie": sessionCookie(token, request)
  });
}

async function login(request, response) {
  checkOrigin(request);
  checkRateLimit(request, "login");
  const body = await readJsonBody(request);
  const email = normalizeEmail(body.email);
  const emailHash = hmac(email, "email");
  const password = validatePassword(body.password);
  const attemptKey = loginAttemptKey(request, email);
  assertLoginAllowed(attemptKey);
  const store = await readStore();
  const userId = store.emailIndex[emailHash];
  const user = userId ? store.users.find((entry) => entry.id === userId) : null;

  const dummySalt = hmac("unknown-account", "password-salt").slice(0, 32);
  const actualHash = await derivePassword(
    password,
    user ? user.passwordSalt : dummySalt
  );
  if (!user || !passwordMatches(user.passwordHash, actualHash)) {
    recordLoginFailure(attemptKey);
  }

  loginFailures.delete(attemptKey);
  const token = await updateStore((draft) => makeSession(draft, user.id));
  sendJson(response, 200, { user: { id: user.id } }, {
    "Set-Cookie": sessionCookie(token, request)
  });
}

function legacyUuidMap(legacyCategories, userCategories) {
  const mapping = new Map();
  for (const category of legacyCategories) {
    if (
      !isObject(category) ||
      typeof category.id !== "string" ||
      typeof category.name !== "string"
    ) {
      continue;
    }
    const name = category.name.trim().slice(0, 40);
    if (!name) {
      continue;
    }
    let saved = userCategories.find(
      (entry) => entry.name.toLowerCase() === name.toLowerCase()
    );
    if (!saved) {
      saved = { id: crypto.randomUUID(), name };
      userCategories.push(saved);
    }
    mapping.set(category.id, saved.id);
  }
  return mapping;
}

function parseLegacyState(body) {
  const library = body.library || { categories: [], games: [] };
  const cart = body.cart || [];
  if (
    !isObject(library) ||
    !Array.isArray(library.categories) ||
    !Array.isArray(library.games) ||
    library.categories.length > 100 ||
    library.games.length > 200 ||
    !Array.isArray(cart) ||
    cart.length > 100
  ) {
    throw new HttpError(400, "Старі дані бібліотеки або кошика мають неправильний формат.");
  }
  return { library, cart };
}

async function migrateLegacy(request, response, user) {
  checkOrigin(request);
  const body = await readJsonBody(request);
  const { library, cart } = parseLegacyState(body);
  const result = await updateStore((store) => {
    ensureUserMaps(store, user.id);
    const categoryMap = legacyUuidMap(
      library.categories,
      store.categories[user.id]
    );
    const savedGameIds = new Set(
      store.libraries[user.id].map((entry) => entry.gameId)
    );
    let libraryAdded = 0;
    for (const legacyGame of library.games) {
      if (!isObject(legacyGame) || legacyGame.id === undefined) {
        continue;
      }
      const game = gamesBySteamId.get(String(legacyGame.id));
      if (!game || savedGameIds.has(game.id)) {
        continue;
      }
      const categoryId =
        typeof legacyGame.categoryId === "string"
          ? categoryMap.get(legacyGame.categoryId) || null
          : null;
      store.libraries[user.id].push(
        createLibraryEntry(
          game.id,
          categoryId,
          legacyGame.favorite,
          Number(legacyGame.lastPlayedAt) || 0
        )
      );
      savedGameIds.add(game.id);
      libraryAdded += 1;
    }

    const savedCart = new Map(
      store.carts[user.id].map((item) => [item.gameId, item])
    );
    let cartAdded = 0;
    for (const legacyItem of cart) {
      if (!isObject(legacyItem) || legacyItem.id === undefined) {
        continue;
      }
      const game = gamesBySteamId.get(String(legacyItem.id));
      const quantity = Number(legacyItem.quantity);
      if (!game || game.price === 0 || !Number.isInteger(quantity) || quantity <= 0) {
        continue;
      }
      const existing = savedCart.get(game.id);
      if (existing) {
        existing.quantity += quantity;
      } else {
        const item = { gameId: game.id, quantity };
        store.carts[user.id].push(item);
        savedCart.set(game.id, item);
      }
      cartAdded += quantity;
    }
    return {
      categories: store.categories[user.id].length,
      libraryAdded,
      cartAdded
    };
  });

  sendJson(response, 200, result);
}

async function handleApi(request, response, url) {
  const { pathname } = url;
  const method = request.method;

  if (method === "GET" && pathname === "/api/games") {
    sendJson(response, 200, { games });
    return;
  }

  if (method === "POST" && pathname === "/api/register") {
    await register(request, response);
    return;
  }
  if (method === "POST" && pathname === "/api/login") {
    await login(request, response);
    return;
  }
  if (method === "POST" && pathname === "/api/logout") {
    checkOrigin(request);
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    if (token) {
      await updateStore((store) => {
        delete store.sessions[hmac(token, "session")];
      });
    }
    sendJson(response, 200, { ok: true }, {
      "Set-Cookie": clearSessionCookie(request)
    });
    return;
  }

  if (method === "GET" && pathname === "/api/me") {
    const user = await getCurrentUser(request);
    sendJson(response, 200, { user: user ? { id: user.id } : null });
    return;
  }

  const user = await requireUser(request);
  const segments = pathname.split("/").filter(Boolean);

  if (method === "GET" && pathname === "/api/library") {
    const store = await readStore();
    sendJson(response, 200, serializeLibrary(store, user.id));
    return;
  }
  if (method === "POST" && pathname === "/api/library/games") {
    checkOrigin(request);
    const body = await readJsonBody(request);
    if (typeof body.gameId !== "string") {
      throw new HttpError(400, "Вибери гру для бібліотеки.");
    }
    const game = getGame(body.gameId);
    if (game.price !== 0) {
      throw new HttpError(400, "Платні ігри додаються після покупки.");
    }
    const added = await updateStore((store) =>
      upsertLibraryGame(store, user.id, game.id)
    );
    sendJson(response, added ? 201 : 200, { added });
    return;
  }
  if (
    (method === "PATCH" || method === "DELETE") &&
    segments.length === 4 &&
    segments[1] === "library" &&
    segments[2] === "games"
  ) {
    const gameId = segments[3];
    getGame(gameId);
    checkOrigin(request);
    if (method === "DELETE") {
      await updateStore((store) => {
        store.libraries[user.id] = (store.libraries[user.id] || []).filter(
          (entry) => entry.gameId !== gameId
        );
      });
      sendJson(response, 200, { ok: true });
      return;
    }

    const body = await readJsonBody(request);
    await updateStore((store) => {
      const entry = (store.libraries[user.id] || []).find(
        (savedGame) => savedGame.gameId === gameId
      );
      if (!entry) {
        throw new HttpError(404, "Гру не знайдено в бібліотеці.");
      }
      if (Object.hasOwn(body, "favorite")) {
        if (typeof body.favorite !== "boolean") {
          throw new HttpError(400, "Статус вибраного має бути логічним значенням.");
        }
        entry.favorite = body.favorite;
      }
      if (Object.hasOwn(body, "categoryId")) {
        if (
          body.categoryId !== null &&
          (typeof body.categoryId !== "string" ||
            !(store.categories[user.id] || []).some(
              (category) => category.id === body.categoryId
            ))
        ) {
          throw new HttpError(400, "Вибрана категорія не існує.");
        }
        entry.categoryId = body.categoryId;
      }
      if (Object.hasOwn(body, "lastPlayedAt")) {
        if (
          !Number.isSafeInteger(body.lastPlayedAt) ||
          body.lastPlayedAt <= 0 ||
          body.lastPlayedAt > Date.now() + 60_000
        ) {
          throw new HttpError(400, "Час запуску гри некоректний.");
        }
        entry.lastPlayedAt = body.lastPlayedAt;
      }
      if (
        !Object.hasOwn(body, "favorite") &&
        !Object.hasOwn(body, "categoryId") &&
        !Object.hasOwn(body, "lastPlayedAt")
      ) {
        throw new HttpError(400, "Немає змін для оновлення гри.");
      }
    });
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "POST" && pathname === "/api/categories") {
    checkOrigin(request);
    const body = await readJsonBody(request);
    const name =
      typeof body.name === "string" ? body.name.trim().slice(0, 40) : "";
    if (!name) {
      throw new HttpError(400, "Введи назву категорії.");
    }
    const category = await updateStore((store) => {
      ensureUserMaps(store, user.id);
      if (
        store.categories[user.id].some(
          (entry) => entry.name.toLowerCase() === name.toLowerCase()
        )
      ) {
        throw new HttpError(409, "Категорія з такою назвою вже існує.");
      }
      const created = { id: crypto.randomUUID(), name };
      store.categories[user.id].push(created);
      return created;
    });
    sendJson(response, 201, { category });
    return;
  }
  if (
    method === "DELETE" &&
    segments.length === 3 &&
    segments[1] === "categories"
  ) {
    checkOrigin(request);
    const categoryId = segments[2];
    await updateStore((store) => {
      const categories = store.categories[user.id] || [];
      if (!categories.some((category) => category.id === categoryId)) {
        throw new HttpError(404, "Категорію не знайдено.");
      }
      store.categories[user.id] = categories.filter(
        (category) => category.id !== categoryId
      );
      store.libraries[user.id] = (store.libraries[user.id] || []).map((entry) =>
        entry.categoryId === categoryId
          ? { ...entry, categoryId: null }
          : entry
      );
    });
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "POST" && pathname === "/api/migrate/legacy") {
    await migrateLegacy(request, response, user);
    return;
  }
  if (method === "GET" && pathname === "/api/cart") {
    const store = await readStore();
    sendJson(response, 200, serializeCart(store, user.id));
    return;
  }
  if (method === "POST" && pathname === "/api/cart") {
    checkOrigin(request);
    const body = await readJsonBody(request);
    if (typeof body.gameId !== "string") {
      throw new HttpError(400, "Вибери гру для кошика.");
    }
    const game = getGame(body.gameId);
    if (game.price === 0) {
      throw new HttpError(400, "Безкоштовні ігри додаються до бібліотеки.");
    }
    const added = await updateStore((store) => {
      ensureUserMaps(store, user.id);
      if (store.libraries[user.id].some((entry) => entry.gameId === game.id)) {
        throw new HttpError(409, "Гра вже є у твоїй бібліотеці.");
      }
      if (store.carts[user.id].some((item) => item.gameId === game.id)) {
        return false;
      }
      store.carts[user.id].push({ gameId: game.id, quantity: 1 });
      return true;
    });
    const store = await readStore();
    sendJson(response, 200, { ...serializeCart(store, user.id), added });
    return;
  }
  if (
    method === "DELETE" &&
    segments.length === 3 &&
    segments[1] === "cart"
  ) {
    checkOrigin(request);
    const gameId = segments[2];
    getGame(gameId);
    await updateStore((store) => {
      store.carts[user.id] = (store.carts[user.id] || []).filter(
        (item) => item.gameId !== gameId
      );
    });
    const store = await readStore();
    sendJson(response, 200, serializeCart(store, user.id));
    return;
  }
  if (method === "POST" && pathname === "/api/checkout") {
    checkOrigin(request);
    const receipt = await updateStore((store) => {
      ensureUserMaps(store, user.id);
      const cart = store.carts[user.id];
      if (cart.length === 0) {
        throw new HttpError(400, "Кошик порожній.");
      }
      let addedCount = 0;
      for (const item of cart) {
        getGame(item.gameId);
        if (upsertLibraryGame(store, user.id, item.gameId)) {
          addedCount += 1;
        }
      }
      const purchasedCount = cart.length;
      store.carts[user.id] = [];
      return { addedCount, purchasedCount };
    });
    sendJson(response, 200, {
      ...receipt,
      message:
        receipt.addedCount > 0
          ? "Покупку завершено. Ігри додано до бібліотеки."
          : "Ці ігри вже є у твоїй бібліотеці."
    });
    return;
  }

  throw new HttpError(404, "API endpoint not found.");
}

async function serveStatic(request, response, url) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    throw new HttpError(405, "Method not allowed.");
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw new HttpError(400, "Invalid URL path.");
  }
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(ROOT, relativePath);
  const relativeToRoot = path.relative(ROOT, filePath);
  if (
    relativeToRoot.startsWith("..") ||
    path.isAbsolute(relativeToRoot) ||
    !PUBLIC_FILES.has(relativeToRoot)
  ) {
    throw new HttpError(404, "File not found.");
  }

  let file;
  try {
    file = await fs.readFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      throw new HttpError(404, "File not found.");
    }
    throw error;
  }

  response.writeHead(200, {
    "Cache-Control": "no-cache",
    "Content-Length": file.length,
    "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(request.method === "HEAD" ? undefined : file);
}

function createServer() {
  return http.createServer(handleApiRequest);
}

async function handleApiRequest(request, response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Frame-Options", "DENY");
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }
    await serveStatic(request, response, url);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) {
      console.error(error);
    }
    if (!response.headersSent) {
      sendJson(response, status, {
        ...(error instanceof HttpError ? error.details : {}),
        error:
          error instanceof HttpError
            ? error.message
            : "Сталася помилка сервера."
      });
    } else {
      response.destroy(error);
    }
  }
}

async function start() {
  await initialize();
  const server = createServer();
  const port = Number(process.env.PORT) || 8767;
  const host = process.env.HOST || "127.0.0.1";
  server.listen(port, host, () => {
    console.log(`SteamSite running at http://${host}:${port}`);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  createEmptyStore,
  derivePassword,
  handleApiRequest,
  initialize,
  normalizeEmail,
  validateGames,
  validatePassword
};
