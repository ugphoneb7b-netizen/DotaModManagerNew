/* Image → Dota 2 hero-grid config — high-quality vector contour & halftone pipeline.
   Emits individual category strokes (| / \ -) and shading dots (., :) exactly like GridStudio. */

import type { GridConfigItem } from './gridCanvas.ts';
import { rasterizeImage, type RasterOptions } from './image-to-grid-engine.ts';
import { packPointsWithDotaStandards } from './grid-packer.ts';

export type GridMethod = 'halftone' | 'contour' | 'hybrid';

export interface ImageToGridOptions {
  title?: string;
  method?: GridMethod;
  invert?: boolean;
  contrast?: number;    // -100..100
  brightness?: number;  // -100..100
  detail?: number;      // 0..100
  edgeBoost?: number;   // 0..100
  gamma?: number;       // 0..100 (50 = linear)
  fill?: number;        // 20..100 (% of canvas)
  spacingX?: number;    // px
  spacingY?: number;    // px
  maxPoints?: number;   // safe point limit (default: 480, protects Dota 2 from FPS drop)
}

/* Presets tuned for maximum clarity and detail reproduction without lagging Dota 2 */
export const GRID_PRESETS: Record<string, {
  method: GridMethod;
  label: string;
  description: string;
  options: Partial<ImageToGridOptions>;
}> = {
  photoRealistic: {
    method: 'hybrid',
    label: 'Фото / реализм',
    description: 'Высокая чёткость черт лица и предметов с мягкой тоновой штриховкой',
    options: { fill: 94, detail: 80, edgeBoost: 55, gamma: 50, spacingX: 6.8, spacingY: 10.8, brightness: 0, contrast: 25, maxPoints: 480 },
  },
  portrait: {
    method: 'hybrid',
    label: 'Портрет / лицо',
    description: 'Максимальная отчётливость глаз, ресниц, губ и волос',
    options: { fill: 94, detail: 85, edgeBoost: 65, gamma: 48, spacingX: 6.8, spacingY: 10.8, brightness: 0, contrast: 30, maxPoints: 500 },
  },
  anime: {
    method: 'contour',
    label: 'Аниме / чистые линии',
    description: 'Идеальные векторные контуры без мыла с направленными штрихами (| / \\ -)',
    options: { fill: 94, detail: 90, edgeBoost: 80, gamma: 50, spacingX: 7.2, spacingY: 11.2, brightness: 0, contrast: 40, maxPoints: 460 },
  },
  textLogo: {
    method: 'contour',
    label: 'Текст и логотип',
    description: 'Предельная чёткость шрифтов и мелких надписей без размытия',
    options: { fill: 92, detail: 95, edgeBoost: 90, gamma: 50, spacingX: 6.2, spacingY: 10.2, brightness: 0, contrast: 50, maxPoints: 450 },
  },
  sketch: {
    method: 'contour',
    label: 'Скетч / карандаш',
    description: 'Глубокий контурный рисунок пером и штриховкой',
    options: { fill: 92, detail: 85, edgeBoost: 80, gamma: 52, spacingX: 7.2, spacingY: 11.2, brightness: 5, contrast: 35, maxPoints: 480 },
  },
  dense: {
    method: 'hybrid',
    label: 'Максимум деталей',
    description: 'Повышенная детализация при сохранении плавной работы в Dota 2',
    options: { fill: 96, detail: 95, edgeBoost: 75, gamma: 46, spacingX: 5.6, spacingY: 9.2, brightness: 0, contrast: 30, maxPoints: 550 },
  },
  pixel: {
    method: 'halftone',
    label: 'Пиксель-арт / точки',
    description: 'Классическая точечная матрица без направленных линий',
    options: { fill: 90, detail: 55, edgeBoost: 15, gamma: 50, spacingX: 8.8, spacingY: 14.5, brightness: 0, contrast: 30, maxPoints: 400 },
  },
};

/* ——— helpers ——— */

export async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Не удалось прочитать изображение'));
    image.src = dataUrl;
  });
}

function clamp(value: number, min = 0, max = 1): number {
  return value < min ? min : value > max ? max : value;
}

/** Convert sRGB pixel data to perceptual luminance with unsharp masking enhancement. */
function extractLuminance(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  invert: boolean,
  brightness: number,
  contrast: number,
): Float32Array {
  const luma = new Float32Array(width * height);
  const bg = invert ? 0 : 1;
  const cf = Math.pow(2, contrast * 2);

  for (let i = 0; i < luma.length; i++) {
    const r = pixels[i * 4] / 255;
    const g = pixels[i * 4 + 1] / 255;
    const b = pixels[i * 4 + 2] / 255;
    const alpha = pixels[i * 4 + 3] / 255;

    const rl = Math.pow(r, 2.2);
    const gl = Math.pow(g, 2.2);
    const bl = Math.pow(b, 2.2);
    let value = Math.pow(rl * 0.2126 + gl * 0.7152 + bl * 0.0722, 1 / 2.2);

    value = value * alpha + bg * (1 - alpha);
    if (invert) value = 1 - value;
    value = value + brightness;
    value = (value - 0.5) * cf + 0.5;

    luma[i] = clamp(value);
  }
  return luma;
}

/* ——— Main conversion ——— */

const CANVAS_W = 1193;
const CANVAS_H = 593;

export function convertImageToGrid(image: HTMLImageElement, options: ImageToGridOptions = {}): GridConfigItem {
  const fill     = clamp((options.fill ?? 94) / 100, 0.2, 1);
  const invert   = options.invert ?? false;
  const contrast = (options.contrast ?? 25) / 100;
  const brightness = (options.brightness ?? 0) / 100;
  const title    = (options.title && options.title.trim()) || 'Custom Grid Art';
  const method   = options.method || 'hybrid';
  const detail   = clamp((options.detail ?? 85) / 100);
  const edgeBoost = clamp((options.edgeBoost ?? 60) / 100);
  const gamma    = Math.max(0.2, (options.gamma ?? 50) / 50);
  const spacingX = Math.max(3.0, options.spacingX ?? 3.6);
  const spacingY = Math.max(5.0, options.spacingY ?? 6.2);

  const scale = Math.min(
    (CANVAS_W - 24) * fill / image.naturalWidth,
    (CANVAS_H - 24) * fill / image.naturalHeight,
  );
  const width  = Math.max(8, Math.round(image.naturalWidth * scale));
  const height = Math.max(8, Math.round(image.naturalHeight * scale));
  const offsetX = (CANVAS_W - width) / 2;
  const offsetY = (CANVAS_H - height) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = invert ? '#000000' : '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);

  const pixels = ctx.getImageData(0, 0, width, height).data;
  const luma = extractLuminance(pixels, width, height, invert, brightness, contrast);

  let rasterInkFloor: number;
  switch (method) {
    case 'contour':
      rasterInkFloor = 0.12;
      break;
    case 'hybrid':
      rasterInkFloor = 0.06;
      break;
    case 'halftone':
    default:
      rasterInkFloor = 0.04;
      break;
  }

  const maxPoints = Math.max(100, Math.min(1200, options.maxPoints ?? 480));

  const rasterOpts: RasterOptions = {
    detail,
    spacingX,
    spacingY,
    inkFloor: rasterInkFloor,
    edgeBoost,
    gamma,
    method,
    maxPoints,
  };

  const points = rasterizeImage(luma, width, height, rasterOpts);

  // Pack points into standard Dota 2 category lines with precise spacing
  // This reduces categories in Dota 2 from 2000+ down to ~40-90, preventing lag completely.
  const rawPoints = points.map((p) => ({
    ch: p.ch,
    x: +(offsetX + p.x).toFixed(4),
    y: +(offsetY + p.y).toFixed(4),
  }));

  const categories = packPointsWithDotaStandards(rawPoints);

  return {
    version: 3,
    configs: [{
      config_name: title,
      categories,
    }],
  };
}
