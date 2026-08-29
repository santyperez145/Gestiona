import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const rate = read("supabase/functions/fetch-usd-rate/index.ts");
const birthday = read("supabase/functions/send-birthday-whatsapp/index.ts");
const whatsapp = read("supabase/functions/_shared/whatsapp.ts");
const migration = read("supabase/migrations/20260828000180_las_tareas_programadas_terminan.sql");
const settings = read("src/pages/SettingsPage.tsx");

describe("recuperación de tareas Edge programadas", () => {
  it("el cron de cotización tiene una rama service y no vuelve a exigir usuario", () => {
    expect(rate).toContain("const cron = esLlamadaDeCron(req)");
    expect(rate).toContain('mode: "cron"');
    expect(rate).toContain('Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")');
    expect(migration).toContain("'fetch-usd-rate-daily'");
    expect(migration).toContain("'15 11 * * *'");
  });

  it("la acción manual apunta a la organización activa y valida membresía", () => {
    expect(settings).toContain("body: { org_id: orgId }");
    expect(rate).toContain('.eq("org_id", orgId)');
    expect(rate).toContain('.eq("user_id", userId)');
    expect(rate).not.toContain(".limit(1)");
  });

  it("una fuente parcial no borra una cotización sana", () => {
    expect(rate).toContain("if (rates.oficial) update.usd_rate_oficial");
    expect(rate).toContain("if (rates.blue) update.usd_rate_blue");
    expect(rate).toContain("AbortSignal.timeout(7_000)");
  });

  it("cumpleaños compara DATE en SQL y no depende de Evolution", () => {
    expect(birthday).toContain('"birthday_whatsapp_candidates"');
    expect(birthday).not.toContain('.like("birthday"');
    expect(birthday).not.toContain("getEvolutionCredentials");
    expect(migration).toContain("extract(month FROM c.birthday)");
    expect(migration).toContain("extract(day FROM c.birthday)");
  });

  it("la notificación proactiva usa plantilla Meta y falla cerrada sin aprobación", () => {
    expect(whatsapp).toContain('type: "template"');
    expect(birthday).toContain("platform_template_not_ready");
    expect(birthday).toContain("whatsapp_birthday_template");
    expect(settings).not.toContain("Requiere Evolution API y birthday cargado");
  });

  it("consentimiento, opt-in y deduplicación se imponen antes del envío", () => {
    expect(migration).toContain("c.marketing_consent_at IS NOT NULL");
    expect(migration).toContain("c.marketing_opt_out_at IS NULL");
    expect(migration).toContain("s.whatsapp_birthday_enabled IS TRUE");
    expect(migration).toContain("UNIQUE (org_id, customer_id, birthday_date)");
    expect(birthday.indexOf('status: "processing"')).toBeLessThan(
      birthday.indexOf("enviarPlantillaWhatsApp("),
    );
  });
});
