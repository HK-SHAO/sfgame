import { css } from 'lit'

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
  }

  /* UA 字体不一（如 button/textarea 用系统字体）：统一继承组件字体 */
  button,
  input,
  textarea,
  summary {
    font: inherit;
    color: inherit;
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

// 暖色背景渐变：主页与终端页共用（左上发光）；pageShell 用右上变体（84% 10%，有意区分页面壳）
export const warmBg = css`
  background:
    radial-gradient(circle at 18% 12%, rgba(255, 196, 83, 0.32), transparent 42%),
    linear-gradient(180deg, #fff8ea 0%, #f8e6c4 100%);
`

export const pageShell = css`
  .page {
    height: 100%;
    overflow-y: auto;
    padding: 0 var(--page-pad-x) calc(1.875rem + env(safe-area-inset-bottom, 0px));
    scrollbar-width: thin;
    scrollbar-color: var(--scroll-thumb) transparent;
    background:
      radial-gradient(circle at 84% 10%, rgba(255, 196, 83, 0.22), transparent 42%),
      linear-gradient(180deg, #fff8ea 0%, #f8e6c4 100%);
  }

  /* 标题栏：sticky 悬浮 + 半透明薄雾（负 margin 顶开 page 侧 padding 通到视口边缘），内容从栏下滚过 */
  .bar {
    position: sticky;
    top: 0;
    z-index: 10;
    margin: 0 calc(-1 * var(--page-pad-x)) var(--sp-4);
    padding: calc(0.75rem + env(safe-area-inset-top, 0px)) var(--page-pad-x) 0.75rem;
    background: rgba(255, 253, 248, 0.6);
    backdrop-filter: blur(1.5rem) saturate(1.6);
    -webkit-backdrop-filter: blur(1.5rem) saturate(1.6);
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

  .icon-btn {
    flex: none;
    width: var(--ctl-h);
    height: var(--ctl-h);
    display: grid;
    place-items: center;
    border: none;
    border-radius: var(--r-md);
    corner-shape: squircle;
    background: rgba(255, 253, 248, 0.66);
    backdrop-filter: blur(1rem) saturate(1.5);
    -webkit-backdrop-filter: blur(1rem) saturate(1.5);
    border: 1px solid rgba(255, 255, 255, 0.55);
    box-shadow: 0 0.125rem 0.625rem rgba(61, 52, 39, 0.06);
    color: var(--ink);
    cursor: pointer;
    padding: 0;
  }

  .icon-btn:active {
    transform: scale(0.97);
  }

  .icon-btn svg {
    width: 1.19rem;
    height: 1.19rem;
  }
`

export const card = css`
  .card {
    max-width: var(--maxw-card);
    margin: 0 auto var(--sp-4);
    padding: var(--sp-2);
    background: var(--card);
    border: 1px solid rgba(255, 255, 255, 0.6);
    border-radius: var(--r-lg);
    corner-shape: squircle;
    box-shadow: 0 0.5rem 1.375rem rgba(61, 52, 39, 0.07);
  }
`
