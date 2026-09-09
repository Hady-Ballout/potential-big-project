/* Interphone service worker: Web Push only. No caching (the app is online-only for now). */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { /* non-JSON push: show defaults */ }
  const url = data.url || "/app";
  e.waitUntil(
    self.registration.showNotification(data.title || "Visitor at the door", {
      body: data.body || "",
      tag: data.tag || "interphone",
      renotify: true,
      requireInteraction: true,
      icon: "/icon-192.png",
      data: { url, visit_id: data.visit_id },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/app", self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const existing = list.find((w) => new URL(w.url).origin === self.location.origin);
      if (existing) return existing.focus().then((w) => (w && w.navigate ? w.navigate(url) : w));
      return self.clients.openWindow(url);
    }),
  );
});
