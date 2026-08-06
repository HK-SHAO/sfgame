#!/bin/sh
# 编译 WASM 内核（C → sfengine.wasm）：流体内核 + 渲染顶点批两文件一次链接，单模块单内存。
# 产物 src/wasm/sfengine.wasm（与旧 asc 产物同路径，JS 引导零改动）。
# -O3 -msimd128：LLVM 标量优化 + 自动向量化；-ffp-contract=off 保 IEEE 语义（混沌流场禁 FMA 融合）。
set -e
NATIVE_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$NATIVE_DIR/../src/wasm/sfengine.wasm"
if [ -f /Users/sf/dev/emsdk/emsdk_env.sh ]; then
  . /Users/sf/dev/emsdk/emsdk_env.sh >/dev/null 2>&1
else
  echo "[wasm] 未找到 emsdk（期望 /Users/sf/dev/emsdk/emsdk_env.sh），请先安装并 activate" >&2
  exit 1
fi
emcc -O3 -msimd128 -ffp-contract=off \
  -sSTANDALONE_WASM --no-entry -sNO_FILESYSTEM=1 \
  -sINITIAL_MEMORY=16777216 \
  -sEXPORTED_FUNCTIONS=_init,_clear,_setAmbient,_rebuildSolid,_addHeat,_sampleVelocity,_outX,_outY,_sampleTemp,_fieldU,_fieldV,_fieldT,_solidBuf,_step,_bCapacity,_bPtsCap,_bFadeCap,_bData,_bPtsBuf,_bFadeBuf,_bCount,_bReset,_bTri,_bRect,_bRectVGrad,_bStroke,_bPolyline,_bPolylineFade,_bDisc,_bDiscGrad,_bDiscGradCore,_bRing,_bArc,_bDashRing \
  "$NATIVE_DIR/engine.c" "$NATIVE_DIR/batch.c" -o "$OUT"
ls -la "$OUT"
