import { css, unsafeCSS } from 'lit'
import bgArtUrl from '../../src/assets/bg-title.webp?url'

// 页面屏外壳共享样式（存储管理/开发者页两屏复用）：滚动页 + sticky 玻璃标题栏 + 图标钮。
// 单独模块而非全局：各屏 shadow DOM 不继承全局样式（见 pitfalls A2）
export const boxReset = css`
  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  /* 文档 color-scheme 不传入 shadow root（WebKit 已知缺陷）：深色系统下滚动条/控件会渲染成黑，须逐组件钉死浅色 */
  :host {
    color-scheme: light;
    /* 与 color-scheme 同源：继承属性跨 shadow 边界在 WebKit 不可靠，text-autospace 须逐组件自声明（shadow 内文本才能自动留白） */
    text-autospace: normal;
    /* 禁 iOS 双击放大：Safari 的 touch-action 不跨 shadow 边界（:host 只约束本组件内空白区），交互元素须自身声明，见下 */
    touch-action: manipulation;
  }

  /* UA 字体不一（如 button/textarea 用系统字体）：统一继承组件字体 */
  button,
  input,
  textarea,
  summary {
    font: inherit;
    color: inherit;
  }

  /* iOS 双击缩放：user-scalable=no 在 iOS10+ 被忽略（辅助放大），且 :host 的 touch-action 不跨 shadow DOM 边界
     （Safari 缺陷）——可点元素须自身声明；manipulation 保留滚动/捏合，仅禁双击放大与 300ms 延迟 */
  button,
  summary,
  a {
    touch-action: manipulation;
  }
`

// 动效降级：prefers-reduced-motion 下动画/过渡归零（shadow 内 CSS 不穿透全局，须逐组件声明）
export const reduceMotion = css`
  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
`

// 品牌图进场：淡入 + 轻微上浮（0.5rem≈6px），500ms 一次不循环；both 保证动画前后状态稳定不闪。
// 主页与 about 卡片共用同一参数（动画单源，避免双处漂移）
export const brandIn = css`
  @keyframes brand-in {
    from {
      opacity: 0;
      transform: translateY(0.5rem);
    }
  }

  .brand {
    animation: brand-in 500ms ease-out both;
  }
`

// 暖色背景渐变：主页与终端页共用（左上发光）；pageShell 用右上变体（84% 10%，有意区分页面壳）。
// 单源 token 定义在 styles.css :root（shadow DOM 继承自定义属性），此处仅引用
export const warmBg = css`
  background: var(--bg-warm);
`

// 全屏手绘背景图（1:1 cover，中央为安全区）：主菜单与各页面壳共用（:host 固定，滚动不随内容）；
// 图以 ?url 导入——JS 字符串里的 url() vite 不重写会留绝对路径（unsafeCSS 包受控常量，无注入面）
export const artBg = css`
  :host {
    background:
      url('${unsafeCSS(bgArtUrl)}') center center / cover no-repeat,
      var(--bg-warm);
  }
`

export const pageShell = css`
  .page {
    height: 100%;
    /* 背景由 artBg 提供（:host 固定不随滚动），此处须透明，否则盖住背景图 */
    overflow-y: auto;
    padding: 0 calc(var(--page-pad-x) + env(safe-area-inset-right, 0px))
      calc(1.875rem + env(safe-area-inset-bottom, 0px)) calc(var(--page-pad-x) + env(safe-area-inset-left, 0px));
    scrollbar-width: thin;
    scrollbar-color: var(--scroll-thumb) transparent;
  }

  /* 标题栏：sticky 悬浮 + 半透明薄雾（负 margin 顶开 page 侧 padding 通到视口边缘），内容从栏下滚过。
     四值 margin 勿缩写成两值：bottom 的 --sp-4 是栏与下方内容的间距 */
  .bar {
    position: sticky;
    top: 0;
    z-index: 10;
    margin: 0 calc(-1 * (var(--page-pad-x) + env(safe-area-inset-right, 0px))) var(--sp-4)
      calc(-1 * (var(--page-pad-x) + env(safe-area-inset-left, 0px)));
    padding: calc(0.75rem + env(safe-area-inset-top, 0px)) calc(var(--page-pad-x) + env(safe-area-inset-right, 0px)) 0.75rem
      calc(var(--page-pad-x) + env(safe-area-inset-left, 0px));
    background: var(--card-glass);
    backdrop-filter: var(--blur-glass);
    -webkit-backdrop-filter: var(--blur-glass);
    border-bottom: 1px solid rgba(255, 255, 255, 0.45);
    box-shadow: 0 0.25rem 1rem rgba(61, 52, 39, 0.08);
    /* 底角圆润与卡片/按钮一致；顶角贴视口上沿，不圆 */
    border-radius: 0 0 var(--r-lg) var(--r-lg);
    corner-shape: squircle;
  }

  .bar-inner {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    max-width: var(--maxw-card);
    margin: 0 auto;
  }

  .head-text h1 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 700;
    letter-spacing: 0.01em;
  }

  /* 居中 + 溢出兜底：子项 margin auto（禁 place-items，溢出双向裁切） */
  .icon-btn {
    flex: none;
    width: var(--ctl-h);
    height: var(--ctl-h);
    display: grid;
    border: none;
    border-radius: var(--r-md);
    corner-shape: squircle;
    background: var(--card-glass);
    backdrop-filter: var(--blur-glass);
    -webkit-backdrop-filter: var(--blur-glass);
    border: 1px solid var(--glass-line);
    box-shadow: var(--shadow-ctl);
    color: var(--ink);
    cursor: pointer;
    padding: 0;
  }

  .icon-btn {
    transition: transform 100ms ease-out, box-shadow 120ms ease-out;
  }

  .icon-btn:active {
    transform: scale(0.97);
  }

  /* 卡片式图标钮：hover 阴影提亮（与 title .level.play 同语言） */
  .icon-btn:hover {
    box-shadow: var(--shadow-card);
  }

  .icon-btn > * {
    margin: auto;
  }

  .icon-btn svg {
    width: var(--icon-lg);
    height: var(--icon-lg);
  }
`

// 玻璃胶囊配方（hud 图标钮/徽章与玻璃面同款）：4 组件 5 处手写合并于此，改质感只动这一处
export const glassChip = css`
  .icon-btn,
  .chip,
  .glass-chip {
    background: rgba(255, 253, 248, 0.66);
    backdrop-filter: var(--blur-glass);
    -webkit-backdrop-filter: var(--blur-glass);
    border: 1px solid var(--glass-line);
    box-shadow: var(--shadow-ctl);
  }
`

// 胶囊链接钮（标题屏 .link-btn 与关于页 .links a 同配方，K8-02 收敛）：消费方不再各自复制
export const pillLink = css`
  .link-btn,
  .links a,
  .pill-link {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1-5);
    padding: var(--sp-2) var(--sp-4);
    font-size: 0.75rem;
    color: var(--ink-soft);
    text-decoration: none;
    background: rgba(255, 253, 248, 0.6);
    border: 1px solid var(--glass-line);
    border-radius: var(--r-pill);
    corner-shape: squircle;
    transition: color 120ms ease-out, box-shadow 120ms ease-out;
  }

  .link-btn:hover,
  .links a:hover,
  .pill-link:hover {
    color: var(--ink);
    box-shadow: 0 0.25rem 0.875rem rgba(61, 52, 39, 0.08);
  }
`

// 按钮 UA 复位 + 按压缩放（hud/title/win-overlay 三处同款，K8-04 收敛）
export const buttonReset = css`
  button {
    border: none;
    background: none;
    padding: 0;
    cursor: pointer;
    color: inherit;
    -webkit-user-select: none;
    user-select: none;
  }

  /* 统一 hover 白洗：玻璃/中性按钮的通用提亮（彩色强身份按钮以更高特异度覆盖） */
  button:hover {
    background: rgba(255, 255, 255, 0.55);
  }

  button:active {
    transform: scale(0.97);
  }
`

export const card = css`
  .card {
    max-width: var(--maxw-card);
    margin: 0 auto var(--sp-4);
    padding: var(--sp-2);
    /* 雾面玻璃：白底（--card-glass）+ 统一模糊（--blur-glass），与主菜单卡同配方——所有页面卡片统一质感 */
    background: var(--card-glass);
    backdrop-filter: var(--blur-glass);
    -webkit-backdrop-filter: var(--blur-glass);
    border: 1px solid rgba(255, 255, 255, 0.6);
    border-radius: var(--r-lg);
    corner-shape: squircle;
    box-shadow: 0 0.5rem 1.375rem rgba(61, 52, 39, 0.07);
  }
`
