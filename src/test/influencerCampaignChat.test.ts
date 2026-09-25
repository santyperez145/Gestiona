import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const src = (rel: string) => readFileSync(resolve(root, rel), "utf8");

/**
 * Guardias del chat por colaboración (paridad Go-Marz).
 * El servidor decide quién puede leer/escribir; el cliente nunca declara
 * la org ni el creador.
 */
describe("chat por colaboración", () => {
  it("la migración crea el hilo con RLS propia y RPCs con autoridad en servidor", () => {
    const mig = src("supabase/migrations/20260925000400_influencer_campaign_chat.sql");
    expect(mig).toContain("CREATE TABLE IF NOT EXISTS public.influencer_campaign_messages");
    expect(mig).toContain("author_role");
    expect(mig).toContain("ALTER TABLE public.influencer_campaign_messages ENABLE ROW LEVEL SECURITY");
    // Autoridad en servidor: la marca y el creador se resuelven en el RPC.
    expect(mig).toContain("public.campaign_chat_list");
    expect(mig).toContain("public.campaign_chat_send");
    // El cliente nunca declara la org: sale de influencer_campaigns.
    expect(mig).toContain("SELECT org_id INTO v_org FROM public.influencer_campaigns");
    // El chat es sólo con creadores asignados a la campaña.
    expect(mig).toContain("influencer_campaign_creators");
    // Anti-spam.
    expect(mig).toContain("chat_rate_limited");
    // Sin acceso anónimo.
    expect(mig).toContain("REVOKE ALL ON FUNCTION public.campaign_chat_send(uuid, text, uuid) FROM PUBLIC, anon");
    // El portal del creador ve el resumen del hilo junto a su campaña.
    expect(mig).toContain("chat_last_body");
  });

  it("la verificación reversible existe y prueba ambos lados", () => {
    const verify = src("supabase/verificaciones/20260925_influencer_campaign_chat.sql");
    expect(verify).toContain("ROLLBACK");
    expect(verify).toContain("campaign_chat_send");
    expect(verify).toContain("creator_accounts");
    expect(verify).toContain("rollback_intencional");
  });

  it("el lado marca usa el RPC y traduce errores legibles", () => {
    const db = src("src/lib/campaignChatDB.ts");
    expect(db).toContain("campaign_chat_list");
    expect(db).toContain("campaign_chat_send");
    expect(db).toContain("chat_rate_limited");
    // Nunca inserta directo en la tabla: toda escritura pasa por el RPC.
    expect(db).not.toContain('.from("influencer_campaign_messages")');
  });

  it("el panel de marca existe y el editor de campañas lo monta por creador", () => {
    const panel = src("src/components/influencers/CampaignChatPanel.tsx");
    expect(panel).toContain("listCampaignChat");
    expect(panel).toContain("sendCampaignChatMessage");
    const page = src("src/pages/InfluencerCampaignsPage.tsx");
    expect(page).toContain("CampaignChatPanel");
    expect(page).toContain("campaignId={campaign.id}");
  });

  it("el portal del creador expone el chat junto a la campaña", () => {
    const portal = src("src/pages/CreatorPortalPage.tsx");
    expect(portal).toContain("listChat");
    expect(portal).toContain("sendChat");
    expect(portal).toContain("Ver chat");
    const ctx = src("src/lib/creatorContext.tsx");
    expect(ctx).toContain("campaign_chat_list");
    expect(ctx).toContain("campaign_chat_send");
    expect(ctx).toContain("chat_last_body");
  });

  it("las notificaciones del chat son consentidas y con autoridad en servidor", () => {
    const mig = src("supabase/migrations/20260925000500_influencer_chat_notifications.sql");
    expect(mig).toContain("CREATE TABLE IF NOT EXISTS public.influencer_chat_notify_prefs");
    expect(mig).toContain("CREATE TABLE IF NOT EXISTS public.influencer_chat_notifications");
    expect(mig).toContain("trg_campaign_chat_enqueue");
    // Sin consentimiento no hay fila: la preferencia la decide el destinatario.
    expect(mig).toContain("campaign_chat_notify_get");
    expect(mig).toContain("campaign_chat_notify_set");
    // El despacho es de service_role: el cliente no marca resultados.
    expect(mig).toContain("GRANT EXECUTE ON FUNCTION public.campaign_chat_notifications_pending() TO service_role");
    expect(mig).toContain("GRANT EXECUTE ON FUNCTION public.campaign_chat_notification_result(uuid, boolean, text) TO service_role");
    expect(mig).toContain("GRANT EXECUTE ON FUNCTION public.campaign_chat_notifications_retry() TO service_role");
    const verify = src("supabase/verificaciones/20260925_influencer_chat_notifications.sql");
    expect(verify).toContain("ROLLBACK");
    expect(verify).toContain("campaign_chat_notify_set");
    expect(verify).toContain("campaign_chat_notifications_pending");
    // La cola no expone filas sin destino real (sin correo / sin suscripción).
    expect(verify).toContain("sin suscripción push registrada la cola debe exponer sólo el email");
    // UI: el consentimiento es editable en ambos portales.
    const panel = src("src/components/influencers/CampaignChatPanel.tsx");
    expect(panel).toContain("setChatNotifyPrefs");
    const portal = src("src/pages/CreatorPortalPage.tsx");
    expect(portal).toContain("ChatNotifyCard");
    const db = src("src/lib/campaignChatDB.ts");
    expect(db).toContain("campaign_chat_notify_get");
    expect(db).toContain("campaign_chat_notify_set");
  });
});
