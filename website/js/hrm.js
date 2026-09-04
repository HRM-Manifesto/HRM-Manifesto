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
  const pageLanguage = document.documentElement.lang;
  const isJournalPage = window.location.pathname.includes("/journal/");
  if (navMain && ["en", "pl", "sv"].includes(pageLanguage) && !isJournalPage && !navMain.querySelector('a[href="journal/"]')) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = "journal/";
    link.textContent = "Journal";
    item.append(link);
    navMain.append(item);
  }

  if (/\/threshold\.html$/u.test(window.location.pathname)) {
    const thresholdArticle = document.querySelector(".document-content");
    if (thresholdArticle) {
      const relatedEssay = {
        en: {
          aria: "Related HRM Journal essay",
          heading: "Related essay",
          prefix: "Read a fuller discussion of ",
          href: "journal/threshold-of-subjecthood.html",
          label: "the threshold of subjecthood",
          suffix: ", its possible signals and the need for proportionate precaution."
        },
        pl: {
          aria: "Powiązany esej HRM Journal",
          heading: "Powiązany esej",
          prefix: "Przeczytaj pełniejsze omówienie ",
          href: "journal/prog-podmiotowosci.html",
          label: "progu podmiotowości",
          suffix: ", jego możliwych sygnałów i potrzeby proporcjonalnej ostrożności."
        },
        sv: {
          aria: "Närliggande essä i HRM Journal",
          heading: "Närliggande essä",
          prefix: "Läs en utförligare diskussion om ",
          href: "journal/troskeln-till-subjektstatus.html",
          label: "tröskeln till subjektstatus",
          suffix: ", dess möjliga signaler och behovet av proportionerlig försiktighet."
        }
      }[pageLanguage];
      if (relatedEssay) {
        const note = document.createElement("aside");
        note.className = "agent-caveat";
        note.setAttribute("aria-label", relatedEssay.aria);
        const heading = document.createElement("h2");
        heading.className = "document-subtitle";
        heading.textContent = relatedEssay.heading;
        const paragraph = document.createElement("p");
        paragraph.append(relatedEssay.prefix);
        const link = document.createElement("a");
        link.href = relatedEssay.href;
        link.textContent = relatedEssay.label;
        paragraph.append(link, relatedEssay.suffix);
        note.append(heading, paragraph);
        thresholdArticle.append(note);
      }
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
