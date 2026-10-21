/* The canvas a grid is drawn on, wherever one is shown: a workshop card, a local card, the
 * detail modal and the merge modal. Kept in one place so the redraw-on-image-load trick (a
 * portrait that arrives after the first paint asks for another) cannot be forgotten in one of
 * them. */
import { useEffect, useRef, useState } from 'react';
import { drawGridToCanvas, type GridConfigItem } from './gridCanvas.ts';

export function GridCanvasPreview({ grid, width = 716 }: { grid: GridConfigItem | null; width?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (canvasRef.current) {
      drawGridToCanvas(canvasRef.current, grid, width, () => setTick((t) => t + 1));
    }
  }, [grid, width]);

  return <canvas ref={canvasRef} />;
}