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

  const navMain = document.querySelector(".nav-main");
  const isEnglishPage = document.documentElement.lang === "en";
  const isJournalPage = window.location.pathname.includes("/journal/");
  if (navMain && isEnglishPage && !isJournalPage && !navMain.querySelector('a[href="journal/"]')) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = "journal/";
    link.textContent = "Journal";
    item.append(link);
    navMain.append(item);
  }

  if (isEnglishPage && /\/threshold\.html$/u.test(window.location.pathname)) {
    const thresholdArticle = document.querySelector(".document-content");
    if (thresholdArticle) {
      const note = document.createElement("aside");
      note.className = "agent-caveat";
      note.setAttribute("aria-label", "Related HRM Journal essay");
      const heading = document.createElement("h2");
      heading.className = "document-subtitle";
      heading.textContent = "Related essay";
      const paragraph = document.createElement("p");
      paragraph.append("Read how HRM can approach uncertainty through ");
      const link = document.createElement("a");
      link.href = "journal/protect-possible-ai-subject.html";
      link.textContent = "proportional precautions for a possible AI subject";
      paragraph.append(link, ", without treating every chatbot as a subject.");
      note.append(heading, paragraph);
      thresholdArticle.append(note);
    }
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
