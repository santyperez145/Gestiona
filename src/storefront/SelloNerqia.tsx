/**
 * «Tienda hecha con Nerqia» al pie de cada tienda — distribución de TESIS §5.
 * El enlace lleva `?ref=<slug del comercio>`: quien da de alta un comercio
 * desde acá queda como referido por esta tienda (`origen_de_alta`). Las
 * tiendas con marca propia vigente no lo muestran (lo decide la base con
 * `marca_nerqia_de_tienda`); si la consulta falla, tampoco.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { enlaceSelloNerqia } from "@/lib/origenDeAlta";
import { BRAND_NAME } from "@/lib/brand";

export default function SelloNerqia({ slug }: { slug?: string | null }) {
  const [ref, setRef] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    let activo = true;
    supabase.rpc("marca_nerqia_de_tienda" as never, { p_slug: slug } as never).then(({ data, error }) => {
      if (!activo) return;
      if (error) {
        console.error("marca_nerqia_de_tienda", error);
        return;
      }
      const r = data as { mostrar?: boolean; ref?: string } | null;
      setRef(r?.mostrar && r.ref ? r.ref : null);
    });
    return () => { activo = false; };
  }, [slug]);

  if (!ref) return null;
  return (
    <p>
      <a href={enlaceSelloNerqia(ref)} target="_blank" rel="noopener" className="hover:underline">
        Tienda hecha con {BRAND_NAME}
      </a>
    </p>
  );
}
