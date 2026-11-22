import { describe, it, expect } from 'vitest';
import { applyCells, brushMask, linePoints, paintBrush, paintLine, paintPixel, WIDTH, HEIGHT } from '../shared/raster';
import { PALETTE, validPalette } from '../shared/palette';

describe('raster v1', () => {
  it('includes endpoints and resolves ties deterministically', () => {
    expect(linePoints(0, 0, 4, 2)).toEqual([[0,0],[1,1],[2,1],[3,2],[4,2]]);
    expect(linePoints(3, 2, 1, 2)).toEqual([[3,2],[2,2],[1,2]]);
    expect(linePoints(0, 0, 2, 4)).toEqual([[0,0],[1,1],[1,2],[2,3],[2,4]]);
    expect(linePoints(2, 4, 0, 0)).toEqual([[2,4],[1,3],[1,2],[0,1],[0,0]]);
    expect(paintPixel(3, 4, 2)).toEqual([[3,4,2]]);
  });
  it('defines discrete masks and clips at borders', () => {
    expect(brushMask(1)).toEqual([[0,0]]);
    expect(brushMask(3)).toEqual([[-1,-1],[0,-1],[1,-1],[-1,0],[0,0],[1,0],[-1,1],[0,1],[1,1]]);
    expect(paintBrush([[0,0]], 3, 1)).toEqual([[0,0,1],[1,0,1],[0,1,1],[1,1,1]]);
    expect([1,3,5,9,15,21].map(n=>brushMask(n).length)).toEqual([1,9,21,69,177,349]);
    expect(() => brushMask(2)).toThrow();
  });
  it('replay and consecutive segments converge', () => {
    const a = new Uint8Array(WIDTH * HEIGHT), b = new Uint8Array(a.length);
    applyCells(a, paintBrush([[1,1],[10,5],[13,7]], 5, 3));
    applyCells(b, paintBrush([[1,1],[10,5]], 5, 3));
    applyCells(b, paintBrush([[10,5],[13,7]], 5, 3));
    expect(a).toEqual(b);
    applyCells(a, paintLine(1,1,1,1,4));
    expect(a[WIDTH + 1]).toBe(4);
  });
  it('requires 24 distinct chromatic colors', () => {
    expect(validPalette(PALETTE)).toBe(true);
    expect(validPalette([...PALETTE.slice(0, 23), '#888888'])).toBe(false);
    expect(validPalette([...PALETTE.slice(0, 23), PALETTE[0]])).toBe(false);
  });
  it('keeps the order of distinct cells when a wide stroke revisits a center', () => {
    const points = [[0,0],[3,1],[0,0],[3,1]] as const;
    const expected = new Map<number, readonly [number, number, number]>();
    for (const [i, point] of points.entries()) {
      const previous = points[Math.max(0, i - 1)];
      for (const [cx, cy] of linePoints(previous[0], previous[1], point[0], point[1])) {
        for (const [dx, dy] of brushMask(21)) {
          for (const cell of paintPixel(cx + dx, cy + dy, 4)) {
            expected.set(cell[1] * WIDTH + cell[0], cell);
          }
        }
      }
    }
    expect(paintBrush(points, 21, 4)).toEqual([...expected.values()]);
  });
});
