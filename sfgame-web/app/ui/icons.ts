import { html } from 'lit'

// 火焰本体偏窄（x 6-18 vs 其余图标 4.5-19.5）：绕中心拉宽补齐视觉体量
export const iconFlame = html`<svg
  viewBox="0 0 24 24"
  fill="currentColor"
  aria-hidden="true"
>
  <g transform="translate(12 12) scale(1.17 1.03) translate(-12 -12)">
    <path
      d="M12 4.98c2.4 2.62 6 4.92 6 8.53a6 6 0 0 1-12 0c0-1.31.5-2.54 1.4-3.61.8.98 1.9 1.72 3 1.97-.8-2.38.1-4.92 1.6-6.89z"
    />
  </g>
</svg>`

// 雪花本体偏小（x 6.15-17.85）：等比放大对齐其余图标占位，等比保证描边不变形
export const iconSnow = html`<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  aria-hidden="true"
>
  <g transform="translate(12 12) scale(1.15) translate(-12 -12)">
    <line x1="12" y1="5.25" x2="12" y2="18.75" />
    <line x1="6.15" y1="8.63" x2="17.85" y2="15.38" />
    <line x1="17.85" y1="8.63" x2="6.15" y2="15.38" />
    <path d="M12 5.25l-2 2m2-2l2 2M12 18.75l-2-2m2 2l2-2" stroke-width="1.6" />
  </g>
</svg>`

export const iconBack = html`<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2.4"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <polyline points="16.2 5 8 12 16.2 19" />
</svg>`

export const iconHome = html`<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2.2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d="M4.5 10.8 12 4.6l7.5 6.2" />
  <path d="M6.4 9.6v9h11.2v-9" />
  <path d="M10.2 18.6v-4.6h3.6v4.6" />
</svg>`

export const iconReset = html`<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2.2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d="M5.9 9.45a6.6 6.6 0 1 1-.5 3.3" />
  <polyline points="5.8 5.35 5.8 9.45 9.9 9.45" />
</svg>`

export const iconSoundOn = html`<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2.2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d="M4.5 9.8v4.4h3L11.5 17.8V6.2L7.5 9.8H4.5z" fill="currentColor" stroke="none" />
  <path d="M14.7 9.2a3.6 3.6 0 0 1 0 5.6" />
  <path d="M16.9 6.9a6.3 6.3 0 0 1 0 10.2" />
</svg>`

export const iconSoundOff = html`<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2.2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d="M4.5 9.8v4.4h3L11.5 17.8V6.2L7.5 9.8H4.5z" fill="currentColor" stroke="none" />
  <line x1="14.7" y1="9.7" x2="18.7" y2="14.3" />
  <line x1="18.7" y1="9.7" x2="14.7" y2="14.3" />
</svg>`

export const iconLock = html`<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <rect x="5.5" y="10.5" width="13" height="9.5" rx="2.5" />
  <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
</svg>`

export const iconGear = html`<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  aria-hidden="true"
>
  <path d="M4 8h9M17 8h3M4 16h3M11 16h9" />
  <circle cx="15" cy="8" r="2" />
  <circle cx="9" cy="16" r="2" />
</svg>`

export const iconDatabase = html`<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" />
  <path d="M4.5 5.5v13c0 1.55 3.36 2.8 7.5 2.8s7.5-1.25 7.5-2.8v-13" />
  <path d="M4.5 12c0 1.55 3.36 2.8 7.5 2.8s7.5-1.25 7.5-2.8" />
</svg>`

export const iconInfo = html`<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  aria-hidden="true"
>
  <circle cx="12" cy="12" r="8.5" />
  <path d="M12 11v5" />
  <path d="M12 8h.01" />
</svg>`

export const iconAlert = html`<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d="M12 4 3.5 20h17L12 4z" />
  <path d="M12 10v4" />
  <path d="M12 17h.01" />
</svg>`

export const iconChevron = html`<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <polyline points="9 5.5 15.5 12 9 18.5" />
</svg>`

export const iconPause = html`<svg
  viewBox="0 0 24 24"
  fill="currentColor"
  aria-hidden="true"
>
  <rect x="5.5" y="4.5" width="4.5" height="15" rx="1.5" />
  <rect x="14" y="4.5" width="4.5" height="15" rx="1.5" />
</svg>`

export const iconPlay = html`<svg
  viewBox="0 0 24 24"
  fill="currentColor"
  aria-hidden="true"
>
  <path d="M8 5.5v13a1 1 0 0 0 1.54.84l10-6.5a1 1 0 0 0 0-1.68l-10-6.5A1 1 0 0 0 8 5.5Z" />
</svg>`
