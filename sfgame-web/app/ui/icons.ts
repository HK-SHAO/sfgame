import { html, nothing, svg } from 'lit'
import type { TemplateResult } from 'lit'

function outlineIcon(sw: number, inner: TemplateResult, join = true): TemplateResult {
  return html`<svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="${sw}"
    stroke-linecap="round"
    stroke-linejoin=${join ? 'round' : nothing}
    aria-hidden="true"
  >
    ${inner}
  </svg>`
}

function fillIcon(inner: TemplateResult): TemplateResult {
  return html`<svg
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    ${inner}
  </svg>`
}

export const iconFlame = fillIcon(svg`
  <g transform="translate(12 12) scale(1.17 1.03) translate(-12 -12)">
    <path
      d="M12 4.98c2.4 2.62 6 4.92 6 8.53a6 6 0 0 1-12 0c0-1.31.5-2.54 1.4-3.61.8.98 1.9 1.72 3 1.97-.8-2.38.1-4.92 1.6-6.89z"
    />
  </g>
`)

export const iconSnow = outlineIcon(2, svg`
  <g transform="translate(12 12) scale(1.15) translate(-12 -12)">
    <line x1="12" y1="5.25" x2="12" y2="18.75" />
    <line x1="6.15" y1="8.63" x2="17.85" y2="15.38" />
    <line x1="17.85" y1="8.63" x2="6.15" y2="15.38" />
    <path d="M12 5.25l-2 2m2-2l2 2M12 18.75l-2-2m2 2l2-2" stroke-width="1.6" />
  </g>
`, false)

export const iconBack = outlineIcon(2.4, svg`
  <polyline points="16.2 5 8 12 16.2 19" />
`)

export const iconHome = outlineIcon(2.2, svg`
  <path d="M4.5 10.8 12 4.6l7.5 6.2" />
  <path d="M6.4 9.6v9h11.2v-9" />
  <path d="M10.2 18.6v-4.6h3.6v4.6" />
`)

export const iconReset = outlineIcon(2.2, svg`
  <path d="M5.9 9.45a6.6 6.6 0 1 1-.5 3.3" />
  <polyline points="5.8 5.35 5.8 9.45 9.9 9.45" />
`)

export const iconSoundOn = outlineIcon(2.2, svg`
  <path d="M4.5 9.8v4.4h3L11.5 17.8V6.2L7.5 9.8H4.5z" fill="currentColor" stroke="none" />
  <path d="M14.7 9.2a3.6 3.6 0 0 1 0 5.6" />
  <path d="M16.9 6.9a6.3 6.3 0 0 1 0 10.2" />
`)

export const iconSoundOff = outlineIcon(2.2, svg`
  <path d="M4.5 9.8v4.4h3L11.5 17.8V6.2L7.5 9.8H4.5z" fill="currentColor" stroke="none" />
  <line x1="14.7" y1="9.7" x2="18.7" y2="14.3" />
  <line x1="18.7" y1="9.7" x2="14.7" y2="14.3" />
`)

export const iconLock = outlineIcon(2, svg`
  <rect x="5.5" y="10.5" width="13" height="9.5" rx="2.5" />
  <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
`)

export const iconGear = outlineIcon(2, svg`
  <path d="M4 8h9M17 8h3M4 16h3M11 16h9" />
  <circle cx="15" cy="8" r="2" />
  <circle cx="9" cy="16" r="2" />
`, false)

export const iconDatabase = outlineIcon(2, svg`
  <ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" />
  <path d="M4.5 5.5v13c0 1.55 3.36 2.8 7.5 2.8s7.5-1.25 7.5-2.8v-13" />
  <path d="M4.5 12c0 1.55 3.36 2.8 7.5 2.8s7.5-1.25 7.5-2.8" />
`)

export const iconInfo = outlineIcon(2, svg`
  <circle cx="12" cy="12" r="8.5" />
  <path d="M12 11v5" />
  <path d="M12 8h.01" />
`, false)

export const iconAlert = outlineIcon(2, svg`
  <path d="M12 4 3.5 20h17L12 4z" />
  <path d="M12 10v4" />
  <path d="M12 17h.01" />
`)

export const iconChevron = outlineIcon(2, svg`
  <polyline points="9 5.5 15.5 12 9 18.5" />
`)

export const iconPause = fillIcon(svg`
  <rect x="5.5" y="4.5" width="4.5" height="15" rx="1.5" />
  <rect x="14" y="4.5" width="4.5" height="15" rx="1.5" />
`)

export const iconPlay = fillIcon(svg`
  <path d="M8 5.5v13a1 1 0 0 0 1.54.84l10-6.5a1 1 0 0 0 0-1.68l-10-6.5A1 1 0 0 0 8 5.5Z" />
`)
