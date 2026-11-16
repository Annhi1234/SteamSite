"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");

const root = path.resolve(__dirname, "..");
const dataDirectory = path.join(
  os.tmpdir(),
  `steamsite-vercel-test-${crypto.randomUUID()}`
);
process.env.STEAMSITE_DATA_DIR = dataDirectory;
process.env.STEAMSITE_APP_SECRET = crypto.randomBytes(32).toString("base64");
const handler = require("../api/[...path]");

function createResponse() {
  return {
    headers: {},
    statusCode: null,
    body: "",
    headersSent: false,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      Object.assign(this.headers, headers);
      this.headersSent = true;
    },
    end(body = "") {
      this.body = body;
    },
    destroy(error) {
      this.error = error;
    }
  };
}

async function invoke(method, url, body, cookie) {
  const request = {
    method,
    url,
    headers: { host: "steamsite.test" },
    socket: { remoteAddress: "127.0.0.1" }
  };
  if (body !== undefined) {
    request.body = body;
  }
  if (cookie) {
    request.headers.cookie = cookie;
  }
  const response = createResponse();
  await handler(request, response);
  return {
    status: response.statusCode,
    headers: response.headers,
    body: JSON.parse(response.body || "{}")
  };
}

after(async () => {
  await fs.rm(dataDirectory, { recursive: true, force: true });
});

test("Vercel catch-all serves catalog and authenticated API routes", async () => {
  const catalog = await invoke("GET", "/api/games");
  assert.equal(catalog.status, 200);
  assert.equal(catalog.body.games.length, 18);

  const registration = await invoke("POST", "/api/register", {
    email: "vercel-player@example.com",
    password: "example-pass-123"
  });
  assert.equal(registration.status, 201);
  assert.match(registration.headers["Set-Cookie"], /HttpOnly/);

  const cookie = registration.headers["Set-Cookie"].split(";")[0];
  const library = await invoke("GET", "/api/library", undefined, cookie);
  assert.equal(library.status, 200);
  assert.deepEqual(library.body.games, []);

  const freeGame = await invoke(
    "POST",
    "/api/library/games",
    { gameId: "1eae2cb3-23dc-4589-9da2-c218ca8d7056" },
    cookie
  );
  assert.equal(freeGame.status, 201);
  assert.equal(freeGame.body.added, true);
});

test("vercel.json forwards nested API paths to the catch-all function", async () => {
  const config = JSON.parse(
    await fs.readFile(path.join(root, "vercel.json"), "utf8")
  );
  assert.deepEqual(config.rewrites, [
    {
      source: "/api/:path*",
      destination: "/api/[...path]"
    }
  ]);
  const headerValue = (key) =>
    (config.headers?.[0]?.headers || []).find((entry) => entry.key === key)
      ?.value || "";
  assert.match(headerValue("Content-Security-Policy"), /frame-ancestors 'none'/);
  assert.equal(headerValue("X-Frame-Options"), "DENY");
  assert.equal(headerValue("X-Content-Type-Options"), "nosniff");
});
