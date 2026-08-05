/**
 * El menú del header, armado por el comercio.
 *
 * Antes se armaba solo: Inicio, Productos, las dos primeras categorías y
 * Ofertas. Servía para arrancar y no se podía tocar — ni sacar un link, ni
 * renombrarlo, ni subir "Cómo comprar" que vive escondida en el pie.
 *
 * Mientras la lista esté vacía, la tienda sigue armando el menú sola. Eso está
 * dicho en pantalla: si no, se lee como que el menú desapareció.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";
import { Menu, Plus, Trash2, ArrowUp, ArrowDown, Loader2, Save, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { TIPOS, validarLink, type LinkMenu, type TipoLink } from "@/lib/storeMenu";

interface Props {
  storeSlug: string | null;
  /** Para el desplegable de categorías. */
  categorias: { slug: string; name: string }[];
  /** Para el desplegable de páginas. */
  paginas: { slug: string; title: string }[];
}

export default function MenuEditor({ storeSlug, categorias, paginas }: Props) {
  const { orgId } = useOrganization();
  const [links, setLinks] = useState<LinkMenu[]>([]);
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [sucio, setSucio] = useState(false);

  const cargar = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("ecommerce_stores").select("nav_links").eq("org_id", orgId).maybeSingle();
    setLoading(false);
    if (error) { toast.error("No se pudo cargar el menú"); return; }
    const raw = (data as { nav_links?: unknown } | null)?.nav_links;
    setLinks(Array.isArray(raw) ? (raw as LinkMenu[]) : []);
    setSucio(false);
  }, [orgId]);

  useEffect(() => { cargar(); }, [cargar]);

  const editar = (i: number, cambio: Partial<LinkMenu>) => {
    setLinks(prev => prev.map((l, j) => j === i ? { ...l, ...cambio } : l));
    setSucio(true);
  };

  const agregar = () => {
    setLinks(prev => [...prev, { label: "", tipo: "productos", valor: null }]);
    setSucio(true);
  };

  const quitar = (i: number) => {
    setLinks(prev => prev.filter((_, j) => j !== i));
    setSucio(true);
  };

  const mover = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= links.length) return;
    setLinks(prev => {
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setSucio(true);
  };

  /** Arranca desde el menú que la tienda ya muestra, para no tipear de cero. */
  const partirDelAutomatico = () => {
    setLinks([
      { label: "Inicio", tipo: "inicio", valor: null },
      { label: "Productos", tipo: "productos", valor: null },
      ...categorias.slice(0, 2).map(c => ({
        label: c.name, tipo: "categoria" as TipoLink, valor: c.slug,
      })),
      { label: "Ofertas", tipo: "ofertas", valor: null },
    ]);
    setSucio(true);
    toast.success("Copiado el menú actual", {
      description: "Editalo y guardá. Hasta que guardes no cambia nada en la tienda.",
    });
  };

  async function guardar() {
    // Se valida todo antes de escribir: guardar la mitad dejaría el menú a
    // medio armar y sin forma de saber cuál falló.
    for (const [i, l] of links.entries()) {
      const error = validarLink(l);
      if (error) { toast.error(`Link ${i + 1}: ${error}`); return; }
    }
    setGuardando(true);
    const { error } = await supabase
      .from("ecommerce_stores")
      .update({ nav_links: links as never } as never)
      .eq("org_id", orgId);
    setGuardando(false);
    if (error) { toast.error("No se pudo guardar: " + error.message); return; }
    setSucio(false);
    toast.success(
      links.length === 0 ? "Menú vacío: la tienda vuelve a armarlo sola" : "Menú guardado",
    );
  }

  if (loading) {
    return <div className="py-12 grid place-items-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border/60 rounded-[10px] px-4 py-3 flex items-center gap-3 flex-wrap">
        <Menu className="w-4 h-4 text-primary shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm">Menú de la tienda</p>
          <p className="text-[11px] text-muted-foreground">
            {links.length === 0
              ? "Vacío: la tienda arma el menú sola con Inicio, Productos, dos categorías y Ofertas."
              : `${links.length} ${links.length === 1 ? "link" : "links"} en el header, el menú del celular y el pie.`}
          </p>
        </div>
        {links.length === 0 && (
          <Button size="sm" variant="outline" onClick={partirDelAutomatico}>
            <Wand2 className="w-4 h-4 mr-1" /> Partir del actual
          </Button>
        )}
      </div>

      <div className="space-y-2">
        {links.map((l, i) => {
          const tipo = TIPOS.find(t => t.id === l.tipo);
          return (
            <div key={i} className="bg-card border border-border rounded-xl p-3 flex items-start gap-3 flex-wrap">
              <div className="flex flex-col gap-0.5 shrink-0 pt-5">
                <button
                  onClick={() => mover(i, -1)} disabled={i === 0}
                  className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-25"
                  aria-label="Subir"
                ><ArrowUp className="w-3.5 h-3.5" /></button>
                <button
                  onClick={() => mover(i, 1)} disabled={i === links.length - 1}
                  className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-25"
                  aria-label="Bajar"
                ><ArrowDown className="w-3.5 h-3.5" /></button>
              </div>

              <div className="min-w-[9rem] flex-1">
                <Label className="text-xs">Texto</Label>
                <Input
                  className="h-9" value={l.label}
                  onChange={e => editar(i, { label: e.target.value })}
                  placeholder="Cómo comprar"
                />
              </div>

              <div className="min-w-[10rem]">
                <Label className="text-xs">Lleva a</Label>
                <Select
                  value={l.tipo}
                  onValueChange={v => editar(i, { tipo: v as TipoLink, valor: null })}
                >
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIPOS.map(t => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {tipo?.pideValor && (
                <div className="min-w-[11rem] flex-1">
                  <Label className="text-xs">
                    {l.tipo === "url" ? "Dirección" : l.tipo === "pagina" ? "Página" : "Categoría"}
                  </Label>
                  {l.tipo === "url" ? (
                    <Input
                      className="h-9" value={l.valor ?? ""}
                      onChange={e => editar(i, { valor: e.target.value })}
                      placeholder="https://instagram.com/mitienda"
                    />
                  ) : (
                    <Select
                      value={l.valor ?? ""}
                      onValueChange={v => editar(i, { valor: v })}
                    >
                      <SelectTrigger className="h-9"><SelectValue placeholder="Elegí" /></SelectTrigger>
                      <SelectContent>
                        {(l.tipo === "categoria" ? categorias : paginas).map(o => {
                          const value = o.slug;
                          const label = "name" in o ? o.name : (o as { title: string }).title;
                          return <SelectItem key={value} value={value}>{label}</SelectItem>;
                        })}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              <Button
                size="sm" variant="outline" className="mt-5"
                onClick={() => quitar(i)} aria-label="Quitar"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          );
        })}
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <Button variant="outline" onClick={agregar}>
          <Plus className="w-4 h-4 mr-1" /> Agregar link
        </Button>
        <Button onClick={guardar} disabled={guardando || !sucio}>
          {guardando ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
          Guardar menú
        </Button>
        {sucio && <span className="text-xs text-muted-foreground">Sin guardar</span>}
        {storeSlug && (
          <a
            href={`/tienda/${storeSlug}`} target="_blank" rel="noopener noreferrer"
            className="text-xs text-primary hover:underline ml-auto"
          >
            Ver la tienda
          </a>
        )}
      </div>

      {links.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Un link que no lleve a ningún lado —una categoría borrada, una página
          despublicada— no se muestra. Si ninguno queda en pie, la tienda vuelve a
          armar el menú sola: el header no puede quedarse sin forma de llegar al
          catálogo.
        </p>
      )}
    </div>
  );
}
