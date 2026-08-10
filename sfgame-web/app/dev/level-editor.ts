import { LitElement, css, html, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { parseLevelText } from '../game/level-format'
import { levelSource } from '../game/levels'
import { urlState } from '../game/state'
import { iconAlert, iconChevron } from '../ui/icons'

@customElement('sf-level-editor')
export class SfLevelEditor extends LitElement {
  onApply?: (json: string) => void
  @state() private expanded = false
  @state() private editorText = ''
  @state() private error = ''

  static styles = css`
    :host {
      display: block;
      /* dev 面板内的滚动条/控件按浅色渲染 */
      color-scheme: light;
    }

    button,
    textarea {
      font-family: inherit;
      color: inherit;
    }

    .toggle {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      width: 100%;
      padding: var(--sp-1) var(--sp-2);
      border: none;
      border-radius: var(--r-sm);
      corner-shape: squircle;
      background: transparent;
      color: inherit;
      font-size: 0.6875rem;
      line-height: 1.5;
      text-align: left;
      cursor: pointer;
      -webkit-user-select: none;
      user-select: none;
    }

    .toggle:hover {
      background: var(--dev-hover);
    }

    /* 折叠图标与面板头部图标同规格；展开旋转 90° */
    .toggle svg {
      flex: none;
      width: 0.75rem;
      height: 0.75rem;
      opacity: 0.75;
      transition: transform 150ms ease;
    }

    .toggle[aria-expanded='true'] svg {
      transform: rotate(90deg);
    }

    textarea {
      width: 100%;
      box-sizing: border-box;
      padding: var(--sp-1) var(--sp-2);
      border: 1px solid var(--dev-hairline);
      border-radius: var(--r-sm);
      corner-shape: squircle;
      background: var(--dev-input);
      color: inherit;
      font-size: 0.6875rem;
      line-height: 1.5;
      resize: vertical;
      min-height: 6rem;
      max-height: 40vh;
      touch-action: auto;
      user-select: text;
      white-space: pre;
      overflow: auto;
    }

    .row {
      display: flex;
      gap: var(--sp-2);
    }

    .row button {
      flex: 1;
      padding: var(--sp-1) var(--sp-2);
      border: none;
      border-radius: var(--r-sm);
      corner-shape: squircle;
      font-size: 0.6875rem;
      cursor: pointer;
      -webkit-user-select: none;
      user-select: none;
    }

    .apply {
      color: var(--dev-accent-fg);
      background: var(--dev-accent-bg);
    }

    .cancel {
      color: inherit;
      background: var(--dev-hover);
    }

    /* 校验失败容器：独立成块，下间距隔开按钮行 */
    .error {
      display: flex;
      align-items: flex-start;
      gap: 0.375rem;
      margin: 0 0 var(--sp-2);
      padding: var(--sp-2);
      font-size: 0.6875rem;
      font-weight: 500;
      line-height: 1.5;
      color: var(--dev-error);
      background: rgba(255, 180, 160, 0.16);
      border: 1px solid rgba(255, 180, 160, 0.42);
      border-radius: var(--r-sm);
      corner-shape: squircle;
      white-space: pre-wrap;
      word-break: break-all;
      user-select: text;
    }

    .error svg {
      flex: none;
      width: 0.875rem;
      height: 0.875rem;
      margin-top: 0.125rem;
    }
  `

  protected override render() {
    return html`
      <button class="toggle" @click=${this.toggle} aria-expanded=${this.expanded}>
        ${iconChevron}
        <span>关卡编辑</span>
      </button>
      ${this.expanded
        ? html`
            <textarea
              name="dev-level-json"
              rows="10"
              spellcheck="false"
              .value=${this.editorText}
              @input=${this.onInput}
            ></textarea>
            ${this.error ? html`<p class="error" role="alert">${iconAlert}<span>${this.error}</span></p>` : nothing}
            <div class="row">
              <button class="apply" @click=${this.confirm}>确认生效</button>
              <button class="cancel" @click=${this.collapse}>取消</button>
            </div>
          `
        : nothing}
    `
  }

  private toggle() {
    this.expanded = !this.expanded
    if (this.expanded) {
      this.error = ''
      this.editorText = this.currentText() ?? ''
    }
  }

  // 当前关卡源文本：内联关卡为 URL 紧凑 JSON，这里重新美化；内置关卡取仓库 JSON 原文
  private currentText(): string | undefined {
    const lv = urlState.get('lv')
    if (lv !== null && 'json' in lv) {
      try {
        return JSON.stringify(JSON.parse(lv.json), null, 2)
      } catch {
        return undefined
      }
    }
    return lv === null ? undefined : levelSource(lv.id)
  }

  private collapse() {
    this.expanded = false
    this.error = ''
  }

  private onInput(e: Event) {
    this.editorText = (e.target as HTMLTextAreaElement).value
  }

  private confirm() {
    try {
      // parseLevelText 已校验，直接序列化交 app 压 URL
      const json = JSON.stringify(parseLevelText(this.editorText))
      this.onApply?.(json)
      this.error = ''
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e)
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sf-level-editor': SfLevelEditor
  }
}
