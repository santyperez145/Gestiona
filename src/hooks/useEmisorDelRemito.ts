import { useEffect, useState } from "react";
import { useOrg } from "@/lib/orgContext";
import type { EmisorDelRemito } from "@/lib/remitos";
import { leerEmisor } from "@/lib/remitosDatos";

/**
 * Encabezado del remito (razón social, CUIT, domicilio, IIBB, inicio). Se lee
 * al montar y no al imprimir: la ventana de impresión tiene que abrirse en el
 * mismo clic o el navegador la bloquea.
 */
export function useEmisorDelRemito(activo = true): EmisorDelRemito {
  const { activeOrg } = useOrg();
  const respaldo = activeOrg?.name ?? "Tu negocio";
  const [emisor, setEmisor] = useState<EmisorDelRemito>({ nombre: respaldo });

  useEffect(() => {
    if (!activo || !activeOrg?.id) return;
    let vivo = true;
    void leerEmisor(activeOrg.id, respaldo).then(e => { if (vivo) setEmisor(e); });
    return () => { vivo = false; };
  }, [activo, activeOrg?.id, respaldo]);

  return emisor;
}
