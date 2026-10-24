/* ==================================================================
   DTD TOOLS CATALOG — shared by the tools pages (browser) and the
   download API (server). Works in both places:

     Browser : <script src="tools-data.cjs"></script>  → window.DTD_TOOLS
     Server  : require("./tools-data.cjs")              → array of tools

   HOW TO ADD A TOOL / YOUR REAL SOFTWARE
   --------------------------------------
   1. Put your software file into  assets/tools/  (e.g. MyTool.zip)
   2. Add (or edit) an entry below. `file` is a RELATIVE path from the
      site root, e.g.  "assets/tools/MyTool.zip"
   3. That's it — the download button will deliver that file after the
      visitor submits the name/email/phone form.
   ================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DTD_TOOLS = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  const TOOLS = [
    // ─────────────── FREE TOOLS ───────────────
    {
      id: "smtp-checker",
      name: "SMTP Checker Pro V4",
      short: "Fast multi-threaded SMTP validator for Windows.",
      description:
        "SMTP Checker Pro v4 validates SMTP server configurations at high speed using multi-threading. It checks each server locally, saves the working ones into a clean `.txt` list, and shows live progress as it works. Optimized for Windows, no install required — the perfect companion for anyone who needs to verify SMTP setups quickly and safely.",
      kind: "free",
      tag: "Free",
      version: "v4.0",
      date: "2025-08-14",
      downloads: 1967,
      icon: "📮",
      accent: "#22d3a7",
      file: "assets/tools/smtp-checker-pro-v4.zip"
    },
    {
      id: "website-grabber",
      name: "Website Grabber V3",
      short: "Extract every domain bound to any IP address.",
      description:
        "Website Grabber v3 pulls all domains connected to a given IP in seconds. Multi-threaded scanning, real-time progress, and results saved in an organized format so you can feed them straight into other tools. Built for Windows, no setup required.",
      kind: "free",
      tag: "Free",
      version: "v3.0",
      date: "2025-08-10",
      downloads: 1423,
      icon: "🕸️",
      accent: "#38bdf8",
      file: "assets/tools/website-grabber-v3.zip"
    },
    {
      id: "cms-filter",
      name: "CMS Filter V3",
      short: "Detect the CMS behind any site — WordPress, Laravel and more.",
      description:
        "CMS Filter v3 detects the platform powering any website, supporting WordPress, Laravel, Joomla, Drupal, Magento and more. Up to 50 threads scan large lists fast, and results are sorted automatically into clean text files by CMS type. Windows, no install, live feedback while it scans.",
      kind: "free",
      tag: "Free",
      version: "v3.0",
      date: "2025-08-06",
      downloads: 991,
      icon: "🧬",
      accent: "#a78bfa",
      file: "assets/tools/cms-filter-v3.zip"
    },
    {
      id: "scrapex-lite",
      name: "ScrapeX Lite V4",
      short: "Real-time domain discovery with built-in CMS filtering.",
      description:
        "ScrapeX Lite v4 auto-fetches live domains in real time and drops them into organized result files. Designed for researchers and recon work, it cleans the list as it goes and needs zero coding or installation. Optimized for Windows.",
      kind: "free",
      tag: "Free",
      version: "v4.0",
      date: "2025-08-01",
      downloads: 1503,
      icon: "⚡",
      accent: "#fbbf24",
      file: "assets/tools/scrapex-lite-v4.zip"
    },

    // ─────────────── PRO TOOLS (paid) ───────────────
    {
      id: "smtp-cracker",
      name: "SMTP Cracker Pro V6",
      short: "High-speed SMTP credential cracking, up to 50 threads.",
      description:
        "SMTP Cracker Pro v6 processes thousands of accounts in minutes with up to 50 concurrent threads and automatic server detection for Gmail, Outlook, Yahoo and 20+ providers. Instant auto-save, real-time Telegram alerts, full SSL/STARTTLS support and unlimited combo lists without freezing. Single portable executable — no install needed.",
      kind: "pro",
      tag: "Pro",
      version: "v6.0",
      date: "2025-11-30",
      downloads: 2104,
      price: 80,
      icon: "🔥",
      accent: "#f87171",
      file: "assets/tools/smtp-cracker-pro-v6.zip"
    },
    {
      id: "dtd-sender",
      name: "DTD Sender Suite V2",
      short: "Professional email marketing & SMTP management suite.",
      description:
        "DTD Sender Suite v2 combines powerful SMTP management with campaign automation — multiple message templates, open-rate tracking, subject and sender encryption, and a sleek dark interface. Manage single or multiple SMTP setups, test deliverability, and run clean campaigns with real-time analytics.",
      kind: "pro",
      tag: "Pro",
      version: "v2.0",
      date: "2025-08-24",
      downloads: 847,
      price: 199,
      icon: "🚀",
      accent: "#34d399",
      file: "assets/tools/dtd-sender-suite-v2.zip"
    },
    {
      id: "smtp-digger",
      name: "SMTP Digger Pro V5",
      short: "Scan sites for exposed SMTP credentials at high speed.",
      description:
        "SMTP Digger Pro v5 scans websites for exposed SMTP credentials with refined detection logic and new vulnerability checks. Ultra-fast multi-threaded scanning, real-time Telegram alerts, automatic host/port/user/password detection and one-click exports. Built exclusively for Windows.",
      kind: "pro",
      tag: "Pro",
      version: "v5.0",
      date: "2025-03-15",
      downloads: 1289,
      price: 70,
      icon: "⛏️",
      accent: "#fb923c",
      file: "assets/tools/smtp-digger-pro-v5.zip"
    },
    {
      id: "scrapex-premium",
      name: "ScrapeX Premium V4",
      short: "Full license — unlimited scans and premium features.",
      description:
        "The ScrapeX Premium V4 license unlocks the full tool: unlimited scans, enhanced CMS filtering, faster performance and priority updates. Intended for professionals who run high-volume or advanced jobs.",
      kind: "pro",
      tag: "Pro",
      version: "v4.0",
      date: "2025-02-27",
      downloads: 764,
      price: 40,
      icon: "👑",
      accent: "#facc15",
      file: "assets/tools/scrapex-premium-v4.zip"
    }
  ];

  TOOLS.findById = function (id) {
    return TOOLS.find((t) => t.id === String(id || "").toLowerCase()) || null;
  };

  return TOOLS;
});