/* Hero grids canvas rendering, using GridStudio's coordinate and text system. */

export interface GridConfigItem {
  version?: number;
  configs: Array<{
    config_name: string;
    categories: Array<{
      category_name: string;
      x_position: number;
      y_position: number;
      width: number;
      height: number;
      hero_ids: number[];
    }>;
  }>;
}

const BASE_W = 1193;
const BASE_H = 593;
const CELL_W = 51;
const CELL_H = 83;
const IMG_MARGIN = 4;
const HEADER = 20;
const LIST_PAD = 4;
const LABEL_COLOR = '#808fa6';
const FONT_FAMILY = 'StudioRadiance, "Exo 2", "Segoe UI", Arial, sans-serif';
const FONT_SIZE = 15.15;
const FONT_WEIGHT = 600;
const LETTER_SPACING = 2;
const SCREEN_SCALE = 1.1497;
const BASELINE_OFFSET = FONT_SIZE * 0.857; // ~12.98px

function calcHeroLayout(w: number, h: number, heroIds: number[], pad = LIST_PAD) {
  const r = Math.max(1, w - pad * 2);
  const i = Math.max(1, h - pad * 2);
  let best: {
    cols: number;
    rows: number;
    scale: number;
    cardW: number;
    cardH: number;
    left: number;
    top: number;
    stepX: number;
    stepY: number;
  } | null = null;

  for (let o = 1; o <= heroIds.length; o++) {
    const s = Math.ceil(heroIds.length / o);
    const c = Math.min(r / (o * CELL_W), i / (s * CELL_H));
    if (!best || c >= best.scale - 1e-10) {
      const gap = IMG_MARGIN * c;
      const cardW = (CELL_W - IMG_MARGIN * 2) * c;
      const cardH = (CELL_H - IMG_MARGIN * 2) * c;
      best = {
        cols: o,
        rows: s,
        scale: c,
        cardW,
        cardH,
        left: pad + gap,
        top: HEADER + pad + gap,
        stepX: CELL_W * c,
        stepY: CELL_H * c,
      };
    }
  }
  return best;
}

const portraitCache = new Map<number, HTMLImageElement>();

/* Portraits arrive one at a time, and each arrival asks for the whole grid to be drawn again.
 * A grid made from a picture can hold tens of thousands of single-character categories, so that
 * meant drawing every glyph of them again for every portrait - which is what made the screen
 * stall. Only the hero layer changes when a portrait lands, so the text layer is drawn once into
 * an offscreen canvas, keyed by the categories array and the width, and blitted on top after. */
const textLayerCache = new WeakMap<object, Map<number, HTMLCanvasElement>>();
/** Hero ids already waiting for a load event, so a redraw does not add a second listener. */
const portraitSubscribed = new Set<number>();

function buildTextLayer(categories: GridConfigItem['configs'][0]['categories'], width: number): HTMLCanvasElement {
  const height = Math.round((width / BASE_W) * BASE_H);
  const layer = document.createElement('canvas');
  layer.width = width;
  layer.height = height;
  const ctx = layer.getContext('2d');
  if (!ctx) return layer;

  const s = width / BASE_W;
  ctx.scale(s, s);
  ctx.font = `${FONT_WEIGHT} ${FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = LABEL_COLOR;
  ctx.letterSpacing = '0px';

  ctx.shadowColor = '#00000044';
  ctx.shadowOffsetX = 2 * s;
  ctx.shadowOffsetY = 2 * s;
  ctx.shadowBlur = 4 * s;

  for (const cat of categories) {
    const text = String(cat.category_name || '');
    if (text.trim()) drawCategoryLine(ctx, text, cat.x_position, cat.y_position);
  }
  return layer;
}

function getTextLayer(categories: GridConfigItem['configs'][0]['categories'], width: number): HTMLCanvasElement {
  let byWidth = textLayerCache.get(categories);
  if (!byWidth) {
    byWidth = new Map<number, HTMLCanvasElement>();
    textLayerCache.set(categories, byWidth);
  }
  let layer = byWidth.get(width);
  if (!layer) {
    layer = buildTextLayer(categories, width);
    byWidth.set(width, layer);
  }
  return layer;
}

function getHeroImage(heroId: number): HTMLImageElement {
  let img = portraitCache.get(heroId);
  if (!img) {
    img = new Image();
    img.src = `https://gridstudio.me/assets/portraits/${heroId}.webp`;
    portraitCache.set(heroId, img);
  }
  return img;
}

const measureCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
const measureCtx = measureCanvas ? measureCanvas.getContext('2d') : null;
const widthCache = new Map<string, number>();
const advancesCache = new Map<string, number[]>();
const BIG_M = 64;

function calcCharAdvance(char: string, prevChar: string): number {
  const key = prevChar + '\0' + char;
  let w = widthCache.get(key);
  if (w === undefined) {
    if (measureCtx) {
      measureCtx.save();
      measureCtx.font = `${FONT_WEIGHT} ${FONT_SIZE * BIG_M}px ${FONT_FAMILY}`;
      measureCtx.letterSpacing = '0px';
      if (prevChar) {
        w = (measureCtx.measureText(prevChar + char).width - measureCtx.measureText(prevChar).width) / BIG_M;
      } else {
        w = measureCtx.measureText(char).width / BIG_M;
      }
      measureCtx.restore();
    } else {
      w = 9;
    }
    widthCache.set(key, w);
  }
  // Formula from GridStudio core: Math.max(0, Math.round(w * SCREEN_SCALE) / SCREEN_SCALE + LETTER_SPACING)
  return Math.max(0, Math.round(w * SCREEN_SCALE) / SCREEN_SCALE + LETTER_SPACING);
}

function getLineAdvances(line: string): number[] {
  let advs = advancesCache.get(line);
  if (advs) return advs;
  let prev = '';
  const chars = Array.from(line);
  advs = chars.map((ch) => {
    const adv = /[\u2002-\u2004\u2006]/u.test(ch) ? 0 : calcCharAdvance(ch, prev);
    prev = ch;
    return adv;
  });
  advancesCache.set(line, advs);
  return advs;
}
function drawCategoryLine(ctx: CanvasRenderingContext2D, text: string, x: number, y: number) {
  if (text.length === 1) {
    ctx.fillText(text.toUpperCase(), x + LIST_PAD, y + BASELINE_OFFSET);
    return;
  }
  const lines = text.toUpperCase().split('\n');
  lines.forEach((line, lIdx) => {
    const chars = Array.from(line);
    const lineY = y + BASELINE_OFFSET + lIdx * HEADER;
    if (chars.length === 1) {
      ctx.fillText(line, x + LIST_PAD, lineY);
      return;
    }
    const advances = getLineAdvances(line);
    let curX = x + LIST_PAD;
    chars.forEach((ch, idx) => {
      if (ch !== ' ') ctx.fillText(ch, curX, lineY);
      curX += advances[idx] ?? 10;
    });
  });
}

export function drawGridToCanvas(
  canvas: HTMLCanvasElement,
  grid: GridConfigItem | null,
  width: number,
  onImageLoad?: () => void,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const height = Math.round((width / BASE_W) * BASE_H);
  canvas.width = width;
  canvas.height = height;

  ctx.save();
  const s = width / BASE_W;
  ctx.scale(s, s);

  // Gradient background matching GridStudio
  const grad = ctx.createLinearGradient(0, 0, 0, BASE_H);
  grad.addColorStop(0, '#261e12');
  grad.addColorStop(1, '#140f0a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, BASE_W, BASE_H);

  if (!grid || !grid.configs || !grid.configs[0] || !grid.configs[0].categories) {
    ctx.restore();
    return;
  }

  const categories = grid.configs[0].categories;

  // 1. Draw Hero Cards & Category Containers first
  for (const cat of categories) {
    if (Array.isArray(cat.hero_ids) && cat.hero_ids.length > 0) {
      const layout = calcHeroLayout(cat.width, cat.height, cat.hero_ids);
      if (layout) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(cat.x_position, cat.y_position + HEADER, cat.width, cat.height);
        ctx.clip();

        cat.hero_ids.forEach((heroId, hIdx) => {
          const col = hIdx % layout.cols;
          const row = Math.floor(hIdx / layout.cols);
          const x = cat.x_position + layout.left + col * layout.stepX;
          const y = cat.y_position + layout.top + row * layout.stepY;

          ctx.fillStyle = '#202831';
          ctx.fillRect(x, y, layout.cardW, layout.cardH);

          const img = getHeroImage(heroId);
          if (img.complete && img.naturalWidth > 0) {
            const nw = img.naturalWidth;
            const nh = img.naturalHeight;
            const c = Math.max(layout.cardW / nw, layout.cardH / nh);
            const l = layout.cardW / c;
            const u = layout.cardH / c;
            const sx = (nw - l) / 2;
            const sy = (nh - u) / 2;
            ctx.filter = 'saturate(0.7)';
            ctx.drawImage(img, sx, sy, l, u, x, y, layout.cardW, layout.cardH);
            ctx.filter = 'none';
          } else {
            /* One listener per portrait, however many redraws happen while it loads. */
            if (onImageLoad && !portraitSubscribed.has(heroId)) {
              portraitSubscribed.add(heroId);
              img.addEventListener('load', () => {
                portraitSubscribed.delete(heroId);
                onImageLoad();
              }, { once: true });
            }
          }
        });

        ctx.restore();
      }
    }
  }

  // 2. Draw Category Text / Art / Symbols OVER heroes so grid designs are fully visible.
  // The layer is cached per categories array and width; a portrait landing redraws only the
  // hero layer above, not these tens of thousands of glyphs again.
  ctx.drawImage(getTextLayer(categories, width), 0, 0, BASE_W, BASE_H);

  ctx.restore();
}

