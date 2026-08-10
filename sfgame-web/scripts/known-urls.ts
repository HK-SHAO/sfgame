// 打印全部已知解的 URL 直达参数（?lv=<slug>&s=…）：仅依赖纯 TS（game/state 的 s= 编码），无需 WASM/关卡加载
import { KNOWN_SOLUTIONS, solutionUrl } from './known-solutions'

for (const [lv, sol] of Object.entries(KNOWN_SOLUTIONS).sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`?lv=${lv}&s=${solutionUrl(sol.src)}`)
}
