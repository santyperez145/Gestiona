// Sello «Hecho con Nerqia» en lo que el comercio le entrega a su cliente:
// tickets de caja, facturas y presupuestos (TESIS §5: distribución en tiendas
// y tickets). Lleva el slug del comercio para medir altas referidas
// (`origen_de_alta`). Con marca propia vigente (`org_entitlements.branding`,
// la misma fuente que la tienda) no va; ante cualquier error, tampoco.
import { supabase } from "@/integrations/supabase/client";
import { BRAND_DOMAIN, BRAND_NAME } from "@/lib/brand";

export async function selloHechoConNerqia(orgId: string): Promise<string | null> {
  try {
    const [derechos, org] = await Promise.all([
      supabase.rpc("org_entitlements", { p_org: orgId }),
      supabase.from("organizations").select("slug").eq("id", orgId).maybeSingle(),
    ]);
    const branding = (derechos.data as { branding?: boolean } | null)?.branding;
    const slug = (org.data as { slug?: string } | null)?.slug;
    if (derechos.error || org.error || branding !== false || !slug) return null;
    return `Hecho con ${BRAND_NAME} · ${BRAND_DOMAIN}/?ref=${slug.toLowerCase()}`;
  } catch (cause) {
    console.error("[sello Nerqia]", cause);
    return null;
  }
}
