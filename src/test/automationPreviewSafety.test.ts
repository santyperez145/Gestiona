import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..", "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const edge = read("supabase/functions/execute-automations/index.ts");
const ui = read("src/components/marketing/AutomationFlowsTab.tsx");
const migration = read("supabase/migrations/20260906000030_automation_purchase_orders.sql");

describe("prueba segura de automatizaciones", () => {
  it("exige organización, flujo y permiso real del tenant", () => {
    expect(edge).toContain('const previewOnly = requestedMode === "preview"');
    expect(edge).toContain('requestedMode !== "execute" && requestedMode !== "preview"');
    expect(edge).toContain('if (previewOnly && !targetFlowId)');
    expect(edge).toContain('if (!targetOrgId)');
    expect(edge).toContain('if (!UUID.test(targetOrgId))');
    expect(edge).toContain('[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}');
    expect(edge).toContain('p_module: "marketing"');
    expect(edge).toContain('p_action: "edit"');
    expect(edge).toContain('if (!allowed) return json({ error: "No tenés permiso para ejecutar automatizaciones" }, 403)');
  });

  it("permite probar un flujo pausado sin abrir esa excepción a ejecuciones reales", () => {
    expect(edge).toContain('if (!previewOnly) query = query.eq("active", true)');
    expect(edge).toContain('if (targetFlowId) query = query.eq("id", targetFlowId)');
    expect(edge).toContain('if (targetOrgId) query = query.eq("org_id", targetOrgId)');
  });

  it("corta antes de ejecutar acciones, registrar runs o tocar last_run_at", () => {
    const previewGate = edge.indexOf("// El modo prueba termina antes de cualquier acción");
    const actionGate = edge.indexOf('if (matchedEntities.length === 0)', previewGate);
    const runLog = edge.indexOf('.from("automation_runs").insert', previewGate);
    expect(previewGate).toBeGreaterThan(0);
    expect(edge.slice(previewGate, actionGate)).toContain("continue;");
    expect(previewGate).toBeLessThan(actionGate);
    expect(previewGate).toBeLessThan(runLog);
  });

  it("devuelve impacto acotado y ejemplos, no el dataset completo", () => {
    expect(edge).toContain("matched_count: matchedEntities.length");
    expect(edge).toContain("sample: matchedEntities.slice(0, 5)");
    expect(edge).toContain('return json({ ok: true, mode: "preview", preview: previews[0] })');
  });

  it("un modo mal escrito falla cerrado y los errores internos no llegan al comercio", () => {
    expect(edge).toContain('return json({ error: "El modo de automatización no es válido" }, 400)');
    expect(edge).toContain('merchant_message: "No pudimos procesar la automatización. Intentá nuevamente; si continúa, contactá a soporte."');
    expect(edge).not.toContain('return json({ error: err.message }, 500)');
  });

  it("la UI diferencia probar de ejecutar y explica que no produce efectos", () => {
    expect(ui).toContain('mode: "preview"');
    expect(ui).toContain("Probar sin ejecutar");
    expect(ui).toContain("no envía mensajes, no crea tareas y no modifica el negocio");
    expect(ui).toContain("no actualizó el historial de ejecuciones");
  });

  it("los flujos nuevos nacen pausados y las plantillas conservan su nombre", () => {
    expect(ui).toContain('org_id: activeOrg.id, active: false');
    expect(ui).toContain("Flujo creado en pausa. Probalo antes de activarlo.");
    expect(ui).toContain('handleSave({ name: tpl.name, ...tpl.data })');
  });

  it("evalúa deuda con el contrato vigente y no silencia errores de lectura", () => {
    expect(edge).toContain('tc.days_overdue ?? tc.grace_days');
    expect(edge).toContain('.select("id, customer_name, remaining_ars, due_date")');
    expect(edge).toContain('.in("status", ["pending", "partial"])');
    expect(edge).toContain("if (debtsError) throw debtsError");
    expect(edge).not.toContain('.eq("paid", false)');
  });

  it("crea tareas con columnas reales, configuración de UI y deduplicación", () => {
    expect(edge).toContain("ac.task_priority");
    expect(edge).toContain("ac.task_due_days");
    expect(edge).toContain("assigned_to: adminIds[0]");
    expect(edge).toContain("created_by: adminIds[0]");
    expect(edge).toContain('.from("tasks")');
    expect(edge).toContain('.gte("created_at", cutoff24h)');
    expect(edge).not.toContain("user_id: adminIds[0]");
  });

  it("delega la reposición a una transacción idempotente del servidor", () => {
    expect(edge).toContain('"create_automated_purchase_orders"');
    expect(edge).toContain("p_run_date: argentinaDate(now)");
    expect(migration).toContain("UNIQUE (org_id, flow_id, idempotency_key)");
    expect(migration).toContain("ON CONFLICT (org_id, flow_id, idempotency_key) DO NOTHING");
    expect(migration).toContain("supplier.id IS NOT DISTINCT FROM v_group.supplier_id");
    expect(migration).toContain("public.generate_po_number(p_org_id)");
    expect(migration).toContain("'draft', v_group.currency");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.create_automated_purchase_orders");
    expect(migration).toContain("TO service_role");
  });

  it("no informa éxito cuando una acción falló o no produjo cambios", () => {
    expect(edge).toContain('status === "success" && actionsTaken === 0');
    expect(edge).toContain('ok: failedCount === 0');
    expect(edge).toContain('merchant_message: "Una o más automatizaciones no pudieron completarse. Revisá el historial e intentá nuevamente."');
    expect(ui).toContain("data?.ok === false");
    expect(ui).toContain('result?.status === "skipped"');
    expect(ui).toContain("no había acciones nuevas para realizar");
  });

  it("el motor consume las mismas claves que guarda el editor", () => {
    expect(edge).toContain("tc.min_amount ?? tc.threshold");
    expect(edge).toContain('typeof ac.recipient_email === "string"');
    expect(edge).toContain("configuredRecipient ? [configuredRecipient] : adminEmails");
    expect(edge).toContain("html: `<p>${escapeHtml(msgText)}</p>`");
    expect(ui).toContain("Sin comprar 45 días → Alerta por email");
    expect(ui).not.toContain("Sin comprar 45 días → Email de reactivación");
  });
});
