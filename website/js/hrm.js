(function () {
  "use strict";

  const header = document.querySelector(".site-header");
  const menuButton = document.querySelector(".menu-button");
  const navigation = document.querySelector(".site-nav");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const updateHeader = () => {
    if (header) header.classList.toggle("is-scrolled", window.scrollY > 12);
  };

  if (menuButton && navigation) {
    menuButton.addEventListener("click", () => {
      const open = menuButton.getAttribute("aria-expanded") === "true";
      menuButton.setAttribute("aria-expanded", String(!open));
      navigation.classList.toggle("is-open", !open);
    });

    navigation.addEventListener("click", (event) => {
      if (event.target instanceof HTMLAnchorElement) {
        menuButton.setAttribute("aria-expanded", "false");
        navigation.classList.remove("is-open");
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        menuButton.setAttribute("aria-expanded", "false");
        navigation.classList.remove("is-open");
        menuButton.focus();
      }
    });
  }

  const threshold = document.querySelector("[data-threshold]");
  const updateThreshold = () => {
    if (!threshold || reducedMotion.matches) return;
    const rect = threshold.getBoundingClientRect();
    const progress = Math.max(0, Math.min(1, 1 - rect.top / window.innerHeight));
    threshold.style.setProperty("--threshold-shift", `${(progress - 0.5) * 0.22}em`);
  };

  updateHeader();
  updateThreshold();
  window.addEventListener("scroll", updateHeader, { passive: true });
  window.addEventListener("scroll", updateThreshold, { passive: true });
  reducedMotion.addEventListener?.("change", updateThreshold);
})();
