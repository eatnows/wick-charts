import { describe, expect, it } from 'vitest';
import { CrosshairRenderer } from './crosshairRenderer';
import { createFakeContext } from './testHelpers';
import type { FakeContext2D } from './testHelpers';
import type { ChartCrosshairOptions, ChartFontOptions, ChartLegendOptions } from './types';

const CROSSHAIR: Required<ChartCrosshairOptions> = {
  lineColor: '#909090',
  labelBackground: '#3a3a3a',
  labelTextColor: '#f0f0f0',
  labelPaddingX: 4,
  labelPaddingY: 3,
};

const LEGEND: Required<ChartLegendOptions> = {
  textColor: '#f0f0f0',
  background: '#3a3a3a',
  paddingX: 8,
  paddingY: 6,
  cursorGap: 12,
};

const FONT: Required<ChartFontOptions> = { family: 'sans-serif', axisSize: 10, legendSize: 11 };

function makeRenderer(ctx: FakeContext2D): CrosshairRenderer {
  return new CrosshairRenderer(ctx as unknown as CanvasRenderingContext2D, CROSSHAIR, LEGEND, FONT, 64);
}

function baseInput() {
  return {
    x: 100,
    timeSeconds: 1704067200,
    hoverY: 100,
    valueMin: 0,
    valueMax: 200,
    priceStep: 10,
    chartWidth: 700,
    chartHeight: 300,
    stackHeight: 300,
    invertValueAxis: false,
    legendParts: [] as string[],
    canvasWidth: 764,
  };
}

describe('CrosshairRenderer', () => {
  // Constructed standalone, with no ChartRenderer/canvas/series/plugin
  // involved — exercising exactly the decoupling the split was for
  // (render() takes plain data, not a TPoint or a SeriesDefinition).

  it('draws the dashed vertical line spanning the full stack, not just chartHeight', () => {
    const ctx = createFakeContext();
    const renderer = makeRenderer(ctx);
    renderer.render({ ...baseInput(), chartHeight: 300, stackHeight: 500 });

    expect(ctx.setLineDash).toHaveBeenCalledWith([4, 4]);
    expect(ctx.moveTo).toHaveBeenCalledWith(100, 0);
    expect(ctx.lineTo).toHaveBeenCalledWith(100, 500);
  });

  it('draws the horizontal price line only when hoverY is within [0, chartHeight]', () => {
    const ctx = createFakeContext();
    const renderer = makeRenderer(ctx);
    renderer.render({ ...baseInput(), hoverY: 350, chartHeight: 300 }); // outside the pane

    // no horizontal line at y=350 across chartWidth
    expect(ctx.lineTo).not.toHaveBeenCalledWith(700, 350);
  });

  it('inverts the price-label value the same way pixelToValue predicts', () => {
    const ctx = createFakeContext();
    const renderer = makeRenderer(ctx);
    // hoverY=100 of chartHeight=200, range [0, 200]: normal -> 100, inverted -> 100
    // use an asymmetric hoverY to actually distinguish the two directions
    const input = { ...baseInput(), hoverY: 50, chartHeight: 200, valueMin: 0, valueMax: 200 };

    renderer.render(input);
    const normalTexts = ctx.fillText.mock.calls.map((c) => c[0]);

    ctx.fillText.mockClear();
    renderer.render({ ...input, invertValueAxis: true });
    const invertedTexts = ctx.fillText.mock.calls.map((c) => c[0]);

    expect(normalTexts).toContain('150'); // (1 - 50/200) * 200 = 150
    expect(invertedTexts).toContain('50'); // (50/200) * 200 = 50
  });

  it('skips the legend tooltip when legendParts is empty, draws it otherwise', () => {
    const ctx = createFakeContext();
    const renderer = makeRenderer(ctx);

    renderer.render({ ...baseInput(), legendParts: [] });
    const fillRectCallsEmpty = ctx.fillRect.mock.calls.length;

    ctx.fillRect.mockClear();
    renderer.render({ ...baseInput(), legendParts: ['O 100', 'C 105'] });
    expect(ctx.fillRect.mock.calls.length).toBeGreaterThan(fillRectCallsEmpty);
  });

  it('clamps the time-axis label chip within canvasWidth', () => {
    const ctx = createFakeContext();
    const renderer = makeRenderer(ctx);
    renderer.render({ ...baseInput(), x: 0, canvasWidth: 764 }); // hovering the very left edge

    const timeChipCall = ctx.fillRect.mock.calls.find(
      (call) => (call[1] as number) === baseInput().chartHeight,
    );
    expect(timeChipCall).toBeDefined();
    expect(timeChipCall![0]).toBeGreaterThanOrEqual(0); // never a negative left edge
  });
});
