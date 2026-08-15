// Value-axis ticks for the hand-rolled charts. Pure — covered by axis.test.ts.
//
// The charts scale their plot to the data's own extent and always did; these
// ticks are placed INSIDE that extent rather than rounding it outwards. A bar
// chart whose domain got stretched to the next round number would redraw every
// bar shorter to gain a tidier label, which is a bad trade — the bars are the
// data and the labels are the furniture.

/**
 * Round values inside [min, max], roughly `target` of them, at a step from the
 * 1 / 2 / 2.5 / 5 / 10 family so the labels read as round numbers.
 *
 * Returns at most one tick when the range is degenerate, and never returns
 * anything outside the range: a label the plot does not reach is a label
 * pointing at nothing.
 */
export function niceTicks(min: number, max: number, target = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (max <= min) return [min];
  const raw = (max - min) / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step =
    mag * (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10);
  const out: number[] = [];
  // Start at the first step at or above min, and guard the loop against a step
  // that floating point makes vanishingly small.
  if (!(step > 0)) return [min, max];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    // -0 prints as "-0"; it is zero.
    out.push(Object.is(v, -0) ? 0 : v);
    if (out.length > 12) break;
  }
  return out;
}

/**
 * The short number that goes beside a tick.
 *
 * Deliberately not the chart's own formatter: that one writes the currency out
 * ("102,25 kM USD") because it labels a single figure in a tooltip, and five of
 * those stacked in a 34-pixel gutter is a wall. The unit belongs to the card,
 * which says it in its title and its tooltips; the axis only has to say how
 * far up the page a number is.
 */
/**
 * The unit a chart's own formatter writes, so the axis can state it once.
 *
 * The corner label these axes replaced said "102,25 kM USD" — it was a poor
 * scale but it did name the currency, and dropping that would leave a chart of
 * TSM's revenue reading "1,45 B" with nothing to say those are Taiwan dollars.
 * Rather than thread a currency prop through four components and a dozen call
 * sites, ask the formatter: whatever survives after the digits and separators
 * are stripped from a formatted zero is the unit it is speaking in.
 *
 * Returns "" for a plain number, which is the right answer for per-share
 * figures and multiples.
 */
export function unitFrom(format: (v: number) => string): string {
  try {
    return format(0).replace(/[\d\s.,  -]+/g, "").trim();
  } catch {
    return "";
  }
}

export function axisLabel(v: number): string {
  const abs = Math.abs(v);
  return new Intl.NumberFormat(undefined, {
    notation: abs >= 10000 ? "compact" : "standard",
    maximumFractionDigits: abs >= 100 ? 0 : abs >= 1 ? 1 : 2,
  }).format(v);
}
