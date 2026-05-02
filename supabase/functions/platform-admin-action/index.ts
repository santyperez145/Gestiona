// Superadmin actions — only callable by platform_admins.
// Handles: extendTrial, changePlan, deleteOrg, addPlatformAdmin,
//          removePlatformAdmin, updatePlan, getUsers, toggleBanUser
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const authHeader = req.headers.get("Authorization");

    // Verify caller is authenticated
    const anon = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader || "" } },
    });
    const { data: { user } } = await anon.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "No autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service role client — bypasses RLS for all operations
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Verify caller is platform admin
    const { data: pa } = await admin
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!pa) {
      return new Response(JSON.stringify({ error: "Acceso denegado" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { action } = body;

    // ── GET USERS ─────────────────────────────────────────────────────────────
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

      const users = (authUsers?.users || []).map(u => ({
        id: u.id,
        email: u.email,
        name: u.user_metadata?.full_name || u.user_metadata?.name || "",
        createdAt: u.created_at,
        lastSignIn: u.last_sign_in_at,
        banned: u.banned_until ? new Date(u.banned_until) > new Date() : false,
        memberships: memByUser[u.id] || [],
      }));

      return new Response(JSON.stringify({ ok: true, users }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── EXTEND TRIAL ──────────────────────────────────────────────────────────
    if (action === "extendTrial") {
      const { orgId, days } = body;
      const { data: org } = await admin.from("organizations").select("trial_ends_at").eq("id", orgId).single();
      const base = org?.trial_ends_at ? new Date(org.trial_ends_at) : new Date();
      if (base < new Date()) base.setTime(new Date().getTime()); // if expired, start from today
      base.setDate(base.getDate() + (days || 7));
      await admin.from("organizations").update({ trial_ends_at: base.toISOString() }).eq("id", orgId);
      return new Response(JSON.stringify({ ok: true, newExpiry: base.toISOString() }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── CHANGE PLAN ───────────────────────────────────────────────────────────
    if (action === "changePlan") {
      const { orgId, planId } = body;
      await admin.from("organizations").update({ plan_id: planId }).eq("id", orgId);
      const { data: sub } = await admin.from("subscriptions").select("id").eq("org_id", orgId).maybeSingle();
      if (sub) {
        await admin.from("subscriptions").update({ plan_id: planId, status: "active" }).eq("id", sub.id);
      } else {
        await admin.from("subscriptions").insert({ org_id: orgId, plan_id: planId, status: "active" });
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── DELETE ORG ────────────────────────────────────────────────────────────
    if (action === "deleteOrg") {
      const { orgId } = body;
      // Delete in dependency order
      for (const table of ["sales", "purchases", "debts", "expenses", "notifications",
        "audit_logs", "products", "subscriptions", "memberships", "tiendanube_connections",
        "settings", "suppliers", "quotes"]) {
        await admin.from(table).delete().eq("org_id", orgId).then(() => {});
      }
      await admin.from("organizations").delete().eq("id", orgId);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── TOGGLE BAN USER ───────────────────────────────────────────────────────
    if (action === "toggleBanUser") {
      const { userId, ban } = body;
      if (ban) {
        await admin.auth.admin.updateUserById(userId, {
          ban_duration: "876600h", // 100 years
        });
      } else {
        await admin.auth.admin.updateUserById(userId, { ban_duration: "none" });
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── ADD PLATFORM ADMIN ────────────────────────────────────────────────────
    if (action === "addPlatformAdmin") {
      const { userId } = body;
      await admin.from("platform_admins").upsert({ user_id: userId });
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── REMOVE PLATFORM ADMIN ─────────────────────────────────────────────────
    if (action === "removePlatformAdmin") {
      const { userId } = body;
      if (userId === user.id) {
        return new Response(JSON.stringify({ error: "No podés quitarte el acceso a vos mismo" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await admin.from("platform_admins").delete().eq("user_id", userId);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── UPDATE PLAN ───────────────────────────────────────────────────────────
    if (action === "updatePlan") {
      const { planId, updates } = body;
      const allowed = ["name", "description", "price_usd_monthly", "price_usd_yearly",
        "max_products", "max_sales_per_month", "max_users", "ai_enabled",
        "backups_enabled", "custom_branding", "stripe_price_id_monthly",
        "stripe_price_id_yearly", "features"];
      const safe = Object.fromEntries(
        Object.entries(updates || {}).filter(([k]) => allowed.includes(k))
      );
      await admin.from("plans").update(safe).eq("id", planId);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── GET ORG DETAIL ────────────────────────────────────────────────────────
    if (action === "getOrgDetail") {
      const { orgId } = body;
      const [{ data: org }, { data: mems }, { data: salesCount }, { data: sub }] = await Promise.all([
        admin.from("organizations").select("*").eq("id", orgId).single(),
        admin.from("memberships").select("user_id, role").eq("org_id", orgId),
        admin.from("sales").select("id", { count: "exact", head: true }).eq("org_id", orgId),
        admin.from("subscriptions").select("*").eq("org_id", orgId).maybeSingle(),
      ]);
      return new Response(JSON.stringify({ ok: true, org, members: mems, salesCount, subscription: sub }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Acción desconocida: ${action}` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("platform-admin-action error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
