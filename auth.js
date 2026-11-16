"use strict";

const authApi = window.SteamSiteApi;
const VERIFY_WAIT_MS = 5 * 60 * 1000;
const VERIFY_POLL_MS = 3000;

function setMessage(element, message) {
  if (!element) {
    return;
  }
  element.textContent = message || "";
}

function showAuthMessage(form, message) {
  setMessage(form.querySelector("#auth-message"), message);
}

function appendLink(element, href, label) {
  if (!element) {
    return;
  }
  const link = document.createElement("a");
  link.href = href;
  link.textContent = label;
  link.target = "_blank";
  link.rel = "noopener";
  element.append(" ", link);
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
  const verifyPanel = document.querySelector("#verify-panel");
  const verifyMessage = document.querySelector("#verify-panel-message");
  const verifyTimer = document.querySelector("#verify-panel-timer");
  const verifyDev = document.querySelector("#verify-panel-dev");
  let waitToken = null;
  let pollTimer = null;
  let countdownTimer = null;
  let waitDeadline = 0;
  let polling = false;

  const stopWaiting = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  };

  const leaveWithoutLogin = () => {
    stopWaiting();
    window.location.replace("index.html");
  };

  const renderCountdown = () => {
    const remaining = Math.max(0, waitDeadline - Date.now());
    if (remaining <= 0) {
      setMessage(verifyTimer, "00:00");
      leaveWithoutLogin();
      return;
    }
    const totalSeconds = Math.ceil(remaining / 1000);
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    setMessage(verifyTimer, `Залишилось ${minutes}:${seconds}`);
  };

  const checkVerification = async () => {
    if (!waitToken || polling) {
      return;
    }
    polling = true;
    try {
      const result = await authApi.get(
        `/api/verify/wait?token=${encodeURIComponent(waitToken)}`
      );
      if (result.verified) {
        stopWaiting();
        window.location.replace("index.html");
        return;
      }
      if (result.status === "expired") {
        stopWaiting();
        setMessage(verifyTimer, "");
        setMessage(
          verifyMessage,
          "Посилання для підтвердження застаріло. Увійди і натисни «Надіслати лист ще раз»."
        );
        window.setTimeout(() => window.location.replace("login.html"), 4000);
      }
    } catch {
      // A single failed poll must not break the countdown.
    } finally {
      polling = false;
    }
  };

  const startWaiting = ({ email, token, devLink, deliveryError }) => {
    registerForm.hidden = true;
    if (verifyPanel) {
      verifyPanel.hidden = false;
    }

    if (devLink) {
      setMessage(
        verifyMessage,
        "Brevo ще не налаштований, тому лист не відправлено. Локальне посилання підтвердження:"
      );
      if (verifyDev) {
        verifyDev.hidden = false;
        verifyDev.textContent = "";
        appendLink(verifyDev, devLink, "підтвердити пошту");
      }
    } else if (deliveryError) {
      setMessage(
        verifyMessage,
        `${deliveryError} Можеш увійти і натиснути «Надіслати лист ще раз».`
      );
    } else {
      setMessage(
        verifyMessage,
        `Ми надіслали лист на ${email}. Відкрий його і натисни «Підтвердити пошту».`
      );
    }

    if (!token) {
      return;
    }

    waitToken = token;
    waitDeadline = Date.now() + VERIFY_WAIT_MS;
    renderCountdown();
    countdownTimer = window.setInterval(renderCountdown, 1000);
    pollTimer = window.setInterval(checkVerification, VERIFY_POLL_MS);
  };

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
      const result = await authApi.post("/api/register", { email, password });
      const verification = result.verification || {};
      startWaiting({
        email,
        token: result.waitToken,
        devLink: verification.devLink,
        deliveryError:
          verification.sent === false && !verification.devLink
            ? verification.error || "Лист не вдалося надіслати."
            : null
      });
    } catch (error) {
      const details = error && error.details;
      if (details && details.code === "email_not_verified") {
        showAuthMessage(
          registerForm,
          "Ця пошта вже зареєстрована, але не підтверджена. Увійди і натисни «Надіслати лист ще раз»."
        );
      } else {
        showAuthMessage(
          registerForm,
          error instanceof Error ? error.message : "Не вдалося створити акаунт."
        );
      }
    } finally {
      submitButton.disabled = false;
    }
  });
}

const loginForm = document.querySelector("#login-form");
if (loginForm) {
  let loginLockTimer = null;
  const resendButton = loginForm.querySelector("#resend-verification");
  const resendMessage = loginForm.querySelector("#resend-message");

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

  if (resendButton) {
    resendButton.addEventListener("click", async () => {
      const email = loginForm.querySelector("#email").value.trim();
      if (!email) {
        setMessage(resendMessage, "Введи пошту, на яку надіслати лист.");
        return;
      }
      resendButton.disabled = true;
      setMessage(resendMessage, "Надсилаю лист…");
      try {
        const result = await authApi.post("/api/verify/resend", { email });
        if (result.devLink) {
          setMessage(
            resendMessage,
            "Brevo не налаштований, лист не відправлено. Локальне посилання:"
          );
          appendLink(resendMessage, result.devLink, "підтвердити пошту");
        } else if (result.sent) {
          setMessage(
            resendMessage,
            "Лист надіслано. Перевір пошту і папку «Спам»."
          );
        } else {
          setMessage(
            resendMessage,
            result.error || "Лист не вдалося надіслати. Спробуй пізніше."
          );
        }
      } catch (error) {
        setMessage(
          resendMessage,
          error instanceof Error ? error.message : "Не вдалося надіслати лист."
        );
      } finally {
        resendButton.disabled = false;
      }
    });
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (loginLockTimer) {
      return;
    }

    showAuthMessage(loginForm, "");
    setMessage(resendMessage, "");

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
      } else if (details && details.code === "email_not_verified") {
        showAuthMessage(
          loginForm,
          `${error.message} Натисни «Надіслати лист ще раз».`
        );
        if (resendButton) {
          resendButton.hidden = false;
        }
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
