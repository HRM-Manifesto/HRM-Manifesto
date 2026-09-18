(() => {
  "use strict";
  const body = document.body;
  if (!body || !body.classList.contains("home-v2")) return;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const hero = document.querySelector(".reframe-hero");
  const dark = document.querySelector(".reframe-dark");
  if (!hero) return;

  const labels = {
    en: "SUBJECTHOOD THRESHOLD · OPEN QUESTION",
    pl: "PRÓG PODMIOTOWOŚCI · PYTANIE OTWARTE",
    sv: "TRÖSKEL FÖR SUBJEKTSTATUS · ÖPPEN FRÅGA"
  };
  const language = document.documentElement.lang || "en";

  const canvas = document.createElement("canvas");
  canvas.className = "hrm-space-canvas";
  canvas.setAttribute("aria-hidden", "true");
  hero.prepend(canvas);

  const scene = document.createElement("img");
  scene.className = "hrm-duality-scene";
  scene.src = "/images/threshold-duality.svg?v=20260918-v2";
  scene.alt = "";
  scene.setAttribute("aria-hidden", "true");
  hero.append(scene);

  const field = document.createElement("div");
  field.className = "hrm-spatial-field";
  field.setAttribute("aria-hidden", "true");
  for (const name of ["r1", "r2", "r3"]) {
    const ring = document.createElement("span");
    ring.className = "threshold-ring " + name;
    field.append(ring);
  }
  const core = document.createElement("span");
  core.className = "threshold-core";
  const label = document.createElement("span");
  label.className = "threshold-label";
  label.textContent = labels[language] || labels.en;
  field.append(core, label);
  hero.append(field);
  if (dark) {
    const bridge = document.createElement("div");
    bridge.className = "reciprocity-bridge";
    bridge.setAttribute("aria-hidden", "true");
    bridge.append(document.createElement("span"), document.createElement("span"));
    dark.prepend(bridge);
  }

  const pointer = { x: 0, y: 0 };
  const updatePointer = (event) => {
    pointer.x = (event.clientX / window.innerWidth - 0.5) * 2;
    pointer.y = (event.clientY / window.innerHeight - 0.5) * 2;
    body.style.setProperty("--v3-mx", pointer.x.toFixed(3));
    body.style.setProperty("--v3-my", pointer.y.toFixed(3));
    body.style.setProperty("--v3-x", (pointer.x * 10).toFixed(2) + "px");
    body.style.setProperty("--v3-y", (pointer.y * 7).toFixed(2) + "px");
  };
  window.addEventListener("pointermove", updatePointer, { passive: true });

  const updateScroll = () => {
    const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    body.style.setProperty("--v3-scroll", (scrollY / max).toFixed(4));
  };
  updateScroll();
  addEventListener("scroll", updateScroll, { passive: true });

  const cardTargets = document.querySelectorAll(
    ".claim-grid article, .layer-grid article"
  );
  cardTargets.forEach((card) => {
    card.classList.add("depth-card");
    card.addEventListener("pointermove", (event) => {
      if (reduced.matches || innerWidth < 900) return;
      const rect = card.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      card.style.setProperty("--card-rx", ((0.5 - y) * 5).toFixed(2) + "deg");
      card.style.setProperty("--card-ry", ((x - 0.5) * 7).toFixed(2) + "deg");
      card.style.setProperty("--card-x", (x * 100).toFixed(1) + "%");
      card.style.setProperty("--card-y", (y * 100).toFixed(1) + "%");
    });
    card.addEventListener("pointerleave", () => {
      card.style.removeProperty("--card-rx");
      card.style.removeProperty("--card-ry");
      card.style.removeProperty("--card-x");
      card.style.removeProperty("--card-y");
    });
  });
  const revealTargets = document.querySelectorAll(
    ".reframe-section > .section-wide, .reframe-section > .section-inner"
  );
  if (!reduced.matches && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      }
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    revealTargets.forEach((el) => {
      el.classList.add("reveal-3d");
      observer.observe(el);
    });
  }

  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx || reduced.matches) return;

  let width = 0;
  let height = 0;
  let dpr = 1;
  let frame = 0;
  let active = true;
  const particles = Array.from({ length: 44 }, (_, i) => ({
    x: ((i * 37) % 101) / 100,
    y: ((i * 61 + 17) % 103) / 102,
    z: 0.25 + (((i * 29) % 71) / 100),
    phase: i * 0.43
  }));

  const resize = () => {
    const rect = hero.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  addEventListener("resize", resize, { passive: true });
  const render = (time) => {
    frame = requestAnimationFrame(render);
    if (!active) return;
    ctx.clearRect(0, 0, width, height);

    const points = particles.map((p) => {
      const drift = Math.sin(time * 0.00016 + p.phase) * 7 * p.z;
      return {
        x: p.x * width + pointer.x * 17 * p.z + drift,
        y: p.y * height + pointer.y * 11 * p.z,
        z: p.z
      };
    });

    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      for (let j = i + 1; j < points.length; j++) {
        const b = points[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 118) {
          const alpha = (1 - dist / 118) * 0.13 * Math.min(a.z, b.z);
          ctx.strokeStyle = "rgba(154,122,73," + alpha + ")";
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    for (const p of points) {
      const radius = 0.8 + p.z * 1.5;
      ctx.fillStyle = "rgba(154,122,73," + (0.18 + p.z * 0.34) + ")";
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  frame = requestAnimationFrame(render);

  const visibility = new IntersectionObserver(([entry]) => {
    active = entry.isIntersecting;
  }, { threshold: 0.01 });
  visibility.observe(hero);

  reduced.addEventListener?.("change", (event) => {
    if (event.matches) {
      cancelAnimationFrame(frame);
      ctx.clearRect(0, 0, width, height);
    }
  });
})();
