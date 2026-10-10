/**
 * El alta fiscal del emisor desde el padrón de ARCA.
 *
 * El tipo de emisor decide qué letra factura el comercio: un responsable
 * inscripto marcado como monotributista emite Factura C sin IVA discriminado.
 * Por eso se deduce del padrón cuando ARCA lo informa, y si dice «consumidor
 * final» (sin inscripción) no se adivina: el comercio tiene que elegir.
 */
import type { PersonaPadron } from "../../supabase/functions/_shared/padronA5";

export type TipoEmisor = "monotributo" | "responsable_inscripto" | "exento";

export function tipoEmisorDesdePadron(p: Pick<PersonaPadron, "condicionIva">): TipoEmisor | null {
  switch (p.condicionIva) {
    case "monotributo": return "monotributo";
    case "responsable_inscripto": return "responsable_inscripto";
    case "exento": return "exento";
    default: return null;
  }
}
