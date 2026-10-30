/**
 * Últimos ajustes de precio del negocio con «Deshacer» (2026-10-30,
 * migración 20261030000500). Muestra los de los últimos 30 días; sin la
 * migración no se muestra nada.
 */
import { useCallback, useEffect, useState } from "react";
import { History, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isMissingRelation } from "@/lib/publicDataSource";
import { describirAjuste, textoDeshacerAjuste, type AjusteDePrecio } from "@/lib/ajustesDePrecio";
import { Button } from "@/components/ui/button";

export default function UltimosAjustesDePrecio({ orgId, version = 0, onDone }: { orgId: string; version?: number; onDone: () => void }) {
  const [ajustes, setAjustes] = useState<AjusteDePrecio[] | null>(null);
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const desde = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { data, error } = await supabase.from("ajustes_de_precio" as never)
      .select("id, origen, parametros, productos, created_at, deshecho_at")
      .eq("org_id" as never, orgId as never).gte("created_at" as never, desde as never)
      .order("created_at" as never, { ascending: false }).limit(5);
    if (error) {
      if (!isMissingRelation(error)) {
        console.error("[ajustes de precio]", error);
        toast.error("No se pudieron leer los últimos ajustes de precio");
      }
      setAjustes([]);
      return;
    }
    setAjustes((data ?? []) as unknown as AjusteDePrecio[]);
  }, [orgId]);
  useEffect(() => { void cargar(); }, [cargar, version]);

  const deshacer = async (id: string) => {
    setOcupado(id);
    const { data, error } = await supabase.rpc("deshacer_ajuste_de_precios" as never, { p_ajuste: id } as never);
    setOcupado(null);
    setConfirmar(null);
    if (error) { console.error("[ajustes de precio] deshacer", error); toast.error(error.message || "No se pudo deshacer el ajuste"); return; }
    const r = data as { restaurados?: number; con_cambios_posteriores?: number } | null;
    toast.success(textoDeshacerAjuste({ restaurados: Number(r?.restaurados ?? 0), con_cambios_posteriores: Number(r?.con_cambios_posteriores ?? 0) }));
    onDone();
    await cargar();
  };

  if (!ajustes || ajustes.length === 0) return null;
  return (
    <section className="space-y-2 border-t border-border pt-4" aria-label="Últimos ajustes de precio">
      <h4 className="text-sm font-semibold flex items-center gap-1.5"><History className="w-4 h-4" />Últimos ajustes</h4>
      {ajustes.map(a => (
        <div key={a.id} className="flex items-center justify-between gap-3 text-sm">
          <div className="min-w-0">
            <p className="font-medium break-words">{describirAjuste(a)}</p>
            <p className="text-xs text-muted-foreground">
              {new Date(a.created_at).toLocaleString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              {" · "}{a.productos === 1 ? "1 producto" : `${a.productos} productos`}{a.deshecho_at ? " · deshecho" : ""}
            </p>
          </div>
          {!a.deshecho_at && a.productos > 0 && (confirmar === a.id ? (
            <span className="flex shrink-0 gap-1">
              <Button size="sm" variant="ghost" disabled={!!ocupado} onClick={() => setConfirmar(null)}>No</Button>
              <Button size="sm" variant="destructive" disabled={!!ocupado} onClick={() => void deshacer(a.id)}>
                {ocupado === a.id && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}Sí, deshacer
              </Button>
            </span>
          ) : (
            <Button size="sm" variant="outline" className="shrink-0" disabled={!!ocupado} onClick={() => setConfirmar(a.id)}
              title="Vuelve los precios a como estaban; no toca los que se editaron después">
              <Undo2 className="w-3.5 h-3.5 mr-1" />Deshacer
            </Button>
          ))}
        </div>
      ))}
    </section>
  );
}
