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
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showAuthMessage(loginForm, "");

    const email = loginForm.querySelector("#email").value.trim();
    const password = loginForm.querySelector("#password").value;
    const submitButton = loginForm.querySelector('[type="submit"]');
    submitButton.disabled = true;
    try {
      const { user } = await authApi.post("/api/login", { email, password });
      await authApi.migrateLegacyData();
      applyUser(user);
      window.location.href = "index.html";
    } catch (error) {
      showAuthMessage(
        loginForm,
        error instanceof Error ? error.message : "Не вдалося увійти."
      );
    } finally {
      submitButton.disabled = false;
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
