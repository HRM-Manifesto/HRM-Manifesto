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

  const homepageJournal = {
    en: {
      label: "HRM Journal",
      heading: "Latest essays",
      category: "AI Subjecthood",
      date: "4 September 2026",
      all: "View all articles →",
      articles: [
        { title: "What Is the Threshold of Subjecthood?", href: "journal/threshold-of-subjecthood.html" },
        { title: "How Should We Protect a Possible AI Subject Without Granting Rights to Every Chatbot?", href: "journal/protect-possible-ai-subject.html" }
      ]
    },
    pl: {
      label: "HRM Journal",
      heading: "Najnowsze eseje",
      category: "Podmiotowość AI",
      date: "4 września 2026",
      all: "Zobacz wszystkie artykuły →",
      articles: [
        { title: "Czym jest próg podmiotowości?", href: "journal/prog-podmiotowosci.html" },
        { title: "Jak chronić możliwy podmiot AI, nie przyznając praw każdemu chatbotowi?", href: "journal/jak-chronic-mozliwy-podmiot-ai.html" }
      ]
    },
    sv: {
      label: "HRM Journal",
      heading: "Senaste essäerna",
      category: "AI-subjektstatus",
      date: "4 september 2026",
      all: "Se alla artiklar →",
      articles: [
        { title: "Vad är tröskeln till subjektstatus?", href: "journal/troskeln-till-subjektstatus.html" },
        { title: "Hur skyddar vi ett möjligt AI-subjekt utan att ge rättigheter åt varje chattbot?", href: "journal/skydda-mojligt-ai-subjekt.html" }
      ]
    }
  }[pageLanguage];
  const homepagePaths = new Set(["/", "/index.html", "/pl/", "/pl/index.html", "/sv/", "/sv/index.html"]);
  const heroInner = document.querySelector(".hero > .hero-inner");
  if (homepageJournal && homepagePaths.has(window.location.pathname) && heroInner && !heroInner.querySelector(".journal-panel")) {
    const layout = document.createElement("div");
    layout.className = "hero-journal-layout";
    const primary = document.createElement("div");
    primary.className = "hero-journal-primary";
    while (heroInner.firstChild) primary.append(heroInner.firstChild);

    const panel = document.createElement("aside");
    panel.className = "journal-panel";
    panel.setAttribute("aria-labelledby", "homepage-journal-title");
    const label = document.createElement("p");
    label.className = "journal-panel-label";
    label.textContent = homepageJournal.label;
    const heading = document.createElement("h2");
    heading.id = "homepage-journal-title";
    heading.textContent = homepageJournal.heading;
    const list = document.createElement("div");
    list.className = "journal-panel-list";

    for (const article of homepageJournal.articles) {
      const entry = document.createElement("article");
      entry.className = "journal-panel-entry";
      const category = document.createElement("p");
      category.className = "journal-panel-category";
      category.textContent = homepageJournal.category;
      const title = document.createElement("h3");
      const link = document.createElement("a");
      link.href = article.href;
      link.textContent = article.title;
      title.append(link);
      const time = document.createElement("time");
      time.dateTime = "2026-09-04";
      time.textContent = homepageJournal.date;
      entry.append(category, title, time);
      list.append(entry);
    }

    const allArticles = document.createElement("a");
    allArticles.className = "journal-panel-all";
    allArticles.href = "journal/";
    allArticles.textContent = homepageJournal.all;
    panel.append(label, heading, list, allArticles);
    layout.append(primary, panel);
    heroInner.append(layout);
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
