/* High-Fidelity Directional Contour & Halftone Vector Engine for Dota 2 Hero Grids.
   Draws vector-like contours using '|', '/', '\', '-' strokes and adaptive foreground/background shading. */

export interface RasterOptions {
  detail: number;      // 0..1
  spacingX: number;    // px step in X
  spacingY: number;    // px step in Y
  inkFloor: number;    // threshold 0..1
  edgeBoost: number;   // 0..1
  gamma: number;       // >0
  method?: 'contour' | 'halftone' | 'hybrid';
  maxPoints?: number;  // max allowed points to keep Dota 2 smooth (default: 500)
}

export interface RasterPoint {
  ch: string;
  x: number;
  y: number;
  weight?: number;
  isContour?: boolean;
}

function clamp(v: number, min = 0, max = 1): number {
  return v < min ? min : v > max ? max : v;
}

/** Sobel filter returning gradient magnitude, gx, and gy for edge angle determination. */
function computeSobel(
  luma: Float32Array,
  w: number,
  h: number
): { mag: Float32Array; gx: Float32Array; gy: Float32Array } {
  const mag = new Float32Array(w * h);
  const gxArr = new Float32Array(w * h);
  const gyArr = new Float32Array(w * h);
  if (w < 3 || h < 3) return { mag, gx: gxArr, gy: gyArr };

  for (let y = 1; y < h - 1; y++) {
    const pRow = (y - 1) * w;
    const cRow = y * w;
    const nRow = (y + 1) * w;

    for (let x = 1; x < w - 1; x++) {
      const gx = -luma[pRow + x - 1] - 2 * luma[cRow + x - 1] - luma[nRow + x - 1]
               +  luma[pRow + x + 1] + 2 * luma[cRow + x + 1] + luma[nRow + x + 1];
      const gy = -luma[pRow + x - 1] - 2 * luma[pRow + x]     - luma[pRow + x + 1]
               +  luma[nRow + x - 1] + 2 * luma[nRow + x]     + luma[nRow + x + 1];
      const idx = cRow + x;
      gxArr[idx] = gx;
      gyArr[idx] = gy;
      mag[idx] = clamp(Math.hypot(gx, gy) / 4.0);
    }
  }
  return { mag, gx: gxArr, gy: gyArr };
}

/** Determines contour stroke character along the edge tangent (perpendicular to gradient). */
function getContourStroke(gx: number, gy: number): string {
  let deg = (Math.atan2(gy, gx) * 180 / Math.PI + 90) % 180;
  if (deg < 0) deg += 180;

  if (deg < 22.5 || deg >= 157.5) return '-';
  if (deg >= 22.5 && deg < 67.5) return '/';
  if (deg >= 67.5 && deg < 112.5) return '|';
  return '\\';
}

export function rasterizeImage(
  luma: Float32Array,
  width: number,
  height: number,
  options: RasterOptions
): RasterPoint[] {
  if (width < 1 || height < 1 || luma.length < 1) return [];

  const detail = clamp(options.detail);
  const inkFloor = clamp(options.inkFloor, 0, 0.9);
  const edgeBoost = clamp(options.edgeBoost);
  const gamma = Math.max(0.1, options.gamma || 1.0);
  const method = options.method || 'hybrid';

  const totalPixels = width * height;
  const inkMap = new Float32Array(totalPixels);
  const { mag: edgeMag, gx, gy } = computeSobel(luma, width, height);

  for (let i = 0; i < totalPixels; i++) {
    const darkness = 1.0 - clamp(luma[i]);
    let ink = Math.pow(darkness, gamma);
    if (ink <= inkFloor) {
      ink = 0.0;
    } else if (inkFloor > 0) {
      ink = (ink - inkFloor) / (1.0 - inkFloor);
    }
    if (edgeBoost > 0 && edgeMag[i] > 0.015) {
      ink += edgeMag[i] * edgeBoost * 1.8;
    }
    inkMap[i] = clamp(ink);
  }

  const points: RasterPoint[] = [];
  const occupied = new Uint8Array(width * height);

  const isOccupied = (px: number, py: number, rad: number): boolean => {
    const x0 = Math.max(0, Math.floor(px - rad));
    const x1 = Math.min(width - 1, Math.ceil(px + rad));
    const y0 = Math.max(0, Math.floor(py - rad));
    const y1 = Math.min(height - 1, Math.ceil(py + rad));
    for (let y = y0; y <= y1; y++) {
      const row = y * width;
      for (let x = x0; x <= x1; x++) {
        if (occupied[row + x]) return true;
      }
    }
    return false;
  };

  const markOccupied = (px: number, py: number) => {
    const ix = clamp(Math.round(px), 0, width - 1);
    const iy = clamp(Math.round(py), 0, height - 1);
    occupied[iy * width + ix] = 1;
  };

  // PASS 1: Extract continuous vector contour strokes with sub-pixel stepping
  if (method === 'contour' || method === 'hybrid') {
    const edgeThreshold = method === 'contour' ? 0.05 : 0.07;
    const strokeStep = Math.max(4.0, Math.min(7.5, 7.8 - detail * 3.5));

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const m = edgeMag[idx];
        if (m < edgeThreshold) continue;

        const vx = gx[idx];
        const vy = gy[idx];
        const len = Math.hypot(vx, vy);
        if (len < 1e-4) continue;
        const nx = vx / len;
        const ny = vy / len;

        const p1 = edgeMag[clamp(Math.round(y + ny), 0, height - 1) * width + clamp(Math.round(x + nx), 0, width - 1)];
        const p2 = edgeMag[clamp(Math.round(y - ny), 0, height - 1) * width + clamp(Math.round(x - nx), 0, width - 1)];
        if (m < p1 || m < p2) continue;

        if (!isOccupied(x, y, strokeStep * 0.50)) {
          const ch = getContourStroke(vx, vy);
          points.push({ ch, x, y, weight: m, isContour: true });
          markOccupied(x, y);
        }
      }
    }
  }

  // PASS 2: Multi-scale depth shading (foreground vs subtle background)
  if (method === 'halftone' || method === 'hybrid') {
    const stepX = Math.max(3.0, options.spacingX || 3.5);
    const stepY = Math.max(4.8, options.spacingY || 5.8);
    const cols = Math.floor(width / stepX);
    const rows = Math.floor(height / stepY);

    const gridInk = new Float32Array(cols * rows);
    for (let gy = 0; gy < rows; gy++) {
      const cy = Math.round(stepY * 0.5 + gy * stepY);
      if (cy >= height) continue;
      const row = cy * width;
      const gRow = gy * cols;
      for (let gx = 0; gx < cols; gx++) {
        const cx = Math.round(stepX * 0.5 + gx * stepX);
        if (cx < width) {
          gridInk[gRow + gx] = inkMap[row + cx];
        }
      }
    }

    const diffused = new Float32Array(gridInk);
    for (let gy = 0; gy < rows; gy++) {
      const gRow = gy * cols;
      const nextGRow = (gy + 1) * cols;
      const y = +(stepY * 0.5 + gy * stepY).toFixed(2);

      for (let gx = 0; gx < cols; gx++) {
        const idx = gRow + gx;
        const val = diffused[idx];
        const orig = gridInk[idx];
        const x = +(stepX * 0.5 + gx * stepX).toFixed(2);

        // Keep background clean: very light tone noise is discarded unless intentional
        if (orig <= 0.02 || isOccupied(x, y, 2.0)) {
          diffused[idx] = 0;
          continue;
        }

        let bit = 0;
        let err = 0;
        let ch = '.';

        if (val >= 0.5) {
          bit = 1;
          // Foreground shadow gets dense ':', midtone '.', background nuance gets ','
          ch = orig > 0.78 ? ':' : orig < 0.28 ? ',' : '.';
          err = val - 1.0;
        } else {
          bit = 0;
          err = val;
        }

        if (bit === 1) {
          points.push({ ch, x, y, weight: orig, isContour: false });
          markOccupied(x, y);
        }

        if (err !== 0) {
          if (gx + 1 < cols) diffused[idx + 1] += err * (7 / 16);
          if (gy + 1 < rows) {
            if (gx > 0) diffused[nextGRow + gx - 1] += err * (3 / 16);
            diffused[nextGRow + gx] += err * (5 / 16);
            if (gx + 1 < cols) diffused[nextGRow + gx + 1] += err * (1 / 16);
          }
        }
      }
    }
  }

  // Thinning: bound total points to prevent Dota 2 UI stuttering while preserving contours and shading
  const maxPoints = options.maxPoints ?? 500;
  if (points.length > maxPoints && width > 10 && height > 10) {
    const contourPoints = points.filter((p) => p.isContour);
    const halftonePoints = points.filter((p) => !p.isContour);

    contourPoints.sort((a, b) => (b.weight || 0) - (a.weight || 0));
    halftonePoints.sort((a, b) => (b.weight || 0) - (a.weight || 0));

    const contourBudget = Math.min(contourPoints.length, Math.round(maxPoints * 0.65));
    const keptContours = thinPointsSpatially(contourPoints, contourBudget, width, height);
    const keptHalftone = thinPointsSpatially(halftonePoints, maxPoints - keptContours.length, width, height);

    return [...keptContours, ...keptHalftone];
  }

  return points;
}

/** Spatial Poisson-disc thinning algorithm that preserves structure and bounds dot density */
function thinPointsSpatially(
  candidates: RasterPoint[],
  budget: number,
  width: number,
  height: number
): RasterPoint[] {
  if (candidates.length <= budget || budget <= 0) {
    return candidates.slice(0, Math.max(0, budget));
  }

  const area = Math.max(100, width * height);
  const targetRadius = Math.max(3.5, Math.sqrt(area / (budget * 1.25)));

  const runPass = (radius: number): RasterPoint[] => {
    const cellSize = Math.max(1.0, radius);
    const gridCols = Math.ceil(width / cellSize) + 1;
    const gridRows = Math.ceil(height / cellSize) + 1;
    const grid = new Int32Array(gridCols * gridRows).fill(-1);
    const result: RasterPoint[] = [];

    for (let i = 0; i < candidates.length; i++) {
      const pt = candidates[i];
      const cx = Math.floor(pt.x / cellSize);
      const cy = Math.floor(pt.y / cellSize);
      let tooClose = false;

      for (let dy = -1; dy <= 1 && !tooClose; dy++) {
        const ny = cy + dy;
        if (ny < 0 || ny >= gridRows) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          if (nx < 0 || nx >= gridCols) continue;
          const otherIdx = grid[ny * gridCols + nx];
          if (otherIdx >= 0) {
            const other = candidates[otherIdx];
            const distSq = (pt.x - other.x) * (pt.x - other.x) + (pt.y - other.y) * (pt.y - other.y);
            if (distSq < radius * radius) {
              tooClose = true;
              break;
            }
          }
        }
      }

      if (!tooClose) {
        grid[cy * gridCols + cx] = i;
        result.push(pt);
        if (result.length >= budget) break;
      }
    }

    return result;
  };

  let kept = runPass(targetRadius);
  if (kept.length < budget * 0.70) {
    kept = runPass(targetRadius * 0.70);
  }
  return kept.slice(0, budget);
}
