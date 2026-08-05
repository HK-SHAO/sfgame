import { LitElement, css, html, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { STORAGE_KEY as PROGRESS_KEY } from '../game/progress'
import { MUTED_KEY } from '../core/sfx'
import { iconBack, iconDatabase } from './icons'

/** 本 app 持久化的数据键前缀（存储管理页的可见范围） */
const KEY_PREFIXES = ['sfgame.', 'zaofeng.']

interface StorageEntry {
  key: string
  bytes: number
  summary: string
  /** 原始值（展开时展示） */
  raw: string
}

function summarize(key: string, raw: string): string {
  if (key === PROGRESS_KEY) {
    try {
      const levels = Object.entries((JSON.parse(raw) as { levels?: Record<string, unknown> }).levels ?? {})
      if (levels.length === 0) return '暂无通关记录'
      return levels
        .map(([id, list]) => `第 ${id} 关 ${Array.isArray(list) ? list.length : 0} 条成绩`)
        .join(' · ')
    } catch {
      return '数据损坏（JSON 解析失败）'
    }
  }
  if (key === MUTED_KEY) return raw === '1' ? '声音已关闭' : '声音已开启'
  return raw.slice(0, 80)
}

function listEntries(): StorageEntry[] {
  const out: StorageEntry[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key || !KEY_PREFIXES.some((p) => key.startsWith(p))) continue
    const raw = localStorage.getItem(key) ?? ''
    out.push({ key, bytes: new TextEncoder().encode(raw).length, summary: summarize(key, raw), raw })
  }
  return out
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  return `${(n / 1024).toFixed(1)} KB`
}

/**
 * 存储管理页：只读展示本 app 的持久化数据（键/大小/内容摘要），提供删除与清空。
 * 删除后整页重载——进度/音效等模块单例在内存里持有旧数据，重载是最可靠的一致性保证
 * （URL 带 v=storage，重载后仍回到本页）。
 */
@customElement('sf-storage')
export class SfStorage extends LitElement {
  /** 两击确认：记录已武装的键（'*' = 清空全部），3 秒后自动解除 */
  @state() private armed: string | null = null
  /** 展开查看原始值的键集合 */
  @state() private expanded = new Set<string>()
  private entries: StorageEntry[] = []
  private disarmTimer: ReturnType<typeof setTimeout> | null = null

  private onBack = () => this.dispatchEvent(new CustomEvent('back'))

  connectedCallback() {
    super.connectedCallback()
    this.entries = listEntries()
  }

  private toggleExpand(key: string) {
    const next = new Set(this.expanded)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    this.expanded = next
  }

  private arm(key: string) {
    if (this.armed === key) {
      if (key === '*') {
        for (const e of this.entries) localStorage.removeItem(e.key)
      } else {
        localStorage.removeItem(key)
      }
      location.reload()
      return
    }
    this.armed = key
    if (this.disarmTimer) clearTimeout(this.disarmTimer)
    this.disarmTimer = setTimeout(() => {
      this.armed = null
    }, 3000)
  }

  override disconnectedCallback() {
    if (this.disarmTimer) clearTimeout(this.disarmTimer)
    super.disconnectedCallback()
  }

  protected override render() {
    const total = this.entries.reduce((s, e) => s + e.bytes, 0)
    return html`
      <main class="page">
        <header class="head">
          <button class="icon-btn" @click=${this.onBack} aria-label="返回">${iconBack}</button>
          <div class="head-text">
            <h1>存储管理</h1>
          </div>
        </header>

        <section class="card">
          ${this.entries.length === 0
            ? html`<p class="empty">${iconDatabase}<span>暂无本地持久化数据</span></p>`
            : this.entries.map(
                (e) => html`
                  <div class="entry">
                    <div class="entry-head">
                      <code class="key">${e.key}</code>
                      <span class="size">${formatBytes(e.bytes)}</span>
                      <button
                        class="expand ${this.expanded.has(e.key) ? 'open' : ''}"
                        @click=${() => this.toggleExpand(e.key)}
                        aria-label=${this.expanded.has(e.key) ? '收起' : '展开'}
                      >
                        ${this.expanded.has(e.key) ? '收起' : '展开'}
                      </button>
                      <button class="del" @click=${() => this.arm(e.key)}>
                        ${this.armed === e.key ? '确认删除' : '删除'}
                      </button>
                    </div>
                    <p class="summary">${e.summary}</p>
                    ${this.expanded.has(e.key)
                      ? html`<pre class="raw">${e.raw}</pre>`
                      : nothing}
                  </div>
                `,
              )}
        </section>

        <div class="foot">
          <button
            class="clear ${this.armed === '*' ? 'armed' : ''}"
            @click=${() => this.arm('*')}
            ?disabled=${this.entries.length === 0}
          >
            ${this.armed === '*' ? '确认清空全部' : '清空全部数据'}
          </button>
          <p class="note">共 ${this.entries.length} 项 · ${formatBytes(total)}</p>
          <p class="note">数据仅保存在本设备浏览器（localStorage），删除后不可恢复。</p>
        </div>
      </main>
    `
  }

  static styles = css`
    /* shadow DOM 不继承全局 box-sizing */
    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }

    :host {
      display: block;
      height: 100%;
      color: var(--ink);
    }

    .page {
      height: 100%;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      padding:
        calc(0.875rem + env(safe-area-inset-top, 0px)) 1.125rem
        calc(1.875rem + env(safe-area-inset-bottom, 0px));
      background:
        radial-gradient(circle at 84% 10%, rgba(255, 196, 83, 0.22), transparent 42%),
        linear-gradient(180deg, #fff8ea 0%, #f8e6c4 100%);
    }

    .head {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      max-width: 35rem;
      margin: 0 auto 1.25rem;
    }

    .head-text h1 {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 700;
      letter-spacing: 0.01em;
    }

    .icon-btn {
      flex: none;
      width: 2.5rem;
      height: 2.5rem;
      display: grid;
      place-items: center;
      border: none;
      border-radius: 0.75rem;
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

    .card {
      max-width: 35rem;
      margin: 0 auto 1rem;
      padding: 0.375rem;
      background: var(--card);
      border: 1px solid rgba(255, 255, 255, 0.6);
      border-radius: 1rem;
      corner-shape: squircle;
      box-shadow: 0 0.5rem 1.375rem rgba(61, 52, 39, 0.07);
    }

    .entry {
      padding: 0.75rem 0.875rem;
      border-radius: 0.75rem;
      corner-shape: squircle;
    }

    .entry + .entry {
      border-top: 1px solid rgba(61, 52, 39, 0.06);
    }

    .entry-head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .key {
      flex: 1;
      min-width: 0;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.8125rem;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .size {
      flex: none;
      font-size: 0.75rem;
      font-variant-numeric: tabular-nums;
      color: var(--ink-soft);
    }

    .del,
    .expand {
      flex: none;
      padding: 0.375rem 0.75rem;
      font-size: 0.75rem;
      font-weight: 600;
      border-radius: 999px;
      corner-shape: squircle;
      cursor: pointer;
      transition: transform 100ms ease-out, background 120ms ease-out;
    }

    .del {
      color: var(--hot);
      background: rgba(255, 90, 60, 0.08);
      border: 1px solid rgba(255, 90, 60, 0.28);
    }

    .expand {
      color: var(--ink-soft);
      background: rgba(61, 52, 39, 0.06);
      border: 1px solid rgba(61, 52, 39, 0.14);
    }

    .expand.open {
      color: var(--ink);
      background: rgba(61, 52, 39, 0.12);
    }

    .del:active,
    .expand:active {
      transform: scale(0.95);
    }

    .summary {
      margin: 0.375rem 0 0;
      font-size: 0.8125rem;
      line-height: 1.6;
      color: var(--ink-soft);
    }

    /* 展开的原始值：等宽小字，可滚动 */
    .raw {
      margin: 0.5rem 0 0;
      padding: 0.625rem 0.75rem;
      max-height: 10rem;
      overflow: auto;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.6875rem;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-all;
      color: var(--ink);
      background: rgba(61, 52, 39, 0.05);
      border-radius: 0.625rem;
      corner-shape: squircle;
    }

    .empty {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      margin: 0;
      padding: 1.5rem 1rem;
      font-size: 0.875rem;
      color: var(--ink-soft);
    }

    .empty svg {
      width: 1.5rem;
      height: 1.5rem;
      flex: none;
    }

    .foot {
      max-width: 35rem;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.625rem;
    }

    .clear {
      padding: 0.6875rem 1.375rem;
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--hot);
      background: rgba(255, 90, 60, 0.08);
      border: 1px solid rgba(255, 90, 60, 0.28);
      border-radius: 0.875rem;
      corner-shape: squircle;
      cursor: pointer;
      transition: transform 100ms ease-out, background 120ms ease-out;
    }

    .clear.armed {
      background: var(--hot);
      border-color: var(--hot);
      color: #fff;
    }

    .clear:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .clear:active:not(:disabled) {
      transform: scale(0.97);
    }

    .note {
      margin: 0;
      font-size: 0.75rem;
      line-height: 1.6;
      color: var(--ink-soft);
      text-align: center;
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'sf-storage': SfStorage
  }
}
