import { describe, it, expect } from 'vitest';
import {
  calculateDynamicTimeout,
  resolveTimeout,
} from '../timeout';

// ---------------------------------------------------------------------------
// Constants from timeout.ts — keep in sync or import if exported
// ---------------------------------------------------------------------------
const BASE_MS = 30_000;
const STREAM_BASE_MS = 10_000;
const THRESHOLD = 10_000;
const BUCKET = 5_000;
const BUCKET_MS = 2_000;
const MAX_EXTRA = 200_000;

// ---------------------------------------------------------------------------
// calculateDynamicTimeout
// ---------------------------------------------------------------------------
describe('calculateDynamicTimeout', () => {
  // ---- base values --------------------------------------------------------
  it('returns base 30s for non-stream with bodySize = 0', () => {
    expect(calculateDynamicTimeout(0, false)).toBe(BASE_MS);
  });

  it('returns stream base 10s for stream with bodySize = 0', () => {
    expect(calculateDynamicTimeout(0, true)).toBe(STREAM_BASE_MS);
  });

  it('non-stream base is different from stream base', () => {
    expect(calculateDynamicTimeout(0, false)).not.toBe(calculateDynamicTimeout(0, true));
  });

  // ---- below threshold (no extra) ----------------------------------------
  it('bodySize 1 (< 10KB) returns base for non-stream', () => {
    expect(calculateDynamicTimeout(1, false)).toBe(BASE_MS);
  });

  it('bodySize 9999 (< 10KB) returns base for non-stream', () => {
    expect(calculateDynamicTimeout(9999, false)).toBe(BASE_MS);
  });

  it('bodySize 9999 (< 10KB) returns stream base for stream', () => {
    expect(calculateDynamicTimeout(9999, true)).toBe(STREAM_BASE_MS);
  });

  // ---- exactly at threshold (10KB) ---------------------------------------
  it('bodySize = 10KB returns base (0 buckets) for non-stream', () => {
    // (10000 - 10000) / 5000 = 0 buckets → 0 extra
    expect(calculateDynamicTimeout(THRESHOLD, false)).toBe(BASE_MS);
  });

  it('bodySize = 10KB returns stream base (0 buckets) for stream', () => {
    expect(calculateDynamicTimeout(THRESHOLD, true)).toBe(STREAM_BASE_MS);
  });

  // ---- various sizes above threshold -------------------------------------
  it('bodySize = 15KB → 1 bucket → +2s (non-stream)', () => {
    const extra = Math.floor((15_000 - THRESHOLD) / BUCKET) * BUCKET_MS;
    expect(calculateDynamicTimeout(15_000, false)).toBe(BASE_MS + extra);
  });

  it('bodySize = 30KB → 4 buckets → +8s (stream)', () => {
    const extra = Math.floor((30_000 - THRESHOLD) / BUCKET) * BUCKET_MS;
    expect(calculateDynamicTimeout(30_000, true)).toBe(STREAM_BASE_MS + extra);
  });

  it('bodySize = 50KB → 8 buckets → +16s', () => {
    const extra = Math.floor((50_000 - THRESHOLD) / BUCKET) * BUCKET_MS;
    expect(calculateDynamicTimeout(50_000, false)).toBe(BASE_MS + extra);
  });

  it('bodySize = 100KB → 18 buckets → +36s', () => {
    const extra = Math.floor((100_000 - THRESHOLD) / BUCKET) * BUCKET_MS;
    expect(calculateDynamicTimeout(100_000, false)).toBe(BASE_MS + extra);
  });

  it('bodySize = 200KB → 38 buckets → +76s', () => {
    const extra = Math.floor((200_000 - THRESHOLD) / BUCKET) * BUCKET_MS;
    expect(calculateDynamicTimeout(200_000, false)).toBe(BASE_MS + extra);
  });

  it('bodySize = 500KB → 98 buckets → capped at 200s', () => {
    // (500_000 - 10_000) / 5_000 = 98 buckets → 196_000ms (< 200_000)
    const extra = Math.floor((500_000 - THRESHOLD) / BUCKET) * BUCKET_MS;
    expect(calculateDynamicTimeout(500_000, false)).toBe(BASE_MS + Math.min(extra, MAX_EXTRA));
  });

  // ---- max extra 200s cap ------------------------------------------------
  it('huge body (10MB) is capped at base + 200s', () => {
    const capped = BASE_MS + MAX_EXTRA;
    expect(calculateDynamicTimeout(10_000_000, false)).toBe(capped);
  });

  it('huge body (10MB) stream capped at stream base + 200s', () => {
    const capped = STREAM_BASE_MS + MAX_EXTRA;
    expect(calculateDynamicTimeout(10_000_000, true)).toBe(capped);
  });

  // ---- boundary: just under one extra bucket ------------------------------
  it('bodySize = 14999 → floor(4999/5000)=0 → no extra', () => {
    expect(calculateDynamicTimeout(14_999, false)).toBe(BASE_MS);
  });

  it('bodySize = 15000 → floor(5000/5000)=1 → +2s', () => {
    expect(calculateDynamicTimeout(15_000, false)).toBe(BASE_MS + BUCKET_MS);
  });

  // ---- negative / NaN bodySize (defensive) --------------------------------
  it('negative bodySize treated as no body → returns base', () => {
    // `!bodySizeBytes` is true for 0, NaN, null, undefined — but TS types won't allow that
    // For negative: `!bodySizeBytes` is false, but `< THRESHOLD` is true
    expect(calculateDynamicTimeout(-1, false)).toBe(BASE_MS);
  });
});

// ---------------------------------------------------------------------------
// resolveTimeout
// ---------------------------------------------------------------------------
describe('resolveTimeout', () => {
  const bodySize = 50_000; // large enough to produce dynamic extra

  // ---- no provider overrides → falls back to dynamic ----------------------
  it('both null → dynamic non-stream', () => {
    const expected = calculateDynamicTimeout(bodySize, false);
    expect(resolveTimeout(null, null, bodySize, false)).toBe(expected);
  });

  it('both null → dynamic stream', () => {
    const expected = calculateDynamicTimeout(bodySize, true);
    expect(resolveTimeout(null, null, bodySize, true)).toBe(expected);
  });

  it('both undefined → dynamic non-stream', () => {
    const expected = calculateDynamicTimeout(bodySize, false);
    expect(resolveTimeout(undefined, undefined, bodySize, false)).toBe(expected);
  });

  // ---- provider sets only non-stream timeout ------------------------------
  it('only timeoutMs set, non-stream request → uses provider value', () => {
    expect(resolveTimeout(60_000, null, bodySize, false)).toBe(60_000);
  });

  it('only timeoutMs set, stream request → falls back to dynamic (stream)', () => {
    const expected = calculateDynamicTimeout(bodySize, true);
    expect(resolveTimeout(60_000, null, bodySize, true)).toBe(expected);
  });

  // ---- provider sets only stream timeout ----------------------------------
  it('only streamTimeoutMs set, stream request → uses provider value', () => {
    expect(resolveTimeout(null, 45_000, bodySize, true)).toBe(45_000);
  });

  it('only streamTimeoutMs set, non-stream request → falls back to dynamic', () => {
    const expected = calculateDynamicTimeout(bodySize, false);
    expect(resolveTimeout(null, 45_000, bodySize, false)).toBe(expected);
  });

  // ---- provider sets both -------------------------------------------------
  it('both set, non-stream → uses timeoutMs', () => {
    expect(resolveTimeout(90_000, 45_000, bodySize, false)).toBe(90_000);
  });

  it('both set, stream → uses streamTimeoutMs', () => {
    expect(resolveTimeout(90_000, 45_000, bodySize, true)).toBe(45_000);
  });

  // ---- provider overrides take absolute precedence (ignore bodySize) ------
  it('provider timeout used even with huge body', () => {
    expect(resolveTimeout(5_000, null, 10_000_000, false)).toBe(5_000);
  });

  it('provider stream timeout used even with huge body', () => {
    expect(resolveTimeout(null, 3_000, 10_000_000, true)).toBe(3_000);
  });

  // ---- zero values are treated as "not set" (== null check) ---------------
  it('timeoutMs = 0 is treated as not set (falsy) → dynamic', () => {
    const expected = calculateDynamicTimeout(bodySize, false);
    // In the code: `providerTimeoutMs != null` — 0 != null is true, so 0 IS used
    expect(resolveTimeout(0, null, bodySize, false)).toBe(0);
  });

  // ---- streamTimeoutMs takes precedence over timeoutMs for stream ---------
  it('stream request: streamTimeoutMs wins even if timeoutMs is also set', () => {
    expect(resolveTimeout(99_000, 77_000, bodySize, true)).toBe(77_000);
  });
});
