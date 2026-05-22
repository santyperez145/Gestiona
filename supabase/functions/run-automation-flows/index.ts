// Edge function: run-automation-flows
// Evaluates all active automation flows and executes their configured actions.
// Called daily by pg_cron at 11:00 AM UTC.
//
// Supported triggers: customer_inactive, debt_overdue, low_stock, birthday,
//                     stock_out, new_customer, big_sale
// Supported actions:  notification, email, whatsapp_message,
//                     create_task, create_purchase_order, webhook
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail, parseSmtpConfig } from "../_shared/smtpSender.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ─────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────
Deno.serve(async () => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const { data: flows } = await supabase
      .from("automation_flows")
      .select("*")
      .eq("active", true);

    if (!flows?.length) return json({ ok: true, processed: 0 });

    let processed = 0;
    let actions = 0;

    for (const flow of flows) {
      try {
        const triggered = await evaluateFlow(flow, today);
        if (triggered > 0) {
          await supabase
            .from("automation_flows")
            .update({ last_run_at: new Date().toISOString() })
            .eq("id", flow.id);
          actions += triggered;
        }
        processed++;
      } catch (e) {
        console.error(`Flow ${flow.id} error:`, e);
      }
    }

    return json({ ok: true, flows: processed, actions });
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});

// ─────────────────────────────────────────────────────────────
// Flow evaluator — routes to trigger handler
// ─────────────────────────────────────────────────────────────
async function evaluateFlow(flow: any, today: string): Promise<number> {
  const { trigger_type, trigger_config, action_type, action_config, org_id, id: flowId } = flow;

  let subjects: Subject[] = [];

  switch (trigger_type) {
    case "customer_inactive":
      subjects = await triggerCustomerInactive(org_id, trigger_config);
      break;
    case "debt_overdue":
      subjects = await triggerDebtOverdue(org_id, trigger_config);
      break;
    case "low_stock":
      subjects = await triggerLowStock(org_id, trigger_config);
      break;
    case "birthday":
      subjects = await triggerBirthday(org_id);
      break;
    case "stock_out":
      subjects = await triggerStockOut(org_id);
      break;
    case "new_customer":
      subjects = await triggerNewCustomer(org_id);
      break;
    case "big_sale":
      subjects = await triggerBigSale(org_id, trigger_config);
      break;
    default:
      return 0;
  }

  if (!subjects.length) return 0;

  return await executeAction({ action_type, action_config, org_id, flowId, today, subjects, trigger_type, trigger_config });
}

// ─────────────────────────────────────────────────────────────
// Subject type — generic payload passed from trigger to action
// ─────────────────────────────────────────────────────────────
interface Subject {
  label: string;       // human-readable identifier (customer name, product, etc.)
  detail?: string;     // secondary detail (amount, stock qty, etc.)
  phone?: string;      // for WhatsApp
  email?: string;      // for email
  meta?: Record<string, any>; // extra data for create_task / create_purchase_order
}

// ─────────────────────────────────────────────────────────────
// Trigger handlers
// ─────────────────────────────────────────────────────────────
async function triggerCustomerInactive(orgId: string, config: any): Promise<Subject[]> {
  const days = Number(config?.days ?? 30);
  const cutoff = daysAgo(days);

  const { data: sales } = await supabase
    .from("sales")
    .select("customer_name, date")
    .eq("org_id", orgId)
    .not("customer_name", "is", null)
    .order("date", { ascending: false });

  if (!sales?.length) return [];

  const lastPurchase: Record<string, string> = {};
  for (const s of sales) {
    if (!lastPurchase[s.customer_name]) lastPurchase[s.customer_name] = s.date.slice(0, 10);
  }

  const inactive = Object.entries(lastPurchase).filter(([, d]) => d < cutoff);

  // Try to enrich with customer contact
  const names = inactive.map(([n]) => n);
  const { data: customers } = await supabase
    .from("customers")
    .select("name, phone, email")
    .eq("org_id", orgId)
    .in("name", names);

  const contactMap: Record<string, { phone?: string; email?: string }> = {};
  for (const c of customers ?? []) contactMap[c.name] = { phone: c.phone, email: c.email };

  return inactive.map(([name, lastDate]) => ({
    label: name,
    detail: `última compra ${lastDate}`,
    phone: contactMap[name]?.phone,
    email: contactMap[name]?.email,
  }));
}

async function triggerDebtOverdue(orgId: string, config: any): Promise<Subject[]> {
  const daysOverdue = Number(config?.days_overdue ?? 0);
  const cutoff = daysAgo(daysOverdue);

  const { data: debts } = await supabase
    .from("debts")
    .select("customer_name, remaining_ars, due_date")
    .eq("org_id", orgId)
    .eq("status", "pending")
    .not("due_date", "is", null)
    .lt("due_date", cutoff);

  if (!debts?.length) return [];

  const names = [...new Set(debts.map((d: any) => d.customer_name))];
  const { data: customers } = await supabase
    .from("customers")
    .select("name, phone, email")
    .eq("org_id", orgId)
    .in("name", names);
  const contactMap: Record<string, { phone?: string; email?: string }> = {};
  for (const c of customers ?? []) contactMap[c.name] = { phone: c.phone, email: c.email };

  return debts.map((d: any) => ({
    label: d.customer_name,
    detail: `$${Math.round(Number(d.remaining_ars)).toLocaleString("es-AR")} vencida`,
    phone: contactMap[d.customer_name]?.phone,
    email: contactMap[d.customer_name]?.email,
    meta: { amount: d.remaining_ars, due_date: d.due_date },
  }));
}

async function triggerLowStock(orgId: string, config: any): Promise<Subject[]> {
  const threshold = Number(config?.threshold ?? 3);

  const { data: products } = await supabase
    .from("products")
    .select("id, name, stock, supplier_id")
    .eq("org_id", orgId)
    .lte("stock", threshold)
    .gt("stock", 0);

  return (products ?? []).map((p: any) => ({
    label: p.name,
    detail: `${p.stock} u.`,
    meta: { product_id: p.id, stock: p.stock, supplier_id: p.supplier_id },
  }));
}

async function triggerBirthday(orgId: string): Promise<Subject[]> {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");

  const { data: customers } = await supabase
    .from("customers")
    .select("name, phone, email, birthday")
    .eq("org_id", orgId)
    .not("birthday", "is", null);

  return (customers ?? [])
    .filter((c: any) => c.birthday?.slice(5, 7) === mm && c.birthday?.slice(8, 10) === dd)
    .map((c: any) => ({ label: c.name, phone: c.phone, email: c.email }));
}

async function triggerStockOut(orgId: string): Promise<Subject[]> {
  const { data: products } = await supabase
    .from("products")
    .select("id, name, stock, supplier_id")
    .eq("org_id", orgId)
    .lte("stock", 0);

  return (products ?? []).map((p: any) => ({
    label: p.name,
    detail: "sin stock",
    meta: { product_id: p.id, stock: 0, supplier_id: p.supplier_id },
  }));
}

async function triggerNewCustomer(orgId: string): Promise<Subject[]> {
  const yesterday = daysAgo(1);

  const { data: customers } = await supabase
    .from("customers")
    .select("name, phone, email, created_at")
    .eq("org_id", orgId)
    .gte("created_at", `${yesterday}T00:00:00`);

  return (customers ?? []).map((c: any) => ({
    label: c.name,
    phone: c.phone,
    email: c.email,
  }));
}

async function triggerBigSale(orgId: string, config: any): Promise<Subject[]> {
  const minAmount = Number(config?.min_amount ?? 50000);
  const yesterday = daysAgo(1);

  const { data: sales } = await supabase
    .from("sales")
    .select("id, customer_name, total_ars, date")
    .eq("org_id", orgId)
    .gte("date", yesterday)
    .gte("total_ars", minAmount);

  return (sales ?? []).map((s: any) => ({
    label: s.customer_name ?? "Cliente",
    detail: `$${Math.round(Number(s.total_ars)).toLocaleString("es-AR")}`,
    meta: { sale_id: s.id, amount: s.total_ars },
  }));
}

// ─────────────────────────────────────────────────────────────
// Action executor
// ─────────────────────────────────────────────────────────────
interface ActionContext {
  action_type: string;
  action_config: any;
  org_id: string;
  flowId: string;
  today: string;
  subjects: Subject[];
  trigger_type: string;
  trigger_config: any;
}

async function executeAction(ctx: ActionContext): Promise<number> {
  const { action_type, action_config, org_id, flowId, today, subjects, trigger_type, trigger_config } = ctx;

  const summary = buildSummary(trigger_type, subjects, trigger_config);
  const customMsg = action_config?.message ?? "";

  switch (action_type) {
    case "notification":
      return await actionNotification(org_id, flowId, today, trigger_type, summary, customMsg);

    case "email":
      return await actionEmail(org_id, subjects, trigger_type, summary, customMsg, action_config);

    case "whatsapp_message":
      return await actionWhatsApp(org_id, subjects, customMsg, trigger_type);

    case "create_task":
      return await actionCreateTask(org_id, subjects, summary, customMsg, action_config);

    case "create_purchase_order":
      return await actionCreatePurchaseOrder(org_id, subjects, action_config);

    case "webhook":
      return await actionWebhook(org_id, trigger_type, subjects, action_config);

    default:
      return 0;
  }
}

// ─────────────────────────────────────────────────────────────
// Action: internal notification
// ─────────────────────────────────────────────────────────────
async function actionNotification(
  orgId: string,
  flowId: string,
  today: string,
  triggerType: string,
  summary: { title: string; message: string },
  customMsg: string,
): Promise<number> {
  const { data: members } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("org_id", orgId)
    .in("role", ["owner", "admin"]);

  if (!members?.length) return 0;

  let sent = 0;
  for (const m of members) {
    // Dedup: one notification per flow per day per user
    const { data: existing } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", m.user_id)
      .eq("org_id", orgId)
      .like("type", `automatizacion_%`)
      .gte("created_at", `${today}T00:00:00`)
      .limit(1);

    if (existing?.length) continue;

    await supabase.from("notifications").insert({
      user_id: m.user_id,
      org_id: orgId,
      type: `automatizacion_${triggerType}`,
      title: summary.title,
      message: customMsg || summary.message,
      read: false,
    });
    sent++;
  }
  return sent;
}

// ─────────────────────────────────────────────────────────────
// Action: email via own SMTP or Resend fallback
// ─────────────────────────────────────────────────────────────
async function actionEmail(
  orgId: string,
  subjects: Subject[],
  triggerType: string,
  summary: { title: string; message: string },
  customMsg: string,
  config: any,
): Promise<number> {
  // Determine recipients: org admins, or specific email in config
  let recipients: string[] = [];
  if (config?.recipient_email) {
    recipients = [config.recipient_email];
  } else {
    const { data: members } = await supabase
      .from("memberships")
      .select("user_id")
      .eq("org_id", orgId)
      .in("role", ["owner", "admin"]);

    const userIds = (members ?? []).map((m: any) => m.user_id);
    if (userIds.length) {
      const { data: users } = await supabase.auth.admin.listUsers();
      recipients = (users?.users ?? [])
        .filter((u) => userIds.includes(u.id) && u.email)
        .map((u) => u.email!);
    }
  }

  if (!recipients.length) return 0;

  // Load SMTP config for org
  const { data: orgSettings } = await supabase
    .from("settings")
    .select("smtp_host, smtp_port, smtp_user, smtp_pass, smtp_secure, smtp_from_name, smtp_from_email")
    .eq("org_id", orgId)
    .maybeSingle();
  const smtpCfg = parseSmtpConfig(orgSettings as Record<string, unknown> | null);
  const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";

  if (!smtpCfg && !resendKey) {
    console.warn(`run-automation-flows: no email provider for org=${orgId} — skipping email action`);
    return 0;
  }

  const body = customMsg || summary.message;
  const listHtml = subjects.slice(0, 10)
    .map((s) => `<li><strong>${s.label}</strong>${s.detail ? ` — ${s.detail}` : ""}</li>`)
    .join("");
  const extraLine = subjects.length > 10 ? `<p>…y ${subjects.length - 10} más.</p>` : "";

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#b8973a">${summary.title}</h2>
      <p>${body}</p>
      <ul>${listHtml}</ul>
      ${extraLine}
      <hr/>
      <p style="color:#888;font-size:12px">Enviado automáticamente por Gestiona</p>
    </div>`;

  let sent = 0;
  for (const to of recipients) {
    const result = await sendEmail(
      smtpCfg,
      resendKey,
      "Gestiona <automatizaciones@gestiona.app>",
      { to, subject: summary.title, html },
    );
    if (result.ok) sent++;
    else console.error(`actionEmail failed for ${to}:`, result.error);
  }
  return sent;
}

// ─────────────────────────────────────────────────────────────
// Action: WhatsApp via Evolution API (self-hosted, no Twilio)
// ─────────────────────────────────────────────────────────────
async function actionWhatsApp(
  orgId: string,
  subjects: Subject[],
  customMsg: string,
  triggerType: string,
): Promise<number> {
  // Load Evolution API credentials from org settings
  const { data: settings } = await supabase
    .from("settings")
    .select("evolution_api_url, evolution_api_key, evolution_instance")
    .eq("org_id", orgId)
    .maybeSingle();

  const baseUrl = settings?.evolution_api_url?.replace(/\/$/, "");
  const apiKey = settings?.evolution_api_key;
  const instance = settings?.evolution_instance;

  if (!baseUrl || !apiKey || !instance) {
    console.warn(`run-automation-flows: Evolution API not configured for org=${orgId} — skipping WhatsApp action`);
    return 0;
  }

  const withPhone = subjects.filter((s) => s.phone);
  if (!withPhone.length) return 0;

  let sent = 0;

  for (const subject of withPhone) {
    // Normalize: digits only, no + (Evolution API expects E.164 without +)
    const number = subject.phone!.replace(/\D/g, "");
    const text = interpolate(customMsg || defaultWhatsAppMsg(triggerType), subject);

    try {
      const res = await fetch(`${baseUrl}/message/sendText/${instance}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: apiKey,
        },
        body: JSON.stringify({ number, text }),
        signal: AbortSignal.timeout(15_000),
      });

      if (res.ok) {
        sent++;
      } else {
        const errText = await res.text().catch(() => res.status.toString());
        console.error(`Evolution API error for ${number}:`, errText);
      }
    } catch (e) {
      console.error(`Evolution API fetch failed for ${number}:`, e);
    }
  }
  return sent;
}

// ─────────────────────────────────────────────────────────────
// Action: create task
// ─────────────────────────────────────────────────────────────
async function actionCreateTask(
  orgId: string,
  subjects: Subject[],
  summary: { title: string; message: string },
  customMsg: string,
  config: any,
): Promise<number> {
  const title = customMsg || summary.title;
  const description = subjects.slice(0, 20).map((s) => `• ${s.label}${s.detail ? ` (${s.detail})` : ""}`).join("\n");
  const priority = config?.task_priority ?? "medium";
  const dueDate = config?.task_due_days
    ? new Date(Date.now() + Number(config.task_due_days) * 86400000).toISOString().slice(0, 10)
    : null;

  const { error } = await supabase.from("tasks").insert({
    org_id: orgId,
    title,
    description,
    priority,
    status: "pending",
    due_date: dueDate,
    category: "automatizacion",
  });

  return error ? 0 : 1;
}

// ─────────────────────────────────────────────────────────────
// Action: create purchase order (for stock triggers)
// ─────────────────────────────────────────────────────────────
async function actionCreatePurchaseOrder(
  orgId: string,
  subjects: Subject[],
  config: any,
): Promise<number> {
  const stockSubjects = subjects.filter((s) => s.meta?.product_id);
  if (!stockSubjects.length) return 0;

  const qty = Number(config?.reorder_qty ?? 10);
  const batchName = `Auto-restock ${new Date().toLocaleDateString("es-AR")}`;

  // Group items for the purchase
  const items = stockSubjects.map((s) => ({
    product_id: s.meta!.product_id,
    quantity: qty,
    unit_cost_usd: 0, // to be filled by user
    product_name: s.label,
  }));

  const { error } = await supabase.from("purchases").insert({
    org_id: orgId,
    batch_name: batchName,
    supplier_id: stockSubjects[0].meta?.supplier_id ?? null,
    status: "draft",
    items,
    notes: `Creado automáticamente por flujo de automatización. ${stockSubjects.length} producto(s) sin stock o bajo mínimo.`,
    total_usd: 0,
    total_ars: 0,
    exchange_rate: 0,
  });

  return error ? 0 : 1;
}

// ─────────────────────────────────────────────────────────────
// Action: call org's configured webhook URL
// ─────────────────────────────────────────────────────────────
async function actionWebhook(
  orgId: string,
  triggerType: string,
  subjects: Subject[],
  _config: any,
): Promise<number> {
  const { data: settings } = await supabase
    .from("settings")
    .select("webhook_url, webhook_enabled")
    .eq("org_id", orgId)
    .maybeSingle();

  if (!settings?.webhook_enabled || !settings?.webhook_url) return 0;

  const payload = {
    event: `automation.${triggerType}`,
    org_id: orgId,
    timestamp: new Date().toISOString(),
    data: { trigger: triggerType, count: subjects.length, subjects: subjects.slice(0, 50) },
  };

  try {
    const res = await fetch(settings.webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Gestiona-Event": `automation.${triggerType}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? 1 : 0;
  } catch {
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function interpolate(template: string, subject: Subject): string {
  return template
    .replace(/\{nombre\}/gi, subject.label)
    .replace(/\{detalle\}/gi, subject.detail ?? "")
    .replace(/\{monto\}/gi, subject.detail ?? "");
}

function defaultWhatsAppMsg(triggerType: string): string {
  const msgs: Record<string, string> = {
    customer_inactive: "Hola {nombre}! 👋 Te extrañamos, hace tiempo que no pasás. ¿Hay algo que podamos hacer por vos?",
    debt_overdue: "Hola {nombre}, te recordamos que tenés una deuda pendiente de {detalle}. Escribinos para coordinar el pago.",
    birthday: "🎂 ¡Feliz cumpleaños {nombre}! Desde el equipo te deseamos un excelente día.",
    low_stock: "Hola {nombre}! Avisamos que {detalle} tiene stock bajo.",
    stock_out: "El producto {nombre} se quedó sin stock.",
    new_customer: "¡Bienvenido/a {nombre}! Gracias por elegirnos.",
    big_sale: "¡Gran venta de {detalle} registrada para {nombre}!",
  };
  return msgs[triggerType] ?? "Hola {nombre}! Notificación automática de Gestiona.";
}

function buildSummary(
  triggerType: string,
  subjects: Subject[],
  config: any,
): { title: string; message: string } {
  const n = subjects.length;
  const list = subjects.slice(0, 3).map((s) => s.label).join(", ");
  const extra = n > 3 ? ` y ${n - 3} más` : "";

  switch (triggerType) {
    case "customer_inactive": {
      const days = config?.days ?? 30;
      return {
        title: `${n} cliente${n !== 1 ? "s" : ""} sin comprar hace +${days} días`,
        message: `${list}${extra}`,
      };
    }
    case "debt_overdue": {
      const days = config?.days_overdue ?? 0;
      return {
        title: `${n} deuda${n !== 1 ? "s" : ""} vencida${n !== 1 ? "s" : ""} (>${days}d)`,
        message: `${list}${extra}`,
      };
    }
    case "low_stock":
      return {
        title: `${n} producto${n !== 1 ? "s" : ""} con stock bajo`,
        message: subjects.slice(0, 5).map((s) => `${s.label} (${s.detail})`).join(", "),
      };
    case "birthday":
      return {
        title: `🎂 ${n} cumpleaño${n !== 1 ? "s" : ""} hoy`,
        message: `Felicitá a: ${list}${extra}`,
      };
    case "stock_out":
      return {
        title: `${n} producto${n !== 1 ? "s" : ""} sin stock`,
        message: `${list}${extra}`,
      };
    case "new_customer":
      return {
        title: `${n} cliente${n !== 1 ? "s" : ""} nuevo${n !== 1 ? "s" : ""} hoy`,
        message: `${list}${extra}`,
      };
    case "big_sale":
      return {
        title: `${n} venta${n !== 1 ? "s" : ""} destacada${n !== 1 ? "s" : ""}`,
        message: subjects.slice(0, 3).map((s) => `${s.label}: ${s.detail}`).join(", "),
      };
    default:
      return { title: "Automatización disparada", message: list };
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
