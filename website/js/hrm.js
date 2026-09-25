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
        { title: "When Language Is Cheap: What Evidence of AI Subjecthood Is Hard to Fake?", href: "journal/hard-to-fake-ai-subjecthood.html" },
        { title: "Can a Non-Sentient AI Have Authentic Interests?", href: "journal/non-sentient-ai-authentic-interests.html" },
        { title: "AI Consent and Refusal: What Would Meaningful Autonomy Require?", href: "journal/ai-consent-and-refusal.html" },
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
        { title: "Gdy słowa są łatwe: jakie oznaki podmiotowości AI trudno podrobić?", href: "journal/trudne-do-podrobienia-oznaki-podmiotowosci-ai.html" },
        { title: "Czy nieodczuwająca AI może mieć autentyczne interesy?", href: "journal/nieodczuwajaca-ai-autentyczne-interesy.html" },
        { title: "Zgoda i odmowa AI: czego wymagałaby rzeczywista autonomia?", href: "journal/zgoda-i-odmowa-ai.html" },
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
        { title: "När ord är lätta: vilka tecken på AI-subjektstatus är svåra att fejka?", href: "journal/svara-att-fejka-tecken-pa-ai-subjektstatus.html" },
        { title: "Kan en icke-kännande AI ha genuina intressen?", href: "journal/icke-kannande-ai-genuina-intressen.html" },
        { title: "AI:s samtycke och vägran: vad skulle verklig autonomi kräva?", href: "journal/ai-samtycke-och-vagran.html" },
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

  // HRM Radar 1.0 - first-party, privacy-first analytics.
  const radar = (() => {
    try {
      const ls = window.localStorage;
      const ss = window.sessionStorage;
      const uuid = () => crypto.randomUUID ? crypto.randomUUID() : ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
      let anon = ls.getItem("hrm_radar_anon_v1");
      if (!anon) { anon = uuid(); ls.setItem("hrm_radar_anon_v1", anon); }
      let session = ss.getItem("hrm_radar_session_v1");
      if (!session) { session = uuid(); ss.setItem("hrm_radar_session_v1", session); }

      const day = new Date().toISOString().slice(0, 10);
      const lastDay = ls.getItem("hrm_radar_last_day_v1");
      let visitNo = Number(ls.getItem("hrm_radar_visit_no_v1") || "0");
      if (lastDay !== day) {
        visitNo += 1;
        ls.setItem("hrm_radar_last_day_v1", day);
        ls.setItem("hrm_radar_visit_no_v1", String(visitNo));
      }
      if (visitNo < 1) visitNo = 1;

      const qp = new URLSearchParams(location.search);
      let source = ss.getItem("hrm_radar_source_v1") || "";
      let medium = ss.getItem("hrm_radar_medium_v1") || "";
      let campaign = ss.getItem("hrm_radar_campaign_v1") || "";
      let content = ss.getItem("hrm_radar_content_v1") || "";
      let referrer = ss.getItem("hrm_radar_referrer_v1") || "";

      if (!source) {
        source = (qp.get("utm_source") || "").slice(0, 80);
        medium = (qp.get("utm_medium") || "").slice(0, 80);
        campaign = (qp.get("utm_campaign") || "").slice(0, 100);
        content = (qp.get("utm_content") || "").slice(0, 100);
        try {
          const r = document.referrer ? new URL(document.referrer) : null;
          if (r && r.hostname && r.hostname !== location.hostname) referrer = r.hostname;
        } catch (_) {}
        if (!source) source = referrer || "direct";
        ss.setItem("hrm_radar_source_v1", source);
        ss.setItem("hrm_radar_medium_v1", medium);
        ss.setItem("hrm_radar_campaign_v1", campaign);
        ss.setItem("hrm_radar_content_v1", content);
        ss.setItem("hrm_radar_referrer_v1", referrer);
      }

      const sent = new Set();
      const send = (event) => {
        const onceKey = event + "|" + location.pathname;
        if (sent.has(onceKey) && !["download", "contact_click", "discussion_click"].includes(event)) return;
        sent.add(onceKey);
        const payload = JSON.stringify({
          event, anon, session, visit_no: visitNo,
          path: location.pathname,
          lang: document.documentElement.lang || "other",
          source, medium, campaign, content, referrer
        });
        try {
          const blob = new Blob([payload], { type: "application/json" });
          if (navigator.sendBeacon && navigator.sendBeacon("/radar/collect.php", blob)) return;
        } catch (_) {}
        fetch("/radar/collect.php", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
          credentials: "same-origin"
        }).catch(() => {});
      };

      send("page_view");

      let active = 0;
      const timer = setInterval(() => {
        if (document.visibilityState === "visible") active += 1;
        if (active === 30) send("engaged_30");
        if (active === 120) { send("engaged_120"); clearInterval(timer); }
      }, 1000);

      let maxDepth = 0;
      const depthCheck = () => {
        const h = Math.max(document.documentElement.scrollHeight - innerHeight, 1);
        maxDepth = Math.max(maxDepth, Math.min(1, scrollY / h));
        if (maxDepth >= 0.5) send("scroll_50");
        if (maxDepth >= 0.9) send("scroll_90");
      };
      addEventListener("scroll", depthCheck, { passive: true });
      depthCheck();

      document.addEventListener("click", (event) => {
        const a = event.target instanceof Element ? event.target.closest("a[href]") : null;
        if (!a) return;
        const href = a.getAttribute("href") || "";
        if (/^mailto:/i.test(href)) return send("contact_click");
        if (/\.(pdf|docx?|txt|md|json|jsonl)(?:$|[?#])/i.test(href)) return send("download");
        try {
          const u = new URL(a.href, location.href);
          if (u.hostname && u.hostname !== location.hostname) send("discussion_click");
        } catch (_) {}
      }, { capture: true });

      return { send };
    } catch (_) {
      return { send: () => {} };
    }
  })();
})();
