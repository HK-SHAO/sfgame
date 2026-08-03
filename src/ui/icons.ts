import { html } from 'lit'

/** 统一线性图标：2px 圆头描边，随 currentColor 着色。 */

export const iconFlame = html`<svg
  viewBox="0 0 24 24"
  fill="currentColor"
  aria-hidden="true"
>
  <path
    d="M12 2.8c1.9 2.6 4.8 5 4.8 8.6a4.8 4.8 0 0 1-9.6 0c0-1.3.4-2.5 1.1-3.6.6 1 1.5 1.7 2.4 1.9-.6-2.3.1-4.8 1.3-6.9z"
  />
</svg>`

export const iconSnow = html`<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  aria-hidden="true"
>
  <line x1="12" y1="3" x2="12" y2="21" />
  <line x1="4.2" y1="7.5" x2="19.8" y2="16.5" />
  <line x1="19.8" y1="7.5" x2="4.2" y2="16.5" />
  <path d="M12 3l-2 2m2-2l2 2M12 21l-2-2m2 2l2-2" stroke-width="1.6" />
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
  <polyline points="14.5 5.5 8 12 14.5 18.5" />
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
  <path d="M4.6 9.5a8 8 0 1 1-.6 4" />
  <polyline points="4.5 4.5 4.5 9.5 9.5 9.5" />
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
  <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z" fill="currentColor" stroke="none" />
  <path d="M15.5 9a4.2 4.2 0 0 1 0 6" />
  <path d="M18 6.8a7.4 7.4 0 0 1 0 10.4" />
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
  <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z" fill="currentColor" stroke="none" />
  <line x1="15.5" y1="9.5" x2="20.5" y2="14.5" />
  <line x1="20.5" y1="9.5" x2="15.5" y2="14.5" />
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

export const iconLogo = html`<svg viewBox="0 0 64 64" aria-hidden="true">
  <circle cx="22" cy="22" r="12" fill="#ffb43c" />
  <g stroke="#ffb43c" stroke-width="4" stroke-linecap="round">
    <line x1="22" y1="3" x2="22" y2="7" />
    <line x1="8" y1="8" x2="11" y2="11" />
    <line x1="3" y1="22" x2="7" y2="22" />
    <line x1="8" y1="36" x2="11" y2="33" />
    <line x1="36" y1="8" x2="33" y2="11" />
  </g>
  <g stroke="#3d8bff" stroke-width="5" stroke-linecap="round" fill="none">
    <path d="M12 46 H46 a7 7 0 1 0 -7 -7" />
    <path d="M20 57 H42" />
  </g>
</svg>`
