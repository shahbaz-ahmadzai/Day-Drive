/*
 * Day Drive Service – page behaviour
 * - Language switch (English / Deutsch) using js/translations.js
 * - Mobile menu
 * - Highlights the current menu item while scrolling
 * - Fleet slider
 */
(function () {
  var T = window.TRANSLATIONS || {};
  var STORAGE_KEY = "dds-lang";
  var page = document.body.getAttribute("data-page") || "home";

  /* ---------- Language ---------- */
  function getSavedLang() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved && T[saved]) return saved;
    } catch (e) {}
    var nav = (navigator.language || "en").slice(0, 2).toLowerCase();
    return T[nav] ? nav : "en";
  }

  function t(lang, key) {
    var value = (T[lang] && T[lang][key]) || (T.en && T.en[key]) || "";
    return value.replace("{year}", new Date().getFullYear());
  }

  function applyLang(lang) {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(lang, el.getAttribute("data-i18n"));
    });
    document.querySelectorAll("[data-i18n-html]").forEach(function (el) {
      el.innerHTML = t(lang, el.getAttribute("data-i18n-html"));
    });
    // data-i18n-attr="alt:key; aria-label:key2"
    document.querySelectorAll("[data-i18n-attr]").forEach(function (el) {
      el.getAttribute("data-i18n-attr").split(";").forEach(function (pair) {
        var p = pair.split(":");
        if (p.length === 2) el.setAttribute(p[0].trim(), t(lang, p[1].trim()));
      });
    });
    var titleKey = document.body.getAttribute("data-title-key") || "meta.title";
    document.title = t(lang, titleKey);
    var desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute("content", t(lang, "meta.description"));

    var current = document.querySelector(".lang-current");
    if (current) current.textContent = lang.toUpperCase();
    document.querySelectorAll("[data-lang]").forEach(function (b) {
      b.setAttribute("aria-selected", b.getAttribute("data-lang") === lang ? "true" : "false");
    });
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
  }

  applyLang(getSavedLang());

  var langBox = document.getElementById("lang");
  if (langBox) {
    var toggle = langBox.querySelector(".lang-toggle");
    toggle.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = langBox.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    langBox.querySelectorAll("[data-lang]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        applyLang(btn.getAttribute("data-lang"));
        langBox.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
    document.addEventListener("click", function () {
      langBox.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    });
  }

  /* ---------- Header: shadow on scroll + mobile menu ---------- */
  var header = document.querySelector(".site-header");
  function onScroll() {
    if (header) header.classList.toggle("scrolled", window.scrollY > 10);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  var menuBtn = document.querySelector(".menu-toggle");
  if (menuBtn) {
    menuBtn.addEventListener("click", function () {
      var open = document.body.classList.toggle("nav-open");
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.querySelectorAll(".main-nav a").forEach(function (a) {
      a.addEventListener("click", function () {
        document.body.classList.remove("nav-open");
        menuBtn.setAttribute("aria-expanded", "false");
      });
    });
  }

  /* ---------- Active menu item ---------- */
  function setActive(id) {
    document.querySelectorAll(".nav-link").forEach(function (a) {
      a.classList.toggle("active", a.getAttribute("data-nav") === id);
    });
  }

  if (page !== "home") {
    setActive(page); // about / prices; booking highlights nothing
  } else {
    // Logo and "Home" scroll smoothly back to the top when already on the main page
    document.querySelectorAll('a[href="index.html"]').forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        history.replaceState(null, "", "index.html");
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });

    var sections = ["services", "fleet", "contact"]
      .map(function (id) { return document.getElementById(id); })
      .filter(Boolean);
    function spy() {
      var y = window.scrollY + window.innerHeight * 0.35;
      var active = "home";
      sections.forEach(function (s) {
        if (s.offsetTop <= y) active = s.id;
      });
      // the footer is short – mark Contact once the bottom of the page is reached
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) active = "contact";
      setActive(active);
    }
    window.addEventListener("scroll", spy, { passive: true });
    window.addEventListener("load", spy);
    spy();
  }

  /* ---------- Fleet slider ---------- */
  var slider = document.querySelector("[data-slider]");
  if (slider) {
    var slides = slider.querySelectorAll(".fleet-slide");
    var dotsBox = slider.querySelector(".slider-dots");
    var index = 0;
    slides.forEach(function (_, i) {
      var d = document.createElement("button");
      d.type = "button";
      d.setAttribute("aria-label", String(i + 1));
      d.addEventListener("click", function () { go(i); });
      dotsBox.appendChild(d);
    });
    function go(i) {
      index = (i + slides.length) % slides.length;
      slides.forEach(function (s, n) { s.classList.toggle("is-active", n === index); });
      dotsBox.querySelectorAll("button").forEach(function (d, n) { d.classList.toggle("is-active", n === index); });
    }
    slider.querySelector(".slider-prev").addEventListener("click", function () { go(index - 1); });
    slider.querySelector(".slider-next").addEventListener("click", function () { go(index + 1); });
    go(0);
  }
})();
