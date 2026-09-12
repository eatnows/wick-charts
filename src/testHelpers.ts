import { vi } from 'vitest';

/** Minimal fake of the subset of CanvasRenderingContext2D the renderer
 * actually calls — jsdom implements `<canvas>` as an element but not its
 * 2D drawing context, so real code under test needs this stood in for
 * `getContext('2d')`. */
export interface FakeContext2D {
  clearRect: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  moveTo: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
  measureText: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  setLineDash: ReturnType<typeof vi.fn>;
  fillStyle: string;
  strokeStyle: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  globalAlpha: number;
}

export function createFakeContext(): FakeContext2D {
  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn().mockReturnValue({ width: 40 } as TextMetrics),
    save: vi.fn(),
    restore: vi.fn(),
    setLineDash: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    globalAlpha: 1,
  };
}

/** A real jsdom `<canvas>` element (so `addEventListener`/`dispatchEvent`/
 * `getBoundingClientRect` all behave like a normal DOM node) with its 2D
 * context stubbed to `createFakeContext()`'s spies. `width`/`height` are
 * the backing-store size; `getBoundingClientRect` is stubbed to the same
 * values by default (devicePixelRatio 1) — pass a different `cssWidth`/
 * `cssHeight` to simulate a scaled display. */
export function createTestCanvas(
  width = 800,
  height = 400,
  cssWidth = width,
  cssHeight = height,
): { canvas: HTMLCanvasElement; ctx: FakeContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = createFakeContext();
  vi.spyOn(canvas, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: cssWidth,
    bottom: cssHeight,
    width: cssWidth,
    height: cssHeight,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);

  return { canvas, ctx };
}
