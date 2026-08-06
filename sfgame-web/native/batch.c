// 渲染顶点批内核（C，替代原 AssemblyScript assembly/batch.ts）：x,y,r,g,b,a 平铺，f64 中间量 → f32 存储。
// 静态容量 + 静态内存：实例化时定型、运行期零分配、memory.buffer 视图恒定；
// 容量溢出整体丢弃图元（最坏场景 ~10 万顶点，容量留 ~2 倍余量）。
// 三角函数用 libm（musl 移植，与原 AS 的 musl 内核实现同源）；PI 用 hex float 保与旧版逐位一致。

#include <math.h>
#include <stddef.h>
#include <stdint.h>

#define VERTEX_STRIDE 6
#define CAPACITY 196608
#define PTS_CAP 2048
#define FADE_CAP 1024
#define MITER_LIMIT 4
#define PI 0x1.921FB54442D18p+1

static float data[CAPACITY * VERTEX_STRIDE];
static float ptsBuf[PTS_CAP];
static float fadeBuf[FADE_CAP];
static float gradRing[8];

static int count = 0;

int bCapacity(void) { return CAPACITY; }
int bPtsCap(void) { return PTS_CAP; }
int bFadeCap(void) { return FADE_CAP; }
uint32_t bData(void) { return (uint32_t)(uintptr_t)data; }
uint32_t bPtsBuf(void) { return (uint32_t)(uintptr_t)ptsBuf; }
uint32_t bFadeBuf(void) { return (uint32_t)(uintptr_t)fadeBuf; }
int bCount(void) { return count; }
void bReset(void) { count = 0; }

static void push(double x, double y, double r, double g, double b, double a) {
  size_t o = (size_t)count * VERTEX_STRIDE;
  data[o] = (float)x;
  data[o + 1] = (float)y;
  data[o + 2] = (float)r;
  data[o + 3] = (float)g;
  data[o + 4] = (float)b;
  data[o + 5] = (float)a;
  count++;
}

void bTri(
  double x0, double y0, double x1, double y1, double x2, double y2,
  double r, double g, double b, double a
) {
  if (count + 3 > CAPACITY) return;
  push(x0, y0, r, g, b, a);
  push(x1, y1, r, g, b, a);
  push(x2, y2, r, g, b, a);
}

void bRect(
  double x0, double y0, double x1, double y1,
  double r, double g, double b, double a
) {
  if (count + 6 > CAPACITY) return;
  push(x0, y0, r, g, b, a);
  push(x1, y0, r, g, b, a);
  push(x0, y1, r, g, b, a);
  push(x1, y0, r, g, b, a);
  push(x1, y1, r, g, b, a);
  push(x0, y1, r, g, b, a);
}

void bRectVGrad(
  double x0, double y0, double x1, double y1,
  double r0, double g0, double b0, double a0,
  double r1, double g1, double b1, double a1
) {
  if (count + 6 > CAPACITY) return;
  push(x0, y0, r0, g0, b0, a0);
  push(x1, y0, r0, g0, b0, a0);
  push(x0, y1, r1, g1, b1, a1);
  push(x1, y0, r0, g0, b0, a0);
  push(x1, y1, r1, g1, b1, a1);
  push(x0, y1, r1, g1, b1, a1);
}

static void disc(
  double cx, double cy, double rx, double ry, double rot, int seg,
  double r, double g, double b, double a
) {
  if (rx <= 0 || ry <= 0 || a <= 0) return;
  if (count + seg * 3 > CAPACITY) return;
  double c = cos(rot);
  double s = sin(rot);
  double px = 0, py = 0;
  for (int i = 0; i <= seg; i++) {
    double th = ((double)i / (double)seg) * PI * 2;
    double ex = rx * cos(th);
    double ey = ry * sin(th);
    double qx = cx + ex * c - ey * s;
    double qy = cy + ex * s + ey * c;
    if (i > 0) {
      push(cx, cy, r, g, b, a);
      push(px, py, r, g, b, a);
      push(qx, qy, r, g, b, a);
    }
    px = qx;
    py = qy;
  }
}

void bDisc(
  double cx, double cy, double rx, double ry, double rot, int seg,
  double r, double g, double b, double a
) {
  disc(cx, cy, rx, ry, rot, seg, r, g, b, a);
}

static void stroke(
  double x0, double y0, double x1, double y1, double w,
  double r, double g, double b, double a, int round
) {
  double dx = x1 - x0;
  double dy = y1 - y0;
  double len = sqrt(dx * dx + dy * dy);
  if (len < 1e-8) return;
  if (count + (round ? 54 : 6) > CAPACITY) return;
  double hw = w / 2 / len;
  double nx = -dy * hw;
  double ny = dx * hw;
  push(x0 + nx, y0 + ny, r, g, b, a);
  push(x1 + nx, y1 + ny, r, g, b, a);
  push(x0 - nx, y0 - ny, r, g, b, a);
  push(x1 + nx, y1 + ny, r, g, b, a);
  push(x1 - nx, y1 - ny, r, g, b, a);
  push(x0 - nx, y0 - ny, r, g, b, a);
  if (round) {
    disc(x0, y0, w / 2, w / 2, 0, 8, r, g, b, a);
    disc(x1, y1, w / 2, w / 2, 0, 8, r, g, b, a);
  }
}

void bStroke(
  double x0, double y0, double x1, double y1, double w,
  double r, double g, double b, double a, int round
) {
  stroke(x0, y0, x1, y1, w, r, g, b, a, round);
}

// pts/fade 由宿主写入 ptsBuf/fadeBuf 后调用；n 为 float 个数（点数 × 2）
static void miter(int n, double w, double r, double g, double b, double baseA, int fade) {
  if (n < 4) return;
  if (count + 3 * n > CAPACITY) return;
  double hw = w / 2;
  double limit = MITER_LIMIT * hw;
  double sx = 0, sy = 0, mx = 0, my = 0, pnx = 0, pny = 0;
  int ready = 0;
  for (int i = 0; i + 3 < n; i += 2) {
    double ax = (double)ptsBuf[i];
    double ay = (double)ptsBuf[i + 1];
    double bx = (double)ptsBuf[i + 2];
    double by = (double)ptsBuf[i + 3];
    double dx = bx - ax;
    double dy = by - ay;
    double len = sqrt(dx * dx + dy * dy);
    if (len < 1e-8) continue;
    double nx = -dy / len;
    double ny = dx / len;
    if (!ready) {
      sx = ax;
      sy = ay;
      mx = nx * hw;
      my = ny * hw;
      pnx = nx;
      pny = ny;
      ready = 1;
      continue;
    }
    double tx = pnx + nx;
    double ty = pny + ny;
    double fl = sqrt(tx * tx + ty * ty);
    if (fl < 1e-6) {
      tx = nx;
      ty = ny;
      fl = 1;
    } else {
      tx /= fl;
      ty /= fl;
      fl = hw / (pnx * tx + pny * ty);
      if (fl > limit) fl = limit;
    }
    double ex = tx * fl;
    double ey = ty * fl;
    double a0 = fade ? (double)fadeBuf[i / 2 - 1] : baseA;
    double a1 = fade ? (double)fadeBuf[i / 2] : baseA;
    push(sx + mx, sy + my, r, g, b, a0);
    push(ax + ex, ay + ey, r, g, b, a1);
    push(sx - mx, sy - my, r, g, b, a0);
    push(ax + ex, ay + ey, r, g, b, a1);
    push(ax - ex, ay - ey, r, g, b, a1);
    push(sx - mx, sy - my, r, g, b, a0);
    sx = ax;
    sy = ay;
    mx = ex;
    my = ey;
    pnx = nx;
    pny = ny;
  }
  if (ready) {
    double bx = (double)ptsBuf[n - 2];
    double by = (double)ptsBuf[n - 1];
    double ex = pnx * hw;
    double ey = pny * hw;
    double a0 = fade ? (double)fadeBuf[(n - 4) / 2] : baseA;
    double a1 = fade ? (double)fadeBuf[(n - 2) / 2] : baseA;
    push(sx + mx, sy + my, r, g, b, a0);
    push(bx + ex, by + ey, r, g, b, a1);
    push(sx - mx, sy - my, r, g, b, a0);
    push(bx + ex, by + ey, r, g, b, a1);
    push(bx - ex, by - ey, r, g, b, a1);
    push(sx - mx, sy - my, r, g, b, a0);
  }
}

void bPolyline(int n, double w, double r, double g, double b, double a) {
  miter(n, w, r, g, b, a, 0);
}

void bPolylineFade(int n, double w, double r, double g, double b) {
  miter(n, w, r, g, b, 0, 1);
}

void bDiscGrad(
  double cx, double cy, double radius, int seg,
  double cr, double cg, double cb, double ca,
  double er, double eg, double eb, double ea
) {
  if (radius <= 0) return;
  if (count + seg * 3 > CAPACITY) return;
  double px = 0, py = 0;
  for (int i = 0; i <= seg; i++) {
    double th = ((double)i / (double)seg) * PI * 2;
    double qx = cx + radius * cos(th);
    double qy = cy + radius * sin(th);
    if (i > 0) {
      push(cx, cy, cr, cg, cb, ca);
      push(px, py, er, eg, eb, ea);
      push(qx, qy, er, eg, eb, ea);
    }
    px = qx;
    py = qy;
  }
}

void bDiscGradCore(
  double cx, double cy, double radius, int seg, double solidFrac,
  double cr, double cg, double cb, double ca,
  double er, double eg, double eb, double ea
) {
  if (radius <= 0) return;
  if (count + seg * 21 > CAPACITY) return;
  double inner = radius * solidFrac;
  double band = radius - inner;
  double r1 = inner + band / 3;
  double r2 = inner + (band * 2) / 3;
  double t1 = 7.0 / 27;
  double t2 = 20.0 / 27;
  double c1r = cr + (er - cr) * t1, c1g = cg + (eg - cg) * t1, c1b = cb + (eb - cb) * t1, c1a = ca + (ea - ca) * t1;
  double c2r = cr + (er - cr) * t2, c2g = cg + (eg - cg) * t2, c2b = cb + (eb - cb) * t2, c2a = ca + (ea - ca) * t2;
  for (int i = 0; i <= seg; i++) {
    double th = ((double)i / (double)seg) * PI * 2;
    double cs = cos(th);
    double sn = sin(th);
    double n0x = cx + inner * cs, n0y = cy + inner * sn;
    double n1x = cx + r1 * cs, n1y = cy + r1 * sn;
    double n2x = cx + r2 * cs, n2y = cy + r2 * sn;
    double n3x = cx + radius * cs, n3y = cy + radius * sn;
    if (i > 0) {
      push(cx, cy, cr, cg, cb, ca);
      push((double)gradRing[0], (double)gradRing[1], cr, cg, cb, ca);
      push(n0x, n0y, cr, cg, cb, ca);
      push((double)gradRing[0], (double)gradRing[1], cr, cg, cb, ca);
      push((double)gradRing[2], (double)gradRing[3], c1r, c1g, c1b, c1a);
      push(n1x, n1y, c1r, c1g, c1b, c1a);
      push((double)gradRing[0], (double)gradRing[1], cr, cg, cb, ca);
      push(n1x, n1y, c1r, c1g, c1b, c1a);
      push(n0x, n0y, cr, cg, cb, ca);
      push((double)gradRing[2], (double)gradRing[3], c1r, c1g, c1b, c1a);
      push((double)gradRing[4], (double)gradRing[5], c2r, c2g, c2b, c2a);
      push(n2x, n2y, c2r, c2g, c2b, c2a);
      push((double)gradRing[2], (double)gradRing[3], c1r, c1g, c1b, c1a);
      push(n2x, n2y, c2r, c2g, c2b, c2a);
      push(n1x, n1y, c1r, c1g, c1b, c1a);
      push((double)gradRing[4], (double)gradRing[5], c2r, c2g, c2b, c2a);
      push((double)gradRing[6], (double)gradRing[7], er, eg, eb, ea);
      push(n3x, n3y, er, eg, eb, ea);
      push((double)gradRing[4], (double)gradRing[5], c2r, c2g, c2b, c2a);
      push(n3x, n3y, er, eg, eb, ea);
      push(n2x, n2y, c2r, c2g, c2b, c2a);
    }
    gradRing[0] = (float)n0x;
    gradRing[1] = (float)n0y;
    gradRing[2] = (float)n1x;
    gradRing[3] = (float)n1y;
    gradRing[4] = (float)n2x;
    gradRing[5] = (float)n2y;
    gradRing[6] = (float)n3x;
    gradRing[7] = (float)n3y;
  }
}

void bRing(
  double cx, double cy, double rx, double ry, double rot, int seg, double w,
  double r, double g, double b, double a
) {
  if (rx <= 0 || ry <= 0 || a <= 0) return;
  if (count + seg * 6 > CAPACITY) return;
  double c = cos(rot);
  double s = sin(rot);
  double px = 0, py = 0;
  for (int i = 0; i <= seg; i++) {
    double th = ((double)i / (double)seg) * PI * 2;
    double ex = rx * cos(th);
    double ey = ry * sin(th);
    double qx = cx + ex * c - ey * s;
    double qy = cy + ex * s + ey * c;
    if (i > 0) stroke(px, py, qx, qy, w, r, g, b, a, 0);
    px = qx;
    py = qy;
  }
}

// 与 polyline 复用 ptsBuf：调用方不得在 arc 期间改写入参缓冲（单线程天然成立）
static void arc(
  double cx, double cy, double radius, double a0, double a1, int seg, double w,
  double r, double g, double b, double a
) {
  if (radius <= 0 || a <= 0 || a1 == a0) return;
  int n = seg + 1;
  if (n * 2 > PTS_CAP) return;
  for (int i = 0; i <= seg; i++) {
    double th = a0 + ((a1 - a0) * (double)i) / (double)seg;
    ptsBuf[i * 2] = (float)(cx + radius * cos(th));
    ptsBuf[i * 2 + 1] = (float)(cy + radius * sin(th));
  }
  miter(n * 2, w, r, g, b, a, 0);
  double hw = w / 2;
  disc((double)ptsBuf[0], (double)ptsBuf[1], hw, hw, 0, 8, r, g, b, a);
  disc((double)ptsBuf[seg * 2], (double)ptsBuf[seg * 2 + 1], hw, hw, 0, 8, r, g, b, a);
}

void bArc(
  double cx, double cy, double radius, double a0, double a1, int seg, double w,
  double r, double g, double b, double a
) {
  arc(cx, cy, radius, a0, a1, seg, w, r, g, b, a);
}

void bDashRing(
  double cx, double cy, double radius, double on, double off, double w,
  double r, double g, double b, double a
) {
  double circ = PI * 2 * radius;
  double onLen = on;
  double offLen = off;
  double period = onLen + offLen;
  if (circ <= 0 || period <= 0) return;
  if (circ < 6 * period) {
    double k = circ / (6 * period);
    onLen *= k;
    offLen *= k;
    period = onLen + offLen;
  }
  double s = 0;
  while (s < circ) {
    double segLen = fmin(onLen, circ - s);
    double ang0 = s / radius;
    double ang1 = (s + segLen) / radius;
    int segs = (int)ceil(segLen / 0.5);
    if (segs < 2) segs = 2;
    arc(cx, cy, radius, ang0, ang1, segs, w, r, g, b, a);
    s += period;
  }
}
