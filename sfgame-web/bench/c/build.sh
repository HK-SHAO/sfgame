#!/bin/sh
# 编译流体内核 C 版为 standalone wasm（bench 对比用）：先 source emsdk 环境再 emcc。
# 产物 sfengine-c.wasm（gitignore）。标量 + 自动向量化（-msimd128），-ffp-contract=off 保 IEEE 语义。
set -e
C_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f /Users/sf/dev/emsdk/emsdk_env.sh ]; then
  . /Users/sf/dev/emsdk/emsdk_env.sh >/dev/null 2>&1
fi
emcc -O3 -msimd128 -ffp-contract=off \
  -sSTANDALONE_WASM --no-entry -sNO_FILESYSTEM=1 \
  -sINITIAL_MEMORY=16777216 \
  -sEXPORTED_FUNCTIONS=_init,_clear,_setAmbient,_rebuildSolid,_addHeat,_sampleVelocity,_outX,_outY,_sampleTemp,_fieldU,_fieldV,_fieldT,_solidBuf,_step \
  "$C_DIR/fluid.c" -o "$C_DIR/sfengine-c.wasm"
ls -la "$C_DIR/sfengine-c.wasm"
