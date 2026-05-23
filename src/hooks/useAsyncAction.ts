/**
 * useAsyncAction — Wrap async functions with loading/error state management.
 *
 * Eliminates the boilerplate of setting `loading`, catching errors, and
 * cleaning up. Especially useful for form submits, API calls, and button
 * actions that should disable while in-flight.
 *
 * Usage:
 *   const [save, saving, saveError] = useAsyncAction(async (data: FormData) => {
 *     await supabase.from("products").insert(data);
 *     toast.success("Guardado");
 *   });
 *
 *   <Button onClick={() => save(formData)} disabled={saving}>
 *     {saving ? "Guardando..." : "Guardar"}
 *   </Button>
 *   {saveError && <p className="text-destructive">{saveError.message}</p>}
 *
 * Options:
 *   onError(e)  — called when the action throws (default: no-op)
 *   onSuccess() — called after the action resolves
 *   throwOnError — re-throw after calling onError (default: false)
 */
import { useState, useCallback } from "react";

interface AsyncActionOptions<T> {
  /** Called with the error if the action throws */
  onError?: (error: Error, ...args: T extends unknown[] ? T : [T]) => void;
  /** Called after successful completion */
  onSuccess?: () => void;
  /** Re-throw the error after onError (default: false) */
  throwOnError?: boolean;
}

type AsyncFn<TArgs extends unknown[], TResult> = (...args: TArgs) => Promise<TResult>;

export function useAsyncAction<TArgs extends unknown[], TResult = void>(
  fn: AsyncFn<TArgs, TResult>,
  options: AsyncActionOptions<TArgs> = {}
): [(...args: TArgs) => Promise<TResult | undefined>, boolean, Error | null] {
  const { onError, onSuccess, throwOnError = false } = options;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(
    async (...args: TArgs): Promise<TResult | undefined> => {
      setLoading(true);
      setError(null);
      try {
        const result = await fn(...args);
        onSuccess?.();
        return result;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        onError?.(err, ...(args as any));
        if (throwOnError) throw err;
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fn, onError, onSuccess, throwOnError]
  );

  return [execute, loading, error];
}
