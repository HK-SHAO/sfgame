import { css, unsafeCSS } from 'lit'
import bgArtUrl from '../../assets/bg-title.webp?url'

export const boxReset = css`
  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  :host {
    color-scheme: light;
    text-autospace: normal;
    touch-action: manipulation;
  }

  button,
  input,
  textarea,
  summary {
    font: inherit;
    color: inherit;
  }

  button,
  summary,
  a {
    touch-action: manipulation;
  }
`

export const reduceMotion = css`
  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
`

export const warmBg = css`
  background: var(--bg-warm);
`

export const artBg = css`
  :host {
    background:
      url('${unsafeCSS(bgArtUrl)}') center center / cover no-repeat,
      var(--bg-warm);
  }
`

export const pageShell = css`
  .page {
    height: 100%;
    overflow-y: auto;
    padding: 0 calc(var(--page-pad-x) + env(safe-area-inset-right, 0px))
      calc(var(--page-pad-y) + env(safe-area-inset-bottom, 0px)) calc(var(--page-pad-x) + env(safe-area-inset-left, 0px));
    scrollbar-width: thin;
    scrollbar-color: var(--scroll-thumb) transparent;
  }

  .bar {
    position: sticky;
    top: 0;
    z-index: 10;
    margin: 0 calc(-1 * (var(--page-pad-x) + env(safe-area-inset-right, 0px))) var(--sp-4)
      calc(-1 * (var(--page-pad-x) + env(safe-area-inset-left, 0px)));
    padding: calc(0.75rem + env(safe-area-inset-top, 0px)) calc(var(--page-pad-x) + env(safe-area-inset-right, 0px)) 0.75rem
      calc(var(--page-pad-x) + env(safe-area-inset-left, 0px));
    background: var(--card-glass);
    backdrop-filter: var(--blur-glass);
    -webkit-backdrop-filter: var(--blur-glass);
    border-bottom: 1px solid rgba(255, 255, 255, 0.45);
    box-shadow: 0 0.25rem 1rem rgba(61, 52, 39, 0.08);
    border-radius: 0 0 var(--r-lg) var(--r-lg);
    corner-shape: squircle;
  }

  .bar-inner {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    max-width: var(--maxw-card);
    margin: 0 auto;
  }

  .head-text h1 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 700;
    letter-spacing: 0.01em;
  }

  .icon-btn {
    flex: none;
    width: var(--ctl-h);
    height: var(--ctl-h);
    display: grid;
    border: none;
    border-radius: var(--r-md);
    corner-shape: squircle;
    background: var(--card-glass);
    backdrop-filter: var(--blur-glass);
    -webkit-backdrop-filter: var(--blur-glass);
    border: 1px solid var(--glass-line);
    box-shadow: var(--shadow-ctl);
    color: var(--ink);
    cursor: pointer;
    padding: 0;
  }

  .icon-btn {
    transition: transform 100ms ease-out, box-shadow 120ms ease-out;
  }

  .icon-btn:active {
    transform: scale(0.97);
  }

  .icon-btn:hover {
    box-shadow: var(--shadow-card);
  }

  .icon-btn > * {
    margin: auto;
  }

  .icon-btn svg {
    width: var(--icon-lg);
    height: var(--icon-lg);
  }
`

export const glassChip = css`
  .icon-btn,
  .chip,
  .glass-chip {
    background: rgba(255, 253, 248, 0.66);
    backdrop-filter: var(--blur-glass);
    -webkit-backdrop-filter: var(--blur-glass);
    border: 1px solid var(--glass-line);
    box-shadow: var(--shadow-ctl);
  }
`

export const pillLink = css`
  .link-btn,
  .links a,
  .pill-link {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1-5);
    padding: var(--sp-2) var(--sp-4);
    font-size: 0.75rem;
    color: var(--ink-soft);
    text-decoration: none;
    background: rgba(255, 253, 248, 0.6);
    border: 1px solid var(--glass-line);
    border-radius: var(--r-pill);
    transition: color 120ms ease-out, box-shadow 120ms ease-out;
  }

  .link-btn:hover,
  .links a:hover,
  .pill-link:hover {
    color: var(--ink);
    box-shadow: 0 0.25rem 0.875rem rgba(61, 52, 39, 0.08);
  }
`

export const buttonReset = css`
  button {
    border: none;
    background: none;
    padding: 0;
    cursor: pointer;
    color: inherit;
    -webkit-user-select: none;
    user-select: none;
  }

  button:hover {
    background: rgba(255, 255, 255, 0.55);
  }

  button:active {
    transform: scale(0.97);
  }
`

export const card = css`
  .card {
    max-width: var(--maxw-card);
    margin: 0 auto var(--sp-4);
    padding: var(--sp-2);
    background: var(--card-glass);
    backdrop-filter: var(--blur-glass);
    -webkit-backdrop-filter: var(--blur-glass);
    border: 1px solid rgba(255, 255, 255, 0.6);
    border-radius: var(--r-lg);
    corner-shape: squircle;
    box-shadow: 0 0.5rem 1.375rem rgba(61, 52, 39, 0.07);
  }
`
