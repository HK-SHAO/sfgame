import { MeshBatch, VERTEX_STRIDE } from '../core/batch'

/**
 * WebGL 1.0 最小渲染层：一个程序（位置 + 逐顶点颜色）、一个动态顶点缓冲、
 * 每帧一次 bufferSubData + 一次 drawArrays(TRIANGLES)。
 *
 * 选 WebGL 1 而非 WebGL2/WebGPU：前者在 iOS Safari（iOS 8+）与 Android WebView
 * 上全量可用且由 Metal/厂商驱动 GPU 加速——正是替代 iOS CPU 栅格化 Canvas 2D
 * 的兼容性最优解。alpha:false 画布不透明，天空由场景自身铺满。
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

export class GlRenderer {
  private gl: WebGLRenderingContext
  private canvas: HTMLCanvasElement
  private program: WebGLProgram | null = null
  private buffer: WebGLBuffer | null = null
  private aPos = 0
  private aColor = 0
  private uView: WebGLUniformLocation | null = null
  /** 已上传容量（字节），增长时重建缓冲（bufferSubData 不能扩容） */
  private uploadedBytes = 0
  private lost = false

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
      this.init()
    })
    this.init()
  }

  /** 上下文不可用（极老旧内核）时返回 null，由调用方降级为不渲染。 */
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

  private init() {
    const gl = this.gl
    const vs = this.compile(gl.VERTEX_SHADER, VS)
    const fs = this.compile(gl.FRAGMENT_SHADER, FS)
    if (!vs || !fs) return
    const program = gl.createProgram()
    if (!program) return
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return

    this.program = program
    this.aPos = gl.getAttribLocation(program, 'aPos')
    this.aColor = gl.getAttribLocation(program, 'aColor')
    this.uView = gl.getUniformLocation(program, 'uView')
    this.buffer = gl.createBuffer()
    this.uploadedBytes = 0

    gl.disable(gl.DEPTH_TEST)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  }

  private compile(type: number, source: string): WebGLShader | null {
    const gl = this.gl
    const shader = gl.createShader(type)
    if (!shader) return null
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return null
    return shader
  }

  /**
   * 绘制一批三角形。viewL/T/R/B 为视口的世界坐标范围（y 向下），
   * 着色器把它映射到裁剪空间；dpr 只影响 gl.viewport 的设备像素尺寸。
   */
  draw(batch: MeshBatch, viewL: number, viewT: number, viewR: number, viewB: number) {
    if (this.lost || !this.program || !this.buffer || batch.count === 0) return
    const gl = this.gl
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.clearColor(0.992, 0.969, 0.925, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)

    const bytes = batch.count * VERTEX_STRIDE * 4
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
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
