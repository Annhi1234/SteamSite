"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const { loadEnvFile } = require("../api/_lib/env");
const { renderVerificationEmail } = require("../api/_lib/email");

const ROOT = path.resolve(__dirname, "..");

async function main() {
  loadEnvFile(path.join(ROOT, ".env"));

  const baseUrl = (process.env.PUBLIC_BASE_URL || "http://127.0.0.1:8767").replace(
    /\/+$/,
    ""
  );
  const email = process.argv[2] || "player@example.com";
  const link = `${baseUrl}/verify.html?token=${"x".repeat(43)}`;

  const content = renderVerificationEmail({ link, email });
  const directory = path.join(ROOT, "email-preview");
  const filePath = path.join(directory, "verification.html");

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(filePath, content.html, "utf8");

  console.log(`Тема листа: ${content.subject}`);
  console.log(`Прев'ю збережено: ${filePath}`);
  console.log("Відкрий цей файл у браузері, щоб побачити, як лист виглядає.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
