// public 的 .md 文档（SKILL.md 等）：sirv 按 text/markdown 发头不带 charset，浏览器对 text/* 默认按
// Latin-1 解码，中文成乱码——前置中间件补 charset（sirv 尊重已设的 Content-Type 不覆盖）。
// 生产（Cloudflare）由 public/_headers 对 /SKILL.md 与 /skills/* 声明同一头，见 pitfalls I11
import type { Plugin } from 'vite'

function setCharset(req: { url?: string } | null, res: { setHeader(name: string, value: string): void }) {
  if ((req?.url ?? '').split('?')[0].endsWith('.md')) {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
  }
}

export function mdUtf8(): Plugin {
  return {
    name: 'md-utf8',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        setCharset(req, res)
        next()
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        setCharset(req, res)
        next()
      })
    },
  }
}
