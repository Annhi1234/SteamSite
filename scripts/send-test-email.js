"use strict";

const path = require("node:path");
const { loadEnvFile } = require("../api/_lib/env");
const {
  isBrevoConfigured,
  sendVerificationEmail,
  senderAddress
} = require("../api/_lib/email");

const ROOT = path.resolve(__dirname, "..");

async function main() {
  loadEnvFile(path.join(ROOT, ".env"));

  const to = (process.argv[2] || "").trim();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    console.error("Використання: npm run email:test -- tvoya-poshta@example.com");
    process.exitCode = 1;
    return;
  }

  if (!isBrevoConfigured()) {
    console.error(
      [
        "Brevo ще не налаштований: у .env порожні BREVO_API_KEY або BREVO_SENDER_EMAIL.",
        "Що зробити:",
        "  1. brevo.com → SMTP & API → API Keys → створити ключ (v3);",
        "  2. Senders & IP → Senders → додати й підтвердити адресу відправника;",
        "  3. вписати обидва значення в E:\\SteamSite\\.env і повторити команду.",
        "Детальніше: BREVO.md"
      ].join("\n")
    );
    process.exitCode = 1;
    return;
  }

  const sender = senderAddress();
  console.log(`Відправник: ${sender.name} <${sender.email}>`);
  console.log(`Отримувач: ${to}`);
  console.log("Надсилаю тестовий лист через Brevo…");

  const result = await sendVerificationEmail({
    to,
    link: `${(process.env.PUBLIC_BASE_URL || "http://127.0.0.1:8767").replace(
      /\/+$/,
      ""
    )}/verify.html?token=test-token-not-valid`,
    dataDirectory: process.env.STEAMSITE_DATA_DIR || path.join(ROOT, "data")
  });

  if (result.delivered) {
    console.log(`Готово. Brevo прийняв лист. messageId: ${result.messageId}`);
    console.log("Перевір пошту (і папку «Спам»).");
  } else {
    console.log(`Лист не відправлено. Локальне посилання: ${result.devLink}`);
  }
}

main().catch((error) => {
  console.error(`Помилка: ${error.message}`);
  process.exitCode = 1;
});
