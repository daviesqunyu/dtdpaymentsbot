/* ============================================================
   DTD Motion Engine (scroll.js)
   Scroll progress bar, scroll reveals, scrolly sections,
   parallax layers, and the home story reel.
   Pure vanilla. Respects prefers-reduced-motion.
   Exposes window.DTDMotion.refresh() for SPA page switches.
   ============================================================ */
(function () {
  "use strict";

  const reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (reduceMq.matches) return;

  document.documentElement.classList.add("motion-ok");

  const progressBar = document.getElementById("scrollProgress");
  const isMobile = () =>
    window.innerWidth < 768 || document.documentElement.classList.contains("tg-mini-app");

  let scrollyEls = [];
  let parallaxEls = [];
  let ticking = false;

  function collect() {
    scrollyEls = Array.from(document.querySelectorAll("[data-scrolly]"));
    parallaxEls = isMobile()
      ? []
      : Array.from(document.querySelectorAll(".page-visual-bg, .ambient-layer"));
  }

  /* ---------- home story reel ---------- */
  let reelStage = null;
  let reelFrames = [];
  let reelDots = [];

  function wireReel() {
    reelStage = document.querySelector("#homeReel");
    reelFrames = Array.from(document.querySelectorAll("#homeReel .reel-frame"));
    reelDots = Array.from(document.querySelectorAll("#homeReel .reel-dot"));
  }

  function updateReel() {
    if (!reelStage || !reelFrames.length) return;
    const p = parseFloat(reelStage.style.getPropertyValue("--scrolly") || "0");
    const n = reelFrames.length;

    reelFrames.forEach((frame, i) => {
      let local;
      if (p <= 0.001) local = i === 0 ? 0.5 : 0;
      else if (p >= 0.999) local = i === n - 1 ? 0.5 : 0;
      else local = Math.min(1, Math.max(0, p * n - i + 0.5));
      const ease = Math.sin(local * Math.PI);
      const visible = ease > 0.02;
      frame.classList.toggle("is-live", visible);
      frame.style.opacity = ease.toFixed(3);
      const lift = (0.5 - local) * 90;
      frame.style.transform =
        "translate3d(0, " + lift.toFixed(1) + "px, 0) scale(" + (0.92 + 0.08 * ease).toFixed(3) + ")";
    });

    const activeIdx = Math.max(0, Math.min(n - 1, Math.round(p * (n - 1))));
    reelDots.forEach((dot, i) => dot.classList.toggle("is-active", i === activeIdx));
  }

  /* ---------- per-frame update ---------- */
  function update() {
    const vh = window.innerHeight || 1;

    if (progressBar) {
      const max = document.documentElement.scrollHeight - vh;
      progressBar.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + "%";
    }

    for (let i = 0; i < scrollyEls.length; i++) {
      const el = scrollyEls[i];
      const r = el.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= vh) continue;
      const p = Math.min(1, Math.max(0, (vh - r.top) / (vh + r.height)));
      el.style.setProperty("--scrolly", p.toFixed(3));
    }

    for (let i = 0; i < parallaxEls.length; i++) {
      const el = parallaxEls[i];
      const r = el.getBoundingClientRect();
      if (r.bottom <= -80 || r.top >= vh + 80) continue;
      const center = r.top + r.height / 2 - vh / 2;
      el.style.transform = "translate3d(0, " + (center * -0.12).toFixed(1) + "px, 0)";
    }

    updateReel();
  }

  function onFrame() {
    ticking = false;
    update();
  }

  function schedule() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(onFrame);
  }

  /* ---------- reveal system ---------- */
  const revealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-revealed");
          revealObserver.unobserve(entry.target);
        }
      }
    },
    { rootMargin: "0px 0px -10% 0px", threshold: 0.05 }
  );

  function observeReveals() {
    revealObserver.disconnect();
    const scope = "section.page:not([hidden]) ";
    const targets = [
      scope + "[data-reveal]",
      scope + ".page-intro",
      scope + ".page-intro-pills",
      scope + ".feature-tile",
      scope + ".home-visual-card",
      scope + ".faq-item",
      scope + ".smtp-panel",
      scope + ".track-form",
      scope + ".trade-panel",
    ].join(",");
    document.querySelectorAll(targets).forEach((el) => revealObserver.observe(el));
  }

  /* ---------- refresh on SPA page switch ---------- */
  function refresh() {
    collect();
    wireReel();
    observeReveals();
    schedule();
  }

  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("load", schedule, { passive: true });
  document.addEventListener("DOMContentLoaded", refresh);

  window.DTDMotion = { refresh, schedule };
})();
