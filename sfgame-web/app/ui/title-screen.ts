import { LitElement, css, html, nothing } from 'lit'
import { keyed } from 'lit/directives/keyed.js'
import { customElement, property } from 'lit/decorators.js'
import { LEVEL_ERRORS, LEVEL_GROUPS, LEVELS, LEVELS_BY_ID, isUnlocked, levelHash, levelNo } from '../game/levels.ts'
import { progress } from '../game/progress.ts'
import { formatTime } from '../game/timer.ts'
import type { LevelDef } from '../game/types.ts'
import { artBg, boxReset, brandIn, buttonReset, pillLink, reduceMotion } from './shared-styles.ts'
import { iconChevron, iconGear, iconInfo, iconLock, iconPlay } from './icons.ts'
import logoUrl from '../../src/assets/logo-title.webp?url'

// 耗时评级阈值单源（≤30 绿 / ≤60 黄 / >60 红）：emoji 直观表意（🏆 纪录 / 🙂 尚可 / 🐌 缓慢）
export function bestGrade(total: number): { cls: 'good' | 'fair' | 'poor'; emoji: string } {
  if (total > 60) return { cls: 'poor', emoji: '🐌' }
  if (total > 30) return { cls: 'fair', emoji: '🙂' }
  return { cls: 'good', emoji: '🏆' }
}

// 主页关卡选择屏：从 app.ts 拆出（app 收敛为路由 + 结算 + dev 生命周期）
@customElement('sf-title-screen')
export class SfTitleScreen extends LitElement {
  @property({ type: Boolean }) dev = false
  @property({ type: String }) activeGroup = ''

  private startLevel(id: string) {
    this.dispatchEvent(new CustomEvent<string>('start', { detail: id }))
  }

  // 关于按钮：短按开关于页，长按（500ms）进开发者页面（隐藏入口，不向玩家披露）
  private aboutTimer: number | null = null

  private onAboutDown = () => {
    this.aboutTimer = window.setTimeout(() => {
      this.aboutTimer = null
      this.dispatchEvent(new Event('dev-page'))
    }, 500)
  }

  private onAboutUp = () => {
    if (this.aboutTimer === null) return
    clearTimeout(this.aboutTimer)
    this.aboutTimer = null
    this.dispatchEvent(new CustomEvent('about'))
  }

  private onAboutCancel = () => {
    if (this.aboutTimer !== null) clearTimeout(this.aboutTimer)
    this.aboutTimer = null
  }

  override disconnectedCallback() {
    // 卸载时挂起的 500ms 定时器即刻清掉（多点触控：按住关于的同时切走）
    if (this.aboutTimer !== null) clearTimeout(this.aboutTimer)
    this.aboutTimer = null
    super.disconnectedCallback()
  }

  // 键盘路径（Enter 的 click detail=0）；指针的 click 忽略（about 已由 pointerup 触发）
  private onAboutClick = (e: MouseEvent) => {
    if (e.detail === 0) this.dispatchEvent(new CustomEvent('about'))
  }

  private onDevPage = () => this.dispatchEvent(new Event('dev-page'))

  protected override render() {
    return html`
      <main class="title">
        <section class="title-card">
          <h1 class="brand">
            <img src=${logoUrl} alt="烧风 · 太阳精灵 · 用温度创造风" />
          </h1>

          ${this.renderGroups()}
          ${this.renderLevels()}
          ${this.renderErrors()}

          <p class="footnote">
            灵感来自菲尔兹奖得主邓煜的成果，从牛顿硬球物理可以推导出玻尔兹曼和 NS 方程——本游戏内物理基于此。
          </p>

          ${this.renderLinks()}
        </section>
      </main>
    `
  }

  // 分组 tab：activeGroup 定位当前组（组内容/顺序单一事实在 LEVEL_GROUPS）
  private renderGroups() {
    return html`
      <nav class="groups" aria-label="关卡组">
        ${LEVEL_GROUPS.map((g) =>
          html`
            <button
              class="group-tab ${g.name === this.activeGroup ? 'active' : ''}"
              aria-pressed=${g.name === this.activeGroup}
              @click=${() => this.dispatchEvent(new CustomEvent<string>('group', { detail: g.name }))}
            >
              <span class="gname">${g.name}</span>
            </button>
          `,
        )}
      </nav>
    `
  }

  // 关卡列表：dev 模式全关卡可玩（含未解锁）；解锁按关卡 hash 的通关记录判定
  private renderLevels() {
    const group = LEVEL_GROUPS.find((g) => g.name === this.activeGroup)
    const levels = (group?.ids ?? [])
      .map((id) => LEVELS_BY_ID.get(id))
      .filter((l): l is LevelDef => l !== undefined)
    return html`
      <nav class="levels" aria-label="关卡列表">
        ${levels.map((l, i) => {
          const locked = !this.dev && !isUnlocked(l.id, (id) => progress.completed(levelHash({ id }) ?? ''))
          // 最优成绩 = 通关记录合计最少的条目（与结算面板 bestTotal 同口径）；无记录不显示
          const best = progress.best(levelHash({ id: l.id }) ?? '')
          // 耗时评级阈值单源：bestGrade 纯函数（可无头测试）
          const grade = best ? bestGrade(best.total) : null
          // 关卡号双位补零：列对齐稳定（01~15），不随位数跳变；序数 = levelNo（标题屏与状态条同源）
          const no = String(levelNo(l.id)).padStart(2, '0')
          return keyed(l.id, html`
            <button
              class="level play ${locked ? 'locked' : ''}"
              style=${`--i: ${i}`}
              ?disabled=${locked}
              aria-label=${locked ? `第 ${no} 关（未解锁）` : `进入第 ${no} 关`}
              @click=${() => this.startLevel(l.id)}
            >
              <span class="no">第 ${no} 关</span>
              <span class="meta">
                <span class="name">${l.name}</span>
                <span class="concept">${l.tagline}</span>
              </span>
              <span class="side">
                ${best && grade
                  ? html`<span class="best ${grade.cls}" title="最佳耗时">${formatTime(best.total)} ${grade.emoji}</span>`
                  : nothing}
                <span class="go" aria-hidden="true">${locked ? iconLock : iconChevron}</span>
              </span>
            </button>
          `)
        })}
        ${LEVELS.length === 0 ? html`<p class="no-levels">暂无可用关卡</p>` : nothing}
      </nav>
    `
  }

  private renderErrors() {
    return LEVEL_ERRORS.length > 0
      ? html`<div class="level-errors" role="alert">
          <b>关卡加载失败 ${LEVEL_ERRORS.length} 个</b>
          ${LEVEL_ERRORS.map((m) => html`<p>${m}</p>`)}
        </div>`
      : nothing
  }

  // 底部链接：B站视频入口（恒显）+ 非 dev 模式关于钮（长按 500ms 进开发者页面，隐藏入口），dev 模式开发者页面钮
  private renderLinks() {
    return html`
      <div class="links">
        <a
          class="link-btn"
          href="https://www.bilibili.com/video/BV1RMgW6nE72/"
          target="_blank"
          rel="noopener"
          aria-label="观看视频"
        >
          ${iconPlay}<span>观看视频</span>
        </a>
        ${!this.dev
          ? html`<button
              class="link-btn"
              @pointerdown=${this.onAboutDown}
              @pointerup=${this.onAboutUp}
              @pointercancel=${this.onAboutCancel}
              @pointerleave=${this.onAboutCancel}
              @click=${this.onAboutClick}
              aria-label="关于"
            >
              ${iconInfo}<span>关于</span>
            </button>`
          : nothing}
        ${this.dev
          ? html`<button class="link-btn" @click=${this.onDevPage} aria-label="开发者页面">
              ${iconGear}<span>开发者页面</span>
            </button>`
          : nothing}
      </div>
    `
  }

  static styles = [
    boxReset,
    buttonReset,
    pillLink,
    reduceMotion,
    artBg,
    brandIn,
    css`
      :host {
        display: block;
        height: 100%;
      }

      svg {
        display: block;
      }

      .title {
        height: 100%;
        display: flex;
        flex-direction: column;
        /* 横屏刘海/Dynamic Island 在侧边，须加左/右安全区 */
        padding: var(--page-pad-y) calc(var(--page-pad-x) + env(safe-area-inset-right, 0px))
          var(--page-pad-y) calc(var(--page-pad-x) + env(safe-area-inset-left, 0px));
        overflow: auto;
        scrollbar-width: thin;
        scrollbar-color: var(--scroll-thumb) transparent;
      }

      .title-card {
        width: 100%;
        max-width: var(--maxw-card);
        margin: auto;
        padding: var(--card-pad);
        text-align: center;
        /* 白雾玻璃：--card-glass + --blur-glass 统一配方（与页面壳卡片同源） */
        background: var(--card-glass);
        backdrop-filter: var(--blur-glass);
        -webkit-backdrop-filter: var(--blur-glass);
        border: 1px solid rgba(255, 255, 255, 0.6);
        border-radius: var(--r-xl);
        corner-shape: squircle;
        box-shadow: 0 1.125rem 2.75rem rgba(61, 52, 39, 0.14);
      }

      .brand {
        /* h1 语义标题（SEO/无障碍读 img alt）；font-size/line-height 归零：h1 默认字号会撑高模板行内空白，img 是 block 不受影响 */
        display: block;
        width: 12rem;
        max-width: 100%;
        margin: 0 auto var(--sp-2-5);
        font-size: 0;
        line-height: 0;
      }

      .brand img {
        display: block;
        width: 100%;
        height: auto;
        /* 品牌插槽恒定方形：换图比例变化只 letterbox，不随文件抖动 */
        aspect-ratio: 1 / 1;
        object-fit: contain;
      }

      .levels {
        display: flex;
        flex-direction: column;
        gap: var(--sp-2);
        text-align: left;
      }

      .groups {
        display: flex;
        justify-content: center;
        gap: var(--sp-2);
        margin: 0 0 var(--sp-3);
      }

      .group-tab {
        flex: none;
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        gap: 1px;
        padding: var(--sp-1-5) var(--sp-5);
        border-radius: var(--r-lg);
        corner-shape: squircle;
        background: rgba(255, 255, 255, 0.4);
        border: 1px solid rgba(255, 255, 255, 0.7);
        color: var(--ink-soft);
        transition: background 140ms ease-out, color 140ms ease-out, box-shadow 140ms ease-out;
      }

      .group-tab .gname {
        font-size: 0.9375rem;
        font-weight: 700;
        letter-spacing: 0.04em;
      }

      .group-tab.active {
        background: var(--card);
        color: var(--ink);
        box-shadow: 0 0.25rem 0.875rem rgba(61, 52, 39, 0.09);
      }

      .no-levels {
        margin: var(--sp-3) 0 0;
        color: var(--ink-soft);
        text-align: center;
      }

      .level-errors {
        margin-top: var(--sp-4);
        padding: var(--sp-2-5) var(--sp-3);
        text-align: left;
        font-size: 0.75rem;
        line-height: 1.45;
        color: #7a2415;
        background: rgba(255, 90, 60, 0.1);
        border: 1px solid rgba(255, 90, 60, 0.28);
        border-radius: var(--r-md);
        corner-shape: squircle;
        overflow: hidden;
      }

      .level-errors p {
        margin: var(--sp-1) 0 0;
        word-break: break-all;
      }

      .level {
        display: flex;
        align-items: center;
        gap: var(--sp-4);
        width: 100%;
        padding: var(--sp-2) var(--sp-4);
        /* 覆盖卡片继承的 text-align:center */
        text-align: left;
        border-radius: var(--r-lg);
        corner-shape: squircle;
        transition: transform 120ms ease-out, box-shadow 120ms ease-out;
        /* 逐个进场：--i 由模板注入索引，50ms 错峰（一组 5 项 ≈0.5s 收尾）；both 保持 delay 期隐藏，动画后 transform 归位不碍 hover 过渡 */
        animation: level-in 300ms ease-out both;
        animation-delay: calc(var(--i) * 50ms);
      }

      @keyframes level-in {
        from {
          opacity: 0;
          transform: translateY(0.5rem);
        }
      }

      .level.play {
        background: rgba(255, 255, 255, 0.5);
        border: 1px solid rgba(255, 255, 255, 0.8);
        box-shadow: 0 0.25rem 0.875rem rgba(61, 52, 39, 0.07);
      }

      .level.play:hover {
        box-shadow: 0 0.5rem 1.375rem rgba(61, 52, 39, 0.12);
      }

      .level .no {
        flex: none;
        font-size: 0.75rem;
        color: var(--ink-soft);
        /* 双位补零后「第 01 关」仍不换行（0.75rem × 5 字符） */
        width: 3.25rem;
        white-space: nowrap;
      }

      .level.locked {
        background: rgba(255, 255, 255, 0.42);
        border-color: rgba(255, 255, 255, 0.5);
        box-shadow: none;
        opacity: 0.55;
        cursor: not-allowed;
      }

      .level.locked:hover {
        transform: none;
        box-shadow: none;
      }

      .level.locked .go {
        color: var(--ink-soft);
      }

      .level .meta {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 1px;
        min-width: 0;
      }

      .level .name {
        font-size: 1rem;
        font-weight: 600;
        letter-spacing: 0.01em;
      }

      .level .concept {
        font-size: 0.75rem;
        color: var(--ink-soft);
      }

      /* 动作组：成绩徽章与箭头同组贴近（组内 --sp-2），与信息组分隔（--sp-4） */
      .level .side {
        flex: none;
        display: flex;
        align-items: center;
        gap: var(--sp-2);
      }

      .level .go {
        color: var(--hot);
        display: flex;
        align-items: center;
      }

      /* 最佳成绩徽章：仅有关卡记录时出现；耗时评级配色（优秀绿 = 纪录语义 / 一般琥珀 / 不优秀红） */
      .level .best {
        padding: var(--chip-pad);
        font-size: 0.75rem;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        border-radius: var(--r-pill);
      }

      .level .best.good {
        color: var(--goal);
        background: rgba(47, 191, 113, 0.12);
      }

      .level .best.fair {
        color: #c08a17;
        background: rgba(224, 163, 61, 0.14);
      }

      .level .best.poor {
        color: var(--hot);
        background: rgba(255, 90, 60, 0.12);
      }

      .level .go svg {
        display: block;
        width: var(--icon-md);
        height: var(--icon-md);
      }

      .footnote {
        margin: var(--sp-4) auto 0;
        max-width: 28.75rem;
        font-size: 0.75rem;
        line-height: 1.7;
        color: var(--ink-soft);
      }

      .links {
        display: flex;
        justify-content: center;
        gap: var(--sp-2);
        margin-top: var(--sp-3);
      }

      /* .link-btn 配方来自 shared-styles.pillLink */
      .link-btn svg {
        width: var(--icon-sm);
        height: var(--icon-sm);
      }
    `,
  ]
}

declare global {
  interface HTMLElementTagNameMap {
    'sf-title-screen': SfTitleScreen
  }
}
