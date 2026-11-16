"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";
const BREVO_TIMEOUT_MS = 15_000;
const OUTBOX_DIRECTORY = "outbox";
const BRAND = "SteamSite";

/**
 * Palette is copied 1:1 from style.css (:root) so the letter looks like the
 * site: background #1b2838, header #171a21, card #16202d, border #2a475e,
 * accent #66c0f4, button rgb(43, 82, 128), text #ffffff.
 */
const COLORS = {
  background: "#1b2838",
  header: "#171a21",
  card: "#16202d",
  button: "rgb(43, 82, 128)",
  border: "#2a475e",
  accent: "#66c0f4",
  text: "#ffffff"
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isBrevoConfigured() {
  return Boolean(
    (process.env.BREVO_API_KEY || "").trim() &&
      (process.env.BREVO_SENDER_EMAIL || "").trim()
  );
}

function senderAddress() {
  return {
    email: (process.env.BREVO_SENDER_EMAIL || "").trim(),
    name: (process.env.BREVO_SENDER_NAME || BRAND).trim() || BRAND
  };
}

/**
 * Builds the confirmation letter. Kept dependency-free on purpose: Brevo only
 * needs the final HTML, which is sent as `htmlContent`.
 *
 * Layout notes:
 * - table based, 600px wide, all styles inline (Gmail/Outlook strip <style>);
 * - dark palette matching the site, colors are repeated in bgcolor attributes
 *   because some clients ignore CSS backgrounds;
 * - plain-text twin for clients that block HTML.
 */
function renderVerificationEmail({ link, email }) {
  const safeLink = escapeHtml(link);
  const safeEmail = email ? escapeHtml(email) : "";
  const subject = `Підтверди пошту — ${BRAND}`;
  const preheader =
    "Один клік — і акаунт активний. Посилання дійсне 24 години.";

  const text = [
    "Привіт!",
    "",
    `Ти реєструєшся на ${BRAND}${email ? ` з адресою ${email}` : ""}.`,
    "Підтверди пошту за посиланням нижче, щоб активувати акаунт:",
    "",
    link,
    "",
    "Посилання дійсне 24 години.",
    "Якщо ти не реєструвався — просто ігноруй цей лист, акаунт не буде активовано.",
    "",
    `— ${BRAND}`
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="uk">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <meta name="supported-color-schemes" content="light dark">
    <title>${escapeHtml(subject)}</title>
  </head>
  <body bgcolor="${COLORS.background}" style="margin:0;padding:0;background-color:${COLORS.background};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;">
      ${escapeHtml(preheader)}
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.background}" style="background-color:${COLORS.background};">
      <tr>
        <td align="center" style="padding:28px 12px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.card}" style="width:100%;max-width:600px;background-color:${COLORS.card};border:2px solid ${COLORS.border};border-radius:8px;">
            <tr>
              <td bgcolor="${COLORS.header}" style="background-color:${COLORS.header};border-bottom:2px solid ${COLORS.accent};padding:18px 28px;border-radius:6px 6px 0 0;">
                <span style="font-family:'Segoe UI',Arial,sans-serif;font-style:italic;font-weight:700;font-size:21px;letter-spacing:0.3px;color:${COLORS.accent};">
                  ${BRAND}
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 28px 8px;">
                <h1 style="margin:0 0 16px;font-family:'Segoe UI',Arial,sans-serif;font-size:24px;line-height:1.3;font-weight:700;color:${COLORS.text};">
                  Підтверди пошту
                </h1>
                <p style="margin:0 0 22px;font-family:'Segoe UI',Arial,sans-serif;font-size:15px;line-height:1.65;color:${COLORS.text};">
                  Привіт! Залишився один крок — підтверди адресу${
                    safeEmail
                      ? ` <strong style="color:${COLORS.accent};">${safeEmail}</strong>`
                      : ""
                  }, щоб активувати акаунт ${BRAND}.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
                  <tr>
                    <td align="center" bgcolor="${COLORS.button}" style="border-radius:30px;background-color:${COLORS.button};">
                      <a href="${safeLink}" target="_blank" rel="noopener" style="display:inline-block;padding:15px 34px;border-radius:30px;background-color:${COLORS.button};color:${COLORS.accent};font-family:'Segoe UI',Arial,sans-serif;font-size:16px;font-weight:700;text-decoration:none;">
                        Підтвердити пошту
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px;font-family:'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.65;color:${COLORS.text};opacity:0.75;">
                  Кнопка не працює? Скопіюй посилання у браузер:
                </p>
                <p style="margin:0 0 24px;padding:12px 14px;background-color:${COLORS.background};border:1px solid ${COLORS.border};border-radius:6px;font-family:Consolas,'Courier New',monospace;font-size:12px;line-height:1.6;color:${COLORS.accent};word-break:break-all;">
                  <a href="${safeLink}" target="_blank" rel="noopener" style="color:${COLORS.accent};text-decoration:underline;">${safeLink}</a>
                </p>
                <p style="margin:0 0 20px;font-family:'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.65;color:${COLORS.text};opacity:0.8;">
                  Посилання дійсне <strong style="color:${COLORS.text};opacity:1;">24 години</strong>. Якщо ти не реєструвався на ${BRAND}, просто ігноруй цей лист — акаунт залишиться неактивним.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 26px;">
                <div style="height:1px;background-color:${COLORS.border};font-size:1px;line-height:1px;">&nbsp;</div>
                <p style="margin:16px 0 0;font-family:'Segoe UI',Arial,sans-serif;font-size:12px;line-height:1.6;color:${COLORS.text};opacity:0.6;">
                  Це автоматичний лист від ${BRAND} — відповідати на нього не потрібно.<br>
                  Ніколи нікому не пересилай це посилання: воно дає доступ до підтвердження акаунта.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, preheader, text, html };
}

async function sendViaBrevo({ to, content }) {
  let response;
  try {
    response = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": (process.env.BREVO_API_KEY || "").trim(),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        sender: senderAddress(),
        to: [{ email: to }],
        subject: content.subject,
        textContent: content.text,
        htmlContent: content.html
      }),
      signal: AbortSignal.timeout(BREVO_TIMEOUT_MS)
    });
  } catch (error) {
    throw new Error(`Не вдалося зв'язатися з Brevo: ${error.message}`);
  }

  const rawBody = await response.text();
  let body = null;
  if (rawBody) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const detail =
      body && (body.message || body.code)
        ? `: ${body.message || body.code}`
        : "";
    throw new Error(`Brevo відхилив лист (${response.status})${detail}`);
  }

  return { messageId: body && body.messageId ? body.messageId : null };
}

async function writeOutboxEntry(dataDirectory, entry) {
  if (!dataDirectory) {
    return null;
  }
  const directory = path.join(dataDirectory, OUTBOX_DIRECTORY);
  await fs.mkdir(directory, { recursive: true });
  const fileName = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}.json`;
  const filePath = path.join(directory, fileName);
  await fs.writeFile(filePath, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
  return filePath;
}

/**
 * Sends the account verification email.
 * Without BREVO_API_KEY / BREVO_SENDER_EMAIL the email is not sent; it is
 * written to <data>/outbox so the link stays reachable during local development.
 */
async function sendVerificationEmail({
  to,
  link,
  dataDirectory,
  logger = console
}) {
  const content = renderVerificationEmail({ link, email: to });

  if (!isBrevoConfigured()) {
    let outboxFile = null;
    try {
      outboxFile = await writeOutboxEntry(dataDirectory, {
        type: "verification",
        to,
        link,
        subject: content.subject,
        createdAt: new Date().toISOString()
      });
    } catch (error) {
      logger.warn(`[email] Не вдалося записати лист в outbox: ${error.message}`);
    }
    logger.warn(
      `[email] Brevo не налаштований (BREVO_API_KEY / BREVO_SENDER_EMAIL). ` +
        `Лист не відправлено. Посилання підтвердження: ${link}`
    );
    return { delivered: false, devLink: link, outboxFile };
  }

  const result = await sendViaBrevo({ to, content });
  return { delivered: true, messageId: result.messageId };
}

module.exports = {
  isBrevoConfigured,
  renderVerificationEmail,
  sendVerificationEmail,
  senderAddress
};
