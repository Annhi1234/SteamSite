"use strict";

const fs = require("node:fs");

/**
 * Minimal .env reader (no dependencies). Real environment variables always win,
 * so Vercel settings are never overwritten by a local file.
 */
function loadEnvFile(filePath) {
  if (process.env.STEAMSITE_SKIP_ENV_FILE === "1") {
    return;
  }
  let contents;
  try {
    contents = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (!Object.hasOwn(process.env, key)) {
      process.env[key] = value;
    }
  }
}

module.exports = { loadEnvFile };
