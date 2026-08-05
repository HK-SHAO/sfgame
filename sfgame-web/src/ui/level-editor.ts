import { LitElement, css, html, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { DEV_OVERRIDE_EVENT, getDevOverrideText, setDevOverride } from '../game/session'
import { levelSource } from '../game/levels'

/**
 * dev 关卡编辑器（?dev=1）：编辑第 1 关 YAML（lv=0 槽，见 game/session.ts）。
 * 独立组件、不关心定位/拖动/性能——由 DevTools 装配进 sf-perf 的 slot 随面板移动。
 * 默认折叠；「确认生效」写入会话覆写并派发 DEV_OVERRIDE_EVENT（app 跳 ?lv=0，
 * 浏览器返回即复原）；非法 YAML 内联报错，不打断当前局。
 */
@customElement('sf-level-editor')
export class SfLevelEditor extends LitElement {
  @state() private expanded = false
  @state() private editorText = ''
  @state() private error = ''

  static styles = css`
    :host {
      display: block;
      touch-action: auto;
    }

    /* 展开控件：独立一行、撑满面板宽（Apple 风格胶囊按钮） */
    .toggle {
      width: 100%;
      padding: 0.375rem 0.75rem;
      border: 1px solid rgba(255, 233, 201, 0.3);
      border-radius: 0.625rem;
      corner-shape: squircle;
      color: inherit;
      font-size: 0.75rem;
      background: rgba(255, 233, 201, 0.08);
      cursor: pointer;
      touch-action: auto;
      -webkit-user-select: none;
      user-select: none;
    }

    .toggle:active {
      background: rgba(255, 233, 201, 0.2);
    }

    textarea {
      width: min(22rem, 82vw);
      box-sizing: border-box;
      padding: 0.375rem 0.5rem;
      border: 1px solid rgba(255, 233, 201, 0.35);
      border-radius: 0.5rem;
      corner-shape: squircle;
      background: rgba(0, 0, 0, 0.35);
      color: #ffe9c9;
      font-size: 0.75rem;
      line-height: 1.5;
      resize: vertical;
      min-height: 7rem;
      touch-action: auto;
      user-select: text;
      white-space: pre;
      overflow: auto;
    }

    .row {
      display: flex;
      gap: 0.375rem;
    }

    .row button {
      flex: 1;
      padding: 0.375rem 0.75rem;
      border: none;
      border-radius: 0.625rem;
      corner-shape: squircle;
      font-size: 0.75rem;
      cursor: pointer;
      touch-action: auto;
      -webkit-user-select: none;
      user-select: none;
    }

    .apply {
      color: #1d160e;
      background: #ffe9c9;
    }

    .cancel {
      color: #ffe9c9;
      background: rgba(255, 233, 201, 0.14);
    }

    .error {
      margin: 0;
      color: #ffb4a0;
      font-size: 0.75rem;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-all;
      user-select: text;
    }
  `

  protected override render() {
    return html`
      <button class="toggle" @click=${this.toggle} aria-expanded=${this.expanded}>
        ${this.expanded ? '收起 · 关卡 YAML' : '展开 · 编辑关卡 YAML'}
      </button>
      ${this.expanded
        ? html`
            <textarea
              name="dev-level-yaml"
              rows="10"
              spellcheck="false"
              .value=${this.editorText}
              @input=${this.onInput}
            ></textarea>
            ${this.error ? html`<p class="error">${this.error}</p>` : nothing}
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
      // 预填：上次覆写文本（可继续迭代）→ 第 1 关原始 YAML
      this.editorText = getDevOverrideText() ?? levelSource(1) ?? ''
    }
  }

  private collapse() {
    this.expanded = false
    this.error = ''
  }

  private onInput(e: Event) {
    this.editorText = (e.target as HTMLTextAreaElement).value
  }

  /** 校验 + 写入会话覆写，成功后派发事件（app 跳到 ?lv=0）。 */
  private confirm() {
    try {
      setDevOverride(this.editorText)
      window.dispatchEvent(new CustomEvent(DEV_OVERRIDE_EVENT))
      this.expanded = false
    } catch (e) {
      // 非法 YAML/校验失败：留在编辑器内显示错误原文，不打断当前局
      this.error = e instanceof Error ? e.message : String(e)
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sf-level-editor': SfLevelEditor
  }
}
