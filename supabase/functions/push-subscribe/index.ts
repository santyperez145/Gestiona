/**
 * push-subscribe — Save or update a Web Push subscription for the current user.
 *
 * POST body: { endpoint, p256dh, auth, org_id }
 *
 * Requires DB table:
 *   push_subscriptions (id uuid PK, org_id uuid, user_id uuid, endpoint text UNIQUE,
 *                        p256dh text, auth text, created_at timestamptz)
 *
 * Migration to run in Supabase SQL editor:
 *   CREATE TABLE IF NOT EXISTS push_subscriptions (
 *     id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 *     user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
 *     endpoint    text NOT NULL UNIQUE,
 *     p256dh      text NOT NULL,
 *     auth        text NOT NULL,
 *     created_at  timestamptz NOT NULL DEFAULT now()
 *   );
 *   ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "own subs" ON push_subscriptions
 *     USING (user_id = auth.uid());
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // Verify JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });

    const { data: { user }, error: authErr } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authErr || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });

    const { endpoint, p256dh, auth, org_id } = await req.json();
    if (!endpoint || !p256dh || !auth || !org_id) {
      return new Response(JSON.stringify({ error: "Missing fields" }), { status: 400, headers: CORS });
    }

    // Upsert subscription (unique on endpoint)
    const { error } = await supabase
      .from("push_subscriptions" as any)
      .upsert(
        { org_id, user_id: user.id, endpoint, p256dh, auth },
        { onConflict: "endpoint" }
      );

    if (error) throw error;
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
  } catch (err: any) {
    console.error("push-subscribe error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
});
