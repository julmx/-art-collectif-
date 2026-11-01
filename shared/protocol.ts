import type { Point } from './raster';
export interface DrawCommand { opId: string; strokeId: string; partIndex: number; final: boolean; tool: 'pixel' | 'brush'; colorId: number; size: number; points: Point[] }
export type DrawResult = { opId: string; accepted: true; seq: number; duplicate: boolean } | { opId: string; accepted: false; code: string };
