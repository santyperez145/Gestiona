import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const src = (rel: string) => readFileSync(resolve(root, rel), "utf8");

/**
 * Guardia del despachador de notificaciones del chat (cierre del circuito):
 * la función existe, exige el secreto de cron, usa los RPCs server-side de la
 * cola, reutiliza el transporte de correo de la plataforma y está programada
 * en pg_cron por migración idempotente.
 */
describe("despachador de notificaciones del chat", () => {
  it("la edge function existe y sólo corre desde el cron", () => {
    const fn = src("supabase/functions/campaign-chat-dispatcher/index.ts");
    expect(fn).toContain("exigirCron");
    // La cola con autoridad en servidor decide qué se envía y con qué destino.
    expect(fn).toContain("campaign_chat_notifications_pending");
    expect(fn).toContain("campaign_chat_notification_result");
    expect(fn).toContain("campaign_chat_notifications_retry");
    // Mismo transporte de correo que el resto de la plataforma: ningún
    // remitente ni proveedor nuevo.
    expect(fn).toContain("remitenteDe");
    expect(fn).toContain("sendEmail");
  });

  it("el cron llama al despachador por el helper del vault y es idempotente", () => {
    const mig = src("supabase/migrations/20260925000600_campaign_chat_dispatcher_cron.sql");
    expect(mig).toContain("cron.unschedule('campaign-chat-dispatcher')");
    expect(mig).toContain("cron.schedule('campaign-chat-dispatcher'");
    expect(mig).toContain("public.invoke_edge_function('campaign-chat-dispatcher')");
  });

  it("el deploy lista la función como cron sin JWT, como el resto de los jobs", () => {
    for (const script of ["scripts/deploy-functions.sh", "scripts/deploy-functions.ps1"]) {
      const deploy = src(script);
      expect(deploy).toContain('"campaign-chat-dispatcher"');
    }
    // Está en la lista NO_JWT del sh (valida por secreto de cron).
    const sh = src("scripts/deploy-functions.sh");
    expect(sh.indexOf("campaign-chat-dispatcher")).toBeGreaterThan(sh.indexOf("NO_JWT=("));
  });
});