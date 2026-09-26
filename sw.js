// Day Drive website – service worker for customer push messages only (no caching, the website works as usual)
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: "Day Drive", body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Day Drive", {
    body: d.body || "", tag: d.tag, renotify: !!d.tag, icon: "assets/icons/icon-192.png", badge: "assets/icons/icon-192.png", data: { url: d.url || "" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  // push-send sends "/ride.html?b=…&t=…" – open it inside this website (also when it lives in a sub-folder)
  const raw = (e.notification.data && e.notification.data.url) || "account.html";
  const target = new URL(raw.replace(/^\//, ""), self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url === target) return c.focus();
    return self.clients.openWindow(target);
  }));
});
