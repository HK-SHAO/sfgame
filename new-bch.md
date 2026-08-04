造风 bench · 2026-08-04T08:16:06.034Z
UA: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Safari/605.1.15
设备: MacIntel / 8 核 / dpr 2 / 1470×956 · Safari 26.5.2 · 引擎 js+wasm
fluid.step（JS）: mean 0.510ms p95 1.000ms (网格 101×75（js）)
fluid.step（wasm）: mean 0.708ms p95 1.000ms (网格 101×75（wasm）)
LevelSim.step: mean 0.503ms p95 1.000ms (流体+刚体+源（js）)
tracers.step: mean 0.015ms p95 0.000ms (240 粒子 × 24 轨迹点)
batch 构建: mean 0.208ms p95 1.000ms (9600 stroke + 400 disc)
倍速帧 16×: mean 9.333ms p95 10.000ms (16 tick(步进+粒子) + 批构建；>16.7ms 即掉帧)
基准耗时 4.5s（10s 模拟）

造风 bench · 2026-08-04T08:15:50.980Z
UA: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36
设备: macOS / 10 核 / dpr 2 / 16 GB / 1470×956 · Chrome 150.0.0.0 · 引擎 js+wasm
fluid.step（JS）: mean 0.643ms p95 0.700ms (网格 101×75（js）)
fluid.step（wasm）: mean 1.558ms p95 1.700ms (网格 101×75（wasm）)
LevelSim.step: mean 0.642ms p95 0.700ms (流体+刚体+源（js）)
tracers.step: mean 0.009ms p95 0.100ms (240 粒子 × 24 轨迹点)
batch 构建: mean 0.335ms p95 0.400ms (9600 stroke + 400 disc)
倍速帧 16×: mean 11.745ms p95 12.000ms (16 tick(步进+粒子) + 批构建；>16.7ms 即掉帧)
基准耗时 6.3s（10s 模拟）

造风 bench · 2026-08-04T08:16:59.246Z UA: Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1 设备: iPhone / 4 核 / dpr 3 / 440×956 · iOS 18.7 · 引擎 js+wasm fluid.step（JS）: mean 0.520ms p95 1.000ms (网格 101×75（js）) fluid.step（wasm）: mean 0.767ms p95 1.000ms (网格 101×75（wasm）) LevelSim.step: mean 0.485ms p95 1.000ms (流体+刚体+源（js）) tracers.step: mean 0.005ms p95 0.000ms (240 粒子 × 24 轨迹点) batch 构建: mean 0.263ms p95 1.000ms (9600 stroke + 400 disc) 倍速帧 16×: mean 8.942ms p95 10.000ms (16 tick(步进+粒子) + 批构建；>16.7ms 即掉帧) 基准耗时 4.5s（10s 模拟）
