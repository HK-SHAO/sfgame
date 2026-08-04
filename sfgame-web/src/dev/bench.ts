/**
 * 浏览器端性能诊断页（bench.html）入口：真机/真浏览器实测帧预算占用。
 *
 * 用途：
 * - 研发用 Chrome DevTools / Safari WRDP 配合 CPU 节流复现低端机
 * - 玩家设备（尤其 iPhone）直接打开即可得到本机数据，回报给研发
 * 结果可一键复制为纯文本。
 */
import { runBench, type BenchStat } from './bench-core'

const params = new URLSearchParams(location.search)
const seconds = Math.max(2, Math.min(60, Number(params.get('seconds') ?? 10)))
const rate = Math.max(1, Math.min(32, Number(params.get('rate') ?? 16)))

const status = document.getElementById('status')!
const tableBody = document.getElementById('results')!
const copyBtn = document.getElementById('copy') as HTMLButtonElement
const rerunBtn = document.getElementById('rerun') as HTMLButtonElement

function deviceSummary(): string {
  const nav = navigator as Navigator & {
    deviceMemory?: number
    userAgentData?: { platform?: string }
  }
  return [
    nav.userAgentData?.platform || navigator.platform,
    `${navigator.hardwareConcurrency ?? '?'} 核`,
    `dpr ${window.devicePixelRatio}`,
    nav.deviceMemory ? `${nav.deviceMemory} GB` : '',
    `${window.screen.width}×${window.screen.height}`,
  ]
    .filter(Boolean)
    .join(' / ')
}

function uaShort(): string {
  const ua = navigator.userAgent
  const ios = ua.match(/OS (\d+[_.]\d+)/)
  if (ios) return `iOS ${ios[1].replace('_', '.')}`
  const android = ua.match(/Android [\d.]+/)
  if (android) return android[0]
  const safari = ua.match(/Version\/([\d.]+).*Safari/)
  if (safari) return `Safari ${safari[1]}`
  const chrome = ua.match(/Chrome\/([\d.]+)/)
  if (chrome) return `Chrome ${chrome[1]}`
  return ua.slice(0, 60)
}

function render(results: BenchStat[]) {
  tableBody.textContent = ''
  for (const r of results) {
    const tr = document.createElement('tr')
    const ratio = r.mean / 16.67
    const level = ratio > 0.5 ? 'hot' : ratio > 0.2 ? 'warm' : 'ok'
    tr.innerHTML = `<td>${r.name}</td><td class="num">${r.mean.toFixed(3)}</td><td class="num">${r.p95.toFixed(3)}</td><td class="num ${level}">${(ratio * 100).toFixed(0)}%</td><td class="detail">${r.detail}</td>`
    tableBody.appendChild(tr)
  }
  copyBtn.hidden = false
  rerunBtn.hidden = false
}

let report = ''

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(report)
    copyBtn.textContent = '已复制'
    setTimeout(() => (copyBtn.textContent = '复制报告'), 1200)
  } catch {
    prompt('复制以下内容：', report)
  }
})

rerunBtn.addEventListener('click', () => location.reload())

async function main() {
  status.textContent = `设备：${deviceSummary()} · ${uaShort()} · 模拟 ${seconds}s · 倍速帧 ${rate}×`
  // 让状态先绘制再进入密集计算
  await new Promise((r) => setTimeout(r, 60))
  const t0 = performance.now()
  const results = runBench({
    seconds,
    rate,
    onProgress: (p) => {
      status.textContent = `运行中 ${(p * 100).toFixed(0)}%…（页面短暂卡顿属正常）`
    },
  })
  const wall = ((performance.now() - t0) / 1000).toFixed(1)
  report = [
    `造风 bench · ${new Date().toISOString()}`,
    `UA: ${navigator.userAgent}`,
    `设备: ${deviceSummary()} · ${uaShort()}`,
    ...results.map(
      (r) => `${r.name}: mean ${r.mean.toFixed(3)}ms p95 ${r.p95.toFixed(3)}ms (${r.detail})`,
    ),
    `基准耗时 ${wall}s（${seconds}s 模拟）`,
  ].join('\n')
  status.textContent = `完成（基准耗时 ${wall}s）。帧预算占比 = mean / 16.7ms。`
  // 供 CDP 自动化脚本提取（window 全局，仅诊断页存在）
  ;(window as unknown as { __benchReport?: string }).__benchReport = report
  render(results)
}

void main()
