/**
 * Dynamic timeout calculation based on request body size.
 *
 * Formula:
 *   - bodySize < 10KB → return base (30s non-stream / 10s stream)
 *   - bodySize >= 10KB → base + min(floor((bodySize - 10KB) / 5KB) * 2s, 200s)
 *
 * Provider-level overrides (timeoutMs / streamTimeoutMs) take precedence
 * when set on the Provider record.
 */

const DYNAMIC_THRESHOLD_BYTES = 10_000;   // 10KB
const DYNAMIC_BUCKET_BYTES = 5_000;        // 5KB
const DYNAMIC_BUCKET_MS = 2_000;           // each bucket adds 2s
const DYNAMIC_MAX_EXTRA_MS = 200_000;      // max extra 200s
const BASE_TIMEOUT_MS = 30_000;            // non-stream base 30s
const STREAM_BASE_TIMEOUT_MS = 10_000;     // stream base 10s

/**
 * Calculate a timeout that grows with the request body size.
 *
 * @param bodySizeBytes  Size of the serialised request body in bytes (0 for GET / no body)
 * @param isStream       Whether this is a streaming request
 */
export function calculateDynamicTimeout(bodySizeBytes: number, isStream: boolean): number {
  const base = isStream ? STREAM_BASE_TIMEOUT_MS : BASE_TIMEOUT_MS;

  if (!bodySizeBytes || bodySizeBytes < DYNAMIC_THRESHOLD_BYTES) {
    return base;
  }

  const extraBuckets = Math.floor((bodySizeBytes - DYNAMIC_THRESHOLD_BYTES) / DYNAMIC_BUCKET_BYTES);
  const extraMs = Math.min(extraBuckets * DYNAMIC_BUCKET_MS, DYNAMIC_MAX_EXTRA_MS);

  return base + extraMs;
}

/**
 * Resolve the final timeout for a request.
 *
 * If the provider has a custom timeout configured (timeoutMs for non-stream,
 * streamTimeoutMs for stream), that value is used directly.
 * Otherwise falls back to the dynamic calculation.
 */
export function resolveTimeout(
  providerTimeoutMs: number | null | undefined,
  providerStreamTimeoutMs: number | null | undefined,
  bodySizeBytes: number,
  isStream: boolean,
): number {
  if (isStream && providerStreamTimeoutMs != null) {
    return providerStreamTimeoutMs;
  }
  if (!isStream && providerTimeoutMs != null) {
    return providerTimeoutMs;
  }
  return calculateDynamicTimeout(bodySizeBytes, isStream);
}
