/**
 * execute-automations — Runs all active automation flows for all orgs
 *
 * Trigger types handled:
 *   customer_inactive  → customers with no sales in X days
 *   debt_overdue       → debts unpaid past due_date + X days
 *   low_stock          → products with stock <= threshold
 *   stock_out          → products with stock = 0
 *   birthday           → customers with birthday today or in X days
 *   new_customer       → customers created in last X days (first run only)
 *   big_sale           → sales with total_ars >= threshold today
 *
 * Action types handled:
 *   notification       → creates notification for org admins
 *   create_task        → creates a task record
 *   email              → sends email via own SMTP or Resend fallback
 *   whatsapp_message   → sends WhatsApp via Meta Cloud (platform number)
 *   webhook            → calls the org's configured webhook URL
 *   create_purchase_order → creates idempotent draft purchase orders
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enviarWhatsApp } from "../_shared/whatsapp.ts";
import { sendEmail, smtpDeOrganizacion } from "../_shared/smtpSender.ts";
import { deliverOutboundEvent } from "../_shared/outboundWebhook.ts";

import { esLlamadaDeCron, exigirCronOUsuario } from "../_shared/cronAuth.ts";
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "noreply@nerqia.app";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
// PostgreSQL acepta el formato UUID canónico completo. No se limita a v1-v5:
// UUIDv7 es válido bajo RFC 9562 y ya se usa para claves ordenables por tiempo.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function argentinaDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Sólo el cron de la base o una persona con sesión real.
  const vieneDelCron = esLlamadaDeCron(req);
  const noEsCron = await exigirCronOUsuario(req, corsHeaders);
  if (noEsCron) return noEsCron;

  // Optionally target a single org/flow (for "Run now" from UI)
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const targetOrgId: string | undefined = body.org_id;
  const targetFlowId: string | undefined = body.flow_id;
  const requestedMode = body.mode ?? "execute";
  if (requestedMode !== "execute" && requestedMode !== "preview") {
    return json({ error: "El modo de automatización no es válido" }, 400);
  }
  const previewOnly = requestedMode === "preview";
  if (previewOnly && vieneDelCron) {
    return json({ error: "El cron no ejecuta pruebas interactivas" }, 400);
  }

  // La rama cron recorre todas las organizaciones. La rama humana nunca: debe
  // declarar tenant y tener permiso de edición de Marketing. Antes, cualquier
  // usuario con sesión podía mandar el org_id de otro comercio y ejecutar sus
  // automatizaciones porque la consulta posterior usa service_role.
  if (!vieneDelCron) {
    if (!targetOrgId) {
      return json({ error: "La organización es obligatoria" }, 400);
    }
    if (!UUID.test(targetOrgId)) {
      return json({ error: "La organización activa no es válida. Recargá la página." }, 400);
    }
    if (targetFlowId && !UUID.test(targetFlowId)) {
      return json({ error: "La automatización indicada no es válida" }, 400);
    }
    if (previewOnly && !targetFlowId) {
      return json({ error: "Elegí una automatización para probar" }, 400);
    }
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } },
    );
    const { data: allowed, error: permissionError } = await authClient.rpc("has_permission", {
      p_org_id: targetOrgId,
      p_module: "marketing",
      p_action: "edit",
    });
    if (permissionError) {
      console.error("execute-automations permission:", permissionError);
      return json({ error: "No se pudo verificar el permiso" }, 500);
    }
    if (!allowed) return json({ error: "No tenés permiso para ejecutar automatizaciones" }, 403);
  }

  try {
    // Load active flows
    let query = (supabase as any)
      .from("automation_flows")
      .select("*");
    // Una prueba puede evaluar un flujo pausado antes de activarlo. Las
    // ejecuciones reales y el cron conservan el filtro de activos.
    if (!previewOnly) query = query.eq("active", true);
    if (targetOrgId) query = query.eq("org_id", targetOrgId);
    if (targetFlowId) query = query.eq("id", targetFlowId);

    const { data: flows, error: flowsErr } = await query;
    if (flowsErr) throw flowsErr;

    if (previewOnly && !(flows ?? []).length) {
      return json({ error: "La automatización ya no está disponible" }, 404);
    }

    const now = new Date();
    let totalRuns = 0;
    const runResults: Array<{
      flow_id: string;
      flow_name: string;
      status: "success" | "error" | "skipped";
      entities_matched: number;
      actions_taken: number;
      message: string | null;
    }> = [];
    const previews: Array<{
      flow_id: string;
      flow_name: string;
      trigger_type: string;
      action_type: string;
      matched_count: number;
      sample: Array<{ label: string; detail: string | null }>;
    }> = [];

    for (const flow of flows ?? []) {
      const orgId: string = flow.org_id;
      const tc = flow.trigger_config ?? {};
      const ac = flow.action_config ?? {};

      let matchedEntities: { id: string; name: string; extra?: string }[] = [];
      let status: "success" | "error" | "skipped" = "success";
      let errorMessage: string | undefined;
      let actionsTaken = 0;

      try {
        // ── Evaluate trigger ───────────────────────────────────────────────
        if (flow.trigger_type === "customer_inactive") {
          const days = Number(tc.days) || 30;
          const cutoff = new Date(now.getTime() - days * 86400000).toISOString();
          const { data: recentSales, error: recentSalesError } = await supabase
            .from("sales")
            .select("customer_name")
            .eq("org_id", orgId)
            .gte("created_at", cutoff);
          if (recentSalesError) throw recentSalesError;
          const active = new Set((recentSales ?? []).map((s: any) => s.customer_name).filter(Boolean));
          const { data: customers, error: customersError } = await supabase
            .from("customers")
            .select("id, name")
            .eq("org_id", orgId);
          if (customersError) throw customersError;
          matchedEntities = (customers ?? [])
            .filter((c: any) => !active.has(c.name))
            .map((c: any) => ({ id: c.id, name: c.name }));

        } else if (flow.trigger_type === "debt_overdue") {
          const graceDays = Number(tc.days_overdue ?? tc.grace_days) || 0;
          const cutoff = new Date(now.getTime() - graceDays * 86400000).toISOString().slice(0, 10);
          const { data: debts, error: debtsError } = await supabase
            .from("debts")
            .select("id, customer_name, remaining_ars, due_date")
            .eq("org_id", orgId)
            .in("status", ["pending", "partial"])
            .lte("due_date", cutoff);
          if (debtsError) throw debtsError;
          matchedEntities = (debts ?? []).map((d: any) => ({
            id: d.id,
            name: d.customer_name,
            extra: `$${Number(d.remaining_ars).toLocaleString("es-AR")}`,
          }));

        } else if (flow.trigger_type === "low_stock") {
          const threshold = Number(tc.threshold) || 5;
          const { data: prods, error: productsError } = await supabase
            .from("products")
            .select("id, name, stock")
            .eq("org_id", orgId)
            .lte("stock", threshold)
            .gt("stock", 0);
          if (productsError) throw productsError;
          matchedEntities = (prods ?? []).map((p: any) => ({
            id: p.id,
            name: p.name,
            extra: `${p.stock} unidades`,
          }));

        } else if (flow.trigger_type === "stock_out") {
          const { data: prods, error: productsError } = await supabase
            .from("products")
            .select("id, name")
            .eq("org_id", orgId)
            .eq("stock", 0);
          if (productsError) throw productsError;
          matchedEntities = (prods ?? []).map((p: any) => ({ id: p.id, name: p.name }));

        } else if (flow.trigger_type === "birthday") {
          const daysAhead = Number(tc.days_ahead) || 3;
          const today = now;
          const { data: customers, error: customersError } = await supabase
            .from("customers")
            .select("id, name, birthday")
            .eq("org_id", orgId)
            .not("birthday", "is", null);
          if (customersError) throw customersError;
          matchedEntities = (customers ?? []).filter((c: any) => {
            if (!c.birthday) return false;
            const bd = new Date(c.birthday);
            const thisYear = new Date(today.getFullYear(), bd.getMonth(), bd.getDate());
            const diff = Math.round((thisYear.getTime() - today.getTime()) / 86400000);
            return diff >= 0 && diff <= daysAhead;
          }).map((c: any) => ({ id: c.id, name: c.name }));

        } else if (flow.trigger_type === "new_customer") {
          const days = Number(tc.days) || 1;
          const cutoff = new Date(now.getTime() - days * 86400000).toISOString();
          const { data: customers, error: customersError } = await supabase
            .from("customers")
            .select("id, name")
            .eq("org_id", orgId)
            .gte("created_at", cutoff);
          if (customersError) throw customersError;
          matchedEntities = (customers ?? []).map((c: any) => ({ id: c.id, name: c.name }));

        } else if (flow.trigger_type === "big_sale") {
          const threshold = Number(tc.min_amount ?? tc.threshold) || 10000;
          const today = now.toISOString().slice(0, 10);
          const { data: sales, error: salesError } = await supabase
            .from("sales")
            .select("id, customer_name, total_ars")
            .eq("org_id", orgId)
            .gte("date", today)
            .gte("total_ars", threshold);
          if (salesError) throw salesError;
          matchedEntities = (sales ?? []).map((s: any) => ({
            id: s.id,
            name: s.customer_name || "Cliente",
            extra: `$${Number(s.total_ars).toLocaleString("es-AR")}`,
          }));
        }

        // El modo prueba termina antes de cualquier acción, log o actualización
        // de last_run_at. Usa datos reales del tenant, pero es side-effect free.
        if (previewOnly) {
          previews.push({
            flow_id: flow.id,
            flow_name: flow.name,
            trigger_type: flow.trigger_type,
            action_type: flow.action_type,
            matched_count: matchedEntities.length,
            sample: matchedEntities.slice(0, 5).map((entity) => ({
              label: entity.name,
              detail: entity.extra ?? null,
            })),
          });
          continue;
        }

        if (matchedEntities.length === 0) {
          status = "skipped";
        } else {
          // ── Execute action ───────────────────────────────────────────────
          // Get admin user_ids for this org
          const { data: members, error: membersError } = await supabase
            .from("memberships")
            .select("user_id")
            .eq("org_id", orgId)
            // ⚠️ El dueño también. Acá decía `.eq("role","admin")`, así que en un
        // comercio de una sola persona —todo comercio nuevo— la lista quedaba
        // vacía y no se mandaba **ninguna** alerta.
        .in("role", ["owner", "admin"]);
          if (membersError) throw membersError;
          const adminIds = (members ?? []).map((m: any) => m.user_id);

          // Dedup: only notify for entities we haven't notified about in last 24h
          const cutoff24h = new Date(now.getTime() - 86400000).toISOString();
          const { data: recentNotifs, error: recentNotifsError } = await supabase
            .from("notifications")
            // ⚠️ También el `user_id`: sin él la deduplicación es global entre
            // personas y una alerta que ya vio un admin no le llega a nadie más.
            .select("user_id, message")
            .in("user_id", adminIds.length > 0 ? adminIds : ["00000000-0000-0000-0000-000000000000"])
            .gte("created_at", cutoff24h);
          if (recentNotifsError) throw recentNotifsError;
          const recentMsgs = new Set(
            (recentNotifs ?? []).map((n: any) => `${n.user_id}|${n.message}`),
          );

          // Build notification text
          const entitiesStr = matchedEntities.slice(0, 5).map(e =>
            e.extra ? `${e.name} (${e.extra})` : e.name
          ).join(", ");
          const more = matchedEntities.length > 5 ? ` y ${matchedEntities.length - 5} más` : "";
          const msgText = `${ac.message || flow.name}: ${entitiesStr}${more}`;

          if (["notification", "create_task"].includes(flow.action_type) && adminIds.length === 0) {
            status = "error";
            errorMessage = "No se encontró un responsable para recibir la acción";
          } else if (flow.action_type === "notification" && adminIds.length > 0) {
            const toInsert = adminIds
              .filter((uid: string) => !recentMsgs.has(`${uid}|${msgText}`))
              .map((uid: string) => ({
                // ⚠️ `notifications.org_id` es NOT NULL y faltaba: el insert
                // fallaba con 23502 y el error se tragaba, así que la
                // automatización decía haber notificado sin escribir nada.
                org_id: orgId,
                user_id: uid,
                type: "sistema",
                title: flow.name,
                message: msgText,
                read: false,
              }));
            if (toInsert.length > 0) {
              const { error: errNotif } = await supabase
                .from("notifications").insert(toInsert);
              if (errNotif) throw errNotif;
              actionsTaken = toInsert.length;
            }

          } else if (flow.action_type === "create_task" && adminIds.length > 0) {
            const taskTitle = ac.task_title || flow.name;
            const taskPriority = ["low", "medium", "high", "urgent"].includes(ac.task_priority)
              ? ac.task_priority
              : "medium";
            const taskDueDays = Math.min(365, Math.max(0, Number(ac.task_due_days) || 1));
            const candidateTasks = matchedEntities.slice(0, 10).map((entity) => ({
              org_id: orgId,
              created_by: adminIds[0],
              assigned_to: adminIds[0],
              title: `${taskTitle}: ${entity.name}${entity.extra ? ` (${entity.extra})` : ""}`,
              priority: taskPriority,
              due_date: new Date(now.getTime() + taskDueDays * 86400000).toISOString().slice(0, 10),
              category: "Automatización",
            }));
            const { data: existingTasks, error: existingTasksError } = await supabase
              .from("tasks")
              .select("title")
              .eq("org_id", orgId)
              .gte("created_at", cutoff24h)
              .in("title", candidateTasks.map((task) => task.title));
            if (existingTasksError) throw existingTasksError;
            const existingTitles = new Set((existingTasks ?? []).map((task: any) => task.title));
            const tasksToInsert = candidateTasks.filter((task) => !existingTitles.has(task.title));
            if (tasksToInsert.length > 0) {
              const { error: taskError } = await supabase.from("tasks").insert(tasksToInsert);
              if (taskError) throw taskError;
              actionsTaken = tasksToInsert.length;
            }

          } else if (flow.action_type === "create_purchase_order") {
            const reorderQuantity = Math.min(100000, Math.max(1, Number(ac.reorder_qty) || 10));
            const { data: purchaseOrderResult, error: purchaseOrderError } = await (supabase as any).rpc(
              "create_automated_purchase_orders",
              {
                p_org_id: orgId,
                p_flow_id: flow.id,
                p_product_ids: matchedEntities.slice(0, 200).map((entity) => entity.id),
                p_quantity: reorderQuantity,
                p_run_date: argentinaDate(now),
              },
            );
            if (purchaseOrderError) throw purchaseOrderError;
            actionsTaken = Array.isArray(purchaseOrderResult?.order_ids)
              ? purchaseOrderResult.order_ids.length
              : 0;
            if (purchaseOrderResult?.replayed) {
              status = "skipped";
              errorMessage = "La reposición de hoy ya fue creada";
            }

          } else if (flow.action_type === "email") {
            // Get admin emails
            const { data: users, error: usersError } = await supabase.auth.admin.listUsers();
            if (usersError) throw usersError;
            const adminEmails = (users?.users ?? [])
              .filter((u: any) => adminIds.includes(u.id) && u.email)
              .map((u: any) => u.email as string);
            const configuredRecipient = typeof ac.recipient_email === "string"
              ? ac.recipient_email.trim()
              : "";
            const recipientEmails = configuredRecipient ? [configuredRecipient] : adminEmails;

            const smtpCfg = await smtpDeOrganizacion(orgId);

            for (const email of recipientEmails) {
              await sendEmail(
                smtpCfg,
                RESEND_API_KEY,
                FROM_EMAIL,
                {
                  to: email,
                  subject: ac.subject || flow.name,
                  html: `<p>${escapeHtml(msgText)}</p>`,
                },
              );
              actionsTaken++;
            }
            if (recipientEmails.length === 0) {
              status = "skipped";
              errorMessage = "No hay un email destinatario disponible";
            }

          } else if (flow.action_type === "whatsapp_message") {
              // Meta Cloud desde el número de plataforma — misma puerta que
              // campañas. No se pide Evolution: 0 conexiones medido; el gate
              // viejo dejaba toda automatización WA en skipped para siempre.
              const names = matchedEntities.map(e => e.name);
              const { data: contacts, error: contactsError } = await supabase
                .from("customers")
                .select("name, phone")
                .eq("org_id", orgId)
                .in("name", names);
              if (contactsError) throw contactsError;
              const phoneMap: Record<string, string> = {};
              for (const c of contacts ?? []) {
                if (c.phone) phoneMap[c.name] = c.phone;
              }

              const msgTemplate = ac.message || flow.name;
              let intentoConfigurado = false;
              let deliveryFailures = 0;
              for (const entity of matchedEntities.slice(0, 50)) {
                const phone = phoneMap[entity.name];
                if (!phone) continue;
                const number = phone.replace(/\D/g, "");
                const text = msgTemplate
                  .replace(/\{nombre\}/gi, entity.name)
                  .replace(/\{detalle\}/gi, entity.extra ?? "")
                  .replace(/\{monto\}/gi, entity.extra ?? "");
                try {
                  const res = await enviarWhatsApp(number, text);
                  if (res.configurado) intentoConfigurado = true;
                  if (res.ok) actionsTaken++;
                  else if (res.configurado) {
                    deliveryFailures++;
                    console.error("WhatsApp no salió:", res.error);
                  }
                } catch (e) {
                  deliveryFailures++;
                  console.error("WhatsApp falló:", e);
                }
              }
              if (!intentoConfigurado && actionsTaken === 0) {
                status = "skipped";
                errorMessage = "WhatsApp de plataforma no está listo (Meta Cloud)";
              } else if (deliveryFailures > 0) {
                status = "error";
                errorMessage = "Uno o más mensajes no pudieron entregarse";
              }

          } else if (flow.action_type === "webhook") {
            const deliveries = await deliverOutboundEvent(supabase, {
              orgId,
              event: "automation.triggered",
              data: {
                flow_id: flow.id,
                flow_name: flow.name,
                trigger_type: flow.trigger_type,
                entity_count: matchedEntities.length,
                entities: matchedEntities.slice(0, 50).map((entity) => ({
                  id: entity.id,
                  label: entity.name,
                  detail: entity.extra ?? null,
                })),
              },
            });
            actionsTaken = deliveries.filter((delivery) => delivery.delivered).length;
            if (deliveries.length === 0) {
              status = "skipped";
              errorMessage = "No hay un webhook activo suscripto a automatizaciones";
            } else if (actionsTaken !== deliveries.length) {
              status = "error";
              errorMessage = "Uno o más endpoints no confirmaron la entrega";
            }
          } else {
            status = "error";
            errorMessage = "La acción configurada no está disponible";
          }
          if (status === "success" && actionsTaken === 0) {
            status = "skipped";
            errorMessage = "No hubo acciones nuevas para realizar";
          }
        }
      } catch (runErr: any) {
        status = "error";
        errorMessage = "No se pudo completar la ejecución";
        console.error(`Flow ${flow.id} error:`, runErr);
      }

      // ── Log run ──────────────────────────────────────────────────────────
      const { error: runLogError } = await (supabase as any).from("automation_runs").insert({
        org_id: orgId,
        flow_id: flow.id,
        trigger_type: flow.trigger_type,
        action_type: flow.action_type,
        status,
        entities_matched: matchedEntities.length,
        actions_taken: actionsTaken,
        error_message: errorMessage ?? null,
        ran_at: now.toISOString(),
      });
      if (runLogError) console.error(`Flow ${flow.id} run log:`, runLogError);

      // Update flow last_run_at
      const { error: lastRunError } = await (supabase as any)
        .from("automation_flows")
        .update({ last_run_at: now.toISOString() })
        .eq("id", flow.id);
      if (lastRunError) console.error(`Flow ${flow.id} last_run_at:`, lastRunError);

      runResults.push({
        flow_id: flow.id,
        flow_name: flow.name,
        status,
        entities_matched: matchedEntities.length,
        actions_taken: actionsTaken,
        message: errorMessage ?? null,
      });
      totalRuns++;
    }

    if (previewOnly) {
      return json({ ok: true, mode: "preview", preview: previews[0] });
    }
    const failedCount = runResults.filter((run) => run.status === "error").length;
    return json({
      ok: failedCount === 0,
      flows_processed: totalRuns,
      failed_count: failedCount,
      runs: runResults,
      ...(failedCount > 0
        ? { merchant_message: "Una o más automatizaciones no pudieron completarse. Revisá el historial e intentá nuevamente." }
        : {}),
    });
  } catch (err: any) {
    console.error("execute-automations error:", err);
    return json({
      error: "No se pudo procesar la automatización",
      merchant_message: "No pudimos procesar la automatización. Intentá nuevamente; si continúa, contactá a soporte.",
    }, 500);
  }
});
