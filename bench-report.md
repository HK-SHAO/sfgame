造风 bench · 2026-08-04T08:00:14.123Z UA: Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1 设备: iPhone / 4 核 / dpr 3 / 440×956 · iOS 18.7 · 引擎 js+wasm fluid.step（JS）: mean 0.488ms p95 1.000ms (网格 101×75（js）) fluid.step（wasm）: mean 0.647ms p95 1.000ms (网格 101×75（wasm）) LevelSim.step: mean 0.485ms p95 1.000ms (流体+刚体+源（js）) tracers.step: mean 0.012ms p95 0.000ms (240 粒子 × 24 轨迹点) batch 构建: mean 0.204ms p95 1.000ms (9600 stroke + 400 disc) 基准耗时 1.9s（10s 模拟）

造风 bench · 2026-08-04T08:02:38.870Z
UA: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36
设备: macOS / 10 核 / dpr 2 / 16 GB / 1470×956 · Chrome 150.0.0.0 · 引擎 js+wasm
fluid.step（JS）: mean 0.763ms p95 0.900ms (网格 101×75（js）)
fluid.step（wasm）: mean 1.546ms p95 1.700ms (网格 101×75（wasm）)
LevelSim.step: mean 0.788ms p95 0.900ms (流体+刚体+源（js）)
tracers.step: mean 0.009ms p95 0.100ms (240 粒子 × 24 轨迹点)
batch 构建: mean 0.373ms p95 0.500ms (9600 stroke + 400 disc)
基准耗时 3.5s（10s 模拟）

造风 bench · 2026-08-04T07:59:20.421Z
UA: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Safari/605.1.15
设备: MacIntel / 8 核 / dpr 2 / 1470×956 · Safari 26.5.2 · 引擎 js+wasm
fluid.step（JS）: mean 0.602ms p95 1.000ms (网格 101×75（js）)
fluid.step（wasm）: mean 0.712ms p95 1.000ms (网格 101×75（wasm）)
LevelSim.step: mean 0.600ms p95 1.000ms (流体+刚体+源（js）)
tracers.step: mean 0.012ms p95 0.000ms (240 粒子 × 24 轨迹点)
batch 构建: mean 0.204ms p95 1.000ms (9600 stroke + 400 disc)
基准耗时 2.3s（10s 模拟）
