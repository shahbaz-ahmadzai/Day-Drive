// Day Drive driver app – service worker: keeps the app shell for weak mobile signal and shows push messages
const CACHE = "dd-driver-v202609271000";
const SHELL = ["./", "index.html", "css/driver.css?v=202609271000", "js/app.js?v=202609271000", "js/ui.js", "js/i18n.js", "js/sb.js",
  "../assets/icons/driver-192.png", "../assets/icons/icon-192.png", "../assets/images/logo-light.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("dd-driver-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// app files: network first, cache as fallback. Data (Supabase) is never cached here.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: false }).then((r) => r || caches.match("index.html"))));
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: "Day Drive", body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Day Drive", {
    body: d.body || "", tag: d.tag, renotify: !!d.tag, icon: "../assets/icons/driver-192.png", badge: "../assets/icons/driver-192.png",
    data: { url: d.url || "" }, vibrate: [200, 100, 200],
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const raw = (e.notification.data && e.notification.data.url) || "";
  const hash = raw.includes("#") ? raw.slice(raw.indexOf("#")) : "#/home";
  const target = self.registration.scope + hash;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.startsWith(self.registration.scope)) { c.postMessage({ hash }); return c.focus(); }
    return self.clients.openWindow(target);
  }));
});
