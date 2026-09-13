import { describe, expect, it } from 'vitest';
import { computePaneLayout } from './paneLayout';

describe('computePaneLayout', () => {
  it('gives the main pane the entire height when no panes are declared', () => {
    const { main, panes } = computePaneLayout([], 400);
    expect(main).toEqual({ id: 'main', top: 0, height: 400 });
    expect(panes).toEqual([]);
  });

  it('stacks declared panes below the main pane in call order', () => {
    const { main, panes } = computePaneLayout([{ id: 'rsi', heightRatio: 0.25 }], 400);
    expect(main).toEqual({ id: 'main', top: 0, height: 300 });
    expect(panes).toEqual([{ id: 'rsi', top: 300, height: 100 }]);
  });

  it('stacks multiple panes in order, each sized by its own ratio', () => {
    const { main, panes } = computePaneLayout(
      [
        { id: 'volume', heightRatio: 0.2 },
        { id: 'rsi', heightRatio: 0.2 },
      ],
      500,
    );
    expect(main.height).toBeCloseTo(300, 5);
    expect(panes[0]).toEqual({ id: 'volume', top: 300, height: 100 });
    expect(panes[1]).toEqual({ id: 'rsi', top: 400, height: 100 });
  });

  it('proportionally scales down declared panes rather than starving the main pane', () => {
    // Three panes each asking for 0.4 (1.2 total) would leave nothing for
    // the main pane — they should be scaled down together, keeping their
    // relative sizes, so the main pane keeps its floor share.
    const { main, panes } = computePaneLayout(
      [
        { id: 'a', heightRatio: 0.4 },
        { id: 'b', heightRatio: 0.4 },
        { id: 'c', heightRatio: 0.4 },
      ],
      1000,
    );
    expect(main.height).toBeCloseTo(200, 5); // 1 - MAX_TOTAL_PANE_RATIO (0.8)
    expect(panes[0]!.height).toBeCloseTo(panes[1]!.height, 5);
    expect(panes[1]!.height).toBeCloseTo(panes[2]!.height, 5);
    const totalPaneHeight = panes.reduce((sum, p) => sum + p.height, 0);
    expect(totalPaneHeight).toBeCloseTo(800, 5);
  });

  it('floors a near-zero heightRatio so a pane never collapses to nothing', () => {
    const { panes } = computePaneLayout([{ id: 'tiny', heightRatio: 0.0001 }], 400);
    expect(panes[0]!.height).toBeGreaterThan(0);
  });

  it('every rect is contiguous and sums to the total height', () => {
    const { main, panes } = computePaneLayout(
      [
        { id: 'volume', heightRatio: 0.15 },
        { id: 'rsi', heightRatio: 0.25 },
      ],
      777,
    );
    expect(main.top).toBe(0);
    expect(panes[0]!.top).toBeCloseTo(main.height, 5);
    expect(panes[1]!.top).toBeCloseTo(panes[0]!.top + panes[0]!.height, 5);
    const total = main.height + panes.reduce((sum, p) => sum + p.height, 0);
    expect(total).toBeCloseTo(777, 5);
  });

  it('clamps negative total height to zero-height rects instead of throwing', () => {
    const { main, panes } = computePaneLayout([{ id: 'rsi', heightRatio: 0.25 }], -10);
    expect(main.height).toBe(0);
    expect(panes[0]!.height).toBe(0);
  });
});
