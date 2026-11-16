"use strict";

(function () {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "";
  const status = params.get("status");
  const messageElement = document.querySelector("#verify-result-message");
  const linkElement = document.querySelector("#verify-result-link");
  const api = window.SteamSiteApi;

  const setResult = (message, linkLabel, href) => {
    if (messageElement) {
      messageElement.textContent = message;
    }
    if (linkElement) {
      linkElement.textContent = linkLabel;
      linkElement.href = href;
    }
  };

  const showSuccess = () => {
    setResult(
      "Пошту підтверджено. Акаунт активний — можна користуватися каталогом, кошиком і бібліотекою.",
      "До каталогу",
      "index.html"
    );
  };

  const showInvalid = () => {
    setResult(
      "Посилання недійсне або застаріле. Увійди в акаунт і натисни «Надіслати лист ще раз», щоб отримати нове.",
      "Увійти",
      "login.html"
    );
  };

  const alreadyVerified = async () => {
    try {
      const { user } = await api.get("/api/me");
      return Boolean(user && user.emailVerified);
    } catch {
      return false;
    }
  };

  if (status === "ok") {
    showSuccess();
    return;
  }

  if (!token) {
    setResult(
      "Ця сторінка відкривається з листа підтвердження. Перейди за посиланням із листа.",
      "На головну",
      "index.html"
    );
    return;
  }

  (async () => {
    try {
      await api.post("/api/verify", { token });
      showSuccess();
    } catch (error) {
      const invalid =
        error && error.details && error.details.code === "invalid_token";
      if (!invalid) {
        setResult(
          error instanceof Error
            ? error.message
            : "Не вдалося підтвердити пошту. Спробуй ще раз.",
          "На головну",
          "index.html"
        );
        return;
      }
      // A repeated click on an already used link should still feel successful.
      if (await alreadyVerified()) {
        showSuccess();
        return;
      }
      showInvalid();
    }
  })();
})();
