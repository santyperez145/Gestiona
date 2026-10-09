/**
 * Vencimiento del certificado ARCA de la plataforma.
 *
 * Con un único certificado delegado, si vence dejan de facturar todos los
 * comercios. El aviso escala a 60, 30 y 7 días: renovarlo exige generar un
 * CSR, que ARCA emita el CRT y cargarlo, y ese trámite no es instantáneo.
 */
export type NivelVencimiento = "ok" | "aviso" | "urgente" | "critico" | "vencido" | "desconocido";

export function vencimientoCertificado(expiresAt: string | null | undefined, ahora: Date = new Date()): { nivel: NivelVencimiento; dias: number | null; mensaje: string } {
  const fin = expiresAt ? Date.parse(expiresAt) : NaN;
  if (!Number.isFinite(fin)) return { nivel: "desconocido", dias: null, mensaje: "La vigencia del certificado no está registrada. Volvé a cargarlo para que Nerqia controle su vencimiento." };
  const dias = Math.floor((fin - ahora.getTime()) / 86_400_000);
  if (dias < 0) return { nivel: "vencido", dias, mensaje: "El certificado venció: ARCA rechaza la facturación de todos los comercios delegados. Renovalo ahora." };
  if (dias <= 7) return { nivel: "critico", dias, mensaje: `Vence en ${dias} ${dias === 1 ? "día" : "días"}. Generá el CSR, pedí el CRT en ARCA y cargalo hoy.` };
  if (dias <= 30) return { nivel: "urgente", dias, mensaje: `Vence en ${dias} días. Iniciá la renovación: el trámite en ARCA puede demorar.` };
  if (dias <= 60) return { nivel: "aviso", dias, mensaje: `Vence en ${dias} días. Planificá la renovación del certificado.` };
  return { nivel: "ok", dias, mensaje: `Vigente por ${dias} días más.` };
}
