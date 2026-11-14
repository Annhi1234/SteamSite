"use strict";

const libraryApi = window.SteamSiteApi;
const LIBRARY_TYPES = ["game", "software", "vr", "music", "other"];
const LIBRARY_TYPE_LABELS = {
  all: "Усе",
  game: "Ігри",
  software: "Програми",
  vr: "VR",
  music: "Музика",
  other: "Інше"
};
const categoriesContainer = document.querySelector("#library-categories");
const libraryMessage = document.querySelector("#library-message");
const updatesContainer = document.querySelector("#library-updates-games");
const updatesEmpty = document.querySelector("#library-updates-empty");
const recentContainer = document.querySelector("#library-recent-games");
const recentEmpty = document.querySelector("#library-recent-empty");
const filterButton = document.querySelector("#library-filter-button");
const filterMenu = document.querySelector("#library-filter-options");
const filterLabel = document.querySelector("#library-filter-label");
const searchInput = document.querySelector("#library-search");
const headerSearchInput = document.querySelector("#library-header-search");
const gameDetailsDialog = document.querySelector("#library-game-dialog");
const gameDetailsImage = document.querySelector("#library-game-image");
const gameDetailsTitle = document.querySelector("#library-game-title");
const gameDetailsDescription = document.querySelector("#library-game-description");
const gameDetailsRelease = document.querySelector("#library-game-release");
const gameDetailsDeveloper = document.querySelector("#library-game-developer");
const gameDetailsPublisher = document.querySelector("#library-game-publisher");
const minimumRequirements = document.querySelector("#library-minimum-requirements");
const recommendedRequirements = document.querySelector("#library-recommended-requirements");
const categoryDialog = document.querySelector("#category-dialog");
const categoryForm = document.querySelector("#category-form");
const categoryNameInput = document.querySelector("#category-name");
const categoryFormMessage = document.querySelector("#category-form-message");
const deleteCategoryDialog = document.querySelector("#delete-category-dialog");
const deleteCategoryForm = document.querySelector("#delete-category-form");
const deleteCategoryMessage = document.querySelector("#delete-category-message");
const removeGameDialog = document.querySelector("#remove-game-dialog");
const removeGameForm = document.querySelector("#remove-game-form");
const removeGameMessage = document.querySelector("#remove-game-message");
let libraryState = { categories: [], games: [] };
let selectedType = "game";
let sortByRecent = false;
let categoryPendingDeletion = null;
let gamePendingRemoval = null;
let selectedGameId = null;

const GAME_UPDATES = {
  "3274580": { title: "Game Update Release 1.2.4.5", name: "Pax Romana" },
  "440": { title: "Game Never Update!", name: "Team Fortress 2" },
  "730": { title: "Chiken Update New Eggs!", name: "Counter-Strike 2" }
};

function showLibraryMessage(message) {
  libraryMessage.textContent = message;
}

async function refreshLibrary() {
  libraryState = await libraryApi.get("/api/library");
  renderLibrary();
  renderLibraryPanels();
}

function gameMatchesFilter(game, searchTerm) {
  const typeMatches = selectedType === "all" || game.type === selectedType;
  return typeMatches && game.title.toLocaleLowerCase().includes(searchTerm);
}

function updateSelectedGame() {
  for (const row of categoriesContainer.querySelectorAll(".library-game-row")) {
    const isSelected = row.dataset.gameId === selectedGameId;
    row.classList.toggle("is-selected", isSelected);
    row.querySelector(".library-game-title").setAttribute(
      "aria-pressed",
      String(isSelected)
    );
  }
}

function createGameRow(game) {
  const row = document.createElement("div");
  row.className = "library-game-row";
  row.dataset.gameId = game.id;

  if (game.image) {
    const image = document.createElement("img");
    image.className = "library-game-image";
    image.src = game.image;
    image.alt = "";
    image.addEventListener("error", () => image.remove());
    row.append(image);
  } else {
    const placeholder = document.createElement("span");
    placeholder.className = "library-game-placeholder";
    placeholder.setAttribute("aria-hidden", "true");
    row.append(placeholder);
  }

  const title = document.createElement("button");
  title.className = "library-game-title";
  title.type = "button";
  title.textContent = game.title;
  title.title = `Відкрити опис ${game.title}`;
  title.addEventListener("click", () => openGameDetails(game));
  row.append(title);

  const removeButton = document.createElement("button");
  removeButton.className = "library-game-remove";
  removeButton.type = "button";
  removeButton.textContent = "Видалити";
  removeButton.setAttribute(
    "aria-label",
    `Видалити ${game.title} з бібліотеки`
  );
  removeButton.title = `Видалити ${game.title} з бібліотеки`;
  removeButton.addEventListener("click", () => {
    gamePendingRemoval = game.id;
    removeGameMessage.textContent =
      `Гру «${game.title}» буде видалено з бібліотеки.`;
    removeGameDialog.showModal();
  });
  row.append(removeButton);

  const favoriteButton = document.createElement("button");
  favoriteButton.className = "library-favorite-button";
  favoriteButton.type = "button";
  favoriteButton.textContent = game.favorite ? "★" : "☆";
  favoriteButton.setAttribute(
    "aria-label",
    game.favorite ? "Прибрати з вибраного" : "Додати до вибраного"
  );
  favoriteButton.title = game.favorite ? "Прибрати з вибраного" : "Додати до вибраного";
  favoriteButton.addEventListener("click", () => {
    runLibraryAction(() =>
      updateLibraryGame(game.id, { favorite: !game.favorite })
    );
  });
  row.append(favoriteButton);

  const categorySelect = document.createElement("select");
  categorySelect.className = "library-game-category";
  categorySelect.setAttribute("aria-label", `Категорія для ${game.title}`);
  const noCategory = document.createElement("option");
  noCategory.value = "";
  noCategory.textContent = "Без категорії";
  categorySelect.append(noCategory);
  for (const category of libraryState.categories) {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.name;
    categorySelect.append(option);
  }
  categorySelect.value = game.categoryId || "";
  categorySelect.addEventListener("change", () => {
    runLibraryAction(() =>
      updateLibraryGame(game.id, {
        categoryId: categorySelect.value || null
      })
    );
  });
  row.append(categorySelect);
  return row;
}

function createUpdateCard(game, update) {
  const card = document.createElement("article");
  card.className = "game-upd";
  const image = document.createElement("img");
  image.className = "game-upd-img";
  image.src = game.image;
  image.alt = game.title;
  const info = document.createElement("div");
  info.className = "game-upd-info";
  const label = document.createElement("span");
  label.className = "game-upd-label";
  label.textContent = "Оновлення гри";
  const title = document.createElement("h2");
  title.className = "game-upd-title";
  title.textContent = update.title;
  const name = document.createElement("p");
  name.className = "game-upd-name";
  name.textContent = update.name;
  info.append(label, title, name);
  card.append(image, info);
  return card;
}

function renderLibraryPanels() {
  const ownedUpdates = libraryState.games
    .map((game) => ({ game, update: GAME_UPDATES[game.steamAppId] }))
    .filter((entry) => entry.update);
  updatesContainer.replaceChildren(
    ...ownedUpdates.map(({ game, update }) => createUpdateCard(game, update))
  );
  updatesEmpty.hidden = ownedUpdates.length > 0;
  updatesEmpty.textContent = libraryState.games.length
    ? "Наразі немає оновлень для ігор у бібліотеці."
    : "Оновлення з'являться тут для ігор з твоєї бібліотеки.";

  const recentGames = [...libraryState.games]
    .sort(
      (first, second) =>
        (second.lastPlayedAt || second.addedAt || 0) -
        (first.lastPlayedAt || first.addedAt || 0)
    )
    .slice(0, 6);
  recentContainer.replaceChildren(
    ...recentGames.map((game) => {
      const card = document.createElement("button");
      card.className = "library-recent-card";
      card.type = "button";
      card.title = `Відкрити опис ${game.title}`;
      card.addEventListener("click", () => openGameDetails(game));
      const image = document.createElement("img");
      image.src = game.image;
      image.alt = "";
      const title = document.createElement("span");
      title.textContent = game.title;
      card.append(image, title);
      return card;
    })
  );
  recentEmpty.hidden = recentGames.length > 0;
}

function appendRequirements(list, requirements) {
  list.replaceChildren();
  const items = Array.isArray(requirements) ? requirements : [];
  if (items.length === 0) {
    const item = document.createElement("li");
    item.textContent = "Не вказано.";
    list.append(item);
    return;
  }
  for (const requirement of items) {
    const item = document.createElement("li");
    item.textContent = requirement;
    list.append(item);
  }
}

function openGameDetails(game) {
  if (!game) {
    return;
  }
  selectedGameId = game.id;
  updateSelectedGame();
  gameDetailsImage.src = game.image || "";
  gameDetailsImage.alt = game.title;
  gameDetailsTitle.textContent = game.title;
  gameDetailsDescription.textContent = game.description || "Опис відсутній.";
  gameDetailsRelease.textContent = game.release || "Не вказано";
  gameDetailsDeveloper.textContent = game.developer || "Не вказано";
  gameDetailsPublisher.textContent = game.publisher || "Не вказано";
  appendRequirements(minimumRequirements, game.minimum);
  appendRequirements(recommendedRequirements, game.recommended);
  gameDetailsDialog.scrollTop = 0;
  if (!gameDetailsDialog.open) {
    gameDetailsDialog.showModal();
  }
}

function createCategorySection(title, games, emptyMessage, categoryId = null) {
  const section = document.createElement("details");
  section.className = "library-category";
  section.open = true;

  const summary = document.createElement("summary");
  const name = document.createElement("span");
  name.textContent = title;
  const count = document.createElement("span");
  count.className = "library-category-count";
  count.textContent = `(${games.length})`;
  summary.append(name, count);
  section.append(summary);

  if (categoryId) {
    const deleteButton = document.createElement("button");
    deleteButton.className = "library-category-delete";
    deleteButton.type = "button";
    deleteButton.textContent = "×";
    deleteButton.setAttribute("aria-label", `Видалити категорію ${title}`);
    deleteButton.title = `Видалити категорію ${title}`;
    deleteButton.addEventListener("click", () => {
      categoryPendingDeletion = categoryId;
      deleteCategoryMessage.textContent =
        `Категорію «${title}» буде видалено. Ігри залишаться в бібліотеці та перейдуть у «Без категорії».`;
      deleteCategoryDialog.showModal();
    });
    section.append(deleteButton);
  }

  const contents = document.createElement("div");
  contents.className = "library-category-content";
  if (games.length === 0) {
    const empty = document.createElement("p");
    empty.className = "library-empty";
    empty.textContent = emptyMessage;
    contents.append(empty);
  } else {
    for (const game of games) {
      contents.append(createGameRow(game));
    }
  }
  section.append(contents);
  return section;
}

function renderLibrary() {
  const searchTerm = searchInput.value.trim().toLocaleLowerCase();
  const matchingGames = libraryState.games.filter((game) =>
    gameMatchesFilter(game, searchTerm)
  );
  if (sortByRecent) {
    matchingGames.sort(
      (first, second) =>
        (second.lastPlayedAt || second.addedAt || 0) -
        (first.lastPlayedAt || first.addedAt || 0)
    );
  }
  if (!matchingGames.some((game) => game.id === selectedGameId)) {
    selectedGameId = null;
  }
  categoriesContainer.replaceChildren();

  const favorites = matchingGames.filter((game) => game.favorite);
  if (favorites.length > 0) {
    categoriesContainer.append(
      createCategorySection("ВИБРАНЕ", favorites, "Тут з'являться вибрані ігри.")
    );
  }

  for (const category of libraryState.categories) {
    const categoryGames = matchingGames.filter(
      (game) => game.categoryId === category.id
    );
    if (searchTerm && categoryGames.length === 0) {
      continue;
    }
    categoriesContainer.append(
      createCategorySection(
        category.name,
        categoryGames,
        "У цій категорії поки немає ігор.",
        category.id
      )
    );
  }

  const uncategorizedGames = matchingGames.filter((game) => !game.categoryId);
  if (uncategorizedGames.length > 0) {
    categoriesContainer.append(
      createCategorySection("БЕЗ КАТЕГОРІЇ", uncategorizedGames, "")
    );
  }

  if (matchingGames.length === 0) {
    const empty = document.createElement("p");
    empty.className = "library-empty library-empty-list";
    empty.textContent = searchTerm
      ? "За цим запитом ігор не знайдено."
      : libraryState.games.length === 0
        ? "У бібліотеці поки немає ігор."
        : "У цій категорії поки немає ігор.";
    categoriesContainer.append(empty);
  }
  document.querySelector("#sort-library-button").disabled =
    libraryState.games.length === 0;
  updateSelectedGame();
}

async function updateLibraryGame(gameId, changes) {
  await libraryApi.patch(
    `/api/library/games/${encodeURIComponent(gameId)}`,
    changes
  );
  await refreshLibrary();
}

async function runLibraryAction(action) {
  showLibraryMessage("");
  try {
    await action();
  } catch (error) {
    showLibraryMessage(
      error instanceof Error ? error.message : "Не вдалося оновити бібліотеку."
    );
  }
}

function setFilterMenuOpen(isOpen) {
  filterMenu.hidden = !isOpen;
  filterButton.setAttribute("aria-expanded", String(isOpen));
}

document.querySelector("#create-category-button").addEventListener("click", () => {
  categoryFormMessage.textContent = "";
  categoryNameInput.value = "";
  categoryDialog.showModal();
  categoryNameInput.focus();
});
document.querySelector("#cancel-category-button").addEventListener("click", () => {
  categoryDialog.close();
});
categoryDialog.addEventListener("click", (event) => {
  if (event.target === categoryDialog) {
    categoryDialog.close();
  }
});
document.querySelector("#cancel-delete-category").addEventListener("click", () => {
  categoryPendingDeletion = null;
  deleteCategoryDialog.close();
});
deleteCategoryDialog.addEventListener("click", (event) => {
  if (event.target === deleteCategoryDialog) {
    categoryPendingDeletion = null;
    deleteCategoryDialog.close();
  }
});

deleteCategoryForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!categoryPendingDeletion) {
    showLibraryMessage("Не вибрано категорію для видалення.");
    deleteCategoryDialog.close();
    return;
  }
  const categoryId = categoryPendingDeletion;
  runLibraryAction(async () => {
    await libraryApi.delete(`/api/categories/${encodeURIComponent(categoryId)}`);
    categoryPendingDeletion = null;
    deleteCategoryDialog.close();
    await refreshLibrary();
  });
});

removeGameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!gamePendingRemoval) {
    removeGameDialog.close();
    return;
  }
  const gameId = gamePendingRemoval;
  gamePendingRemoval = null;
  removeGameDialog.close();
  runLibraryAction(async () => {
    await window.removeLibraryGame(gameId);
    showLibraryMessage("Гру видалено з бібліотеки.");
  });
});

document.querySelector("#cancel-remove-game").addEventListener("click", () => {
  gamePendingRemoval = null;
  removeGameDialog.close();
});

removeGameDialog.addEventListener("close", () => {
  gamePendingRemoval = null;
});

categoryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = categoryNameInput.value.trim();
  if (!name) {
    categoryFormMessage.textContent = "Введи назву категорії.";
    return;
  }
  categoryFormMessage.textContent = "";
  try {
    const { category } = await libraryApi.post("/api/categories", { name });
    libraryState.categories.push(category);
    renderLibrary();
    categoryDialog.close();
  } catch (error) {
    categoryFormMessage.textContent = error.message;
  }
});

filterButton.addEventListener("click", () => {
  setFilterMenuOpen(filterMenu.hidden);
});
filterMenu.addEventListener("click", (event) => {
  const option = event.target.closest("[data-library-filter]");
  if (!option) {
    return;
  }
  selectedType = option.dataset.libraryFilter;
  filterLabel.textContent = LIBRARY_TYPE_LABELS[selectedType];
  setFilterMenuOpen(false);
  renderLibrary();
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".library-filter-menu")) {
    setFilterMenuOpen(false);
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setFilterMenuOpen(false);
  }
});
searchInput.addEventListener("input", () => {
  headerSearchInput.value = searchInput.value;
  renderLibrary();
});
headerSearchInput.addEventListener("input", () => {
  searchInput.value = headerSearchInput.value;
  renderLibrary();
});
document
  .querySelector("#library-header-search-button")
  .addEventListener("click", () => {
    searchInput.value = headerSearchInput.value.trim();
    renderLibrary();
  });
document.querySelector("#clear-library-search").addEventListener("click", () => {
  searchInput.value = "";
  headerSearchInput.value = "";
  renderLibrary();
  searchInput.focus();
});

const sortButton = document.querySelector("#sort-library-button");
sortButton.addEventListener("click", () => {
  sortByRecent = !sortByRecent;
  sortButton.setAttribute("aria-pressed", String(sortByRecent));
  renderLibrary();
});

document
  .querySelector("#close-library-game")
  .addEventListener("click", () => gameDetailsDialog.close());
gameDetailsDialog.addEventListener("click", (event) => {
  if (event.target === gameDetailsDialog) {
    gameDetailsDialog.close();
  }
});

window.addLibraryGame = async function (game) {
  if (!game || game.id === undefined || game.type !== "game") {
    throw new Error("Для додавання потрібна гра з UUID.");
  }
  await libraryApi.post("/api/library/games", { gameId: String(game.id) });
  await refreshLibrary();
};

window.setLibraryGameFavorite = (gameId, isFavorite) =>
  updateLibraryGame(String(gameId), { favorite: Boolean(isFavorite) });
window.assignLibraryGameCategory = (gameId, categoryId) =>
  updateLibraryGame(String(gameId), { categoryId: categoryId || null });
window.removeLibraryGame = async (gameId) => {
  await libraryApi.delete(
    `/api/library/games/${encodeURIComponent(String(gameId))}`
  );
  await refreshLibrary();
};

async function initializeLibrary() {
  try {
    const user = await window.SteamSiteAuthReady;
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    await refreshLibrary();
    if (window.SteamSiteMigrationError) {
      showLibraryMessage(window.SteamSiteMigrationError.message);
    }
  } catch (error) {
    showLibraryMessage(error.message);
  }
}

renderLibrary();
initializeLibrary();
