/**
 * Categorías de la tienda, del lado del comercio.
 *
 * Hasta la sesión 94 los nombres estaban hardcodeados en `getCategoryLabel`:
 * cuatro entradas de perfumería. Quien vendiera otra cosa veía el slug crudo y
 * nadie podía renombrar, ordenar, esconder ni ponerle una foto a nada sin
 * tocar código. Eso es lo que Tiendanube deja hacer desde el primer día.
 *
 * El botón "Crear desde los productos" existe porque estrenar esta pantalla
 * con una lista vacía —teniendo el catálogo ya categorizado— obliga a tipear
 * lo que la base ya sabe. Es el mismo criterio que "Completar el tarifario".
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";
import {
  Tags, Plus, Trash2, Eye, EyeOff, ArrowUp, ArrowDown, Loader2, Wand2, Check, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import ImageUpload from "@/components/shared/ImageUpload";
import { plural } from "@/lib/plural";
import {
  slugDeNombre, validarNombre, validarPadre, arbolDeCategorias,
  type CategoriaTienda,
} from "@/lib/storeCategories";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface Fila extends CategoriaTienda {
  is_active: boolean;
  productos_reales: number;
}

export default function CategoriesEditor({ storeId }: { storeId: string | null }) {
  const { orgId } = useOrganization();
  const [filas, setFilas] = useState<Fila[]>([]);
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [nueva, setNueva] = useState("");
  const [editando, setEditando] = useState<string | null>(null);
  const [borrador, setBorrador] = useState("");

  const cargar = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const [{ data, error }, { data: prods }] = await Promise.all([
      supabase.from("ecommerce_categories")
        .select("id, name, slug, parent_id, image_url, description, sort_order, is_active")
        .eq("org_id", orgId)
        .order("sort_order").order("name"),
      supabase.from("products").select("category").eq("org_id", orgId).eq("is_active", true),
    ]);
    setLoading(false);
    // Sin `?? []`: vacío por permisos y "todavía no creó ninguna" se ven igual
    // y son cosas distintas.
    if (error) { toast.error("No se pudieron cargar las categorías"); return; }

    const conteo = new Map<string, number>();
    for (const p of (prods ?? []) as { category: string | null }[]) {
      if (p.category) conteo.set(p.category, (conteo.get(p.category) ?? 0) + 1);
    }
    setFilas(((data ?? []) as unknown as Fila[]).map(f => ({
      ...f, productos_reales: conteo.get(f.slug) ?? 0,
    })));
  }, [orgId]);

  useEffect(() => { cargar(); }, [cargar]);

  async function sembrar() {
    setGuardando(true);
    const { data, error } = await supabase.rpc("seed_store_categories", { p_org_id: orgId });
    setGuardando(false);
    if (error) { toast.error(error.message); return; }
    const creadas = (data as { creadas?: number } | null)?.creadas ?? 0;
    toast.success(
      creadas > 0
        ? `${creadas} ${creadas === 1 ? "categoría creada" : "categorías creadas"}`
        : "Ya estaban todas creadas",
      { description: "Renombralas y ordenalas como quieras: la tienda usa esto." },
    );
    cargar();
  }

  async function crear() {
    const error = validarNombre(nueva, filas);
    if (error) { toast.error(error); return; }
    setGuardando(true);
    const { error: err } = await supabase.from("ecommerce_categories").insert({
      org_id: orgId, store_id: storeId, name: nueva.trim(),
      slug: slugDeNombre(nueva), sort_order: filas.length, is_active: true,
    } as never);
    setGuardando(false);
    if (err) { toast.error(err.message); return; }
    setNueva("");
    toast.success("Categoría creada", {
      description: "Todavía no tiene productos: asignásela a alguno desde Productos.",
    });
    cargar();
  }

  async function renombrar(f: Fila) {
    const error = validarNombre(borrador, filas, f.id);
    if (error) { toast.error(error); return; }
    // El slug NO se toca al renombrar: es lo que `products.category` tiene
    // guardado, y cambiarlo dejaría los productos apuntando a una categoría
    // que ya no existe.
    const { error: err } = await supabase.from("ecommerce_categories")
      .update({ name: borrador.trim() } as never).eq("id", f.id);
    if (err) { toast.error(err.message); return; }
    setFilas(prev => prev.map(x => x.id === f.id ? { ...x, name: borrador.trim() } : x));
    setEditando(null);
    toast.success("Nombre actualizado");
  }

  async function ponerPadre(f: Fila, parentId: string | null) {
    const error = validarPadre(f.id, parentId, filas);
    if (error) { toast.error(error); return; }
    const { error: err } = await supabase.from("ecommerce_categories")
      .update({ parent_id: parentId } as never).eq("id", f.id);
    if (err) { toast.error(err.message); return; }
    setFilas(prev => prev.map(x => x.id === f.id ? { ...x, parent_id: parentId } : x));
    toast.success(parentId ? "Ahora es una subcategoría" : "Ahora es una categoría principal");
  }

  async function alternar(f: Fila) {
    const nuevo = !f.is_active;
    const { error } = await supabase.from("ecommerce_categories")
      .update({ is_active: nuevo } as never).eq("id", f.id);
    if (error) { toast.error(error.message); return; }
    setFilas(prev => prev.map(x => x.id === f.id ? { ...x, is_active: nuevo } : x));
    toast.success(nuevo ? "Visible en la tienda" : "Oculta de la tienda");
  }

  async function mover(f: Fila, delta: number) {
    const i = filas.findIndex(x => x.id === f.id);
    const j = i + delta;
    if (j < 0 || j >= filas.length) return;
    const reordenadas = [...filas];
    [reordenadas[i], reordenadas[j]] = [reordenadas[j], reordenadas[i]];
    setFilas(reordenadas);
    // Se persiste el orden de las dos que se movieron, no de toda la lista.
    await Promise.all([
      supabase.from("ecommerce_categories").update({ sort_order: j } as never).eq("id", f.id),
      supabase.from("ecommerce_categories").update({ sort_order: i } as never).eq("id", reordenadas[i].id),
    ]);
  }

  async function borrar(f: Fila) {
    if (f.productos_reales > 0) {
      toast.error(`Tiene ${plural(f.productos_reales, "producto")}`, {
        description: "Cambiales la categoría antes de borrarla, o escondela en vez de borrar.",
      });
      return;
    }
    if (!confirm(`¿Borrar la categoría "${f.name}"?`)) return;
    const { error } = await supabase.from("ecommerce_categories").delete().eq("id", f.id);
    if (error) { toast.error(error.message); return; }
    setFilas(prev => prev.filter(x => x.id !== f.id));
    toast.success("Categoría borrada");
  }

  async function ponerImagen(f: Fila, url: string | null) {
    const { error } = await supabase.from("ecommerce_categories")
      .update({ image_url: url } as never).eq("id", f.id);
    if (error) { toast.error(error.message); return; }
    setFilas(prev => prev.map(x => x.id === f.id ? { ...x, image_url: url } : x));
  }

  // Padre, después sus hijas. Una lista plana con las subcategorías mezcladas
  // no deja ver la jerarquía que se está armando.
  const ordenJerarquico = (() => {
    const porId = new Map(filas.map(f => [f.id, f]));
    const salida: { fila: Fila; nivel: number }[] = [];
    for (const raiz of arbolDeCategorias(filas)) {
      const f = porId.get(raiz.id);
      if (f) salida.push({ fila: f, nivel: 0 });
      for (const hijo of raiz.hijos) {
        const h = porId.get(hijo.id);
        if (h) salida.push({ fila: h, nivel: 1 });
      }
    }
    return salida;
  })();

  if (loading) {
    return <div className="py-12 grid place-items-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border/60 rounded-[10px] px-4 py-3 flex items-center gap-3 flex-wrap">
        <Tags className="w-4 h-4 text-primary shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm">Categorías de la tienda</p>
          <p className="text-[11px] text-muted-foreground">
            El nombre, el orden y la foto que ve el comprador. Mientras no crees
            ninguna, la tienda sigue mostrando los nombres por defecto.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={sembrar} disabled={guardando}>
          {guardando ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Wand2 className="w-4 h-4 mr-1" />}
          Crear desde los productos
        </Button>
      </div>

      <div className="flex gap-2">
        <Input
          value={nueva}
          onChange={e => setNueva(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") crear(); }}
          placeholder="Nombre de una categoría nueva"
          className="max-w-xs"
        />
        <Button variant="outline" onClick={crear} disabled={!nueva.trim() || guardando}>
          <Plus className="w-4 h-4 mr-1" /> Agregar
        </Button>
      </div>

      {filas.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-10 text-center">
          <Tags className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40" />
          <p className="font-medium">Todavía no hay categorías propias</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            La tienda funciona igual: usa los nombres por defecto. Creá las tuyas
            para poder renombrarlas, ordenarlas y ponerles una foto.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {ordenJerarquico.map(({ fila: f, nivel }, i) => (
            <div
              key={f.id}
              className="bg-card border border-border rounded-xl p-3"
              style={nivel > 0 ? { marginLeft: `${nivel * 1.5}rem` } : undefined}
            >
              <div className="flex items-start gap-3 flex-wrap">
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button
                    onClick={() => mover(f, -1)} disabled={filas.indexOf(f) === 0}
                    className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-25"
                    aria-label="Subir"
                  ><ArrowUp className="w-3.5 h-3.5" /></button>
                  <button
                    onClick={() => mover(f, 1)} disabled={filas.indexOf(f) === filas.length - 1}
                    className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-25"
                    aria-label="Bajar"
                  ><ArrowDown className="w-3.5 h-3.5" /></button>
                </div>

                <div className="min-w-0 flex-1">
                  {editando === f.id ? (
                    <div className="flex gap-2 items-center">
                      <Input
                        value={borrador} autoFocus
                        onChange={e => setBorrador(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter") renombrar(f);
                          if (e.key === "Escape") setEditando(null);
                        }}
                        className="h-8 max-w-xs"
                      />
                      <Button size="sm" className="h-8" onClick={() => renombrar(f)}>
                        <Check className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="sm" variant="outline" className="h-8" onClick={() => setEditando(null)}>
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setEditando(f.id); setBorrador(f.name); }}
                      className="font-medium text-sm hover:underline text-left"
                      title="Tocá para renombrar"
                    >
                      {f.name}
                    </button>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    <code>{f.slug}</code> · {f.productos_reales}{" "}
                    {f.productos_reales === 1 ? "producto" : "productos"}
                    {f.productos_reales === 0 && " · no se muestra en la tienda hasta que tenga alguno"}
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {!f.is_active && (
                    <Badge className="bg-zinc-500/15 text-zinc-400 border-zinc-500/20 text-[11px]">Oculta</Badge>
                  )}
                  <Select
                    value={f.parent_id ?? "__raiz__"}
                    onValueChange={v => ponerPadre(f, v === "__raiz__" ? null : v)}
                  >
                    <SelectTrigger className="h-8 w-[11rem] text-xs">
                      <SelectValue placeholder="Categoría principal" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__raiz__">Categoría principal</SelectItem>
                      {/* Sólo las de primer nivel: dos niveles alcanzan y es lo
                          que el menú puede desplegar sin volverse un árbol de
                          carpetas. */}
                      {filas
                        .filter(o => o.id !== f.id && !o.parent_id)
                        .map(o => (
                          <SelectItem key={o.id} value={o.id}>Dentro de {o.name}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => alternar(f)}>
                    {f.is_active
                      ? <><EyeOff className="w-3 h-3" />Ocultar</>
                      : <><Eye className="w-3 h-3" />Mostrar</>}
                  </Button>
                  <Button
                    size="sm" variant="outline" className="gap-1.5 text-xs"
                    onClick={() => borrar(f)}
                    title={f.productos_reales > 0 ? "Tiene productos: escondela en vez de borrarla" : "Borrar"}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>

              <div className="mt-3 pl-7">
                <Label className="text-xs mb-1 block">Foto de la categoría (opcional)</Label>
                <ImageUpload
                  value={f.image_url ?? null}
                  onChange={url => ponerImagen(f, url)}
                  orgId={orgId ?? null}
                  carpeta="categorias"
                  preset="banner"
                  alto="h-24"
                  etiqueta="Subí una foto"
                  ayuda="Se ve en la portada. Sin foto propia se usa la de un producto."
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
