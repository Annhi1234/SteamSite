"use strict";

const authApi = window.SteamSiteApi;

function showAuthMessage(form, message) {
  const messageElement = form.querySelector("#auth-message");
  if (messageElement) {
    messageElement.textContent = message;
  }
}

function applyUser(user) {
  window.SteamSiteUser = user;
  document.body.classList.toggle("is-logged-in", Boolean(user));
  if (typeof window.setLoggedIn === "function") {
    window.setLoggedIn(Boolean(user));
  }
  window.dispatchEvent(
    new CustomEvent("steamsite-auth-change", { detail: { user } })
  );
}

window.SteamSiteAuthReady = (async () => {
  localStorage.removeItem("steamsite-demo-accounts");
  localStorage.removeItem("steamsite-demo-session");
  const { user } = await authApi.get("/api/me");
  applyUser(user);
  if (user) {
    try {
      await authApi.migrateLegacyData();
    } catch (error) {
      window.SteamSiteMigrationError = error;
    }
    if (document.querySelector("#login-form, #register-form")) {
      window.location.replace("index.html");
      return user;
    }
  }
  return user;
})();
window.SteamSiteAuthReady.catch(() => undefined);

const registerForm = document.querySelector("#register-form");
if (registerForm) {
  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showAuthMessage(registerForm, "");

    const email = registerForm.querySelector("#email").value.trim();
    const password = registerForm.querySelector("#password").value;
    const confirmPassword = registerForm.querySelector("#confirm-password").value;
    if (password !== confirmPassword) {
      showAuthMessage(registerForm, "Паролі не збігаються.");
      return;
    }

    const submitButton = registerForm.querySelector('[type="submit"]');
    submitButton.disabled = true;
    try {
      const { user } = await authApi.post("/api/register", { email, password });
      await authApi.migrateLegacyData();
      applyUser(user);
      window.location.href = "index.html";
    } catch (error) {
      showAuthMessage(
        registerForm,
        error instanceof Error ? error.message : "Не вдалося створити акаунт."
      );
    } finally {
      submitButton.disabled = false;
    }
  });
}

const loginForm = document.querySelector("#login-form");
if (loginForm) {
  let loginLockTimer = null;

  const stopLoginCountdown = () => {
    if (loginLockTimer) {
      clearInterval(loginLockTimer);
      loginLockTimer = null;
    }
  };

  const startLoginCountdown = (seconds) => {
    const submitButton = loginForm.querySelector('[type="submit"]');
    const messageElement = loginForm.querySelector("#auth-message");
    let remaining = Math.max(1, Math.ceil(Number(seconds) || 60));

    stopLoginCountdown();
    submitButton.disabled = true;

    const render = () => {
      if (remaining <= 0) {
        stopLoginCountdown();
        submitButton.disabled = false;
        if (messageElement) {
          messageElement.textContent =
            "Ліміт спроб скинуто. Спробуй увійти знову.";
        }
        return;
      }
      if (messageElement) {
        messageElement.textContent =
          `Забагато невдалих спроб. Спробуй ще раз через ${remaining} с.`;
      }
      remaining -= 1;
    };

    render();
    loginLockTimer = setInterval(render, 1000);
  };

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (loginLockTimer) {
      return;
    }

    showAuthMessage(loginForm, "");

    const email = loginForm.querySelector("#email").value.trim();
    const password = loginForm.querySelector("#password").value;
    const submitButton = loginForm.querySelector('[type="submit"]');
    submitButton.disabled = true;
    try {
      const { user } = await authApi.post("/api/login", { email, password });
      stopLoginCountdown();
      await authApi.migrateLegacyData();
      applyUser(user);
      window.location.href = "index.html";
    } catch (error) {
      const details = error && error.details;

      if (
        error &&
        error.status === 429 &&
        details &&
        details.retryAfterSeconds
      ) {
        startLoginCountdown(details.retryAfterSeconds);
      } else if (
        details &&
        Number.isInteger(details.attemptsLeft) &&
        details.attemptsLeft > 0
      ) {
        showAuthMessage(
          loginForm,
          `${error.message} Залишилось спроб: ${details.attemptsLeft}.`
        );
      } else {
        showAuthMessage(
          loginForm,
          error instanceof Error ? error.message : "Не вдалося увійти."
        );
      }
    } finally {
      if (!loginLockTimer) {
        submitButton.disabled = false;
      }
    }
  });
}

const logoutButton = document.querySelector("#logout-btn");
if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    logoutButton.disabled = true;
    try {
      await authApi.post("/api/logout", {});
      applyUser(null);
      window.location.reload();
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Не вдалося вийти з акаунта."
      );
      logoutButton.disabled = false;
    }
  });
}
