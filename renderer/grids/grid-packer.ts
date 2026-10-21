import type { GridConfigItem } from './gridCanvas.ts';

export interface RawPoint { ch: string; x: number; y: number }

const DOTA_HEIGHTS = [720, 768, 900, 960, 1024, 1050, 1080, 1200, 1440, 1600, 2160]
  .flatMap((h) => [1, 0.8695].map((scale) => (1.1497 * h / 1080) * scale));

const measureCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
const measureCtx = measureCanvas ? measureCanvas.getContext('2d') : null;
const charWidthCache = new Map<string, number>();
const BIG_M = 64;

function calcDotaCharWidth(prev: string, char: string): number {
  const key = prev + '\0' + char;
  let cached = charWidthCache.get(key);
  if (cached !== undefined) return cached;
  if (measureCtx) {
    measureCtx.save();
    measureCtx.font = `${BIG_M}px StudioRadiance, "Exo 2", "Segoe UI", Arial, sans-serif`;
    cached = prev
      ? (measureCtx.measureText(prev + char).width - measureCtx.measureText(prev).width) / BIG_M
      : measureCtx.measureText(char).width / BIG_M;
    measureCtx.restore();
  } else {
    cached = char === ' ' ? 8.6 : 5.0;
  }
  charWidthCache.set(key, cached);
  return cached;
}

interface ActiveRun {
  x: number;
  text: string;
  width: number;
  pens: number[];
  last: string;
  members: number[];
}

export function packPointsWithDotaStandards(
  points: RawPoint[],
  opts: { py?: number; tol?: number; drift?: number; spacers?: number } = {}
): GridConfigItem['configs'][0]['categories'] {
  const py = opts.py ?? 0.87;
  const tol = opts.tol ?? 1.0;
  const drift = opts.drift ?? 2.5;
  const maxSpacers = opts.spacers ?? 90;
  const spaceAdvance = calcDotaCharWidth('', ' ');
  const dotaAdvance = (raw: number, scale = 1.1497) => Math.max(0, Math.round(raw * scale) / scale + 2);
  const u = dotaAdvance(spaceAdvance, 1.1497);
  const dRates = DOTA_HEIGHTS.map((scale) => dotaAdvance(spaceAdvance, scale));
  const sorted = points.map((_, idx) => idx).sort((a, b) => points[a].y - points[b].y || points[a].x - points[b].x);
  const runs: { text: string; x: number; y: number; members: number[] }[] = [];

  for (let c = 0; c < sorted.length;) {
    let l = c;
    const baseRowY = points[sorted[c]].y;
    while (l < sorted.length && points[sorted[l]].y - baseRowY <= py) l++;
    const lineIndices = sorted.slice(c, l).sort((a, b) => points[a].x - points[b].x || a - b);
    const avgY = (baseRowY + points[sorted[l - 1]].y) / 2;
    const activeRuns: ActiveRun[] = [];
    for (const ptIdx of lineIndices) {
      const { ch, x } = points[ptIdx];
      let bestMatch: { run: ActiveRun; gaps: number; pen: number; raw: number; cost: number } | null = null;
      for (const run of activeRuns) {
        const dist = x - run.x;
        const gaps = Math.round((dist - run.width) / u);
        if (gaps < 0 || gaps > maxSpacers) continue;
        let bestPen = 0;
        let minDrift = Infinity;
        for (const testGap of [gaps - 1, gaps, gaps + 1]) {
          if (testGap < 0 || testGap > maxSpacers) continue;
          const targetPen = run.width + testGap * u;
          const diff = Math.abs(targetPen - dist);
          if (diff > tol) continue;
          let maxD = diff;
          for (let k = 0; k < run.pens.length; k++) {
            const diffK = Math.abs(run.pens[k] + testGap * dRates[k] - dist);
            if (diffK > maxD) maxD = diffK;
          }
          if (maxD <= drift && maxD < minDrift) {
            minDrift = maxD;
            bestPen = targetPen;
          }
        }
        if (minDrift !== Infinity) {
          const cost = Math.abs(bestPen - dist) - run.members.length * 0.01;
          const rawAdv = calcDotaCharWidth(gaps ? '' : run.last, ch);
          if (!bestMatch || cost < bestMatch.cost) bestMatch = { run, gaps, pen: bestPen, raw: rawAdv, cost };
        }
      }
      if (bestMatch) {
        const { run, gaps, pen, raw } = bestMatch;
        run.text += ' '.repeat(gaps) + ch;
        run.width = pen + dotaAdvance(raw);
        run.pens = run.pens.map((p, k) => p + gaps * dRates[k] + dotaAdvance(raw, DOTA_HEIGHTS[k]));
        run.last = ch;
        run.members.push(ptIdx);
      } else {
        const rawAdv = calcDotaCharWidth('', ch);
        activeRuns.push({
          x,
          text: ch,
          width: dotaAdvance(rawAdv),
          pens: DOTA_HEIGHTS.map((scale) => dotaAdvance(rawAdv, scale)),
          last: ch,
          members: [ptIdx],
        });
      }
    }
    for (const run of activeRuns) runs.push({ text: run.text, x: run.x, y: run.members.length > 1 ? avgY : points[run.members[0]].y, members: run.members });
    c = l;
  }
  return runs.map((run) => ({
    category_name: run.text,
    x_position: +run.x.toFixed(4),
    y_position: +run.y.toFixed(4),
    width: 30,
    height: 30,
    hero_ids: [] as number[],
  }));
}
