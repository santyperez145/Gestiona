import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261011001700_tareas_y_tratos_por_permiso.sql"), "utf8");

describe("P0.2: tareas y tratos con permiso de CRM", () => {
  it("crear y borrar exigen el permiso de CRM", () => {
    expect(sql).toContain("CREATE POLICY tasks_crear ON public.tasks FOR INSERT TO authenticated\n  WITH CHECK (public.has_permission(org_id, 'crm', 'create'));");
    expect(sql).toContain("CREATE POLICY deals_borrar ON public.deals FOR DELETE TO authenticated\n  USING (public.has_permission(org_id, 'crm', 'delete'));");
    expect(sql).toContain("CREATE POLICY deal_outcomes_crear ON public.deal_outcomes FOR INSERT TO authenticated");
  });

  it("editar: con permiso, o lo propio (tarea asignada o creada; trato cargado por la persona)", () => {
    expect(sql).toContain("(assigned_to = auth.uid() OR created_by = auth.uid())");
    expect(sql).toContain("AND user_id = auth.uid()))");
  });
});
