"use strict";

(function () {
  async function request(url, options = {}) {
    const requestOptions = {
      method: options.method || "GET",
      credentials: "same-origin",
      headers: {}
    };

    if (options.body !== undefined) {
      requestOptions.headers["Content-Type"] = "application/json";
      requestOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, requestOptions);
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("Сервер повернув некоректну відповідь.");
    }
    if (!response.ok) {
      throw new Error(result.error || `Помилка запиту (${response.status}).`);
    }
    return result;
  }

  function readLegacyJson(key, fallback) {
    const savedValue = localStorage.getItem(key);
    if (savedValue === null) {
      return fallback;
    }
    try {
      return JSON.parse(savedValue);
    } catch {
      throw new Error(`Не вдалося прочитати старі дані (${key}). Вони залишилися у браузері.`);
    }
  }

  async function migrateLegacyData() {
    const legacyLibrary = readLegacyJson("steamsite-library-data", {
      categories: [],
      games: []
    });
    const legacyCart = readLegacyJson("steamsite-cart-v1", []);

    if (
      !legacyLibrary ||
      !Array.isArray(legacyLibrary.categories) ||
      !Array.isArray(legacyLibrary.games) ||
      !Array.isArray(legacyCart)
    ) {
      throw new Error("Старі дані бібліотеки або кошика мають неправильний формат.");
    }

    const hasLegacyData =
      legacyLibrary.categories.length > 0 ||
      legacyLibrary.games.length > 0 ||
      legacyCart.length > 0;
    const result = hasLegacyData
      ? await request("/api/migrate/legacy", {
          method: "POST",
          body: { library: legacyLibrary, cart: legacyCart }
        })
      : null;

    localStorage.removeItem("steamsite-demo-accounts");
    localStorage.removeItem("steamsite-demo-session");
    localStorage.removeItem("steamsite-library-data");
    localStorage.removeItem("steamsite-cart-v1");
    return result;
  }

  window.SteamSiteApi = {
    get: (url) => request(url),
    post: (url, body) => request(url, { method: "POST", body }),
    patch: (url, body) => request(url, { method: "PATCH", body }),
    delete: (url) => request(url, { method: "DELETE" }),
    migrateLegacyData
  };
})();
