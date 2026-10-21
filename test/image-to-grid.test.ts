import test from 'node:test';
import assert from 'node:assert/strict';
import { rasterizeImage } from '../renderer/grids/image-to-grid-engine.ts';
import { GRID_PRESETS, type ImageToGridOptions } from '../renderer/grids/ImageToGrid.ts';

const width = 72;
const height = 48;

function flat(value: number): Float32Array {
  return new Float32Array(width * height).fill(value);
}

const defaultOpts = {
  detail: 0.7,
  spacingX: 7.2,
  spacingY: 12.96,
  inkFloor: 0.2,
  edgeBoost: 0.3,
  gamma: 1.0,
};

test('a blank white background produces no dots', () => {
  const points = rasterizeImage(flat(1), width, height, defaultOpts);
  assert.deepEqual(points, []);
});

test('a blank black background fills the grid', () => {
  const points = rasterizeImage(flat(0), width, height, { ...defaultOpts, inkFloor: 0 });
  assert.ok(points.length > 10, `expected many dots for black, got ${points.length}`);
});

test('darker tones always yield a denser field', () => {
  const tones = [0.85, 0.65, 0.45, 0.2];
  const counts = tones.map((tone) =>
    rasterizeImage(flat(tone), width, height, { ...defaultOpts, inkFloor: 0.20 }).length
  );
  assert.ok(counts[0] === 0, 'a near-white field must stay empty');
  for (let i = 1; i < counts.length; i++) {
    assert.ok(counts[i] >= counts[i - 1], `tone ${tones[i]} (${counts[i]}) should be >= tone ${tones[i - 1]} (${counts[i - 1]})`);
  }
});

test('dark text on white becomes a connected field, not dust', () => {
  const luma = flat(1);
  for (let y = 18; y < 30; y++) {
    for (let x = 18; x < 54; x++) luma[y * width + x] = 0.08;
  }
  const points = rasterizeImage(luma, width, height, { ...defaultOpts, inkFloor: 0.1 });
  assert.ok(points.length >= 5, `expected at least 5 dots, got ${points.length}`);
  // Check that dots exist inside the dark rectangle
  const insideDots = points.filter((p) => p.x >= 18 && p.x <= 54 && p.y >= 18 && p.y <= 30);
  assert.ok(insideDots.length >= 3, `expected at least 3 dots inside the text area, got ${insideDots.length}`);
});

test('the engine never places dots outside the image bounds', () => {
  const luma = flat(0);
  const points = rasterizeImage(luma, width, height, { ...defaultOpts, spacingX: 3.6, spacingY: 6.5, inkFloor: 0 });
  for (const point of points) {
    assert.ok(point.x >= 0 && point.x <= width, `x=${point.x} out of bounds [0, ${width}]`);
    assert.ok(point.y >= 0 && point.y <= height, `y=${point.y} out of bounds [0, ${height}]`);
  }
});

test('Floyd-Steinberg preserves approximate dot count for mid-tone', () => {
  // For a 50% gray image, roughly half the grid cells should be lit
  const luma = flat(0.5);
  const points = rasterizeImage(luma, width, height, { ...defaultOpts, inkFloor: 0 });
  const cols = Math.floor((width - defaultOpts.spacingX * 0.5) / defaultOpts.spacingX);
  const rows = Math.floor((height - defaultOpts.spacingY * 0.5) / defaultOpts.spacingY);
  const totalCells = cols * rows;
  const ratio = points.length / totalCells;
  assert.ok(ratio >= 0.35 && ratio <= 0.65, `50% gray should give ~50% dots, got ${(ratio * 100).toFixed(1)}%`);
});

test('edge boost increases dots on high-contrast edges', () => {
  // Create a sharp vertical edge
  const luma = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      luma[y * width + x] = x < width / 2 ? 0.9 : 0.1;
    }
  }
  const noEdge = rasterizeImage(luma, width, height, { ...defaultOpts, inkFloor: 0.1, edgeBoost: 0 });
  const withEdge = rasterizeImage(luma, width, height, { ...defaultOpts, inkFloor: 0.1, edgeBoost: 1.0 });
  assert.ok(withEdge.length >= noEdge.length, `edge boost should add dots, not remove them: ${withEdge.length} vs ${noEdge.length}`);
});

test('detail boost brings out fine texture differences', () => {
  // Create fine texture (alternating stripes)
  const luma = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      luma[y * width + x] = (x % 2 === 0) ? 0.4 : 0.6;
    }
  }
  const lowDetail = rasterizeImage(luma, width, height, { ...defaultOpts, inkFloor: 0.1, detail: 0 });
  const highDetail = rasterizeImage(luma, width, height, { ...defaultOpts, inkFloor: 0.1, detail: 1.0 });
  assert.ok(highDetail.length >= lowDetail.length, `highDetail (${highDetail.length}) should >= lowDetail (${lowDetail.length})`);
});

test('presets have valid parameter ranges', () => {
  for (const [key, preset] of Object.entries(GRID_PRESETS)) {
    const opts = preset.options as Partial<ImageToGridOptions>;
    assert.ok(preset.method === 'halftone' || preset.method === 'contour' || preset.method === 'hybrid',
      `${key}: invalid method ${preset.method}`);
    assert.ok(preset.label && preset.label.length > 0, `${key}: missing label`);
    if (opts.detail !== undefined) {
      assert.ok(opts.detail >= 0 && opts.detail <= 100, `${key}: detail out of range`);
    }
    if (opts.edgeBoost !== undefined) {
      assert.ok(opts.edgeBoost >= 0 && opts.edgeBoost <= 100, `${key}: edgeBoost out of range`);
    }
    if (opts.spacingX !== undefined) {
      assert.ok(opts.spacingX >= 3.0, `${key}: spacingX below minimum`);
    }
    if (opts.spacingY !== undefined) {
      assert.ok(opts.spacingY >= 5.0, `${key}: spacingY below minimum`);
    }
  }
});

test('empty image (1x1) does not crash', () => {
  const luma = new Float32Array(1);
  luma[0] = 0.5;
  const points = rasterizeImage(luma, 1, 1, defaultOpts);
  assert.ok(Array.isArray(points), 'should return an array');
});

test('finer spacing produces more dots', () => {
  const luma = flat(0.3);
  const coarse = rasterizeImage(luma, width, height, { ...defaultOpts, spacingX: 12, spacingY: 20, inkFloor: 0.02 });
  const fine = rasterizeImage(luma, width, height, { ...defaultOpts, spacingX: 3.6, spacingY: 6.5, inkFloor: 0.02 });
  assert.ok(fine.length > coarse.length, `finer spacing should produce more dots: fine=${fine.length} coarse=${coarse.length}`);
});

test('spatial thinning bounds total points to maxPoints', () => {
  const largeW = 400;
  const largeH = 300;
  const darkLuma = new Float32Array(largeW * largeH).fill(0.1);
  const cap = 350;
  const points = rasterizeImage(darkLuma, largeW, largeH, {
    ...defaultOpts,
    spacingX: 3.5,
    spacingY: 5.5,
    inkFloor: 0.01,
    maxPoints: cap,
  });
  assert.ok(points.length <= cap, `points count ${points.length} must not exceed cap ${cap}`);
  assert.ok(points.length >= cap * 0.7, `points count ${points.length} should reach at least 70% of cap`);
});
