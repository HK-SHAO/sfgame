// 流体内核 C 移植（bench 对比用，与 assembly/core.ts + main.ts 同算法）：
// 标量实现 + -O3 -msimd128 让 LLVM 自动向量化；-ffp-contract=off 保 IEEE 语义。
// 静态全局数组 = 静态内存，零分配；导出面与 asc 版一致（fieldU/V/T/solidBuf 供零拷贝读）。

#include <math.h>
#include <stdint.h>
#include <string.h>

#define MAX_NX 160
#define MAX_NY 120
#define MAX_CELLS (MAX_NX * MAX_NY)

static float u[MAX_CELLS], v[MAX_CELLS], t[MAX_CELLS];
static uint8_t solid[MAX_CELLS];
static float u0[MAX_CELLS], v0[MAX_CELLS], t0[MAX_CELLS];
static float q1[MAX_CELLS], q2[MAX_CELLS], p[MAX_CELLS], divField[MAX_CELLS], curlField[MAX_CELLS], solidF[MAX_CELLS];
static double divH2[MAX_CELLS];
static int32_t solidList[MAX_CELLS], coreGroupArr[MAX_CELLS], bndEvenArr[MAX_CELLS], bndOddArr[MAX_CELLS];
static uint8_t inGroup[MAX_CELLS];
static int32_t solidCount = 0, coreGroupN = 0, bndEvenN = 0, bndOddN = 0;

static int32_t nx = 0, ny = 0, iterations = 0;
static double cell = 0, buoyancy = 0, tMax = 0, heatRate = 0, sourceRadius = 0;
static double velDamping = 0, tDamping = 0, vorticity = 0;
static double ambientX = 0, ambientY = 0, outVX = 0, outVY = 0;

void clear(void);

int init(int32_t nx_, int32_t ny_, double cell_, double buoyancy_, double tMax_, double heatRate_,
         double sourceRadius_, double velDamping_, double tDamping_, int32_t iterations_, double vorticity_) {
  if (nx_ < 3 || ny_ < 3 || nx_ > MAX_NX || ny_ > MAX_NY) return 1;
  nx = nx_; ny = ny_; cell = cell_; buoyancy = buoyancy_; tMax = tMax_;
  heatRate = heatRate_; sourceRadius = sourceRadius_; velDamping = velDamping_;
  tDamping = tDamping_; iterations = iterations_; vorticity = vorticity_;
  ambientX = 0; ambientY = 0;
  clear();
  return 0;
}

void clear(void) {
  memset(u, 0, (size_t)nx * ny * sizeof(float));
  memset(v, 0, (size_t)nx * ny * sizeof(float));
  memset(t, 0, (size_t)nx * ny * sizeof(float));
  memset(p, 0, (size_t)nx * ny * sizeof(float));
}

void setAmbient(double x, double y) {
  ambientX = x;
  ambientY = y;
}

static int isCore(int idx) {
  return !solid[idx] && !solid[idx - 1] && !solid[idx + 1] && !solid[idx - nx] && !solid[idx + nx];
}

void rebuildSolid(void) {
  int n = nx * ny, c = 0;
  coreGroupN = 0; bndEvenN = 0; bndOddN = 0;
  for (int j = 1; j < ny - 1; j++) {
    int row = j * nx;
    for (int i = 1; i + 7 <= nx - 2; i += 8) {
      int all = 1;
      for (int k = 0; k < 8; k++) {
        if (!isCore(i + k + row)) { all = 0; break; }
      }
      if (all) {
        coreGroupArr[coreGroupN++] = i + row;
        for (int k = 0; k < 8; k++) inGroup[i + k + row] = 1;
      }
    }
  }
  for (int j = 0; j < ny; j++) {
    int row = j * nx;
    for (int i = 0; i < nx; i++) {
      int idx = i + row;
      int s = solid[idx];
      solidF[idx] = (float)s;
      if (s) { solidList[c++] = idx; continue; }
      int parity = (i + j) & 1;
      if (!isCore(idx) || !inGroup[idx]) {
        if (parity) bndOddArr[bndOddN++] = idx;
        else bndEvenArr[bndEvenN++] = idx;
      }
    }
  }
  solidCount = c;
}

void addHeat(double wx, double wy, double amount) {
  double gr = sourceRadius / cell;
  double gx = wx / cell - 0.5;
  double gy = wy / cell - 0.5;
  int x0 = (int)floor(gx - gr); if (x0 < 1) x0 = 1;
  int x1 = (int)ceil(gx + gr); if (x1 > nx - 2) x1 = nx - 2;
  int y0 = (int)floor(gy - gr); if (y0 < 1) y0 = 1;
  int y1 = (int)ceil(gy + gr); if (y1 > ny - 2) y1 = ny - 2;
  for (int j = y0; j <= y1; j++) {
    int row = j * nx;
    for (int i = x0; i <= x1; i++) {
      int idx = i + row;
      if (solid[idx]) continue;
      double dx = (double)i - gx, dy = (double)j - gy;
      double d = sqrt(dx * dx + dy * dy);
      if (d >= gr) continue;
      double falloff = 1 - d / gr;
      double val = (double)t[idx] + amount * falloff;
      if (val > tMax) val = tMax;
      else if (val < -tMax) val = -tMax;
      t[idx] = (float)val;
    }
  }
}

void sampleVelocity(double wx, double wy) {
  double gx = wx / cell - 0.5;
  double gy = wy / cell - 0.5;
  if (gx < 0) gx = 0;
  else if (gx > (double)nx - 1.001) gx = (double)nx - 1.001;
  if (gy < 0) gy = 0;
  else if (gy > (double)ny - 1.001) gy = (double)ny - 1.001;
  int i0 = (int)floor(gx);
  int j0 = (int)floor(gy);
  double fx = gx - (double)i0, fy = gy - (double)j0;
  int a = i0 + j0 * nx, b = a + 1, c = a + nx, d = c + 1;
  double w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
  outVX = (double)u[a] * w00 + (double)u[b] * w10 + (double)u[c] * w01 + (double)u[d] * w11 + ambientX;
  outVY = (double)v[a] * w00 + (double)v[b] * w10 + (double)v[c] * w01 + (double)v[d] * w11 + ambientY;
}

double outX(void) { return outVX; }
double outY(void) { return outVY; }

double sampleTemp(double wx, double wy) {
  double gx = wx / cell - 0.5;
  double gy = wy / cell - 0.5;
  if (gx < 0) gx = 0;
  else if (gx > (double)nx - 1.001) gx = (double)nx - 1.001;
  if (gy < 0) gy = 0;
  else if (gy > (double)ny - 1.001) gy = (double)ny - 1.001;
  int i0 = (int)floor(gx);
  int j0 = (int)floor(gy);
  double fx = gx - (double)i0, fy = gy - (double)j0;
  int a = i0 + j0 * nx, b = a + 1, c = a + nx, d = c + 1;
  return (double)t[a] * (1 - fx) * (1 - fy) + (double)t[b] * fx * (1 - fy) +
         (double)t[c] * (1 - fx) * fy + (double)t[d] * fx * fy;
}

static void applyBuoyancy(double dt) {
  double k = buoyancy * dt;
  for (int j = 1; j < ny - 1; j++) {
    int row = j * nx;
    for (int i = 1; i <= nx - 2; i++) {
      int idx = i + row;
      v[idx] = (float)((double)v[idx] - k * (double)t[idx]);
    }
  }
}

static void applyVorticity(double dt) {
  double h2 = 2 * cell;
  for (int j = 1; j < ny - 1; j++) {
    int row = j * nx;
    for (int i = 1; i < nx - 1; i++) {
      int idx = i + row;
      if (solid[idx]) { curlField[idx] = 0; continue; }
      curlField[idx] = (float)(((double)v[idx + 1] - (double)v[idx - 1]) / h2 -
                               ((double)u[idx + nx] - (double)u[idx - nx]) / h2);
    }
  }
  double f = vorticity * cell * dt;
  for (int j = 2; j < ny - 2; j++) {
    int row = j * nx;
    for (int i = 2; i < nx - 2; i++) {
      int idx = i + row;
      if (solid[idx]) continue;
      double dwdx = (fabs((double)curlField[idx + 1]) - fabs((double)curlField[idx - 1])) / h2;
      double dwdy = (fabs((double)curlField[idx + nx]) - fabs((double)curlField[idx - nx])) / h2;
      double len = sqrt(dwdx * dwdx + dwdy * dwdy) + 1e-5;
      double gxN = dwdx / len, gyN = dwdy / len;
      double w = (double)curlField[idx];
      u[idx] = (float)((double)u[idx] + f * gyN * w);
      v[idx] = (float)((double)v[idx] - f * gxN * w);
    }
  }
}

static void copyFields(void) {
  memcpy(u0, u, (size_t)nx * ny * sizeof(float));
  memcpy(v0, v, (size_t)nx * ny * sizeof(float));
  memcpy(t0, t, (size_t)nx * ny * sizeof(float));
}

static void advectPass(float *dst, const float *src, double dt, double sign) {
  double dt0 = (dt / cell) * sign;
  for (int j = 1; j < ny - 1; j++) {
    int row = j * nx;
    for (int i = 1; i < nx - 1; i++) {
      int idx = i + row;
      if (solid[idx]) { dst[idx] = 0; continue; }
      double x = (double)i - dt0 * (double)u0[idx];
      double y = (double)j - dt0 * (double)v0[idx];
      if (x < 0.5) x = 0.5;
      else if (x > (double)nx - 1.5) x = (double)nx - 1.5;
      if (y < 0.5) y = 0.5;
      else if (y > (double)ny - 1.5) y = (double)ny - 1.5;
      int i0 = (int)x, j0 = (int)y;
      double fx = x - (double)i0, fy = y - (double)j0;
      int a = i0 + j0 * nx, b = a + 1, c = a + nx, d = c + 1;
      dst[idx] = (float)((double)src[a] * (1 - fx) * (1 - fy) + (double)src[b] * fx * (1 - fy) +
                         (double)src[c] * (1 - fx) * fy + (double)src[d] * fx * fy);
    }
  }
}

static void correctCell(int idx, float *dst, const float *src, double damping) {
  if (solid[idx]) { dst[idx] = 0; return; }
  double lo = (double)src[idx], hi = lo, s;
  s = (double)src[idx - nx - 1]; if (s < lo) lo = s; else if (s > hi) hi = s;
  s = (double)src[idx - nx]; if (s < lo) lo = s; else if (s > hi) hi = s;
  s = (double)src[idx - nx + 1]; if (s < lo) lo = s; else if (s > hi) hi = s;
  s = (double)src[idx - 1]; if (s < lo) lo = s; else if (s > hi) hi = s;
  s = (double)src[idx]; if (s < lo) lo = s; else if (s > hi) hi = s;
  s = (double)src[idx + 1]; if (s < lo) lo = s; else if (s > hi) hi = s;
  s = (double)src[idx + nx - 1]; if (s < lo) lo = s; else if (s > hi) hi = s;
  s = (double)src[idx + nx]; if (s < lo) lo = s; else if (s > hi) hi = s;
  s = (double)src[idx + nx + 1]; if (s < lo) lo = s; else if (s > hi) hi = s;
  double val = (double)q1[idx] + ((double)src[idx] - (double)q2[idx]) * 0.5;
  if (val < lo) val = lo;
  else if (val > hi) val = hi;
  dst[idx] = (float)(val * damping);
}

static void advectMacCormack(float *dst, const float *src, double dt, double damping) {
  advectPass(q1, src, dt, 1);
  advectPass(q2, q1, dt, -1);
  for (int j = 1; j < ny - 1; j++) {
    int row = j * nx;
    for (int i = 1; i < nx - 1; i++) correctCell(row + i, dst, src, damping);
  }
}

static void projectDiv(void) {
  double h = cell, inv2h = 1 / (2 * h), h2 = h * h;
  for (int j = 1; j < ny - 1; j++) {
    int row = j * nx;
    for (int i = 1; i <= nx - 2; i++) {
      int idx = i + row;
      if (solid[idx]) { divField[idx] = 0; p[idx] = 0; continue; }
      double uR = solid[idx + 1] ? 0 : (double)u[idx + 1];
      double uL = solid[idx - 1] ? 0 : (double)u[idx - 1];
      double vD = solid[idx + nx] ? 0 : (double)v[idx + nx];
      double vU = solid[idx - nx] ? 0 : (double)v[idx - nx];
      divField[idx] = (float)((uR - uL + vD - vU) * inv2h);
    }
  }
  int n = nx * ny;
  for (int i = 0; i < n; i++) divH2[i] = h2 * (double)divField[i];
}

static void projectGS(void) {
  for (int it = 0; it < iterations; it++) {
    for (int parity = 0; parity < 2; parity++) {
      for (int j = 1; j < ny - 1; j++) {
        int i0 = ((parity ^ (j & 1)) & 1) ? 1 : 2;
        int row = j * nx;
        for (int i = i0; i < nx - 1; i += 2) {
          int idx = i + row;
          if (solid[idx]) continue;
          double pL = solid[idx - 1] ? (double)p[idx] : (double)p[idx - 1];
          double pR = solid[idx + 1] ? (double)p[idx] : (double)p[idx + 1];
          double pU = solid[idx - nx] ? (double)p[idx] : (double)p[idx - nx];
          double pD = solid[idx + nx] ? (double)p[idx] : (double)p[idx + nx];
          p[idx] = (float)((pL + pR + pU + pD - divH2[idx]) * 0.25);
        }
      }
    }
  }
}

static void projectGrad(void) {
  double h = cell, inv2h = 1 / (2 * h);
  for (int j = 1; j < ny - 1; j++) {
    int row = j * nx;
    for (int i = 1; i <= nx - 2; i++) {
      int idx = i + row;
      if (solid[idx]) continue;
      double pL = solid[idx - 1] ? (double)p[idx] : (double)p[idx - 1];
      double pR = solid[idx + 1] ? (double)p[idx] : (double)p[idx + 1];
      double pU = solid[idx - nx] ? (double)p[idx] : (double)p[idx - nx];
      double pD = solid[idx + nx] ? (double)p[idx] : (double)p[idx + nx];
      u[idx] = (float)((double)u[idx] - (pR - pL) * inv2h);
      v[idx] = (float)((double)v[idx] - (pD - pU) * inv2h);
    }
  }
}

static void project(void) {
  projectDiv();
  projectGS();
  projectGrad();
}

static void enforceBoundary(void) {
  for (int k = 0; k < solidCount; k++) {
    int idx = solidList[k];
    u[idx] = 0; v[idx] = 0; t[idx] = 0;
  }
}

void step(double dt) {
  applyBuoyancy(dt);
  if (vorticity > 0) applyVorticity(dt);
  copyFields();
  advectMacCormack(u, u0, dt, velDamping);
  advectMacCormack(v, v0, dt, velDamping);
  advectMacCormack(t, t0, dt, tDamping);
  project();
  enforceBoundary();
}

uint32_t fieldU(void) { return (uint32_t)(uintptr_t)u; }
uint32_t fieldV(void) { return (uint32_t)(uintptr_t)v; }
uint32_t fieldT(void) { return (uint32_t)(uintptr_t)t; }
uint32_t solidBuf(void) { return (uint32_t)(uintptr_t)solid; }
