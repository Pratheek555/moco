// Small statistics helpers for measurements.

export interface Spread {
  median: number;
  p10: number;
  p90: number;
  n: number;
}

export function quantile(values: number[], q: number): number {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low);
}

export function median(values: number[]): number {
  return quantile(values, 0.5);
}

export function mean(values: number[]): number {
  const finite = values.filter(Number.isFinite);
  return finite.length === 0 ? Number.NaN : finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

export function spread(values: number[], digits = 3): Spread {
  return { median: round(median(values), digits), p10: round(quantile(values, 0.1), digits), p90: round(quantile(values, 0.9), digits), n: values.filter(Number.isFinite).length };
}

export function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// Median of each value's neighbourhood (radius frames either side), ignoring NaN.
export function movingMedian(values: number[], radius: number): number[] {
  return values.map((_, i) => median(values.slice(Math.max(0, i - radius), i + radius + 1)));
}

export function movingMean(values: number[], radius: number): number[] {
  return values.map((_, i) => mean(values.slice(Math.max(0, i - radius), i + radius + 1)));
}

// Median absolute deviation, a spread that ignores the outliers we are looking for.
export function mad(values: number[]): number {
  const centre = median(values);
  return median(values.map((value) => Math.abs(value - centre)));
}

// "a–b" for a range, or one number when both ends round the same.
export function formatRange(low: number, high: number, digits = 1): string {
  const a = round(low, digits);
  const b = round(high, digits);
  return a === b ? `${a}` : `${a}–${b}`;
}
