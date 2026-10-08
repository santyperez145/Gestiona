import { afterEach, describe, expect, it, vi } from "vitest";
import { retryAbortableRead } from "@/lib/transientRead";

afterEach(() => { vi.useRealTimers(); });

describe("bounded read lifecycle", () => {
  it("aborts a hung attempt and recovers with a new signal", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const read = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return signals.length === 1
        ? new Promise<{ data: string; error: null }>(() => {})
        : Promise.resolve({ data: "catalog", error: null });
    });
    const result = retryAbortableRead(read, { timeoutMs: 100, delaysMs: [5] });
    await vi.advanceTimersByTimeAsync(105);
    await expect(result).resolves.toEqual({ data: "catalog", error: null });
    expect(read).toHaveBeenCalledTimes(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects instead of waiting forever even if the SDK ignores abort", async () => {
    vi.useFakeTimers();
    const read = vi.fn(() => new Promise<{ error: null }>(() => {}));
    const result = retryAbortableRead(read, { timeoutMs: 100, delaysMs: [0] });
    const assertion = expect(result).rejects.toMatchObject({ code: "ETIMEDOUT" });
    await vi.advanceTimersByTimeAsync(200);
    await assertion;
    expect(read).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels active work without retrying when the store is unmounted", async () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    let child: AbortSignal;
    const read = vi.fn((signal: AbortSignal) => {
      child = signal;
      return new Promise<{ error: null }>(() => {});
    });
    const result = retryAbortableRead(read, { signal: parent.signal, timeoutMs: 100 });
    const assertion = expect(result).rejects.toMatchObject({ code: "ABORT_ERR" });
    await vi.advanceTimersByTimeAsync(1);
    parent.abort();
    await assertion;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(child.aborted).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never starts a request when its caller is already cancelled", async () => {
    const parent = new AbortController();
    parent.abort();
    const read = vi.fn(async () => ({ error: null }));
    await expect(retryAbortableRead(read, { signal: parent.signal }))
      .rejects.toMatchObject({ code: "ABORT_ERR" });
    expect(read).not.toHaveBeenCalled();
  });

  it("keeps permission errors intact and releases the deadline", async () => {
    vi.useFakeTimers();
    const denied = { code: "42501", message: "permission denied" };
    const read = vi.fn(async () => ({ data: null, error: denied, status: 403 }));
    await expect(retryAbortableRead(read)).resolves.toEqual({ data: null, error: denied, status: 403 });
    expect(read).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a late response from an expired attempt cannot replace the recovered result", async () => {
    vi.useFakeTimers();
    let lateResponse: (value: { data: string; error: null }) => void;
    let attempts = 0;
    const result = retryAbortableRead(() => ++attempts === 1
      ? new Promise(resolve => { lateResponse = resolve; })
      : Promise.resolve({ data: "new", error: null }), { timeoutMs: 100, delaysMs: [0] });
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toEqual({ data: "new", error: null });
    lateResponse({ data: "old", error: null });
    expect(await result).toEqual({ data: "new", error: null });
    expect(vi.getTimerCount()).toBe(0);
  });
});
