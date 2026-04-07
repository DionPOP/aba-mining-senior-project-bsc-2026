(function () {
  const slider = document.getElementById("hotelSlider");
  if (!slider) return;

  const slides = slider.querySelectorAll(".slide");
  const prevBtn = slider.querySelector(".prev");
  const nextBtn = slider.querySelector(".next");
  const dots = slider.querySelectorAll(".dot");

  let currentIndex = 0;
  let autoSlide;

  function showSlide(index) {
    slides.forEach((slide, i) => {
      slide.classList.toggle("active", i === index);
    });

    dots.forEach((dot, i) => {
      dot.classList.toggle("active", i === index);
    });

    currentIndex = index;
  }

  function nextSlide() {
    const nextIndex = (currentIndex + 1) % slides.length;
    showSlide(nextIndex);
  }

  function prevSlideFn() {
    const prevIndex = (currentIndex - 1 + slides.length) % slides.length;
    showSlide(prevIndex);
  }

  function startAutoSlide() {
    autoSlide = setInterval(nextSlide, 3000);
  }

  function stopAutoSlide() {
    clearInterval(autoSlide);
  }

  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      stopAutoSlide();
      nextSlide();
      startAutoSlide();
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      stopAutoSlide();
      prevSlideFn();
      startAutoSlide();
    });
  }

  dots.forEach((dot) => {
    dot.addEventListener("click", () => {
      stopAutoSlide();
      showSlide(Number(dot.dataset.index));
      startAutoSlide();
    });
  });

  let startX = 0;
  let endX = 0;

  slider.addEventListener("touchstart", (e) => {
    startX = e.touches[0].clientX;
  });

  slider.addEventListener("touchend", (e) => {
    endX = e.changedTouches[0].clientX;

    if (startX - endX > 50) {
      stopAutoSlide();
      nextSlide();
      startAutoSlide();
    } else if (endX - startX > 50) {
      stopAutoSlide();
      prevSlideFn();
      startAutoSlide();
    }
  });

  slider.addEventListener("mouseenter", stopAutoSlide);
  slider.addEventListener("mouseleave", startAutoSlide);

  showSlide(0);
  startAutoSlide();
})();
