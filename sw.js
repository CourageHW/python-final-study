/* 멘토링 파이썬 학습앱 서비스워커 — network-first + no-store(항상 최신, 오프라인은 캐시 폴백) */
const V = "pyquiz-v3-5";
const ASSETS = ["./", "./index.html", "./style.css", "./app.js", "./data.js"];
self.addEventListener("install", e => { self.skipWaiting(); e.waitUntil(caches.open(V).then(c => c.addAll(ASSETS).catch(() => {}))); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k.indexOf("pyquiz-") === 0).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || e.request.url.indexOf("http") !== 0) return;
  // network-first + HTTP 캐시 우회(no-store): 최신 우선, 성공 시 CacheStorage 갱신, 오프라인이면 캐시
  e.respondWith(
    fetch(e.request, { cache: "no-store" }).then(res => {
      if (res && res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(e.request, cp)); }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
