import { defineConfig } from 'vitest/config'

export default defineConfig({
  // 相对路径部署（itch.io 等子路径托管）：HTML/CSS/JS 资源引用全部相对化
  base: './',
  build: {
    // Safari 不消费 modulepreload 缓存并误报 "preloaded but not used"，禁用注入
    modulePreload: false,
    rollupOptions: {
      output: {
        // 显式组分层（priority 高的组先捕获，捕获后从其他组移除——闭包冲突由此化解）：
        // 主包 / 游戏内核 / dev 工具各自成块，共享模块随高 priority 组走，启动链 12 请求 → 3 请求
        codeSplitting: {
          groups: [
            // 全部第三方（lit + @lit 系）：稳定大块，缓存友好
            { name: 'vendor', test: /node_modules[\\/]/, priority: 3 },
            // 主包：启动链核心（关卡数据/状态/音频/UI 框架/顶层屏），不含游戏内核与低频屏
            {
              name: 'main',
              priority: 2,
              test: (id: string) => {
                // 入口模块须独立成入口 chunk：main.ts 动态 import 同组的 app 模块会形成自引用转发壳（死锁）
                if (id.includes('/app/main.ts')) return false
                if (id.includes('/app/dev/') || id.includes('/app/sim/') || id.includes('/app/render/')) return false
                if (/[/\\]app[/\\]ui[/\\](sf-game|hud|win-overlay|status-bar|controller|input|storage-view|unsupported)\.ts$/.test(id)) return false
                if (/[/\\]app[/\\]game[/\\](simulation|timer)\.ts$/.test(id)) return false
                return id.includes('/app/') || id.includes('package.json')
              },
            },
            // 游戏内核（进关才加载）：sf-game/controller + 物理/渲染 + 关卡模拟
            {
              name: 'game',
              priority: 1,
              test: (id: string) =>
                id.includes('/app/sim/') ||
                id.includes('/app/render/') ||
                /[/\\]app[/\\]ui[/\\](sf-game|hud|win-overlay|status-bar|controller|input)\.ts$/.test(id) ||
                /[/\\]app[/\\]game[/\\](simulation|timer)\.ts$/.test(id),
            },
            // 开发者工具整组（?dev=1 才加载）
            { name: 'dev-tools', test: /[/\\]app[/\\]dev[/\\]/, priority: 1 },
            // 存储管理页（v=storage 才加载）
            { name: 'storage', test: /storage-view/, priority: 1 },
            // 错误页（仅 WASM 不支持时加载）
            { name: 'unsupported', test: /unsupported/, priority: 1 },
          ],
        },
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
})
