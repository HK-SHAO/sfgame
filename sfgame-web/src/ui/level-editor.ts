import { LitElement, css, html, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { DEV_OVERRIDE_EVENT, getDevOverrideText, setDevOverride } from '../game/session'
import { levelSource } from '../game/levels'

/**
 * dev 关卡编辑器（?dev=1）：编辑第 1 关 YAML（lv=0 槽，见 game/session.ts）。
 * 独立组件、不关心定位/拖动/性能——由 DevTools 装配进开发面板（sf-dev-panel）
 * 的 slot 随面板移动；主题色复用面板的 --dev-* CSS 变量（继承穿透 shadow 边界）。
 * 默认折叠（无边框披露行 + 小三角）；「确认生效」写入会话覆写并派发
 * DEV_OVERRIDE_EVENT（app 跳 ?lv=0，浏览器返回即复原）；非法 YAML 内联报错。
 */
@customElement('sf-level-editor')
export class SfLevelEditor extends LitElement {
  @state() private expanded = false
  @state() private editorText = ''
  @state() private error = ''

  static styles = css`
    :host {
      display: block;
    }

    /* 折叠控件：无边框披露行（小三角 + 标签），3D 调试面板风格 */
    .toggle {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      width: 100%;
      padding: 0.25rem 0.375rem;
      border: none;
      border-radius: 0.375rem;
      corner-shape: squircle;
      background: transparent;
      color: inherit;
      font-size: 0.6875rem;
      text-align: left;
      cursor: pointer;
      -webkit-user-select: none;
      user-select: none;
    }

    .toggle:hover {
      background: var(--dev-hover);
    }

    .caret {
      flex: none;
      width: 0;
      height: 0;
      border-left: 0.32em solid currentColor;
      border-top: 0.22em solid transparent;
      border-bottom: 0.22em solid transparent;
      opacity: 0.8;
      transition: transform 150ms ease;
    }

    .toggle[aria-expanded='true'] .caret {
      transform: rotate(90deg);
    }

    textarea {
      width: 100%;
      box-sizing: border-box;
      padding: 0.25rem 0.375rem;
      border: 1px solid var(--dev-hairline);
      border-radius: 0.375rem;
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
      gap: 0.375rem;
    }

    .row button {
      flex: 1;
      padding: 0.25rem 0.5rem;
      border: none;
      border-radius: 0.375rem;
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

    .error {
      margin: 0;
      color: var(--dev-error);
      font-size: 0.6875rem;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-all;
      user-select: text;
    }
  `

  protected override render() {
    return html`
      <button class="toggle" @click=${this.toggle} aria-expanded=${this.expanded}>
        <span class="caret" aria-hidden="true"></span>
        <span>关卡 YAML</span>
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

  /** 校验 + 写入会话覆写，成功后派发事件（app 跳到 ?lv=0）；保持展开不收起，
   * 便于连续迭代。 */
  private confirm() {
    try {
      setDevOverride(this.editorText)
      window.dispatchEvent(new CustomEvent(DEV_OVERRIDE_EVENT))
      this.error = ''
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
