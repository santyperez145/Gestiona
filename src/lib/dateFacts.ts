const DAY_MS = 86_400_000;

/**
 * Returns whole elapsed calendar-ish days for a trusted date value.
 *
 * PostgreSQL can return either `YYYY-MM-DD` or a complete ISO timestamp.  A
 * caller must not append a time to the latter: doing so creates strings such
 * as `2026-09-04T18:20:00Z T12:00:00` and leaks `NaNd` into the UI.
 * Invalid or missing facts stay unknown (`null`) instead of becoming zero or
 * "never".
 */
export function daysSinceKnownDate(
  value: string | null | undefined,
  reference = new Date(),
): number | null {
  const normalized = value?.trim();
  if (!normalized) return null;

  const date = /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? new Date(`${normalized}T12:00:00`)
    : new Date(normalized);
  const timestamp = date.getTime();
  const referenceTimestamp = reference.getTime();
  if (!Number.isFinite(timestamp) || !Number.isFinite(referenceTimestamp)) return null;

  return Math.max(0, Math.floor((referenceTimestamp - timestamp) / DAY_MS));
}
