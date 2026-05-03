/**
 * In-memory sliding-window rate limiter for Supabase Edge Functions.
 *
 * Usage:
 *   import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimiter.ts";
 *
 *   const limited = checkRateLimit(req, "ai-analysis", { max: 10, windowMs: 60_000 });
 *   if (limited) return rateLimitResponse();
 */

interface Window {
  count: number;
  resetAt: number;
}

const store = new Map<string, Window>();

/**
 * Returns true if the request should be blocked.
 * Key = function name + IP (from CF-Connecting-IP or X-Forwarded-For).
 */
export function checkRateLimit(
  req: Request,
  fnName: string,
  opts: { max: number; windowMs: number },
): boolean {
  const ip =
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";

  const key = `${fnName}:${ip}`;
  const now = Date.now();

  const win = store.get(key);
  if (!win || now > win.resetAt) {
    store.set(key, { count: 1, resetAt: now + opts.windowMs });
    return false;
  }

  win.count += 1;
  if (win.count > opts.max) return true;
  return false;
}

export function rateLimitResponse(retryAfterSecs = 60): Response {
  return new Response(
    JSON.stringify({ error: "Too many requests. Please try again later." }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSecs),
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
