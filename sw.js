/* 멘토링 파이썬 학습앱 서비스워커 — 오프라인 + 빠른 재방문(stale-while-revalidate) */
const V = "pyquiz-v2-12";
const ASSETS = ["./", "./index.html", "./style.css", "./app.js", "./data.js"];
self.addEventListener("install", e => { self.skipWaiting(); e.waitUntil(caches.open(V).then(c => c.addAll(ASSETS).catch(() => {}))); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k.indexOf("pyquiz-") === 0).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || e.request.url.indexOf("http") !== 0) return;
  e.respondWith(caches.match(e.request).then(cached => {
    const net = fetch(e.request).then(res => { if (res && res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(e.request, cp)); } return res; }).catch(() => cached);
    return cached || net;
  }));
});
