// Superadmin actions — only callable by platform_admins.
// All mutating actions are logged to admin_audit_logs for accountability.
//
// Actions: extendTrial, changePlan, deleteOrg, addPlatformAdmin,
//          removePlatformAdmin, updatePlan, getUsers, toggleBanUser,
//          suspendOrg, reactivateOrg, getAdminLogs, getOrgActivity
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const ALLOWED_ORIGINS = [
  "https://gestiona.app",
  "https://www.gestiona.app",
  "https://app.gestiona.app",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  };
}

function json(data: unknown, status = 200, req?: Request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...(req ? getCorsHeaders(req) : {}), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: getCorsHeaders(req) });

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
      .select("user_id, role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!pa) return json({ error: "Acceso denegado" }, 403);

    const body = await req.json();
    const { action } = body;

    // ── Autorización por nivel de staff ────────────────────────
    // `superadmin` puede todo. `finance` toca planes y facturación.
    // `support` ve y asiste, pero no cambia plata ni destruye nada.
    // Una acción que no esté en el mapa queda reservada a superadmin.
    const platformRole: string = (pa as { role?: string }).role || "superadmin";
    const ACTION_ROLES: Record<string, string[]> = {
      // Lectura y asistencia
      getUsers: ["support", "finance"],
      getOrgDetail: ["support", "finance"],
      getOrgMembers: ["support", "finance"],
      getOrgActivity: ["support", "finance"],
      getAdminLogs: ["support", "finance"],
      checkSecrets: ["support", "finance"],
      generateMagicLink: ["support"],
      resetUserPassword: ["support"],
      // Facturación / planes
      extendTrial: ["finance"],
      changePlan: ["finance"],
      updatePlan: ["finance"],
      suspendOrg: ["finance"],
      reactivateOrg: ["finance"],
      // Sin entrada = sólo superadmin: deleteOrg, addPlatformAdmin,
      // removePlatformAdmin, toggleBanUser, updateMemberRole,
      // removeMember, createOrg.
    };

    if (platformRole !== "superadmin") {
      const allowed = ACTION_ROLES[action] || [];
      if (!allowed.includes(platformRole)) {
        await admin.from("admin_audit_logs" as any).insert({
          admin_user_id: user.id,
          admin_email: user.email,
          action: `DENIED:${action}`,
          details: { platformRole },
        }).then(() => {}, () => {});
        return json(
          { error: `Tu nivel de acceso (${platformRole}) no permite esta acción` },
          403,
        );
      }
    }

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

    /**
     * Un magic link puede abrir todas las organizaciones a las que pertenece
     * su destinatario. Guardamos ese alcance por organización ahora, no al leer
     * el log: si el miembro se va después, el dueño conserva la evidencia.
     *
     * A diferencia del audit log histórico, no se silencian errores acá. Entregar
     * un enlace sin poder dejar la trazabilidad comprometida sería peor que
     * devolver un error al operador.
     */
    const logMagicLinkAccess = async (targetUserId: string | undefined, details: unknown) => {
      if (!targetUserId) {
        const { error } = await admin.from("admin_audit_logs" as any).insert({
          admin_user_id: user.id,
          admin_email: user.email,
          action: "generateMagicLink",
          details,
        });
        if (error) throw new Error(`No se pudo registrar el magic link: ${error.message}`);
        return;
      }

      const { data: memberships, error: membershipsError } = await admin
        .from("memberships")
        .select("org_id")
        .eq("user_id", targetUserId);
      if (membershipsError) {
        throw new Error(`No se pudo resolver el alcance del magic link: ${membershipsError.message}`);
      }

      const auditRows: Array<Record<string, unknown>> = (memberships ?? []).map((membership: { org_id: string }) => ({
        admin_user_id: user.id,
        admin_email: user.email,
        action: "generateMagicLink",
        target_org_id: membership.org_id,
        target_user_id: targetUserId,
        details,
      }));

      // Un comprador de tienda puede no pertenecer a una organización. Se
      // conserva entonces la auditoría de plataforma, aunque no haya tenant al
      // que mostrársela.
      if (auditRows.length === 0) {
        auditRows.push({
          admin_user_id: user.id,
          admin_email: user.email,
          action: "generateMagicLink",
          target_org_id: null,
          target_user_id: targetUserId,
          details,
        });
      }

      const { error } = await admin.from("admin_audit_logs" as any).insert(auditRows);
      if (error) throw new Error(`No se pudo registrar el magic link: ${error.message}`);
    };

    // ── REINTENTO MANUAL DE OUTBOX ────────────────────────────
    // Sólo superadmin llega acá: ACTION_ROLES no le delega esta operación a
    // soporte ni finanzas. La función SQL hace el cambio y el audit log en una
    // única transacción. No hay reintento de pagos desde plataforma: un cobro
    // ambiguo se resuelve en el flujo de pagos para no crear doble cargo.
    if (action === "retryOutboxDelivery") {
      const ticketId = typeof body.ticketId === "string" ? body.ticketId : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ticketId)) {
        return json({ error: "El incidente de entrega no es válido" }, 400);
      }

      const { error } = await admin.rpc("platform_retry_outbox_delivery", {
        p_ticket_id: ticketId,
        p_admin_user_id: user.id,
        p_admin_email: user.email ?? null,
      });
      if (error) return json({ error: error.message }, 409);
      return json({ ok: true, ticketId });
    }

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
      const { userId, role = "support" } = body;
      if (!["superadmin", "support", "finance"].includes(role)) {
        return json({ error: "Nivel de plataforma inválido" }, 400);
      }
      await admin.from("platform_admins").upsert(
        { user_id: userId, role, granted_by: user.id },
        { onConflict: "user_id" },
      );
      await logAction("addPlatformAdmin", { userId, details: { role } });
      return json({ ok: true });
    }

    // ── SET PLATFORM ROLE ──────────────────────────────────────
    // Cambia el nivel de un miembro del staff ya existente.
    if (action === "setPlatformRole") {
      const { userId, role } = body;
      if (!["superadmin", "support", "finance"].includes(role)) {
        return json({ error: "Nivel de plataforma inválido" }, 400);
      }
      if (userId === user.id) {
        return json({ error: "No podés cambiar tu propio nivel de acceso" }, 400);
      }
      const { error } = await admin
        .from("platform_admins").update({ role }).eq("user_id", userId);
      if (error) return json({ error: error.message }, 500);
      await logAction("setPlatformRole", { userId, details: { role } });
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

    // ── GET ORG MEMBERS ────────────────────────────────────────
    if (action === "getOrgMembers") {
      const { orgId } = body;
      const { data: mems } = await admin
        .from("memberships")
        .select("user_id, role")
        .eq("org_id", orgId);

      const userIds = (mems || []).map((m) => m.user_id);
      const memberInfo: any[] = [];
      for (const uid of userIds) {
        const { data: u } = await admin.auth.admin.getUserById(uid);
        const m = mems!.find((x) => x.user_id === uid)!;
        memberInfo.push({
          user_id: uid,
          email: u?.user?.email || "",
          name: u?.user?.user_metadata?.full_name || "",
          role: m.role,
        });
      }
      return json({ ok: true, members: memberInfo });
    }

    // ── UPDATE MEMBER ROLE ─────────────────────────────────────
    if (action === "updateMemberRole") {
      const { orgId, userId, role } = body;
      if (!["owner", "admin", "vendedor", "viewer"].includes(role)) {
        return json({ error: "Rol inválido" }, 400);
      }
      const { error } = await admin
        .from("memberships")
        .update({ role })
        .eq("org_id", orgId)
        .eq("user_id", userId);
      if (error) return json({ error: error.message }, 500);
      await logAction("updateMemberRole", { orgId, userId, details: { role } });
      return json({ ok: true });
    }

    // ── REMOVE MEMBER ──────────────────────────────────────────
    if (action === "removeMember") {
      const { orgId, userId } = body;
      // Prevent removing the org owner
      const { data: org } = await admin.from("organizations").select("owner_user_id").eq("id", orgId).single();
      if (org?.owner_user_id === userId) {
        return json({ error: "No podés remover al owner de la organización" }, 400);
      }
      const { error } = await admin
        .from("memberships")
        .delete()
        .eq("org_id", orgId)
        .eq("user_id", userId);
      if (error) return json({ error: error.message }, 500);
      await logAction("removeMember", { orgId, userId });
      return json({ ok: true });
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

    // ── GENERATE MAGIC LINK (impersonate or assist) ────────────
    // Issues a one-time magic link for a user. Useful for:
    //   - Support: log in as the user to reproduce issues ("Ver como")
    //   - Onboarding: send a passwordless invite to a new user
    if (action === "generateMagicLink") {
      const { userId, email: emailParam, type = "magiclink" } = body;
      let targetEmail = emailParam;
      if (!targetEmail && userId) {
        const { data: u } = await admin.auth.admin.getUserById(userId);
        targetEmail = u?.user?.email;
      }
      if (!targetEmail) return json({ error: "Email o userId requerido" }, 400);

      const { data, error } = await admin.auth.admin.generateLink({
        type,
        email: targetEmail,
      });
      if (error) return json({ error: error.message }, 500);

      await logMagicLinkAccess(userId, { email: targetEmail, type });
      return json({
        ok: true,
        email: targetEmail,
        action_link: data?.properties?.action_link,
        hashed_token: data?.properties?.hashed_token,
      });
    }

    // ── RESET USER PASSWORD ────────────────────────────────────
    // Sends a password recovery email to the user.
    if (action === "resetUserPassword") {
      const { userId } = body;
      const { data: u } = await admin.auth.admin.getUserById(userId);
      if (!u?.user?.email) return json({ error: "Usuario sin email" }, 400);

      const { error } = await admin.auth.resetPasswordForEmail(u.user.email);
      if (error) return json({ error: error.message }, 500);

      await logAction("resetUserPassword", { userId, details: { email: u.user.email } });
      return json({ ok: true, email: u.user.email });
    }

    // ── CREATE ORG MANUALLY ────────────────────────────────────
    // Used by platform admins to create an org on behalf of a customer.
    // Creates the org, optionally creates/invites the owner user, and
    // assigns the requested plan with optional custom trial extension.
    if (action === "createOrg") {
      const {
        name,
        ownerEmail,
        ownerName,
        planId,
        trialDays = 14,
        sendInvite = true,
      } = body;

      if (!name?.trim() || !ownerEmail?.trim()) {
        return json({ error: "Nombre de org y email del owner son requeridos" }, 400);
      }

      // Find or create the owner user
      let ownerUserId: string | null = null;
      const { data: existingUsers } = await admin.auth.admin.listUsers({ perPage: 1000 });
      const existing = existingUsers?.users.find((u) => u.email?.toLowerCase() === ownerEmail.toLowerCase());

      if (existing) {
        ownerUserId = existing.id;
      } else {
        // Create user with auto-generated password — they'll set it via magic link
        const tempPassword = crypto.randomUUID();
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email: ownerEmail,
          password: tempPassword,
          email_confirm: true,
          user_metadata: { full_name: ownerName || ownerEmail.split("@")[0] },
        });
        if (createErr) return json({ error: `Error creando usuario: ${createErr.message}` }, 500);
        ownerUserId = created.user?.id || null;
      }

      if (!ownerUserId) return json({ error: "No se pudo determinar el owner" }, 500);

      // The trigger handle_new_user_create_org() only fires on signup, so if the
      // user already existed we need to create the org manually. If they didn't,
      // the trigger already created one — we update it instead.
      let orgId: string | null = null;
      const { data: ownedOrg } = await admin
        .from("organizations")
        .select("id")
        .eq("owner_user_id", ownerUserId)
        .maybeSingle();

      if (ownedOrg) {
        orgId = ownedOrg.id;
        await admin
          .from("organizations")
          .update({ name, trial_ends_at: new Date(Date.now() + trialDays * 86400000).toISOString() })
          .eq("id", orgId);
      } else {
        // Generate a slug (strip diacritics, normalize to a-z 0-9 - )
        const slug = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
          .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)
          + "-" + Math.random().toString(36).slice(2, 8);

        const { data: newOrg, error: orgErr } = await admin
          .from("organizations")
          .insert({
            name,
            slug,
            owner_user_id: ownerUserId,
            plan_id: planId || null,
            trial_ends_at: new Date(Date.now() + trialDays * 86400000).toISOString(),
          })
          .select("id")
          .single();
        if (orgErr) return json({ error: `Error creando org: ${orgErr.message}` }, 500);
        orgId = newOrg.id;

        await admin.from("memberships").insert({
          org_id: orgId, user_id: ownerUserId, role: "owner",
        });

        await admin.from("subscriptions").insert({
          org_id: orgId,
          plan_id: planId || null,
          status: "trialing",
          current_period_end: new Date(Date.now() + trialDays * 86400000).toISOString(),
        });

        await admin.from("settings").upsert({
          org_id: orgId, user_id: ownerUserId, business_name: name,
        }, { onConflict: "org_id" });
      }

      // Optionally change the plan if requested (for existing orgs)
      if (planId && ownedOrg) {
        await admin.from("subscriptions")
          .update({ plan_id: planId, status: "trialing" })
          .eq("org_id", orgId);
      }

      // Send magic link to onboard the owner
      let inviteLink: string | undefined;
      if (sendInvite) {
        const { data: linkData } = await admin.auth.admin.generateLink({
          type: existing ? "magiclink" : "invite",
          email: ownerEmail,
        });
        inviteLink = linkData?.properties?.action_link;
      }

      await logAction("createOrg", { orgId, userId: ownerUserId, details: { name, ownerEmail, planId, trialDays } });
      return json({ ok: true, orgId, ownerUserId, inviteLink, existing: !!existing });
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
