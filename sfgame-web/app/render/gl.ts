import { MeshBatch, VERTEX_STRIDE } from './batch'
import type { EngineHandle } from '../wasm/engine'

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
  private quadData = new Float32Array(24)
  private bgTexture: WebGLTexture | null = null
  private bgFbo: WebGLFramebuffer | null = null
  private uploadedBytes = 0
  private lost = false
  bgStale = false
  get bgReady(): boolean {
    return this.bgTexture !== null
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGLRenderingContext) {
    this.canvas = canvas
    this.gl = gl
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      this.lost = true
    })
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false
      if (!this.init()) {
        console.error('WebGL 资源重建失败，渲染已暂停')
        return
      }
      this.resizeBg()
      this.bgStale = true
    })
    this.init()
  }

  // 选 WebGL1：iOS Safari / Android WebView 全量可用且 GPU 加速
  // MSAA 全平台开启（视觉一致，不按平台预降档）；iOS Metal 后端的额外开销由 governor 实测兜底
  static create(canvas: HTMLCanvasElement): GlRenderer | null {
    const opts: WebGLContextAttributes = {
      alpha: false,
      antialias: true,
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

  // 渲染管线热身：抛弃式小画布走完 编译+链接+背景纹理+bakeBg/draw 各一次，
  // 驱动级着色器缓存按源码共享——正式画布首帧不再现场编译/建资源；返回 false = WebGL 不可用
  static warmup(engine: EngineHandle): boolean {
    const canvas = document.createElement('canvas')
    canvas.width = 16
    canvas.height = 16
    const r = GlRenderer.create(canvas)
    if (!r) return false
    try {
      const batch = new MeshBatch(engine)
      batch.rect(0, 0, 1, 1, 1, 1, 1, 1)
      r.resizeBg()
      r.bakeBg(batch, 0, 0, 1, 1)
      r.draw(batch, 0, 0, 1, 1)
    } catch {
      return false
    } finally {
      r.dispose()
      canvas.width = 0
      canvas.height = 0
    }
    return true
  }

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

  resizeBg(): boolean {
    const gl = this.gl
    if (!this.tex || !this.texBuffer) return false
    const w = Math.max(1, this.canvas.width)
    const h = Math.max(1, this.canvas.height)
    if (this.bgTexture) gl.deleteTexture(this.bgTexture)
    if (this.bgFbo) gl.deleteFramebuffer(this.bgFbo)
    this.bgTexture = null
    this.bgFbo = null
    const tex = gl.createTexture()
    if (!tex) return false
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    const fbo = gl.createFramebuffer()
    if (!fbo) {
      gl.bindTexture(gl.TEXTURE_2D, null)
      gl.deleteTexture(tex)
      return false
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindTexture(gl.TEXTURE_2D, null)
    this.bgTexture = tex
    this.bgFbo = fbo
    return true
  }

  // 清屏底色：与 .game 容器 CSS 背景一致（缓冲未初始化/无背景纹理时兜底）
  private clearScreen() {
    this.gl.clearColor(0.992, 0.969, 0.925, 1)
    this.gl.clear(this.gl.COLOR_BUFFER_BIT)
  }

  // 顶点批上传→绘制尾段（bakeBg 与 draw 共用；成员方法零闭包，每帧调用 JIT 内联）
  private drawBatch(batch: MeshBatch, viewL: number, viewT: number, viewR: number, viewB: number) {
    const gl = this.gl
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

  bakeBg(batch: MeshBatch, viewL: number, viewT: number, viewR: number, viewB: number): boolean {
    const gl = this.gl
    if (this.lost || !this.program || !this.buffer) return false
    if (batch.count === 0) return false
    if (!this.bgFbo || !this.bgTexture) {
      if (!this.resizeBg()) return false
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bgFbo)
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      this.resizeBg()
      return false
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    this.clearScreen()
    this.drawBatch(batch, viewL, viewT, viewR, viewB)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return true
  }

  // 两趟：不透明背景先画（平铺 GPU 全屏混合开销大）；blend 每帧幂等重设——resize 会重置上下文状态
  draw(batch: MeshBatch, viewL: number, viewT: number, viewR: number, viewB: number) {
    if (this.lost || !this.program || !this.buffer || batch.count === 0) return
    const gl = this.gl
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)

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
      this.clearScreen()
    }

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    this.drawBatch(batch, viewL, viewT, viewR, viewB)
  }
}
