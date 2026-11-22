/** Raster engine v1. Coordinates are integer cell centers; endpoints are inclusive. */
export const WIDTH = 720;
export const HEIGHT = 480;
export const SIZES = [1, 3, 5, 9, 15, 21] as const;
export const DRAW_PART_POINTS = 64;
export const DRAW_PART_WORK = 400_000;
export type Point = readonly [number, number];
export type Cell = readonly [number, number, number];

export function paintPixel(x: number, y: number, colorId: number): Cell[] {
  return x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT ? [[x, y, colorId]] : [];
}

/** Symmetric integer Bresenham. On a tie both eligible axes advance. */
export function linePoints(x0: number, y0: number, x1: number, y1: number): Point[] {
  const result: Point[] = [];
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  while (true) {
    result.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const twice = 2 * error;
    if (twice >= dy) { error += dy; x0 += sx; }
    if (twice <= dx) { error += dx; y0 += sy; }
  }
  return result;
}

export function paintLine(x0: number, y0: number, x1: number, y1: number, colorId: number): Cell[] {
  return linePoints(x0, y0, x1, y1).flatMap(([x, y]) => paintPixel(x, y, colorId));
}

/** Circle contains cell centers at distance <= diameter / 2. */
export function brushMask(diameter: number): Point[] {
  if (!SIZES.includes(diameter as typeof SIZES[number])) throw new Error('Invalid brush diameter');
  const r = (diameter - 1) / 2, points: Point[] = [];
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    if (4 * (x * x + y * y) <= diameter * diameter) points.push([x || 0, y || 0]);
  }
  return points;
}

const brushMaskSizes = new Map<number, number>(SIZES.map(size => [size, brushMask(size).length]));

function brushSteps(point: Point, previous?: Point): number {
  return previous ? 1 + Math.max(Math.abs(point[0] - previous[0]), Math.abs(point[1] - previous[1])) : 1;
}

export function estimateBrushWork(points: readonly Point[], diameter: number): number {
  const size = brushMaskSizes.get(diameter);
  if (size === undefined) throw new Error('Invalid brush diameter');
  return size * points.reduce((steps, point, i) => steps + brushSteps(point, points[i - 1]), 0);
}

/** Largest prefix that fits in one command, including its continuation point. */
export function drawPartLength(points: readonly Point[], diameter: number): number {
  const size = brushMaskSizes.get(diameter);
  if (size === undefined) throw new Error('Invalid brush diameter');
  let work = 0;
  const max = Math.min(points.length, DRAW_PART_POINTS);
  for (let i = 0; i < max; i++) {
    work += size * brushSteps(points[i], points[i - 1]);
    if (work > DRAW_PART_WORK) return i;
  }
  return max;
}

export function paintBrush(points: readonly Point[], diameter: number, colorId: number): Cell[] {
  const mask = brushMask(diameter), cells: Cell[] = [], seen = new Set<number>();
  for (let i = 0; i < points.length; i++) {
    const previous = points[Math.max(0, i - 1)], current = points[i];
    for (const [cx, cy] of linePoints(previous[0], previous[1], current[0], current[1])) {
      for (const [dx, dy] of mask) {
        const x=cx+dx, y=cy+dy, index=y*WIDTH+x;
        if (x>=0 && x<WIDTH && y>=0 && y<HEIGHT && !seen.has(index)) {seen.add(index);cells.push([x,y,colorId]);}
      }
    }
  }
  return cells;
}

export function applyCells(grid: Uint8Array, cells: readonly Cell[]): void {
  for (const [x, y, color] of cells) grid[y * WIDTH + x] = color;
}
