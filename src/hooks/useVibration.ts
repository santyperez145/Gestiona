/**
 * useVibration — Haptic feedback via the Vibration API.
 *
 * Uses navigator.vibrate() to trigger haptic feedback on supported mobile
 * devices. Silently no-ops on desktop or unsupported browsers.
 *
 * Pre-built patterns for common UX interactions:
 *   - tap()      — 10ms single pulse (button press)
 *   - success()  — two short pulses (item added, sale confirmed)
 *   - error()    — three short rapid pulses (validation failure)
 *   - warning()  — one medium pulse (stock alert)
 *   - heavy()    — one long pulse (destructive action)
 *   - vibrate(pattern) — custom pattern [ms on, ms off, ms on, …]
 *   - cancel()   — stop any active vibration
 *
 * Usage:
 *   const { tap, success, error } = useVibration();
 *   <button onClick={() => { tap(); addItem(); }}>+ Agregar</button>
 */
export function useVibration() {
  const supported =
    typeof navigator !== "undefined" && "vibrate" in navigator;

  const vibrate = (pattern: number | number[]): void => {
    if (!supported) return;
    try { navigator.vibrate(pattern); } catch { /* ignore */ }
  };

  const cancel = (): void => {
    if (!supported) return;
    try { navigator.vibrate(0); } catch { /* ignore */ }
  };

  return {
    supported,
    vibrate,
    cancel,
    /** 10ms — light tap (button press confirmation) */
    tap:     () => vibrate(10),
    /** [20, 60, 20] — double pulse (success) */
    success: () => vibrate([20, 60, 20]),
    /** [30, 40, 30, 40, 30] — triple burst (error) */
    error:   () => vibrate([30, 40, 30, 40, 30]),
    /** 60ms — single medium pulse (warning) */
    warning: () => vibrate(60),
    /** 200ms — long pulse (destructive action) */
    heavy:   () => vibrate(200),
    /** Notification-style: [10, 50, 10] */
    notify:  () => vibrate([10, 50, 10]),
  };
}
