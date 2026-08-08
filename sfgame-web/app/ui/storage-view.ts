import { LitElement, css, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { name } from '../../package.json'
import { deleteStemCache, listStemCache, type StemCacheInfo } from '../core/music-bakery'
import { iconBack, iconDatabase } from './icons'
import { boxReset, card, pageShell } from './shared-styles'

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
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(t: number): string {
  const d = new Date(t)
  const p = (v: number) => String(v).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

@customElement('sf-storage')
export class SfStorage extends LitElement {
  @state() private armed: string | null = null
  @state() private idbEntries: StemCacheInfo[] = []
  private entries: StorageEntry[] = []
  private disarmTimer: ReturnType<typeof setTimeout> | null = null

  private onBack = () => this.dispatchEvent(new CustomEvent('back'))

  connectedCallback() {
    super.connectedCallback()
    this.entries = listEntries()
    void listStemCache().then((list) => {
      this.idbEntries = list
    })
  }

  // 两步确认删除；armed 键域：'*' = 全部、'idb:N' = 烘焙缓存、其余 = localStorage 键
  private arm(key: string) {
    if (this.armed !== key) {
      this.armed = key
      if (this.disarmTimer) clearTimeout(this.disarmTimer)
      this.disarmTimer = setTimeout(() => {
        this.armed = null
      }, 3000)
      return
    }
    if (key === '*') {
      for (const e of this.entries) localStorage.removeItem(e.key)
      // 整页重载：模块单例在内存持有旧数据（URL 带 v=storage，重载仍回本页）
      void deleteStemCache().finally(() => location.reload())
    } else if (key.startsWith('idb:')) {
      void deleteStemCache(Number(key.slice(4))).finally(() => location.reload())
    } else {
      localStorage.removeItem(key)
      location.reload()
    }
  }

  override disconnectedCallback() {
    if (this.disarmTimer) clearTimeout(this.disarmTimer)
    super.disconnectedCallback()
  }

  protected override render() {
    const localTotal = this.entries.reduce((s, e) => s + e.bytes, 0)
    const idbTotal = this.idbEntries.reduce((s, e) => s + e.bytes, 0)
    const allEmpty = this.entries.length === 0 && this.idbEntries.length === 0
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
          <h2 class="card-title">进度与偏好（localStorage）</h2>
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

        <section class="card">
          <h2 class="card-title">音乐烘焙缓存（IndexedDB）</h2>
          ${this.idbEntries.length === 0
            ? html`<p class="empty small">${iconDatabase}<span>暂无缓存，进关时会重新烘焙</span></p>`
            : this.idbEntries.map(
                (e) => html`
                  <div class="entry">
                    <div class="entry-head">
                      <code class="key">背景音乐 · 关卡 ${e.id}</code>
                      <span class="size">${formatBytes(e.bytes)} · ${formatTime(e.time)}</span>
                      <button
                        class="del"
                        @click=${(ev: Event) => {
                          ev.preventDefault()
                          ev.stopPropagation()
                          this.arm(`idb:${e.id}`)
                        }}
                      >
                        ${this.armed === `idb:${e.id}` ? '确认删除' : '删除'}
                      </button>
                    </div>
                  </div>
                `,
              )}
          <p class="note left">预烘的钢琴 BGM 音频数据，清除后不影响游玩（下次进关重新烘焙）。</p>
        </section>

        <div class="foot">
          <button
            class="clear ${this.armed === '*' ? 'armed' : ''}"
            @click=${() => this.arm('*')}
            ?disabled=${allEmpty}
          >
            ${this.armed === '*' ? '确认清空全部' : '清空全部数据'}
          </button>
          <p class="note">
            共 ${this.entries.length + this.idbEntries.length} 项 · ${formatBytes(localTotal + idbTotal)}
          </p>
          <p class="note">数据仅保存在本设备浏览器（localStorage + IndexedDB），删除后不可恢复。</p>
        </div>
      </main>
    `
  }

  static styles = [
    boxReset,
    pageShell,
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

      .card-title {
        margin: var(--sp-1) var(--sp-2) var(--sp-2);
        font-size: 0.875rem;
        font-weight: 700;
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

    .empty.small {
      padding: var(--sp-3) var(--sp-4);
      font-size: 0.8125rem;
    }

    .empty svg {
      width: 1.5rem;
      height: 1.5rem;
      flex: none;
    }

    .note.left {
      text-align: left;
      margin: var(--sp-2) var(--sp-2) var(--sp-1);
    }

    .foot {
      max-width: var(--maxw-card);
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
