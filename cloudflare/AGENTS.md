# Cloudflare 部署（sfgame）

本包是**纯静态 assets 部署**：没有 Worker 源码、没有 main、没有 bindings。
`wrangler.jsonc` 的 `assets.directory` 指向 `../sfgame-web/dist`（由根目录 `bun run build` 产出），
`not_found_handling: single-page-application` 兜底路由。

## 命令

| 命令 | 用途 |
|---|---|
| `bun run deploy`（根目录） | build sfgame-web → `wrangler deploy` |
| `bun run --cwd cloudflare deploy` | 仅部署（dist 须已构建） |

部署产物为静态文件 + 隐式 Workers 路由层，无 KV/R2/D1/DO/Queues 等任何绑定；
`nodejs_compat` 旗标对本仓库无实际作用（保留为脚手架默认，勿依赖）。

## 注意事项

- 上线前必跑根目录 `bun run check`（typecheck → test → build），dist 由它产出
- `upload_source_maps: false` 是刻意设置：一旦开启 vite build.sourcemap，会把完整 TS 源码公开上传
- 改 `wrangler.jsonc` 无需跑 `wrangler types`（无 bindings，无类型生成需求）
