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

// 更新语义 = 下次启动接管：新 SW 装好即停留 waiting（无 skipWaiting/clientsClaim），旧版缓存继续服务，
// 待页面全部关闭后下次启动才 activate 并清旧条目——更新只在“下一次完整重载”生效，绝不在使用中自动刷新打断
