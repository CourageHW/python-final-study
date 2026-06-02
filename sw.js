/* 멘토링 파이썬 학습앱 서비스워커 — network-first(항상 최신, 오프라인은 캐시 폴백) */
const V = "pyquiz-v3-4";
const ASSETS = ["./", "./index.html", "./style.css", "./app.js", "./data.js"];
self.addEventListener("install", e => { self.skipWaiting(); e.waitUntil(caches.open(V).then(c => c.addAll(ASSETS).catch(() => {}))); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k.indexOf("pyquiz-") === 0).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || e.request.url.indexOf("http") !== 0) return;
  // network-first: 최신 우선, 성공 시 캐시 갱신, 네트워크 실패(오프라인) 시 캐시
  e.respondWith(
    fetch(e.request).then(res => {
      if (res && res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(e.request, cp)); }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
