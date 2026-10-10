/**
 * Consulta de CUIT al padrón de ARCA (Edge `arca-padron`) y su traducción a
 * la identidad fiscal del cliente.
 */
import { supabase } from "@/integrations/supabase/client";
import type { IdentidadFiscalCliente } from "@/lib/customerFiscal";
import type { PersonaPadron } from "../../supabase/functions/_shared/padronA5";

export type { PersonaPadron };

export type ResultadoPadron =
  | { ok: true; persona: PersonaPadron; desdeCache: boolean }
  | { ok: false; error: string; code?: string };

export async function consultarPadron(orgId: string, cuit: string): Promise<ResultadoPadron> {
  const { data, error } = await supabase.functions.invoke("arca-padron", { body: { org_id: orgId, cuit } });
  if (error) return { ok: false, error: "No pudimos consultar ARCA. Revisá la conexión o cargá los datos a mano." };
  const r = data as { ok?: boolean; persona?: PersonaPadron; desde_cache?: boolean; error?: string; code?: string } | null;
  if (!r?.ok || !r.persona) return { ok: false, error: r?.error ?? "ARCA no devolvió datos.", code: r?.code };
  return { ok: true, persona: r.persona, desdeCache: !!r.desde_cache };
}

/** Domicilio en una línea: calle, localidad, provincia y CP. */
export function domicilioPadron(p: PersonaPadron): string {
  return [p.domicilio, p.localidad, p.provincia, p.codigoPostal ? `CP ${p.codigoPostal}` : null].filter(Boolean).join(", ");
}

/** Completa la identidad fiscal con lo del padrón; conserva el CUIT tipeado. */
export function identidadDesdePadron(actual: IdentidadFiscalCliente, p: PersonaPadron): IdentidadFiscalCliente {
  return {
    ...actual,
    vat_condition: p.condicionIva,
    legal_name: p.nombre,
    fiscal_address: domicilioPadron(p) || actual.fiscal_address,
  };
}
