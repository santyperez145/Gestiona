// Superadmin actions — only callable by platform_admins.
// All mutating actions are logged to admin_audit_logs for accountability.
//
// Actions: extendTrial, changePlan, deleteOrg, addPlatformAdmin,
//          removePlatformAdmin, updatePlan, getUsers, toggleBanUser,
//          suspendOrg, reactivateOrg, getAdminLogs, getOrgActivity
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const ALLOWED_ORIGINS = [
  "https://exentryimports.vercel.app",
  "https://gestiona.app",
  "https://www.gestiona.app",
  "https://app.gestiona.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const FEATURE_FLAG_KEYS = ["checkout_brick"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getAllowedOrigins() {
  const configured = (Deno.env.get("PLATFORM_ALLOWED_ORIGINS") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set([...ALLOWED_ORIGINS, ...configured]);
}

function isAllowedOrigin(origin: string) {
  return getAllowedOrigins().has(origin);
}

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  };
  if (origin && isAllowedOrigin(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function jsonResponse(data: unknown, status: number, req: Request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  if (origin && !isAllowedOrigin(origin)) {
    return jsonResponse({ error: "Origen no permitido" }, 403, req);
  }
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) });
  }

  const json = (data: unknown, status = 200) => jsonResponse(data, status, req);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const authHeader = req.headers.get("Authorization");

    const anon = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader || "" } },
    });
    const { data: { user } } = await anon.auth.getUser();
    if (!user) return json({ error: "No autenticado" }, 401);

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const mailAuth = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: pa } = await admin
      .from("platform_admins")
      .select("user_id, role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!pa) return json({ error: "Acceso denegado" }, 403);

    const body = await req.json();
    const { action } = body;

    // La impersonación por magic link fue retirada: una sesión emitida como
    // otra persona conserva sus permisos más allá de cualquier ventana de
    // soporte. El reemplazo es el snapshot diagnóstico consentido y temporal.
    if (action === "generateMagicLink") {
      await admin.from("admin_audit_logs" as any).insert({
        admin_user_id: user.id,
        admin_email: user.email,
        action: "DENIED:generateMagicLink",
        details: { reason: "impersonation_retired" },
      }).then(() => {}, () => {});
      return json({ error: "La impersonación fue retirada. Solicitá diagnóstico desde Merchant 360." }, 410);
    }

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
      getFeatureFlags: ["support", "finance"],
      getProductAccess: ["support", "finance"],
      resetUserPassword: ["support"],
      sendOnboardingAccess: ["support"],
      // Facturación / planes
      extendTrial: ["finance"],
      changePlan: ["finance"],
      updatePlan: ["finance"],
      suspendOrg: ["finance"],
      reactivateOrg: ["finance"],
      setProductAccess: ["finance"],
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

    // ── CONTROLES DE LANZAMIENTO ──────────────────────────────
    // La UI nunca toca la tabla. Las escrituras llaman a un RPC que comprueba
    // superadmin y escribe su propia auditoría dentro de la misma transacción;
    // así no existe un estado de checkout cambiado sin evidencia de quién lo
    // hizo. Soporte/finanzas sólo pueden ver el alcance efectivo.
    if (action === "getFeatureFlags") {
      const [overridesResult, organizationsResult] = await Promise.all([
        admin
          .from("feature_flag_overrides" as any)
          .select("id, flag_key, org_id, enabled, reason, updated_at, updated_by, organization:organizations(name, slug)")
          .in("flag_key", FEATURE_FLAG_KEYS)
          .order("updated_at", { ascending: false }),
        admin
          .from("organizations")
          .select("id, name, slug")
          .order("name", { ascending: true })
          .limit(1000),
      ]);
      if (overridesResult.error) return json({ error: overridesResult.error.message }, 500);
      if (organizationsResult.error) return json({ error: organizationsResult.error.message }, 500);
      return json({
        ok: true,
        flags: FEATURE_FLAG_KEYS,
        overrides: overridesResult.data ?? [],
        organizations: organizationsResult.data ?? [],
      });
    }

    if (action === "setFeatureFlag" || action === "clearFeatureFlag") {
      const flagKey = typeof body.flagKey === "string" ? body.flagKey : "";
      const rawOrgId = body.orgId;
      const orgId = rawOrgId == null ? null : typeof rawOrgId === "string" && UUID_RE.test(rawOrgId) ? rawOrgId : undefined;
      if (!FEATURE_FLAG_KEYS.includes(flagKey as typeof FEATURE_FLAG_KEYS[number])) {
        return json({ error: "Control de lanzamiento no reconocido" }, 400);
      }
      if (orgId === undefined) return json({ error: "El comercio seleccionado no es válido" }, 400);

      if (action === "setFeatureFlag") {
        if (typeof body.enabled !== "boolean") return json({ error: "El estado del control es requerido" }, 400);
        const reason = typeof body.reason === "string" ? body.reason.trim() : null;
        if (reason && reason.length > 500) return json({ error: "La justificación supera los 500 caracteres" }, 400);
        const { data, error } = await admin.rpc("platform_feature_flag_configurar", {
          p_flag_key: flagKey,
          p_org_id: orgId,
          p_enabled: body.enabled,
          p_actor: user.id,
          p_actor_email: user.email ?? null,
          p_reason: reason || null,
        });
        if (error) return json({ error: error.message }, 409);
        return json({ ok: true, result: data });
      }

      const { data, error } = await admin.rpc("platform_feature_flag_eliminar", {
        p_flag_key: flagKey,
        p_org_id: orgId,
        p_actor: user.id,
        p_actor_email: user.email ?? null,
      });
      if (error) return json({ error: error.message }, 409);
      return json({ ok: true, result: data });
    }

    // ── ACCESO POR PRODUCTO ────────────────────────────────────
    // Entitlements no son feature flags ni permisos de usuario. Platform decide
    // si una organización tiene Finance; el tenant decide después quién lo usa
    // mediante finance.view. La función SQL repite el control del actor y audita
    // la transición en la misma transacción.
    if (action === "getProductAccess") {
      const orgId = typeof body.orgId === "string" && UUID_RE.test(body.orgId) ? body.orgId : "";
      if (!orgId) return json({ error: "El comercio seleccionado no es válido" }, 400);

      const { data, error } = await admin
        .from("organization_product_access" as any)
        .select("product_key,status,requested_at,decided_at,updated_at")
        .eq("org_id", orgId)
        .order("product_key");
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, products: data ?? [] });
    }

    if (action === "setProductAccess") {
      const orgId = typeof body.orgId === "string" && UUID_RE.test(body.orgId) ? body.orgId : "";
      const productKey = typeof body.productKey === "string" ? body.productKey : "";
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (!orgId) return json({ error: "El comercio seleccionado no es válido" }, 400);
      if (productKey !== "finance") return json({ error: "Producto no reconocido" }, 400);
      if (typeof body.enabled !== "boolean") return json({ error: "El estado del producto es requerido" }, 400);
      if (reason.length < 10 || reason.length > 500) return json({ error: "La decisión requiere un motivo de 10 a 500 caracteres" }, 400);

      const { data, error } = await admin.rpc("platform_product_access_set", {
        p_org_id: orgId,
        p_product_key: productKey,
        p_enabled: body.enabled,
        p_actor: user.id,
        p_reason: reason,
      });
      if (error) return json({ error: error.message }, 409);
      return json({ ok: true, status: data });
    }

    // ── REINTENTO MANUAL DE OUTBOX ────────────────────────────
    // Sólo superadmin llega acá: ACTION_ROLES no le delega esta operación a
    // soporte ni finanzas. La función SQL hace el cambio y el audit log en una
    // única transacción. No hay reintento de pagos desde plataforma: un cobro
    // ambiguo se resuelve en el flujo de pagos para no crear doble cargo.
    if (action === "retryOutboxDelivery") {
      const ticketId = typeof body.ticketId === "string" ? body.ticketId : "";
      if (!UUID_RE.test(ticketId)) {
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

      const users = (authUsers?.users || []).map((u) => {
        // `banned_until` existe en la respuesta administrativa de Auth, pero
        // no en la versión de tipo que expone este SDK de Edge.
        const bannedUntil = (u as typeof u & { banned_until?: string | null }).banned_until;
        return {
        id: u.id,
        email: u.email,
        name: u.user_metadata?.full_name || u.user_metadata?.name || "",
        createdAt: u.created_at,
        lastSignIn: u.last_sign_in_at,
        banned: bannedUntil ? new Date(bannedUntil) > new Date() : false,
        memberships: memByUser[u.id] || [],
        };
      });

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
      // ⚠️ Los precios en PESOS son los que se cobran: MercadoPago sólo cobra
      // ARS y `mp-subscribe` lee `price_ars_monthly`. Hasta 2026-08-27 esta
      // allowlist sólo dejaba escribir los de dólares, así que el dueño editaba
      // el precio en la consola y **no cambiaba nada**: el comercio seguía
      // viendo el ARS viejo y MercadoPago cobrando el ARS viejo.
      const allowed = ["name", "description",
        "price_ars_monthly", "price_ars_yearly",
        "price_usd_monthly", "price_usd_yearly",
        "max_products", "max_sales_per_month", "max_users", "ai_enabled",
        "backups_enabled", "custom_branding", "stripe_price_id_monthly",
        "stripe_price_id_yearly", "features"];
      const safe: Record<string, unknown> = Object.fromEntries(
        Object.entries(updates || {}).filter(([k]) => allowed.includes(k)),
      );
      // `price_ars_updated_at` existe para ver desde cuándo no se toca un precio
      // —con inflación, uno viejo es un descuento que nadie decidió—. Si se
      // actualizara a mano, mentiría en cuanto alguien edite por otra vía.
      if ("price_ars_monthly" in safe || "price_ars_yearly" in safe) {
        safe.price_ars_updated_at = new Date().toISOString();
      }
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

    // ── SEND ONBOARDING ACCESS ─────────────────────────────────
    // El correo sale por Supabase Auth; el staff nunca recibe el token ni una
    // URL capaz de abrir una sesión del owner.
    if (action === "sendOnboardingAccess") {
      const { userId, orgId } = body;
      if (typeof userId !== "string" || !UUID_RE.test(userId)) {
        return json({ error: "Usuario inválido" }, 400);
      }
      if (orgId != null && (typeof orgId !== "string" || !UUID_RE.test(orgId))) {
        return json({ error: "Organización inválida" }, 400);
      }
      const { data: target, error: targetError } = await admin.auth.admin.getUserById(userId);
      if (targetError || !target?.user?.email) {
        return json({ error: "No se encontró el email del owner" }, 404);
      }
      if (orgId) {
        const { data: ownerMembership, error: membershipError } = await admin
          .from("memberships")
          .select("id")
          .eq("org_id", orgId)
          .eq("user_id", userId)
          .eq("role", "owner")
          .maybeSingle();
        if (membershipError) return json({ error: "No se pudo validar el owner" }, 502);
        if (!ownerMembership) return json({ error: "El usuario no es owner de esa organización" }, 409);
      }
      const { error: deliveryError } = await mailAuth.auth.signInWithOtp({
        email: target.user.email,
        options: { shouldCreateUser: false },
      });
      if (deliveryError) {
        await logAction("sendOnboardingAccessFailed", {
          orgId,
          userId,
          details: { reason: "provider_rejected" },
        });
        return json({ error: "No se pudo enviar el acceso. La organización no fue modificada." }, 502);
      }
      await logAction("sendOnboardingAccess", {
        orgId,
        userId,
        details: { delivery: "email", token_exposed_to_staff: false },
      });
      return json({ ok: true, emailSent: true });
    }

    // ── CREATE ORG MANUALLY ────────────────────────────────────
    // Auth crea la identidad; un RPC autenticado crea atómicamente org,
    // membresía, suscripción, ajustes, idempotencia y auditoría. Si el RPC
    // falla, una identidad recién creada se compensa antes de responder.
    if (action === "createOrg") {
      const {
        name,
        ownerEmail,
        ownerName,
        planId,
        trialDays = 14,
        sendInvite = true,
        idempotencyKey,
      } = body;

      const normalizedName = typeof name === "string" ? name.trim() : "";
      const normalizedEmail = typeof ownerEmail === "string" ? ownerEmail.trim().toLowerCase() : "";
      const normalizedTrialDays = Number(trialDays);
      const normalizedPlanId = planId == null || planId === "" ? null : planId;
      if (!normalizedName || !normalizedEmail) {
        return json({ error: "Nombre de org y email del owner son requeridos" }, 400);
      }
      if (normalizedName.length < 2 || normalizedName.length > 120) {
        return json({ error: "El nombre debe tener entre 2 y 120 caracteres" }, 400);
      }
      if (normalizedEmail.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return json({ error: "Email del owner inválido" }, 400);
      }
      if (!Number.isInteger(normalizedTrialDays) || normalizedTrialDays < 0 || normalizedTrialDays > 365) {
        return json({ error: "Los días de trial deben estar entre 0 y 365" }, 400);
      }
      if (normalizedPlanId != null && (typeof normalizedPlanId !== "string" || !UUID_RE.test(normalizedPlanId))) {
        return json({ error: "Plan inicial inválido" }, 400);
      }
      if (typeof idempotencyKey !== "string" || !UUID_RE.test(idempotencyKey)) {
        return json({ error: "La clave idempotente del alta es inválida" }, 400);
      }

      // listUsers pagina: el primer millar no es una garantía de unicidad cuando
      // la plataforma crece. Nunca se crea un duplicado por dejar de paginar.
      let existingUser: { id: string; email?: string } | null = null;
      for (let page = 1; page <= 100; page += 1) {
        const { data: pageData, error: pageError } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (pageError) return json({ error: "No se pudo verificar la identidad del owner" }, 502);
        existingUser = pageData.users.find((candidate) => candidate.email?.toLowerCase() === normalizedEmail) || null;
        if (existingUser || pageData.users.length < 1000) break;
      }

      let ownerUserId = existingUser?.id || null;
      let createdAuthUser = false;
      if (!ownerUserId) {
        const { data: created, error: createError } = await admin.auth.admin.createUser({
          email: normalizedEmail,
          password: crypto.randomUUID() + crypto.randomUUID(),
          email_confirm: true,
          user_metadata: {
            full_name: typeof ownerName === "string" && ownerName.trim()
              ? ownerName.trim().slice(0, 120)
              : normalizedEmail.split("@")[0],
            account_type: "platform_invited_owner",
          },
        });
        if (createError || !created.user?.id) {
          return json({ error: "No se pudo crear la identidad del owner" }, 502);
        }
        ownerUserId = created.user.id;
        createdAuthUser = true;
      }

      const { data: provisioning, error: provisioningError } = await anon.rpc(
        "provision_platform_organization",
        {
          p_idempotency_key: idempotencyKey,
          p_owner_user_id: ownerUserId,
          p_name: normalizedName,
          p_plan_id: normalizedPlanId,
          p_trial_days: normalizedTrialDays,
        },
      );
      if (provisioningError) {
        if (createdAuthUser) await admin.auth.admin.deleteUser(ownerUserId).catch(() => undefined);
        const alreadyLinked = provisioningError.message.includes("already belongs");
        return json({
          error: alreadyLinked
            ? "Ese email ya pertenece a una organización. Usá un email de owner nuevo para no modificar otro negocio."
            : "No se pudo crear la organización de forma completa; no se guardaron datos parciales.",
        }, alreadyLinked ? 409 : 500);
      }

      const result = provisioning as {
        org_id?: string;
        owner_user_id?: string;
        created?: boolean;
      } | null;
      const orgId = result?.org_id;
      if (!orgId || !UUID_RE.test(orgId)) {
        return json({ error: "El servidor no confirmó la organización creada" }, 500);
      }

      let emailSent = false;
      if (sendInvite) {
        const { error: deliveryError } = await mailAuth.auth.signInWithOtp({
          email: normalizedEmail,
          options: { shouldCreateUser: false },
        });
        emailSent = !deliveryError;
        await logAction(emailSent ? "sendOnboardingAccess" : "sendOnboardingAccessFailed", {
          orgId,
          userId: ownerUserId,
          details: emailSent
            ? { delivery: "email", token_exposed_to_staff: false }
            : { reason: "provider_rejected" },
        });
      }

      return json({
        ok: true,
        orgId,
        ownerUserId,
        created: result?.created === true,
        emailSent,
        emailRequested: sendInvite === true,
      });
    }

    // ── CHECK SECRETS ──────────────────────────────────────────
    // Returns boolean map of which platform secrets are configured.
    // Never returns the actual values — safe to expose to platform admins.
    if (action === "checkSecrets") {
      /**
       * ⚠️ Esta lista habia quedado vieja, y de las dos maneras posibles.
       *
       * Medido el 2026-08-28 comparandola contra lo que las Edge Functions
       * REALMENTE leen con `Deno.env.get`:
       *
       *   - **Cuatro que se chequeaban y nadie usa**: TIENDANUBE_CLIENT_SECRET
       *     y los tres de TWILIO. WhatsApp pasó a la API oficial de Meta el
       *     2026-08-27 y Twilio nunca se conecto. Aparecian como «falta
       *     configurar» algo que no hace falta: ruido que enseña a ignorar el
       *     panel.
       *   - **Dieciseis que el codigo usa y no se chequeaban**, entre ellos
       *     `BACKUP_CRON_SECRET` —que desde el 2026-08-28 gatea las 19 tareas
       *     programadas— y `SMTP_PASSWORD`, del que depende todo el correo.
       *
       * 📌 La guarda es `losSecretosQueSeChequeanSeUsan.test.ts`, que compara
       * esta lista contra el codigo y falla cuando divergen. Mantenerla a mano
       * es como llegó a este estado.
       */
      const names = [
        // Inyectados por Supabase
        "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
        // IA
        "ANTHROPIC_API_KEY", "EXPENSE_RECEIPT_EXTRACTION_ENABLED",
        // Correo
        "RESEND_API_KEY", "FROM_EMAIL", "SMTP_PASSWORD", "RESEND_WEBHOOK_SECRET",
        // Cobros y suscripciones
        "MP_APP_ID", "MP_APP_SECRET", "MP_WEBHOOK_SECRET", "MP_PLATFORM_ACCESS_TOKEN",
        // Tareas programadas
        "BACKUP_CRON_SECRET",
        // WhatsApp (API oficial de Meta)
        "WHATSAPP_TOKEN",
        // Notificaciones push
        "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT",
        // Enlaces publicos y CORS
        "PUBLIC_BASE_URL", "PLATFORM_ALLOWED_ORIGINS",
        // Finance (opcionales: el buzon funciona sin extraccion automatica)
        "FINANCE_DOCUMENT_EXTRACTION_ENABLED", "FINANCE_DOCUMENT_MODEL",
        "FINANCE_DOCUMENT_SCANNER_URL", "FINANCE_DOCUMENT_SCANNER_TOKEN",
        // Stripe: sigue leido por `stripe-webhook`, que no se borro porque un
        // webhook puede tener un llamador externo que no se ve desde el codigo.
        "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
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
