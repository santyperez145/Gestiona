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
 *   whatsapp_message   → sends WhatsApp via Evolution API (self-hosted)
 *   webhook            → calls the org's configured webhook URL
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail, parseSmtpConfig } from "../_shared/smtpSender.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "noreply@gestiona.app";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  // Optionally target a single org/flow (for "Run now" from UI)
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const targetOrgId: string | undefined = body.org_id;
  const targetFlowId: string | undefined = body.flow_id;

  try {
    // Load active flows
    let query = (supabase as any)
      .from("automation_flows")
      .select("*")
      .eq("active", true);
    if (targetOrgId) query = query.eq("org_id", targetOrgId);
    if (targetFlowId) query = query.eq("id", targetFlowId);

    const { data: flows, error: flowsErr } = await query;
    if (flowsErr) throw flowsErr;

    const now = new Date();
    let totalRuns = 0;

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
          const { data: recentSales } = await supabase
            .from("sales")
            .select("customer_name")
            .eq("org_id", orgId)
            .gte("created_at", cutoff);
          const active = new Set((recentSales ?? []).map((s: any) => s.customer_name).filter(Boolean));
          const { data: customers } = await supabase
            .from("customers")
            .select("id, name")
            .eq("org_id", orgId);
          matchedEntities = (customers ?? [])
            .filter((c: any) => !active.has(c.name))
            .map((c: any) => ({ id: c.id, name: c.name }));

        } else if (flow.trigger_type === "debt_overdue") {
          const graceDays = Number(tc.grace_days) || 0;
          const cutoff = new Date(now.getTime() - graceDays * 86400000).toISOString().slice(0, 10);
          const { data: debts } = await supabase
            .from("debts")
            .select("id, customer_name, amount, due_date")
            .eq("org_id", orgId)
            .eq("paid", false)
            .lte("due_date", cutoff);
          matchedEntities = (debts ?? []).map((d: any) => ({
            id: d.id,
            name: d.customer_name,
            extra: `$${Number(d.amount).toLocaleString("es-AR")}`,
          }));

        } else if (flow.trigger_type === "low_stock") {
          const threshold = Number(tc.threshold) || 5;
          const { data: prods } = await supabase
            .from("products")
            .select("id, name, stock")
            .eq("org_id", orgId)
            .lte("stock", threshold)
            .gt("stock", 0);
          matchedEntities = (prods ?? []).map((p: any) => ({
            id: p.id,
            name: p.name,
            extra: `${p.stock} unidades`,
          }));

        } else if (flow.trigger_type === "stock_out") {
          const { data: prods } = await supabase
            .from("products")
            .select("id, name")
            .eq("org_id", orgId)
            .eq("stock", 0);
          matchedEntities = (prods ?? []).map((p: any) => ({ id: p.id, name: p.name }));

        } else if (flow.trigger_type === "birthday") {
          const daysAhead = Number(tc.days_ahead) || 3;
          const today = now;
          const { data: customers } = await supabase
            .from("customers")
            .select("id, name, birthday")
            .eq("org_id", orgId)
            .not("birthday", "is", null);
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
          const { data: customers } = await supabase
            .from("customers")
            .select("id, name")
            .eq("org_id", orgId)
            .gte("created_at", cutoff);
          matchedEntities = (customers ?? []).map((c: any) => ({ id: c.id, name: c.name }));

        } else if (flow.trigger_type === "big_sale") {
          const threshold = Number(tc.threshold) || 10000;
          const today = now.toISOString().slice(0, 10);
          const { data: sales } = await supabase
            .from("sales")
            .select("id, customer_name, total_ars")
            .eq("org_id", orgId)
            .gte("date", today)
            .gte("total_ars", threshold);
          matchedEntities = (sales ?? []).map((s: any) => ({
            id: s.id,
            name: s.customer_name || "Cliente",
            extra: `$${Number(s.total_ars).toLocaleString("es-AR")}`,
          }));
        }

        if (matchedEntities.length === 0) {
          status = "skipped";
        } else {
          // ── Execute action ───────────────────────────────────────────────
          // Get admin user_ids for this org
          const { data: members } = await supabase
            .from("memberships")
            .select("user_id")
            .eq("org_id", orgId)
            .eq("role", "admin");
          const adminIds = (members ?? []).map((m: any) => m.user_id);

          // Dedup: only notify for entities we haven't notified about in last 24h
          const cutoff24h = new Date(now.getTime() - 86400000).toISOString();
          const { data: recentNotifs } = await supabase
            .from("notifications")
            .select("message")
            .in("user_id", adminIds.length > 0 ? adminIds : ["00000000-0000-0000-0000-000000000000"])
            .gte("created_at", cutoff24h);
          const recentMsgs = new Set((recentNotifs ?? []).map((n: any) => n.message));

          // Build notification text
          const entitiesStr = matchedEntities.slice(0, 5).map(e =>
            e.extra ? `${e.name} (${e.extra})` : e.name
          ).join(", ");
          const more = matchedEntities.length > 5 ? ` y ${matchedEntities.length - 5} más` : "";
          const msgText = `${ac.message || flow.name}: ${entitiesStr}${more}`;

          if (flow.action_type === "notification" && adminIds.length > 0) {
            const toInsert = adminIds
              .filter(() => !recentMsgs.has(msgText))
              .map((uid: string) => ({
                user_id: uid,
                type: "sistema",
                title: flow.name,
                message: msgText,
                read: false,
              }));
            if (toInsert.length > 0) {
              await supabase.from("notifications").insert(toInsert);
              actionsTaken = toInsert.length;
            }

          } else if (flow.action_type === "create_task" && adminIds.length > 0) {
            const taskTitle = ac.task_title || flow.name;
            for (const entity of matchedEntities.slice(0, 10)) {
              const msg = `${taskTitle}: ${entity.name}${entity.extra ? ` (${entity.extra})` : ""}`;
              if (!recentMsgs.has(msg)) {
                await (supabase as any).from("tasks").insert({
                  org_id: orgId,
                  user_id: adminIds[0],
                  title: msg,
                  priority: ac.priority || "high",
                  due_date: new Date(now.getTime() + 86400000).toISOString().slice(0, 10),
                });
                actionsTaken++;
              }
            }

          } else if (flow.action_type === "email") {
            // Get admin emails
            const { data: users } = await supabase.auth.admin.listUsers();
            const adminEmails = (users?.users ?? [])
              .filter((u: any) => adminIds.includes(u.id) && u.email)
              .map((u: any) => u.email as string);

            // Load SMTP config for this org
            const { data: orgSettings } = await supabase
              .from("settings")
              .select("smtp_host, smtp_port, smtp_user, smtp_pass, smtp_secure, smtp_from_name, smtp_from_email")
              .eq("org_id", orgId)
              .maybeSingle();
            const smtpCfg = parseSmtpConfig(orgSettings as Record<string, unknown> | null);

            for (const email of adminEmails) {
              await sendEmail(
                smtpCfg,
                RESEND_API_KEY,
                FROM_EMAIL,
                {
                  to: email,
                  subject: ac.subject || flow.name,
                  html: `<p>${msgText}</p>`,
                },
              );
              actionsTaken++;
            }

          } else if (flow.action_type === "whatsapp_message") {
            // Load Evolution API credentials for this org
            const { data: evolSettings } = await supabase
              .from("settings")
              .select("evolution_api_url, evolution_api_key, evolution_instance")
              .eq("org_id", orgId)
              .maybeSingle();

            const baseUrl = evolSettings?.evolution_api_url?.replace(/\/$/, "");
            const apiKey = evolSettings?.evolution_api_key;
            const instance = evolSettings?.evolution_instance;

            if (!baseUrl || !apiKey || !instance) {
              console.warn(`execute-automations: Evolution API not configured for org=${orgId}`);
              status = "skipped";
            } else {
              // Get customer phones for matched entities
              const names = matchedEntities.map(e => e.name);
              const { data: contacts } = await supabase
                .from("customers")
                .select("name, phone")
                .eq("org_id", orgId)
                .in("name", names);
              const phoneMap: Record<string, string> = {};
              for (const c of contacts ?? []) {
                if (c.phone) phoneMap[c.name] = c.phone;
              }

              const msgTemplate = ac.message || flow.name;
              for (const entity of matchedEntities.slice(0, 50)) {
                const phone = phoneMap[entity.name];
                if (!phone) continue;
                const number = phone.replace(/\D/g, "");
                const text = msgTemplate
                  .replace(/\{nombre\}/gi, entity.name)
                  .replace(/\{detalle\}/gi, entity.extra ?? "")
                  .replace(/\{monto\}/gi, entity.extra ?? "");
                try {
                  const res = await fetch(`${baseUrl}/message/sendText/${instance}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", apikey: apiKey },
                    body: JSON.stringify({ number, text }),
                    signal: AbortSignal.timeout(15_000),
                  });
                  if (res.ok) actionsTaken++;
                  else console.error("Evolution API error:", await res.text().catch(() => res.status));
                } catch (e) {
                  console.error("Evolution API fetch failed:", e);
                }
              }
            }

          } else if (flow.action_type === "webhook" && ac.webhook_url) {
            try {
              await fetch(ac.webhook_url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  flow_id: flow.id,
                  flow_name: flow.name,
                  trigger: flow.trigger_type,
                  entities: matchedEntities.slice(0, 20),
                  fired_at: now.toISOString(),
                }),
              });
              actionsTaken = 1;
            } catch (webhookErr: any) {
              status = "error";
              errorMessage = webhookErr.message;
            }
          }
        }
      } catch (runErr: any) {
        status = "error";
        errorMessage = runErr.message;
        console.error(`Flow ${flow.id} error:`, runErr);
      }

      // ── Log run ──────────────────────────────────────────────────────────
      await (supabase as any).from("automation_runs").insert({
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

      // Update flow last_run_at
      await (supabase as any)
        .from("automation_flows")
        .update({ last_run_at: now.toISOString() })
        .eq("id", flow.id);

      totalRuns++;
    }

    return new Response(
      JSON.stringify({ ok: true, flows_processed: totalRuns }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("execute-automations error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
