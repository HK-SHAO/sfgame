import { clientsClaim } from 'workbox-core'
import { createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare global {
  interface Window {
    __WB_MANIFEST?: Array<{ url: string; revision: string | null }>
  }
}

// 构建期注入的预缓存清单（hash 资产 + public 静态文件全部）；activate 自动清理旧版本条目
precacheAndRoute(self.__WB_MANIFEST!)

// 导航统一回退预缓存 app shell：离线深链直达游戏；带扩展名的路径（.md 文档/资产）排除，
// 由 precache 按 URL 精确命中——防止文档导航被误回退成 index.html
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/_/, /\/[^/?]+\.[^/]+$/],
  }),
)

// 新版本立即接管：资产内容寻址 + 客户端 autoUpdate 的 reload-on-update，静默更新安全
const sw = self as unknown as { skipWaiting(): Promise<void> }
sw.skipWaiting()
clientsClaim()
