"use strict";

const api = window.SteamSiteApi;
const featuredSlide = document.querySelector("#featured-slide");
const previousFeaturedButton = document.querySelector(".game-arrow-prev");
const nextFeaturedButton = document.querySelector(".game-arrow-next");
const saleGrid = document.querySelector("#sale-grid");
const salePreviousButton = document.querySelector("#sale-previous");
const saleNextButton = document.querySelector("#sale-next");
const salePagination = document.querySelector("#sale-pagination");
const catalogCards = document.querySelector("#catalog-cards");
const searchInput = document.querySelector("#catalog-search");
const gameDetailsDialog = document.querySelector("#game-details-dialog");
const gameDetailsImage = document.querySelector("#game-details-image");
const gameDetailsTitle = document.querySelector("#game-details-title");
const gameDetailsDescription = document.querySelector("#game-details-description");
const gameDetailsRelease = document.querySelector("#game-details-release");
const gameDetailsDeveloper = document.querySelector("#game-details-developer");
const gameDetailsPublisher = document.querySelector("#game-details-publisher");
const gameDetailsPrice = document.querySelector("#game-details-price");
const gameDetailsOriginalPrice = document.querySelector("#game-details-original-price");
const minimumRequirements = document.querySelector("#minimum-requirements");
const recommendedRequirements = document.querySelector("#recommended-requirements");
const addToCartButton = document.querySelector("#add-to-cart-button");
const gameCartFeedback = document.querySelector("#game-cart-feedback");
const cartButton = document.querySelector("#cart-button");
const cartCount = document.querySelector("#cart-count");
const cartDialog = document.querySelector("#cart-dialog");
const cartItemsContainer = document.querySelector("#cart-items");
const cartTotal = document.querySelector("#cart-total");
const cartMessage = document.querySelector("#cart-message");
const checkoutButton = document.querySelector("#checkout-button");
const siteMessage = document.querySelector("#site-message");
const loginButton = document.querySelector("#btny");
const libraryButton = document.querySelector("#btnx");
let games = [];
let featuredGames = [];
let saleGames = [];
let featuredIndex = 0;
let salePage = 0;
let currentGame = null;
let cart = { items: [], total: 0 };

function formatPrice(amount) {
  return `${new Intl.NumberFormat("uk-UA").format(amount)}₴`;
}

function currentPrice(game) {
  return game.salePrice === null ? game.price : game.salePrice;
}

function createPriceElement(game, extraClass = "") {
  const price = document.createElement("div");
  price.className = `price ${extraClass}`.trim();
  if (game.salePrice !== null) {
    const discount = document.createElement("span");
    discount.className = "catalog-discount";
    discount.textContent = `-${game.discountPercent}%`;
    const prices = document.createElement("span");
    prices.className = "catalog-prices";
    const original = document.createElement("del");
    original.textContent = formatPrice(game.price);
    const discounted = document.createElement("strong");
    discounted.className = "price-value";
    discounted.textContent = formatPrice(game.salePrice);
    prices.append(original, discounted);
    price.append(discount, prices);
  } else {
    const value = document.createElement("span");
    value.className = "price-value";
    value.textContent = game.price === 0 ? "Безкоштовно" : formatPrice(game.price);
    price.append(value);
  }
  return price;
}

function setClickable(element, game) {
  element.dataset.gameId = game.id;
  element.tabIndex = 0;
  element.setAttribute("role", "button");
  element.setAttribute("aria-haspopup", "dialog");
  element.setAttribute("aria-label", `Детальніше про ${game.title}`);
  element.addEventListener("click", () => openGameDetails(game));
  element.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openGameDetails(game);
    }
  });
}

function renderFeaturedGame() {
  featuredSlide.replaceChildren();
  if (featuredGames.length === 0) {
    return;
  }
  featuredIndex = (featuredIndex + featuredGames.length) % featuredGames.length;
  const game = featuredGames[featuredIndex];
  const card = document.createElement("article");
  card.className = "game active";
  const image = document.createElement("img");
  image.className = "game-img";
  image.src = game.image;
  image.alt = game.title;
  const info = document.createElement("div");
  info.className = "game-info";
  const title = document.createElement("h3");
  title.className = "game-title";
  title.textContent = game.title;
  const description = document.createElement("p");
  description.className = "game-description";
  description.textContent = game.description;
  info.append(title, description, createPriceElement(game));
  card.append(image, info);
  setClickable(card, game);
  featuredSlide.append(card);
}

function createSaleCard(game) {
  const card = document.createElement("article");
  card.className = "sale-card";
  const image = document.createElement("img");
  image.src = game.image;
  image.alt = game.title;
  const info = document.createElement("span");
  info.className = "sale-card-info";
  const title = document.createElement("span");
  title.className = "sale-card-title";
  title.textContent = game.title;
  const priceRow = document.createElement("span");
  priceRow.className = "sale-price-row";
  const discount = document.createElement("span");
  discount.className = "sale-discount-badge";
  discount.textContent = `-${game.discountPercent}%`;
  const prices = document.createElement("span");
  prices.className = "sale-prices";
  const original = document.createElement("del");
  original.className = "sale-original-price";
  original.textContent = formatPrice(game.price);
  const current = document.createElement("strong");
  current.className = "sale-current-price";
  current.textContent = formatPrice(game.salePrice);
  prices.append(original, current);
  priceRow.append(discount, prices);
  info.append(title, priceRow);
  card.append(image, info);
  setClickable(card, game);
  return card;
}

function renderSalePage() {
  const pageCount = Math.ceil(saleGames.length / 4);
  const start = salePage * 4;
  saleGrid.replaceChildren(
    ...saleGames.slice(start, start + 4).map(createSaleCard)
  );
  salePreviousButton.disabled = salePage === 0;
  saleNextButton.disabled = salePage >= pageCount - 1;
  salePagination.textContent = pageCount
    ? `Сторінка ${salePage + 1} з ${pageCount}`
    : "Акційних ігор поки немає.";
}

function createCatalogCard(game) {
  const card = document.createElement("article");
  card.className = "card game-card-link";
  const image = document.createElement("img");
  image.src = game.image;
  image.alt = game.title;
  image.className = "card-img-top";
  const body = document.createElement("div");
  body.className = "card-body";
  const title = document.createElement("h3");
  title.className = "card-title";
  title.textContent = game.title;
  const description = document.createElement("p");
  description.className = "card-text";
  description.textContent = game.description;
  body.append(title, description, createPriceElement(game, "catalog-price"));
  card.append(image, body);
  setClickable(card, game);
  return card;
}

function renderCatalog() {
  const searchTerm = searchInput.value.trim().toLocaleLowerCase();
  const matchingGames = games.filter((game) =>
    game.title.toLocaleLowerCase().includes(searchTerm)
  );
  catalogCards.replaceChildren(...matchingGames.map(createCatalogCard));
  if (matchingGames.length === 0) {
    const empty = document.createElement("p");
    empty.className = "catalog-empty";
    empty.textContent = "За цим запитом ігор не знайдено.";
    catalogCards.append(empty);
  }
}

function appendRequirementList(list, requirements) {
  list.replaceChildren();
  for (const requirement of requirements) {
    const item = document.createElement("li");
    item.textContent = requirement;
    list.append(item);
  }
}

function openGameDetails(game) {
  currentGame = game;
  gameDetailsImage.src = game.image;
  gameDetailsImage.alt = game.title;
  gameDetailsTitle.textContent = game.title;
  gameDetailsDescription.textContent = game.description;
  gameDetailsRelease.textContent = game.release;
  gameDetailsDeveloper.textContent = game.developer;
  gameDetailsPublisher.textContent = game.publisher;
  gameDetailsPrice.textContent =
    game.price === 0 ? "Безкоштовно" : formatPrice(currentPrice(game));
  gameDetailsOriginalPrice.hidden = game.salePrice === null;
  gameDetailsOriginalPrice.textContent =
    game.salePrice === null ? "" : formatPrice(game.price);
  gameCartFeedback.textContent = "";
  updateGameActionButton();
  appendRequirementList(minimumRequirements, game.minimum);
  appendRequirementList(recommendedRequirements, game.recommended);
  gameDetailsDialog.showModal();
}

function updateGameActionButton() {
  if (!currentGame) {
    return;
  }
  addToCartButton.textContent = currentGame.price === 0
    ? "Додати до бібліотеки"
    : "Додати у кошик";
}

function renderCart() {
  const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);
  cartCount.textContent = String(itemCount);
  cartItemsContainer.replaceChildren();
  if (cart.items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "cart-empty";
    empty.textContent = "Кошик поки порожній.";
    cartItemsContainer.append(empty);
  }
  for (const item of cart.items) {
    const row = document.createElement("div");
    row.className = "cart-item";
    const title = document.createElement("span");
    title.textContent = `${item.title} × ${item.quantity}`;
    const price = document.createElement("span");
    price.textContent = formatPrice(item.lineTotal);
    const removeButton = document.createElement("button");
    removeButton.className = "cart-remove-button";
    removeButton.type = "button";
    removeButton.textContent = "Прибрати";
    removeButton.addEventListener("click", async () => {
      try {
        cart = await api.delete(`/api/cart/${encodeURIComponent(item.gameId)}`);
        renderCart();
      } catch (error) {
        cartMessage.textContent = error.message;
      }
    });
    row.append(title, price, removeButton);
    cartItemsContainer.append(row);
  }
  cartTotal.textContent = `Разом: ${formatPrice(cart.total)}`;
  checkoutButton.disabled = cart.items.length === 0;
}

async function loadCart() {
  cart = await api.get("/api/cart");
  renderCart();
}

function requireLogin(action) {
  return window.SteamSiteAuthReady.then((user) => {
    if (user) {
      return true;
    }
    window.alert(`Щоб ${action}, увійди в акаунт.`);
    window.location.href = "login.html";
    return false;
  }).catch((error) => {
    cartMessage.textContent = error.message;
    return false;
  });
}

async function initializeStore() {
  try {
    const response = await api.get("/api/games");
    games = response.games;
    featuredGames = games.filter((game) => game.featured);
    saleGames = games.filter((game) => game.discountPercent > 0);
    renderFeaturedGame();
    renderSalePage();
    renderCatalog();
  } catch (error) {
    siteMessage.textContent = `Не вдалося завантажити каталог: ${error.message}`;
    return;
  }

  try {
    const user = await window.SteamSiteAuthReady;
    document.body.classList.toggle("is-logged-in", Boolean(user));
    if (window.SteamSiteMigrationError) {
      siteMessage.textContent = window.SteamSiteMigrationError.message;
    }
    if (user) {
      await loadCart();
    }
  } catch (error) {
    siteMessage.textContent = error.message;
  }
}

previousFeaturedButton.addEventListener("click", () => {
  featuredIndex -= 1;
  renderFeaturedGame();
});
nextFeaturedButton.addEventListener("click", () => {
  featuredIndex += 1;
  renderFeaturedGame();
});
salePreviousButton.addEventListener("click", () => {
  salePage -= 1;
  renderSalePage();
});
saleNextButton.addEventListener("click", () => {
  salePage += 1;
  renderSalePage();
});

searchInput.addEventListener("input", renderCatalog);
document.querySelector("#catalog-search-button").addEventListener("click", renderCatalog);
searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    renderCatalog();
  }
});

loginButton.addEventListener("click", () => {
  window.location.href = "login.html";
});
libraryButton.addEventListener("click", () => {
  window.location.href = "libary.html";
});
window.setLoggedIn = (isLoggedIn) => {
  document.body.classList.toggle("is-logged-in", isLoggedIn);
  updateGameActionButton();
};

document.querySelector("#close-game-details").addEventListener("click", () => {
  gameDetailsDialog.close();
});
gameDetailsDialog.addEventListener("click", (event) => {
  if (event.target === gameDetailsDialog) {
    gameDetailsDialog.close();
  }
});

addToCartButton.addEventListener("click", async () => {
  if (!currentGame || !(await requireLogin("продовжити"))) {
    return;
  }
  addToCartButton.disabled = true;
  try {
    if (currentGame.price === 0) {
      const result = await api.post("/api/library/games", {
        gameId: currentGame.id
      });
      gameCartFeedback.textContent = result.added
        ? `${currentGame.title} додано до бібліотеки.`
        : `${currentGame.title} вже є у бібліотеці.`;
    } else {
      cart = await api.post("/api/cart", { gameId: currentGame.id });
      renderCart();
      gameCartFeedback.textContent = `${currentGame.title} додано до кошика.`;
    }
  } catch (error) {
    gameCartFeedback.textContent = error.message;
  } finally {
    addToCartButton.disabled = false;
  }
});

cartButton.addEventListener("click", async () => {
  if (!(await requireLogin("переглянути кошик"))) {
    return;
  }
  try {
    await loadCart();
    cartMessage.textContent = "";
    cartDialog.showModal();
  } catch (error) {
    cartMessage.textContent = error.message;
  }
});

checkoutButton.addEventListener("click", async () => {
  if (!(await requireLogin("оформити покупку"))) {
    return;
  }
  checkoutButton.disabled = true;
  try {
    const receipt = await api.post("/api/checkout", {});
    cartMessage.textContent = receipt.message;
    await loadCart();
  } catch (error) {
    cartMessage.textContent = error.message;
  } finally {
    checkoutButton.disabled = cart.items.length === 0;
  }
});

document.querySelector("#close-cart").addEventListener("click", () => {
  cartDialog.close();
});
cartDialog.addEventListener("click", (event) => {
  if (event.target === cartDialog) {
    cartDialog.close();
  }
});

initializeStore();
