const slides = document.querySelectorAll(".games .game");
const previousButton = document.querySelector(".game-arrow-prev");
const nextButton = document.querySelector(".game-arrow-next");
let currentSlide = 0;

function showSlide(index) {
  slides[currentSlide].classList.remove("active");
  currentSlide = (index + slides.length) % slides.length;
  slides[currentSlide].classList.add("active");
}

previousButton.addEventListener("click", () => showSlide(currentSlide - 1));
nextButton.addEventListener("click", () => showSlide(currentSlide + 1));