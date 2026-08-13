// 离线可玩 Service Worker（零依赖、无预缓存清单——同源 GET 全量运行期缓存，联网玩过一次即完整离线）。
// 分层策略：
//   导航（index.html）   = 网络优先：在线永远最新版，离线回退最近缓存
//   /assets/*（hash 资产） = 缓存优先：内容不可变（更新即换 URL），命中零网络
//   其余同源（favicon/manifest/icons/sw 自身） = stale-while-revalidate：离线可用、后台刷新
// sw.js 内容变更 → CACHE 版本号 bump → activate 清理旧缓存；skipWaiting+claim 让新版本即时接管
const CACHE = 'sfgame-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

const isAsset = (url) => url.pathname.includes('/assets/')

async function networkFirst(request) {
  const cache = await caches.open(CACHE)
  try {
    const fresh = await fetch(request)
    if (fresh && fresh.ok) cache.put(request, fresh.clone())
    return fresh
  } catch {
    // 深链（/?lv=3 等）与缓存键 '/' 的 query 不同——ignoreSearch 回退命中同一份 HTML
    const cached =
      (await cache.match(request)) ?? (await cache.match(request, { ignoreSearch: true }))
    return (
      cached ??
      new Response('离线且尚无缓存：请联网打开一次后即可离线游玩', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    )
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  try {
    const fresh = await fetch(request)
    if (fresh && fresh.ok) cache.put(request, fresh.clone())
    return fresh
  } catch {
    return new Response('', { status: 504 })
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(request)
  const refresh = fetch(request)
    .then((fresh) => {
      if (fresh && fresh.ok) cache.put(request, fresh.clone())
      return fresh
    })
    .catch(() => null)
  return cached ?? (await refresh) ?? new Response('', { status: 504 })
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (request.mode === 'navigate') event.respondWith(networkFirst(request))
  else if (isAsset(url)) event.respondWith(cacheFirst(request))
  else event.respondWith(staleWhileRevalidate(request))
})
