"use strict";

const { handleApiRequest, initialize } = require("./_lib/server");

let initialization;

module.exports = async function handler(request, response) {
  try {
    if (
      process.env.VERCEL === "1" &&
      !process.env.STEAMSITE_DATA_DIR &&
      (!process.env.DATABASE_URL || !process.env.STEAMSITE_APP_SECRET)
    ) {
      throw new Error(
        "DATABASE_URL and STEAMSITE_APP_SECRET are required on Vercel."
      );
    }

    if (!initialization) {
      initialization = initialize().catch((error) => {
        initialization = undefined;
        throw error;
      });
    }
    await initialization;
    await handleApiRequest(request, response);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) {
      response.writeHead(500, {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff"
      });
      response.end(JSON.stringify({ error: "Сталася помилка сервера." }));
    } else {
      response.destroy(error);
    }
  }
};
