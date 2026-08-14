import { LitElement, css, html } from 'lit'
import { customElement } from 'lit/decorators.js'
import { author, description, version } from '../../package.json'
import { boxReset, brandIn, card, pillLink } from './shared-styles.ts'
import logoUrl from '../../assets/logo-title.webp?url'

@customElement('sf-about-card')
export class SfAboutCard extends LitElement {
  protected override render() {
    return html`
      <section class="card about">
        <img
          class="brand"
          src=${logoUrl}
          alt="烧风 · 太阳精灵 · 用温度创造风"
        />
        <p class="wip"><b>WIP: Game Feel and Level Tuning.</b></p>
        <details class="intro">
          <summary>游戏介绍 <span class="caret" aria-hidden="true">›</span></summary>
          <p>烧风，一款关于风与温度的治愈解谜游戏。你是太阳精灵，在暖黄的手绘世界里，用温度创造风，护送纸飞机抵达远方。</p>
          <p>Shaofeng is a cozy puzzle game about wind and temperature. You are a sun spirit in a hand-drawn world of warm cream light, carrying a paper airplane home on wind you create.</p>
          <p>轻点地面放热源，长按放冷源：空气遇热上升、遇冷下沉，冷暖之间的压力差就是风。点击已放置的源可以随时移除。</p>
          <p>Tap to place a hot source, long-press for a cold one: warm air rises, cool air sinks, and the pressure between them becomes wind. Tap a placed source to remove it.</p>
          <p>风托起纸飞机，穿过山谷、绕过山峰，抵达绿色旗帜即通关。没有敌人，没有倒计时，只有风和你想去的方向。</p>
          <p>Your wind lifts the little paper plane over valleys and ridges to the green flag. No enemies, no countdown — just wind, and wherever you want to go.</p>
          <p>每一关都是一场物理小实验：燃烧的篝火、顺坡滑落的冷气、摇头的风扇、起伏的潮汐，还有初霜与灼原的极端气候，等待你读懂。</p>
          <p>Each level is a small physics experiment: crackling fires, cold air spilling downhill, swaying fans, breathing tides, and the extremes of frost and scorching heat — all waiting for you to read them.</p>
          <p>风的背后是真实流体模拟与严谨数学——从牛顿硬球物理可以推导出玻尔兹曼和 NS 方程。风不是魔法，而是温度的翻译。</p>
          <p>Behind the wind is a real fluid simulation and rigorous math — from Newtonian hard-sphere physics, the Boltzmann and Navier–Stokes equations follow. Wind is not magic; it is temperature, translated.</p>
          <p>20 段旅程，从第一缕风到越过天堑。配上安静的钢琴与风铃，愿你玩得开心。</p>
          <p>Twenty journeys, from the first breeze to the great divide, accompanied by gentle piano and wind chimes. Enjoy the flight.</p>
        </details>
        <details class="keys">
          <summary>快捷键 <span class="caret" aria-hidden="true">›</span></summary>
          <div class="keys-grid">
            <span>返回主页</span><span class="kbd-group"><kbd>Esc</kbd></span>
            <span>暂停 / 继续</span><span class="kbd-group"><kbd>Space</kbd><kbd>P</kbd></span>
            <span>重置关卡</span><span class="kbd-group"><kbd>R</kbd></span>
            <span>声音开关</span><span class="kbd-group"><kbd>M</kbd></span>
            <span>减速 / 加速</span><span class="kbd-group"><kbd>[</kbd><kbd>]</kbd></span>
            <span>后退（撤销）</span><span class="kbd-group"><kbd>Ctrl/Cmd+Z</kbd></span>
            <span>前进（重做）</span><span class="kbd-group"><kbd>Ctrl/Cmd+Shift+Z</kbd><kbd>Ctrl+Y</kbd></span>
          </div>
        </details>
        <div class="divider" role="separator"></div>
        <p class="line">${description}</p>
        <p class="line">作者：${author.name}</p>
        <p class="line">版本：v${version}</p>
        <div class="links">
          <a href="https://github.com/HK-SHAO/sfgame" target="_blank" rel="noopener">开源代码</a>
          <a href="https://www.bilibili.com/video/BV1RMgW6nE72/" target="_blank" rel="noopener">B站@烧风</a>
        </div>
        <p class="copyright">版权所有 © ${new Date().getFullYear()} HK-SHAO</p>
      </section>
    `
  }

  static styles = [
    boxReset,
    pillLink,
    brandIn,
    card,
    css`
      :host {
        display: block;
      }

      .about {
        padding: var(--sp-4) var(--sp-5-25);
      }

      .brand {
        display: block;
        width: 12rem;
        height: auto;
        aspect-ratio: 1 / 1;
        object-fit: contain;
        margin: 0 auto 0;
      }

      .wip {
        margin: 0 0 var(--sp-3);
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--hot);
        text-align: center;
      }

      .intro summary,
      .keys summary {
        list-style: none;
        cursor: pointer;
        margin: 0 0 var(--sp-2);
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--ink-soft);
        text-align: center;
        user-select: none;
        -webkit-user-select: none;
        transition: color 120ms ease-out;
      }

      .intro summary:hover,
      .keys summary:hover {
        color: var(--ink);
      }

      .intro summary .caret,
      .keys summary .caret {
        display: inline-block;
        font-weight: 700;
        transition: transform 160ms ease-out;
      }

      .intro[open] summary .caret,
      .keys[open] summary .caret {
        transform: rotate(90deg);
      }

      .intro summary::-webkit-details-marker,
      .keys summary::-webkit-details-marker {
        display: none;
      }

      .intro p {
        margin: 0 0 0.5rem;
        font-size: 0.75rem;
        line-height: 1.7;
        color: var(--ink-soft);
        text-align: left;
      }

      .intro p:last-child {
        margin-bottom: 0;
      }

      .keys-grid {
        display: grid;
        grid-template-columns: auto auto;
        justify-content: center;
        column-gap: var(--sp-3);
        row-gap: var(--sp-1);
        font-size: 0.75rem;
        color: var(--ink-soft);
      }

      .kbd-group {
        display: flex;
        gap: var(--sp-1);
        justify-content: flex-end;
      }

      kbd {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: var(--sp-0-5) var(--sp-1-5);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 0.6875rem;
        line-height: 1;
        color: var(--ink-soft);
        background: rgba(255, 253, 248, 0.7);
        border: 1px solid rgba(61, 52, 39, 0.12);
        border-bottom-width: 2px;
        border-radius: var(--r-sm);
        corner-shape: squircle;
        white-space: nowrap;
      }

      .divider {
        margin: var(--sp-3) 0;
        border-top: 1px solid rgba(61, 52, 39, 0.08);
      }

      .about .line {
        margin: 0;
        font-size: 0.875rem;
        line-height: 1.8;
        color: var(--ink-soft);
      }

      .links {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: var(--sp-2);
        margin-top: var(--sp-3);
      }

      .copyright {
        margin: var(--sp-3) 0 0;
        font-size: 0.75rem;
        color: var(--ink-soft);
        opacity: 0.7;
        text-align: center;
      }
    `,
  ]
}

declare global {
  interface HTMLElementTagNameMap {
    'sf-about-card': SfAboutCard
  }
}
