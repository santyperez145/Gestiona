/**
 * useWebWorker — Run heavy computations off the main thread.
 *
 * Creates an inline Web Worker from a plain function so there's no need for
 * a separate .worker.ts file or Vite worker plugin. The function is serialised
 * to a Blob URL, executed in a Worker, and the result is returned via a Promise.
 *
 * Features:
 *   - Zero-config inline worker (no build tooling required)
 *   - Automatic termination after each call (stateless)
 *   - Cancellable via the returned `cancel()` helper
 *   - Typed input/output via generics
 *   - Works with Transferable objects (ArrayBuffer, ImageData, …)
 *
 * Usage:
 *   // Define the heavy function (must be self-contained — no closure access)
 *   function heavyCalc(payload: { items: number[] }): number {
 *     return payload.items.reduce((s, x) => s + x ** 2, 0);
 *   }
 *
 *   const { run, running, result, error } = useWebWorker(heavyCalc);
 *
 *   const handleClick = async () => {
 *     const sum = await run({ items: [1, 2, 3, 4, 5] });
 *     console.log(sum); // 55
 *   };
 *
 * Limitations:
 *   - The worker function must be self-contained (no imports, no closures).
 *   - DOM APIs are unavailable inside the worker.
 *   - Errors thrown inside the worker are caught and exposed via `error`.
 */
import { useState, useCallback, useRef } from "react";

type WorkerFn<TInput, TOutput> = (payload: TInput) => TOutput | Promise<TOutput>;

interface UseWebWorkerReturn<TInput, TOutput> {
  /** Run the function in a Worker. Resolves with the result or undefined on error. */
  run: (payload: TInput, transfer?: Transferable[]) => Promise<TOutput | undefined>;
  /** True while the Worker is computing */
  running: boolean;
  /** Last successful result */
  result: TOutput | null;
  /** Last error, if any */
  error: Error | null;
  /** Cancel the running Worker (terminates it) */
  cancel: () => void;
}

function buildWorkerBlob<TInput, TOutput>(fn: WorkerFn<TInput, TOutput>): string {
  const code = `
    const fn = ${fn.toString()};
    self.onmessage = async (e) => {
      try {
        const result = await fn(e.data);
        self.postMessage({ ok: true, result });
      } catch (err) {
        self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    };
  `;
  const blob = new Blob([code], { type: "application/javascript" });
  return URL.createObjectURL(blob);
}

export function useWebWorker<TInput, TOutput>(
  fn: WorkerFn<TInput, TOutput>
): UseWebWorkerReturn<TInput, TOutput> {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TOutput | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const cancel = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setRunning(false);
  }, []);

  const run = useCallback(
    async (payload: TInput, transfer?: Transferable[]): Promise<TOutput | undefined> => {
      if (typeof Worker === "undefined") {
        // Fallback: run synchronously on main thread
        try {
          const res = await fn(payload);
          setResult(res);
          return res;
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          setError(err);
          return undefined;
        }
      }

      // Cancel any running worker first
      cancel();

      return new Promise<TOutput | undefined>((resolve) => {
        setRunning(true);
        setError(null);

        const blobUrl = buildWorkerBlob(fn);
        blobUrlRef.current = blobUrl;

        const worker = new Worker(blobUrl);
        workerRef.current = worker;

        worker.onmessage = (e) => {
          const { ok, result: res, error: errMsg } = e.data;
          worker.terminate();
          URL.revokeObjectURL(blobUrl);
          workerRef.current = null;
          blobUrlRef.current = null;
          setRunning(false);

          if (ok) {
            setResult(res);
            resolve(res);
          } else {
            const err = new Error(errMsg ?? "Worker error");
            setError(err);
            resolve(undefined);
          }
        };

        worker.onerror = (e) => {
          const err = new Error(e.message ?? "Worker error");
          worker.terminate();
          URL.revokeObjectURL(blobUrl);
          workerRef.current = null;
          blobUrlRef.current = null;
          setRunning(false);
          setError(err);
          resolve(undefined);
        };

        if (transfer && transfer.length > 0) {
          worker.postMessage(payload, transfer);
        } else {
          worker.postMessage(payload);
        }
      });
    },
    [fn, cancel]
  );

  return { run, running, result, error, cancel };
}
