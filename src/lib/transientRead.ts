export interface PgError { code?: string; message?: string; status?: number }

type ReadResult = { error?: PgError | null; status?: number };
type RetryOptions = { delaysMs?: readonly number[]; maxAttempts?: number };

/** Codes take precedence: a SQL/JWT/schema error is not a transport outage. */
export function isTransientReadError(error: PgError | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  if (code) {
    return /^(PGRST00[0-3]|08[0-9A-Z]{3}|ECONNRESET|ECONNREFUSED|ENETUNREACH|ETIMEDOUT|EAI_AGAIN)$/i.test(code);
  }
  const status = Number(error.status);
  if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  return /failed to fetch|fetch failed|network|timed out|timeout|connection (?:reset|closed|refused)|temporarily unavailable|service unavailable/i.test(error.message ?? "");
}

/** Bounded retries for reads only; never wrap a non-idempotent mutation. */
export async function retryRead<T extends ReadResult>(read: () => PromiseLike<T>, options: RetryOptions = {}): Promise<T> {
  const delays = options.delaysMs ?? [150, 450];
  const maxAttempts = Math.max(1, options.maxAttempts ?? delays.length + 1);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const result = await read();
      // Supabase places the HTTP status on the result, not on its error object.
      const error = result.error ? { ...result.error, status: result.status ?? result.error.status } : null;
      if (!isTransientReadError(error) || attempt === maxAttempts - 1) return result;
    } catch (error) {
      if (!isTransientReadError(error as PgError) || attempt === maxAttempts - 1) throw error;
    }
    const delay = delays[Math.min(attempt, Math.max(0, delays.length - 1))] ?? 0;
    if (delay > 0) await new Promise<void>(resolve => setTimeout(resolve, delay));
  }
  throw new Error("No se pudo completar la lectura");
}

/** Callers must preserve a server-enforced idempotency key across attempts. */
export function retryIdempotentWrite<T extends ReadResult>(write: () => PromiseLike<T>, options: RetryOptions = {}): Promise<T> {
  return retryRead(write, { delaysMs: options.delaysMs ?? [300, 900], maxAttempts: options.maxAttempts ?? 3 });
}
