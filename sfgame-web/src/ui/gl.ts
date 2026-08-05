import { MeshBatch, VERTEX_STRIDE } from '../core/batch'

/**
 * WebGL 1.0 最小渲染层：一个程序（位置 + 逐顶点颜色）、一个动态顶点缓冲、
 * 每帧一次 bufferSubData + 一次 drawArrays(TRIANGLES)。
 *
 * 选 WebGL 1 而非 WebGL2/WebGPU：前者在 iOS Safari（iOS 8+）与 Android WebView
 * 上全量可用且由 Metal/厂商驱动 GPU 加速。alpha:false 画布不透明，天空由场景铺满。
 *
 * iOS Safari（ANGLE→Metal 后端）优化要点（2026-08，详见 docs/issues/#7.md）：
 * - antialias:false：iOS 上 MSAA 4× 作用于整个帧缓冲，是 iOS Metal 后端最大开销
 *   之一；线条/色块为几何化矢量，边缘由分辨率保证（dpr 补偿）。
 * - 两趟绘制：静态背景（烘焙到离屏纹理）不混合先画，动态层保持 alpha 混合——
 *   PowerVR 平铺 GPU 上全屏混合开销直接放大，不透明像素应跳过混合。
 * - blend 状态每帧幂等设置：canvas 尺寸变更会重置上下文状态（resize 后
 *   init 里设置的 blend 会失效），draw 前重设即可（代价可忽略）。
 */

const VS = `
attribute vec2 aPos;
attribute vec4 aColor;
uniform vec4 uView;
varying vec4 vColor;
void main() {
  vec2 t = (aPos - uView.xy) / uView.zw;
  gl_Position = vec4(t.x * 2.0 - 1.0, 1.0 - t.y * 2.0, 0.0, 1.0);
  vColor = aColor;
}
`

const FS = `
precision mediump float;
varying vec4 vColor;
void main() {
  gl_FragColor = vColor;
}
`

/** 背景纹理 quad：世界坐标 quad + 0..1 UV，1:1 呈现烘焙好的静态背景。 */
const TEX_VS = `
attribute vec2 aPos;
attribute vec2 aUV;
uniform vec4 uView;
varying vec2 vUV;
void main() {
  vec2 t = (aPos - uView.xy) / uView.zw;
  gl_Position = vec4(t.x * 2.0 - 1.0, 1.0 - t.y * 2.0, 0.0, 1.0);
  vUV = aUV;
}
`

const TEX_FS = `
precision mediump float;
uniform sampler2D uTex;
varying vec2 vUV;
void main() {
  gl_FragColor = texture2D(uTex, vUV);
}
`

interface TexProgram {
  program: WebGLProgram
  aPos: number
  aUV: number
  uView: WebGLUniformLocation | null
  uTex: WebGLUniformLocation | null
}

export class GlRenderer {
  private gl: WebGLRenderingContext
  private canvas: HTMLCanvasElement
  private program: WebGLProgram | null = null
  private buffer: WebGLBuffer | null = null
  private aPos = 0
  private aColor = 0
  private uView: WebGLUniformLocation | null = null
  private tex: TexProgram | null = null
  private texBuffer: WebGLBuffer | null = null
  /** quad 顶点数据（预分配，热路径零分配）：6 顶点 × (x, y, u, v) */
  private quadData = new Float32Array(24)
  /** 离屏背景纹理与帧缓冲：静态内容（天空/地形/光晕/目标静态）resize 时烘焙 */
  private bgTexture: WebGLTexture | null = null
  private bgFbo: WebGLFramebuffer | null = null
  /** 已上传容量（字节），增长时重建缓冲（bufferSubData 不能扩容） */
  private uploadedBytes = 0
  private lost = false
  /** 上下文恢复后 FBO/纹理已重建但内容为空，需要 Renderer 重新烘焙背景 */
  bgStale = false

  private constructor(canvas: HTMLCanvasElement, gl: WebGLRenderingContext) {
    this.canvas = canvas
    this.gl = gl
    // iOS 内存压力可能回收上下文：preventDefault 声明恢复意图，restored 后重建资源
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      this.lost = true
    })
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false
      // 恢复后旧对象已失效：init 失败已清指针，draw 检查 program 自动跳过
      if (!this.init()) {
        console.error('WebGL 资源重建失败，渲染已暂停')
        return
      }
      // 背景纹理/FBO 随上下文销毁，需重建并标记重烘焙（否则地面/天空缺失）
      this.resizeBg()
      this.bgStale = true
    })
    this.init()
  }

  /** 上下文不可用（极老旧内核）时返回 null，由调用方降级为不渲染。 */
  static create(canvas: HTMLCanvasElement): GlRenderer | null {
    const opts: WebGLContextAttributes = {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    }
    const gl =
      (canvas.getContext('webgl', opts) ??
        canvas.getContext('experimental-webgl', opts)) as WebGLRenderingContext | null
    if (!gl) return null
    return new GlRenderer(canvas, gl)
  }

  /** 删除旧 program/buffer：恢复后已失效；init 重试前也清掉上次失败的残留。 */
  private dispose() {
    const gl = this.gl
    if (this.program) gl.deleteProgram(this.program)
    if (this.buffer) gl.deleteBuffer(this.buffer)
    if (this.tex) gl.deleteProgram(this.tex.program)
    if (this.texBuffer) gl.deleteBuffer(this.texBuffer)
    if (this.bgTexture) gl.deleteTexture(this.bgTexture)
    if (this.bgFbo) gl.deleteFramebuffer(this.bgFbo)
    this.program = null
    this.buffer = null
    this.tex = null
    this.texBuffer = null
    this.bgTexture = null
    this.bgFbo = null
    this.uploadedBytes = 0
  }

  /** 失败返回 false（调用方据其决定停用渲染）；失败路径清理已建对象。 */
  private init(): boolean {
    const gl = this.gl
    this.dispose()
    const vs = this.compile(gl.VERTEX_SHADER, VS)
    const fs = this.compile(gl.FRAGMENT_SHADER, FS)
    const tvs = this.compile(gl.VERTEX_SHADER, TEX_VS)
    const tfs = this.compile(gl.FRAGMENT_SHADER, TEX_FS)
    if (!vs || !fs || !tvs || !tfs) {
      for (const s of [vs, fs, tvs, tfs]) {
        if (s) gl.deleteShader(s)
      }
      return false
    }
    const program = this.link(vs, fs)
    const tprogram = this.link(tvs, tfs)
    for (const s of [vs, fs, tvs, tfs]) gl.deleteShader(s)
    if (!program || !tprogram) {
      if (program) gl.deleteProgram(program)
      if (tprogram) gl.deleteProgram(tprogram)
      return false
    }

    this.program = program
    this.aPos = gl.getAttribLocation(program, 'aPos')
    this.aColor = gl.getAttribLocation(program, 'aColor')
    this.uView = gl.getUniformLocation(program, 'uView')
    this.buffer = gl.createBuffer()
    this.uploadedBytes = 0

    this.tex = {
      program: tprogram,
      aPos: gl.getAttribLocation(tprogram, 'aPos'),
      aUV: gl.getAttribLocation(tprogram, 'aUV'),
      uView: gl.getUniformLocation(tprogram, 'uView'),
      uTex: gl.getUniformLocation(tprogram, 'uTex'),
    }
    this.texBuffer = gl.createBuffer()

    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.BLEND)
    return true
  }

  private link(vs: WebGLShader, fs: WebGLShader): WebGLProgram | null {
    const gl = this.gl
    const program = gl.createProgram()
    if (!program) return null
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('WebGL 着色器链接失败：' + gl.getProgramInfoLog(program))
      gl.deleteProgram(program)
      return null
    }
    return program
  }

  private compile(type: number, source: string): WebGLShader | null {
    const gl = this.gl
    const shader = gl.createShader(type)
    if (!shader) return null
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('WebGL 着色器编译失败：' + gl.getShaderInfoLog(shader))
      gl.deleteShader(shader)
      return null
    }
    return shader
  }

  /**
   * 背景离屏纹理尺寸跟随画布（设备像素），1:1 呈现保证视觉一致。
   * canvas 尺寸变更会重置上下文状态，这里同时重建 FBO/纹理。
   */
  resizeBg() {
    const gl = this.gl
    if (!this.tex || !this.texBuffer) return
    const w = Math.max(1, this.canvas.width)
    const h = Math.max(1, this.canvas.height)
    if (this.bgTexture) gl.deleteTexture(this.bgTexture)
    if (this.bgFbo) gl.deleteFramebuffer(this.bgFbo)
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    const fbo = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindTexture(gl.TEXTURE_2D, null)
    this.bgTexture = tex
    this.bgFbo = fbo
  }

  /** 把静态背景 batch 烘焙进离屏纹理（resize/上下文恢复后调用；需先 resizeBg）。
   * 烘焙保持 alpha 混合：背景含半透明渐变（太阳辉光/目标光柱/虚线圆），
   * 关混合会让它们变不透明实心。烘焙仅 resize 时一次，混合成本可忽略；
   * 主 draw 的纹理 blit 才关混合（纹理已是合成结果）。 */
  bakeBg(batch: MeshBatch, viewL: number, viewT: number, viewR: number, viewB: number) {
    const gl = this.gl
    if (this.lost || !this.program || !this.buffer || !this.bgFbo || !this.bgTexture) return
    if (batch.count === 0) return
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bgFbo)
    // FBO 不完整（纹理分配失败等偶发）：重建后由 bgDirty 保留下次重试，别静默烘焙进空气
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      this.resizeBg()
      return
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.clearColor(0.992, 0.969, 0.925, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    const bytes = batch.count * VERTEX_STRIDE * 4
    if (bytes > this.uploadedBytes) {
      gl.bufferData(gl.ARRAY_BUFFER, batch.data, gl.DYNAMIC_DRAW)
      this.uploadedBytes = batch.data.byteLength
    } else {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.data.subarray(0, batch.count * VERTEX_STRIDE))
    }
    gl.useProgram(this.program)
    gl.uniform4f(this.uView, viewL, viewT, viewR - viewL, viewB - viewT)
    gl.enableVertexAttribArray(this.aPos)
    gl.enableVertexAttribArray(this.aColor)
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, VERTEX_STRIDE * 4, 0)
    gl.vertexAttribPointer(this.aColor, 4, gl.FLOAT, false, VERTEX_STRIDE * 4, 8)
    gl.drawArrays(gl.TRIANGLES, 0, batch.count)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  /**
   * 绘制一帧：不透明背景纹理 quad（关混合）→ 动态 batch（开混合）。
   * 顺序保证背景在最底层；blend 每帧幂等重设（canvas resize 会重置上下文状态）。
   */
  draw(batch: MeshBatch, viewL: number, viewT: number, viewR: number, viewB: number) {
    if (this.lost || !this.program || !this.buffer || batch.count === 0) return
    const gl = this.gl
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)

    // 1. 背景纹理 quad（不透明，跳过混合——PowerVR 平铺 GPU 上全屏混合是重开销）
    // 注意 UV 的 v：FBO 纹理原点在左下（OpenGL 约定），bake 时世界顶部（viewT）
    // 画在纹理上方 → 屏幕顶部顶点须取 v=1，底部取 v=0
    if (this.tex && this.texBuffer && this.bgTexture) {
      gl.disable(gl.BLEND)
      const q = this.quadData
      q[0] = viewL; q[1] = viewT; q[2] = 0; q[3] = 1
      q[4] = viewR; q[5] = viewT; q[6] = 1; q[7] = 1
      q[8] = viewL; q[9] = viewB; q[10] = 0; q[11] = 0
      q[12] = viewR; q[13] = viewT; q[14] = 1; q[15] = 1
      q[16] = viewR; q[17] = viewB; q[18] = 1; q[19] = 0
      q[20] = viewL; q[21] = viewB; q[22] = 0; q[23] = 0
      gl.bindBuffer(gl.ARRAY_BUFFER, this.texBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, q, gl.STREAM_DRAW)
      gl.useProgram(this.tex.program)
      gl.uniform4f(this.tex.uView, viewL, viewT, viewR - viewL, viewB - viewT)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, this.bgTexture)
      gl.uniform1i(this.tex.uTex, 0)
      gl.enableVertexAttribArray(this.tex.aPos)
      gl.enableVertexAttribArray(this.tex.aUV)
      gl.vertexAttribPointer(this.tex.aPos, 2, gl.FLOAT, false, 16, 0)
      gl.vertexAttribPointer(this.tex.aUV, 2, gl.FLOAT, false, 16, 8)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    } else {
      // 背景纹理未就绪（首帧/烘焙失败）：兜底清屏，防残影
      gl.clearColor(0.992, 0.969, 0.925, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }

    // 2. 动态层（alpha 混合）
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    const bytes = batch.count * VERTEX_STRIDE * 4
    if (bytes > this.uploadedBytes) {
      gl.bufferData(gl.ARRAY_BUFFER, batch.data, gl.DYNAMIC_DRAW)
      this.uploadedBytes = batch.data.byteLength
    } else {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.data.subarray(0, batch.count * VERTEX_STRIDE))
    }
    gl.useProgram(this.program)
    gl.uniform4f(this.uView, viewL, viewT, viewR - viewL, viewB - viewT)
    gl.enableVertexAttribArray(this.aPos)
    gl.enableVertexAttribArray(this.aColor)
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, VERTEX_STRIDE * 4, 0)
    gl.vertexAttribPointer(this.aColor, 4, gl.FLOAT, false, VERTEX_STRIDE * 4, 8)
    gl.drawArrays(gl.TRIANGLES, 0, batch.count)
  }
}
