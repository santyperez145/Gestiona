import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import type { ReciboDeCobro } from "@/lib/reciboDeCobro";

/**
 * Nombre y CUIT del negocio para el encabezado del recibo. Se lee al abrir el
 * formulario, no al imprimir: la ventana de impresión tiene que abrirse en el
 * mismo clic o el navegador la bloquea. Si no se puede leer, el recibo sale
 * con el nombre de la organización y sin CUIT (y queda en consola).
 */
export function useNegocioParaRecibo(): ReciboDeCobro["negocio"] {
  const { activeOrg } = useOrg();
  const [negocio, setNegocio] = useState<ReciboDeCobro["negocio"]>({ nombre: activeOrg?.name ?? "Tu negocio" });

  useEffect(() => {
    if (!activeOrg?.id) return;
    let vivo = true;
    setNegocio({ nombre: activeOrg.name ?? "Tu negocio" });
    void supabase.from("settings").select("business_name, afip_cuit").eq("org_id", activeOrg.id).maybeSingle()
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) { console.error("Recibo: no se pudieron leer los datos del negocio", error); return; }
        setNegocio({ nombre: data?.business_name?.trim() || activeOrg.name || "Tu negocio", cuit: data?.afip_cuit ?? null });
      });
    return () => { vivo = false; };
  }, [activeOrg?.id, activeOrg?.name]);

  return negocio;
}
