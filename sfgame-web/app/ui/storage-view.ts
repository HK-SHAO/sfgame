import { LitElement, css, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { name } from '../../package.json'
import { iconBack, iconDatabase } from './icons'
import { artBg, boxReset, card, pageShell } from './shared-styles'

const KEY_PREFIX = `${name}.`

interface StorageEntry {
  key: string
  bytes: number
  raw: string
}

function listEntries(): StorageEntry[] {
  const out: StorageEntry[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key || !key.startsWith(KEY_PREFIX)) continue
    const raw = localStorage.getItem(key) ?? ''
    out.push({ key, bytes: new TextEncoder().encode(raw).length, raw })
  }
  return out
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  return `${(n / 1024).toFixed(1)} KB`
}

@customElement('sf-storage')
export class SfStorage extends LitElement {
  @state() private armed: string | null = null
  private entries: StorageEntry[] = []
  private disarmTimer: ReturnType<typeof setTimeout> | null = null

  private onBack = () => this.dispatchEvent(new CustomEvent('back'))

  connectedCallback() {
    super.connectedCallback()
    this.entries = listEntries()
  }

  private arm(key: string) {
    if (this.armed === key) {
      if (key === '*') {
        for (const e of this.entries) localStorage.removeItem(e.key)
      } else {
        localStorage.removeItem(key)
      }
      // 整页重载：模块单例在内存持有旧数据（URL 带 v=storage，重载仍回本页）
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
        <header class="bar">
          <div class="bar-inner">
            <button class="icon-btn" @click=${this.onBack} aria-label="返回">${iconBack}</button>
            <div class="head-text">
              <h1>存储管理</h1>
            </div>
          </div>
        </header>

        <section class="card">
          ${this.entries.length === 0
            ? html`<p class="empty">${iconDatabase}<span>暂无本地持久化数据</span></p>`
            : this.entries.map(
                (e) => html`
                  <details class="entry">
                    <summary class="entry-head">
                      <code class="key">${e.key}</code>
                      <span class="size">${formatBytes(e.bytes)}</span>
                      <span class="expand-ctl" aria-hidden="true">
                        <span class="expand-open">收起</span>
                        <span class="expand-closed">展开</span>
                      </span>
                      <button
                        class="del"
                        @click=${(ev: Event) => {
                          ev.preventDefault()
                          ev.stopPropagation()
                          this.arm(e.key)
                        }}
                      >
                        ${this.armed === e.key ? '确认删除' : '删除'}
                      </button>
                    </summary>
                    <pre class="raw">${e.raw}</pre>
                  </details>
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

  static styles = [
    boxReset,
    pageShell,
    artBg,
    card,
    css`
      :host {
        display: block;
        height: 100%;
        color: var(--ink);
      }

      .entry {
        padding: var(--sp-3) var(--sp-4);
        border-radius: var(--r-md);
        corner-shape: squircle;
      }

      .entry + .entry {
        border-top: 1px solid rgba(61, 52, 39, 0.06);
      }

      /* 原生 details/summary：展开收起零 JS，open 状态由浏览器维护 */
      summary.entry-head {
        list-style: none;
        cursor: pointer;
      }

      summary::-webkit-details-marker {
        display: none;
      }

      .entry-head {
        display: flex;
        align-items: center;
        gap: var(--sp-2);
      }

      .expand-ctl {
        flex: none;
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--ink-soft);
      }

      .expand-open {
        display: none;
      }

      details[open] .expand-open {
        display: inline;
      }

      .expand-closed {
        display: inline;
      }

      details[open] .expand-closed {
        display: none;
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
      .clear {
        color: var(--hot);
        background: rgba(255, 90, 60, 0.08);
        border: 1px solid rgba(255, 90, 60, 0.28);
      }

      .del {
        flex: none;
        padding: 0.375rem var(--sp-3);
        font-size: 0.75rem;
        font-weight: 600;
        border-radius: var(--r-pill);
        corner-shape: squircle;
        cursor: pointer;
        transition: transform 100ms ease-out, background 120ms ease-out;
      }

      .del:active {
        transform: scale(0.95);
      }

      .raw {
        margin: var(--sp-2) 0 0;
        padding: 0.625rem var(--sp-3);
        max-height: 10rem;
        overflow: auto;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 0.6875rem;
        line-height: 1.6;
        white-space: pre-wrap;
        word-break: break-all;
        color: var(--ink);
        background: rgba(61, 52, 39, 0.05);
        border-radius: var(--r-sm);
        corner-shape: squircle;
      }

    .empty {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      margin: 0;
      padding: var(--sp-6) var(--sp-4);
      font-size: 0.875rem;
      color: var(--ink-soft);
    }

    .empty svg {
      width: 1.5rem;
      height: 1.5rem;
      flex: none;
    }

    .foot {
      max-width: var(--maxw-card);
      margin: var(--sp-4) auto 0;
      padding: var(--sp-4);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.625rem;
      /* 文字防撞背景图色：与条目卡同款雾面玻璃 */
      background: var(--card);
      backdrop-filter: blur(1.5rem) saturate(1.4);
      -webkit-backdrop-filter: blur(1.5rem) saturate(1.4);
      border: 1px solid rgba(255, 255, 255, 0.6);
      border-radius: var(--r-xl);
      corner-shape: squircle;
      box-shadow: 0 0.5rem 1.375rem rgba(61, 52, 39, 0.07);
    }

    .clear {
      padding: 0.6875rem 1.375rem;
      font-size: 0.875rem;
      font-weight: 600;
      border-radius: var(--r-lg);
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
  `,
  ]
}

declare global {
  interface HTMLElementTagNameMap {
    'sf-storage': SfStorage
  }
}
