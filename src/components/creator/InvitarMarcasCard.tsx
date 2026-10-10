/**
 * «Invitá marcas a Nerqia» — E4 de docs/TESIS.md («Creators trae marcas»).
 * Cada creador tiene un enlace propio (`ref=@<slug público>`, migración
 * 20261010002400): la marca que se da de alta desde ahí queda referida por el
 * creador, y acá ve cuántas trajo. Sin slug público no hay enlace: se pide
 * completarlo en el perfil.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { enlaceInvitacionCreador } from "@/lib/origenDeAlta";
import { plural } from "@/lib/plural";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface MarcasQueTrajo {
  slug: string | null;
  total: number;
  marcas: { nombre: string; desde: string }[];
}

/** `activa`: sólo pide datos con la pestaña Perfil a la vista (se monta oculta). */
export default function InvitarMarcasCard({ activa }: { activa: boolean }) {
  const [datos, setDatos] = useState<MarcasQueTrajo | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!activa || datos) return;
    let activo = true;
    supabase.rpc("marcas_que_trajo_el_creador" as never).then(({ data, error: rpcError }) => {
      if (!activo) return;
      if (rpcError) {
        console.error("marcas_que_trajo_el_creador", rpcError);
        setError(true);
        return;
      }
      setDatos(data as unknown as MarcasQueTrajo);
    });
    return () => { activo = false; };
  }, [activa, datos]);

  if (error) return null;
  const enlace = datos?.slug ? enlaceInvitacionCreador(datos.slug) : null;

  const copiar = async () => {
    if (!enlace) return;
    try {
      await navigator.clipboard.writeText(enlace);
      toast.success("Enlace copiado");
    } catch {
      toast.error("No se pudo copiar; seleccioná el enlace y copialo a mano");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Invitá marcas a Nerqia</CardTitle>
        <p className="text-sm text-muted-foreground">
          Si una marca con la que trabajás se da de alta con tu enlace, queda registrada como invitada por vos.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {!datos ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : !enlace ? (
          <p className="text-sm text-muted-foreground">Elegí tu enlace público en el perfil para tener tu enlace de invitación.</p>
        ) : (
          <>
            <div className="flex gap-2">
              <Input readOnly value={enlace} aria-label="Tu enlace para invitar marcas" onFocus={e => e.currentTarget.select()} />
              <Button type="button" variant="outline" onClick={() => void copiar()}>Copiar</Button>
            </div>
            <p className="text-sm">
              {datos.total === 0
                ? "Todavía ninguna marca se dio de alta con tu enlace."
                : `${plural(datos.total, "marca")} se ${datos.total === 1 ? "dio" : "dieron"} de alta con tu enlace: ${datos.marcas.map(m => m.nombre).join(", ")}.`}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
