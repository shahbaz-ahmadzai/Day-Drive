/*
 * Day Drive Service – shared layout
 * Builds the icon set, the header (menu bar) and the footer once, so every page
 * (index, about, prices, booking) stays identical. Edit the header/footer here only.
 */
(function () {
  var page = document.body.getAttribute("data-page") || "home";
  var isHome = page === "home";
  var home = isHome ? "" : "index.html"; // on sub-pages, section links go back to the main page

  /* ---------- Icons (stroke icons, 24×24) ---------- */
  var ICONS = {
    plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
    briefcase: '<rect x="2" y="6" width="20" height="14" rx="2"/><path d="M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><path d="M22 13a18.15 18.15 0 0 1-20 0"/><path d="M12 12h.01"/>',
    gem: '<path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/>',
    rings: '<circle cx="8.5" cy="14" r="5.5"/><circle cx="15.5" cy="14" r="5.5"/><path d="m14 5.5 1.5-2.5 1.5 2.5-1.5 1.5z"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    pin: '<path d="M20 10c0 5-5.5 10.2-7.4 11.8a1 1 0 0 1-1.2 0C9.5 20.2 4 15 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    users: '<circle cx="12" cy="7" r="3.2"/><path d="M6.5 21v-2.2A4.8 4.8 0 0 1 11.3 14h1.4a4.8 4.8 0 0 1 4.8 4.8V21z"/><circle cx="5" cy="10" r="2.2"/><path d="M1.5 21v-1.6A3.4 3.4 0 0 1 4.9 16h1"/><circle cx="19" cy="10" r="2.2"/><path d="M22.5 21v-1.6a3.4 3.4 0 0 0-3.4-3.4h-1"/>',
    headset: '<path d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm0 0a9 9 0 1 1 18 0m0 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z"/><path d="M21 16v2a4 4 0 0 1-4 4h-5"/>',
    arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    chevronLeft: '<path d="m15 18-6-6 6-6"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
    instagram: '<rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><path d="M17.5 6.5h.01"/>',
    whatsapp: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a4 4 0 0 1-1.8-1.8l.8-1-1-2z"/>',
    linkedin: '<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>'
  };
  var sprite = '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">';
  Object.keys(ICONS).forEach(function (k) {
    sprite += '<symbol id="i-' + k + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + ICONS[k] + "</symbol>";
  });
  sprite += "</svg>";
  document.body.insertAdjacentHTML("afterbegin", sprite);
  window.icon = function (name, cls) {
    return '<svg class="icon ' + (cls || "") + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  };
  var icon = window.icon;

  /* ---------- Header ---------- */
  function navLink(key, href, id) {
    return '<li><a class="nav-link" href="' + href + '" data-nav="' + id + '" data-i18n="' + key + '"></a></li>';
  }
  var header =
    '<header class="site-header" id="top">' +
    '<div class="container header-inner">' +
    '<a class="brand" href="index.html" aria-label="Day Drive Service – Home">' +
    '<img src="assets/images/logo-light.svg" alt="Day Drive Service" width="150" height="116"></a>' +
    '<nav class="main-nav" id="main-nav" aria-label="Main">' +
    "<ul>" +
    navLink("nav.home", "index.html", "home") +
    navLink("nav.services", home + "#services", "services") +
    navLink("nav.fleet", home + "#fleet", "fleet") +
    navLink("nav.about", "about.html", "about") +
    navLink("nav.prices", "prices.html", "prices") +
    navLink("nav.contact", home + "#contact", "contact") +
    "</ul>" +
    '<a class="btn btn-gold nav-book-mobile" href="booking.html" data-i18n="btn.bookRide"></a>' +
    "</nav>" +
    '<div class="header-actions">' +
    '<div class="lang" id="lang">' +
    '<button class="lang-toggle" type="button" aria-haspopup="listbox" aria-expanded="false" data-i18n-attr="aria-label:nav.language">' +
    '<span class="lang-current">EN</span>' + icon("chevronDown", "icon-sm") + "</button>" +
    '<ul class="lang-menu" role="listbox">' +
    '<li><button type="button" role="option" data-lang="en"><span>EN</span> English</button></li>' +
    '<li><button type="button" role="option" data-lang="de"><span>DE</span> Deutsch</button></li>' +
    "</ul></div>" +
    '<a class="btn btn-gold header-book" href="booking.html" data-i18n="btn.bookRide"></a>' +
    '<button class="menu-toggle" type="button" aria-controls="main-nav" aria-expanded="false" data-i18n-attr="aria-label:nav.menu">' +
    icon("menu", "icon-open") + icon("close", "icon-close") + "</button>" +
    "</div></div></header>";

  /* ---------- Footer (this is the Contact area) ---------- */
  var footer =
    '<footer class="site-footer" id="contact">' +
    '<div class="container footer-grid">' +
    '<div class="footer-brand">' +
    '<a href="index.html" class="brand"><img src="assets/images/logo-light.svg" alt="Day Drive Service" width="150" height="116"></a>' +
    '<p data-i18n-html="footer.about"></p>' +
    '<div class="social">' +
    '<a href="#" aria-label="Facebook">' + icon("facebook") + "</a>" +
    '<a href="#" aria-label="Instagram">' + icon("instagram") + "</a>" +
    '<a href="https://wa.me/4917643241205" aria-label="WhatsApp">' + icon("whatsapp") + "</a>" +
    '<a href="#" aria-label="LinkedIn">' + icon("linkedin") + "</a>" +
    '<a href="mailto:info.daydriveservice@gmail.com" aria-label="E-Mail">' + icon("mail") + "</a>" +
    "</div></div>" +
    '<div class="footer-col"><h3 data-i18n="footer.contact"></h3><ul class="contact-list">' +
    '<li>' + icon("phone") + '<a href="tel:+4917643241205">0176 43241205</a></li>' +
    '<li>' + icon("phone") + '<a href="tel:+4915751235215">01575 1235 215</a></li>' +
    '<li>' + icon("mail") + '<a href="mailto:info.daydriveservice@gmail.com">info.daydriveservice@gmail.com</a></li>' +
    '<li>' + icon("pin") + '<span data-i18n="footer.address"></span></li>' +
    "</ul></div>" +
    '<div class="footer-col"><h3 data-i18n="footer.links"></h3><ul class="link-list">' +
    '<li><a href="index.html" data-i18n="nav.home"></a></li>' +
    '<li><a href="' + home + '#services" data-i18n="nav.services"></a></li>' +
    '<li><a href="' + home + '#fleet" data-i18n="nav.fleet"></a></li>' +
    '<li><a href="about.html" data-i18n="nav.about"></a></li>' +
    '<li><a href="prices.html" data-i18n="nav.prices"></a></li>' +
    '<li><a href="' + home + '#contact" data-i18n="nav.contact"></a></li>' +
    "</ul></div>" +
    '<div class="footer-col"><h3 data-i18n="footer.follow"></h3><div class="social social-lg">' +
    '<a href="#" aria-label="Facebook">' + icon("facebook") + "</a>" +
    '<a href="#" aria-label="Instagram">' + icon("instagram") + "</a>" +
    '<a href="#" aria-label="LinkedIn">' + icon("linkedin") + "</a>" +
    "</div></div>" +
    '<div class="footer-slogan" data-i18n-html="footer.slogan"></div>' +
    "</div>" +
    '<div class="footer-bottom"><div class="container footer-bottom-inner">' +
    '<p data-i18n="footer.rights"></p>' +
    '<ul><li><a href="#" data-i18n="footer.imprint"></a></li><li><a href="#" data-i18n="footer.privacy"></a></li><li><a href="#" data-i18n="footer.terms"></a></li></ul>' +
    "</div></div></footer>";

  var h = document.getElementById("site-header");
  var f = document.getElementById("site-footer");
  if (h) h.outerHTML = header;
  if (f) f.outerHTML = footer;

  // Fill any <span data-icon="name"></span> placeholders used inside the pages
  document.querySelectorAll("[data-icon]").forEach(function (el) {
    el.outerHTML = icon(el.getAttribute("data-icon"), el.className);
  });
})();
