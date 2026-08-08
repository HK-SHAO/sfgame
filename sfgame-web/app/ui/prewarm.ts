import { LitElement, css, html, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { bakeLevelStems } from '../core/music-bakery'
import { LEVELS } from '../game/levels'
import { urlState } from '../game/state'
import { GlRenderer } from '../render/gl'
import { prewarmEngines, takeEngine } from '../wasm/engine'
import { boxReset, reduceMotion } from './shared-styles'

// 预热模块（高内聚）：流水线 + 运行时校验 + 状态 UI 全部封装在本文件。
// 对外仅两个触点：<sf-prewarm> 挂载（app 只渲染一次）与 prewarmPassed()/prewarm.notify()（进关门禁）。
// 校验语义：引擎（WASM 实例化）与渲染（WebGL 全链路热身）为关键项，失败阻断进关并弹警告（可关）；
// 音乐烘焙仅增强项（失败运行期有回退），不计入校验。

interface PrewarmSnapshot {
  phase: 'running' | 'done'
  // 关键校验是否全过；phase=running 时恒 false（未校验完不放行进关）
  passed: boolean
  failures: string[]
  // 底部小字：当前步骤描述 + 进度
  label: string
  frac: number
}

class PrewarmController {
  private snap: PrewarmSnapshot = { phase: 'running', passed: false, failures: [], label: '物理引擎', frac: 0 }
  private started = false
  private listeners = new Set<() => void>()

  get snapshot(): PrewarmSnapshot {
    return this.snap
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  // 门禁被拦时重弹警告（仅校验失败且已关闭时有效；进行中无动作）
  notifyFailure() {
    if (this.snap.phase === 'done' && this.snap.failures.length > 0) {
      this.snap = { ...this.snap }
      this.warnAgain = true
      this.emit()
    }
  }

  warnAgain = false

  async run(): Promise<void> {
    if (this.started) return
    this.started = true
    const failures: string[] = []
    const set = (label: string, frac: number) => {
      this.snap = { ...this.snap, label, frac }
      this.emit()
    }
    try {
      set('物理引擎', 0)
      if (!prewarmEngines(1)) failures.push('物理引擎（WASM）不可用')
      set('渲染管线', 0.1)
      // 引擎缺失时跳过 GL 校验（takeEngine 会抛）
      if (failures.length === 0) {
        let glOk = false
        try {
          glOk = GlRenderer.warmup(takeEngine())
        } catch {
        }
        if (!glOk) failures.push('渲染管线（WebGL）不可用')
      }
      set('背景音乐', 0.2)
      // URL 直达内联关卡（字符串形态）时预烘首关：内联关音乐进入后由关内路径补
      const lv = urlState.get('lv')
      const levelId = typeof lv === 'number' ? lv : LEVELS[0]?.id
      if (levelId !== undefined) {
        await bakeLevelStems(levelId, (done, total) => {
          set('背景音乐', 0.2 + 0.8 * (total > 0 ? done / total : 1))
        })
      }
    } catch {
    } finally {
      this.snap = { phase: 'done', passed: failures.length === 0, failures, label: '', frac: 1 }
      this.emit()
    }
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }
}

export const prewarm = new PrewarmController()

// 进关门禁：校验完成且关键项全过才放行
export function prewarmPassed(): boolean {
  const s = prewarm.snapshot
  return s.phase === 'done' && s.passed
}

// 预热状态 UI：运行中 = 底部小字（不遮挡不拦输入）；关键校验失败 = 警告卡（可关）
@customElement('sf-prewarm')
export class SfPrewarm extends LitElement {
  @state() private snap: PrewarmSnapshot = prewarm.snapshot
  @state() private warnOpen = true
  private unsub: (() => void) | null = null

  override connectedCallback() {
    super.connectedCallback()
    this.unsub = prewarm.subscribe(() => {
      this.snap = prewarm.snapshot
      if (prewarm.warnAgain) {
        prewarm.warnAgain = false
        this.warnOpen = true
      }
    })
    void prewarm.run()
  }

  override disconnectedCallback() {
    this.unsub?.()
    this.unsub = null
    super.disconnectedCallback()
  }

  protected override render() {
    const s = this.snap
    const showWarn = s.phase === 'done' && s.failures.length > 0 && this.warnOpen
    return html`
      ${s.phase === 'running'
        ? html`<p class="hint" aria-live="polite">正在准备运行环境：${s.label}… ${Math.round(s.frac * 100)}%</p>`
        : nothing}
      ${showWarn
        ? html`
          <div class="backdrop">
            <div class="card">
              <h2>运行环境校验未通过</h2>
              <p>以下关键能力缺失，游戏可能无法正常渲染：</p>
              <ul>
                ${s.failures.map((f) => html`<li>${f}</li>`)}
              </ul>
              <p class="sub">可尝试更换浏览器或开启硬件加速。</p>
              <button class="btn" @click=${() => (this.warnOpen = false)}>知道了</button>
            </div>
          </div>
        `
        : nothing}
    `
  }

  static styles = [
    boxReset,
    reduceMotion,
    css`
      :host {
        position: absolute;
        inset: 0;
        z-index: 50;
        pointer-events: none;
        color: var(--ink);
      }

      /* 底部小字：弱化提示，不遮挡首页、不拦输入 */
      .hint {
        position: absolute;
        bottom: calc(0.625rem + env(safe-area-inset-bottom, 0px));
        left: 0;
        right: 0;
        margin: 0;
        text-align: center;
        font-size: 0.75rem;
        color: rgba(61, 52, 39, 0.45);
        letter-spacing: 0.02em;
      }

      /* 警告卡：居中 + 溢出兜底 margin auto（不用 place-items，见样式约定） */
      .backdrop {
        position: absolute;
        inset: 0;
        display: flex;
        pointer-events: auto;
        background: rgba(61, 52, 39, 0.28);
        backdrop-filter: blur(0.375rem);
        -webkit-backdrop-filter: blur(0.375rem);
      }

      .card {
        margin: auto;
        width: min(20rem, 88vw);
        padding: 1.375rem 1.5rem;
        background: rgba(255, 253, 248, 0.96);
        border: 1px solid rgba(255, 255, 255, 0.6);
        border-radius: 1.125rem;
        corner-shape: squircle;
        box-shadow: 0 0.75rem 2.5rem rgba(61, 52, 39, 0.2);
      }

      h2 {
        margin: 0 0 0.625rem;
        font-size: 1.0625rem;
        font-weight: 700;
      }

      p {
        margin: 0 0 0.5rem;
        font-size: 0.875rem;
        line-height: 1.5;
      }

      ul {
        margin: 0 0 0.75rem;
        padding-left: 1.25rem;
        font-size: 0.875rem;
        line-height: 1.6;
        color: #b4552d;
      }

      .sub {
        color: rgba(61, 52, 39, 0.55);
        margin-bottom: 1rem;
      }

      .btn {
        display: block;
        width: 100%;
        padding: 0.5rem 0;
        border: none;
        border-radius: 0.75rem;
        corner-shape: squircle;
        background: linear-gradient(90deg, #ffb43c, #ff8a3d);
        color: #4a2f12;
        font-weight: 600;
        font-size: 0.9375rem;
        cursor: pointer;
      }

      .btn:active {
        transform: scale(0.98);
      }
    `,
  ]
}

declare global {
  interface HTMLElementTagNameMap {
    'sf-prewarm': SfPrewarm
  }
}
