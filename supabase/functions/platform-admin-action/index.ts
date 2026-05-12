// Superadmin actions — only callable by platform_admins.
// All mutating actions are logged to admin_audit_logs for accountability.
//
// Actions: extendTrial, changePlan, deleteOrg, addPlatformAdmin,
//          removePlatformAdmin, updatePlan, getUsers, toggleBanUser,
//          suspendOrg, reactivateOrg, getAdminLogs, getOrgActivity
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const authHeader = req.headers.get("Authorization");

    const anon = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader || "" } },
    });
    const { data: { user } } = await anon.auth.getUser();
    if (!user) return json({ error: "No autenticado" }, 401);

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: pa } = await admin
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!pa) return json({ error: "Acceso denegado" }, 403);

    const body = await req.json();
    const { action } = body;

    // ── Helper: log admin action ───────────────────────────────
    const logAction = async (
      act: string,
      opts: { orgId?: string; userId?: string; details?: unknown } = {},
    ) => {
      try {
        await admin.from("admin_audit_logs" as any).insert({
          admin_user_id: user.id,
          admin_email: user.email,
          action: act,
          target_org_id: opts.orgId || null,
          target_user_id: opts.userId || null,
          details: opts.details ?? null,
        });
      } catch { /* silent */ }
    };

    // ── GET USERS ──────────────────────────────────────────────
    if (action === "getUsers") {
      const { data: authUsers } = await admin.auth.admin.listUsers({ perPage: 1000 });
      const { data: memberships } = await admin
        .from("memberships")
        .select("user_id, role, org_id, organization:organizations(name)");

      const memByUser: Record<string, any[]> = {};
      (memberships || []).forEach((m: any) => {
        if (!memByUser[m.user_id]) memByUser[m.user_id] = [];
        memByUser[m.user_id].push({ role: m.role, orgName: m.organization?.name });
      });

      const users = (authUsers?.users || []).map((u) => ({
        id: u.id,
        email: u.email,
        name: u.user_metadata?.full_name || u.user_metadata?.name || "",
        createdAt: u.created_at,
        lastSignIn: u.last_sign_in_at,
        banned: u.banned_until ? new Date(u.banned_until) > new Date() : false,
        memberships: memByUser[u.id] || [],
      }));

      return json({ ok: true, users });
    }

    // ── EXTEND TRIAL ───────────────────────────────────────────
    if (action === "extendTrial") {
      const { orgId, days } = body;
      const { data: org } = await admin.from("organizations").select("trial_ends_at").eq("id", orgId).single();
      const base = org?.trial_ends_at ? new Date(org.trial_ends_at) : new Date();
      if (base < new Date()) base.setTime(new Date().getTime());
      base.setDate(base.getDate() + (days || 7));
      await admin.from("organizations").update({ trial_ends_at: base.toISOString() }).eq("id", orgId);
      await logAction("extendTrial", { orgId, details: { days, newExpiry: base.toISOString() } });
      return json({ ok: true, newExpiry: base.toISOString() });
    }

    // ── CHANGE PLAN ────────────────────────────────────────────
    if (action === "changePlan") {
      const { orgId, planId } = body;
      await admin.from("organizations").update({ plan_id: planId }).eq("id", orgId);
      const { data: sub } = await admin.from("subscriptions").select("id").eq("org_id", orgId).maybeSingle();
      if (sub) {
        await admin.from("subscriptions").update({ plan_id: planId, status: "active" }).eq("id", sub.id);
      } else {
        await admin.from("subscriptions").insert({ org_id: orgId, plan_id: planId, status: "active" });
      }
      await logAction("changePlan", { orgId, details: { planId } });
      return json({ ok: true });
    }

    // ── SUSPEND ORG ────────────────────────────────────────────
    if (action === "suspendOrg") {
      const { orgId } = body;
      if (!orgId) return json({ error: "orgId requerido" }, 400);
      const { data: sub, error: subErr } = await admin
        .from("subscriptions").select("id").eq("org_id", orgId).maybeSingle();
      if (subErr) return json({ error: subErr.message }, 500);
      if (sub) {
        const { error: updErr } = await admin
          .from("subscriptions").update({ status: "paused" }).eq("id", sub.id);
        if (updErr) return json({ error: updErr.message }, 500);
      }
      await logAction("suspendOrg", { orgId });
      return json({ ok: true });
    }

    // ── REACTIVATE ORG ─────────────────────────────────────────
    if (action === "reactivateOrg") {
      const { orgId } = body;
      if (!orgId) return json({ error: "orgId requerido" }, 400);
      const { data: sub, error: subErr } = await admin
        .from("subscriptions").select("id").eq("org_id", orgId).maybeSingle();
      if (subErr) return json({ error: subErr.message }, 500);
      if (sub) {
        const { error: updErr } = await admin
          .from("subscriptions").update({ status: "active" }).eq("id", sub.id);
        if (updErr) return json({ error: updErr.message }, 500);
      }
      await logAction("reactivateOrg", { orgId });
      return json({ ok: true });
    }

    // ── DELETE ORG ─────────────────────────────────────────────
    if (action === "deleteOrg") {
      const { orgId } = body;
      const { data: orgInfo } = await admin.from("organizations").select("name").eq("id", orgId).maybeSingle();
      for (const table of ["sales", "purchases", "debts", "expenses", "notifications",
        "audit_logs", "products", "subscriptions", "memberships", "tiendanube_connections",
        "settings", "suppliers", "quotes"]) {
        await admin.from(table).delete().eq("org_id", orgId).then(() => {});
      }
      await admin.from("organizations").delete().eq("id", orgId);
      await logAction("deleteOrg", { details: { orgId, orgName: orgInfo?.name } });
      return json({ ok: true });
    }

    // ── TOGGLE BAN USER ────────────────────────────────────────
    if (action === "toggleBanUser") {
      const { userId, ban } = body;
      if (ban) {
        await admin.auth.admin.updateUserById(userId, { ban_duration: "876600h" });
      } else {
        await admin.auth.admin.updateUserById(userId, { ban_duration: "none" });
      }
      await logAction("toggleBanUser", { userId, details: { ban } });
      return json({ ok: true });
    }

    // ── ADD PLATFORM ADMIN ─────────────────────────────────────
    if (action === "addPlatformAdmin") {
      const { userId } = body;
      await admin.from("platform_admins").upsert({ user_id: userId });
      await logAction("addPlatformAdmin", { userId });
      return json({ ok: true });
    }

    // ── REMOVE PLATFORM ADMIN ──────────────────────────────────
    if (action === "removePlatformAdmin") {
      const { userId } = body;
      if (userId === user.id) return json({ error: "No podés quitarte el acceso a vos mismo" }, 400);
      await admin.from("platform_admins").delete().eq("user_id", userId);
      await logAction("removePlatformAdmin", { userId });
      return json({ ok: true });
    }

    // ── UPDATE PLAN ────────────────────────────────────────────
    if (action === "updatePlan") {
      const { planId, updates } = body;
      const allowed = ["name", "description", "price_usd_monthly", "price_usd_yearly",
        "max_products", "max_sales_per_month", "max_users", "ai_enabled",
        "backups_enabled", "custom_branding", "stripe_price_id_monthly",
        "stripe_price_id_yearly", "features"];
      const safe = Object.fromEntries(
        Object.entries(updates || {}).filter(([k]) => allowed.includes(k)),
      );
      await admin.from("plans").update(safe).eq("id", planId);
      await logAction("updatePlan", { details: { planId, updates: safe } });
      return json({ ok: true });
    }

    // ── GET ORG DETAIL ─────────────────────────────────────────
    if (action === "getOrgDetail") {
      const { orgId } = body;
      const [{ data: org }, { data: mems }, { count: salesCount }, { data: sub }] = await Promise.all([
        admin.from("organizations").select("*").eq("id", orgId).single(),
        admin.from("memberships").select("user_id, role").eq("org_id", orgId),
        admin.from("sales").select("id", { count: "exact", head: true }).eq("org_id", orgId),
        admin.from("subscriptions").select("*").eq("org_id", orgId).maybeSingle(),
      ]);
      return json({ ok: true, org, members: mems, salesCount, subscription: sub });
    }

    // ── GET ORG ACTIVITY ──────────────────────────────────────
    if (action === "getOrgActivity") {
      const { orgId } = body;
      const [
        { data: recentSales },
        { count: totalSales },
        { count: totalProducts },
        { count: totalDebts },
      ] = await Promise.all([
        admin.from("sales").select("id,date,total_ars,product_name").eq("org_id", orgId)
          .order("date", { ascending: false }).limit(5),
        admin.from("sales").select("id", { count: "exact", head: true }).eq("org_id", orgId),
        admin.from("products").select("id", { count: "exact", head: true }).eq("org_id", orgId),
        admin.from("debts").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("paid", false),
      ]);
      return json({ ok: true, recentSales, totalSales, totalProducts, totalDebts });
    }

    // ── GET ADMIN LOGS ─────────────────────────────────────────
    if (action === "getAdminLogs") {
      const { limit = 50 } = body;
      const { data: logs } = await admin
        .from("admin_audit_logs" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      return json({ ok: true, logs: logs || [] });
    }

    // ── CHECK SECRETS ──────────────────────────────────────────
    // Returns boolean map of which platform secrets are configured.
    // Never returns the actual values — safe to expose to platform admins.
    if (action === "checkSecrets") {
      const names = [
        "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
        "ANTHROPIC_API_KEY", "RESEND_API_KEY", "FROM_EMAIL",
        "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "MP_WEBHOOK_SECRET",
        "TIENDANUBE_CLIENT_SECRET",
        "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_FROM",
      ];
      const secrets: Record<string, boolean> = {};
      for (const n of names) {
        const v = Deno.env.get(n);
        secrets[n] = !!v && v.trim() !== "";
      }
      return json({ ok: true, secrets });
    }

    return json({ error: `Acción desconocida: ${action}` }, 400);
  } catch (e) {
    console.error("platform-admin-action error:", e);
    return json({ error: e instanceof Error ? e.message : "Error" }, 500);
  }
});
