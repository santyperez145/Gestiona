/**
 * Ticket de WSAA del comercio para los servicios que no son wsfe (wsfecred,
 * wsfex…), guardado en `afip_ta_por_servicio`.
 *
 * WSAA entrega un ticket por certificado y servicio, y rechaza otro mientras
 * el anterior viva (~12 h). Se reusa el guardado; si hay que pedir uno, se
 * pide de a uno con un lease: el que pierde espera a que el otro lo guarde.
 *
 * ⚠️ Sólo con el certificado propio del comercio (ADR 007). Con el de la
 * plataforma el ticket sería uno para todos y no puede guardarse por
 * comercio: quien llama tiene que exigir `modo === "propio"`.
 */
import { pedirTicketWsaa } from "./wsaaLogin.ts";

export type AmbienteArca = "produccion" | "homologacion";

export const WSAA_URL: Record<AmbienteArca, string> = {
  produccion: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
  homologacion: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
};

export async function ticketPorServicio(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  a: { orgId: string; servicio: string; environment: AmbienteArca; certificate: string; privateKey: string },
): Promise<{ token: string; sign: string }> {
  const vigente = (exp: string | null | undefined) => !!exp && new Date(exp) > new Date(Date.now() + 5 * 60_000);
  const leer = async () => (await supabase.from("afip_ta_por_servicio").select("token, sign, expires_at")
    .eq("org_id", a.orgId).eq("servicio", a.servicio).eq("environment", a.environment).maybeSingle()).data;

  const guardado = await leer();
  if (guardado && vigente(guardado.expires_at)) return guardado;

  const clave = `afip:ta:${a.orgId}:${a.servicio}:${a.environment}`;
  const { data: gane } = await supabase.rpc("afip_ta_lease_tomar", { p_clave: clave, p_segundos: 45 });
  if (!gane) {
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 1500));
      const otro = await leer();
      if (otro && vigente(otro.expires_at)) return otro;
    }
  }
  try {
    const ta = await pedirTicketWsaa(WSAA_URL[a.environment], a.certificate, a.privateKey, a.servicio);
    const { error } = await supabase.from("afip_ta_por_servicio").upsert({
      org_id: a.orgId, servicio: a.servicio, environment: a.environment,
      token: ta.token, sign: ta.sign, expires_at: ta.expiresAt, updated_at: new Date().toISOString(),
    });
    if (error) console.error(`[${a.servicio}] no se guardó el ticket`, error.message);
    return { token: ta.token, sign: ta.sign };
  } finally {
    const { error } = await supabase.rpc("afip_ta_lease_soltar", { p_clave: clave });
    if (error) console.error(`[${a.servicio}] no se soltó el lease`, error.message);
  }
}
