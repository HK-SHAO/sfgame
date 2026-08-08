// 音乐烘焙 Worker：物理建模钢琴合成在后台线程执行，主线程零开销（根除关卡内烘焙掉帧）
// 单任务生命周期：收 levelId → 引导 wasm → renderStems → transfer 传回产物；完成后由主线程 terminate（内存不驻留）

import { bootEngine, createEngine } from '../wasm/engine'
import { bakeScore, renderStems } from './music'
import engineUrl from '../wasm/sfengine.wasm?url'

interface WorkerScope {
  onmessage: ((e: MessageEvent) => void) | null
  postMessage(msg: unknown, transfer?: Transferable[]): void
}

const scope = self as unknown as WorkerScope
let ready: Promise<boolean> | null = null

scope.onmessage = (e: MessageEvent) => {
  const levelId = e.data as number
  ready ??= bootEngine(async () => {
    const res = await fetch(engineUrl)
    if (!res.ok) throw new Error(`wasm ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  })
  void ready
    .then((ok) => {
      if (!ok) throw new Error('wasm 加载失败')
      const stems = renderStems(createEngine(), bakeScore(levelId), (done, total) =>
        scope.postMessage({ type: 'progress', done, total }),
      )
      scope.postMessage(
        { type: 'done', levelId, accomp: stems.accomp.buffer, theme: stems.theme.buffer },
        [stems.accomp.buffer, stems.theme.buffer],
      )
    })
    .catch(() => scope.postMessage({ type: 'error', levelId }))
}
