import { html } from 'lit'

/** 统一线性图标：2px 圆头描边，随 currentColor 着色。 */

export const iconFlame = html`<svg
  viewBox="0 0 24 24"
  fill="currentColor"
  aria-hidden="true"
>
  <path
    d="M12 4.98c2.4 2.62 6 4.92 6 8.53a6 6 0 0 1-12 0c0-1.31.5-2.54 1.4-3.61.8.98 1.9 1.72 3 1.97-.8-2.38.1-4.92 1.6-6.89z"
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
  <line x1="12" y1="5.25" x2="12" y2="18.75" />
  <line x1="6.15" y1="8.63" x2="17.85" y2="15.38" />
  <line x1="17.85" y1="8.63" x2="6.15" y2="15.38" />
  <path d="M12 5.25l-2 2m2-2l2 2M12 18.75l-2-2m2 2l2-2" stroke-width="1.6" />
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

export const iconRoute = html`<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <circle cx="5" cy="18" r="1.8" />
  <circle cx="19" cy="6" r="1.8" />
  <path d="M6.6 16.6c3.4-1.4 5-6.4 10.8-9.2" stroke-dasharray="1 1.6" />
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
