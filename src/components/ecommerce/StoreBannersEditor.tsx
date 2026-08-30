/**
 * Editor de banners de la home de la tienda.
 *
 * El campo que más se olvida es el texto alternativo, así que se pide arriba y
 * se avisa cuando falta: sin él el banner no existe para un lector de pantalla
 * ni para Google.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import ImageUpload from "@/components/shared/ImageUpload";
import {
  Image as ImageIcon, Plus, Trash2, Loader2, ArrowUp, ArrowDown, AlertTriangle, Save,
} from "lucide-react";

interface BannerRow {
  id: string;
  image_url: string;
  image_url_mobile: string | null;
  title: string | null;
  subtitle: string | null;
  link_url: string | null;
  cta_label: string | null;
  alt_text: string | null;
  sort_order: number;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
}

const COLS = "id, image_url, image_url_mobile, title, subtitle, link_url, cta_label, alt_text, sort_order, is_active, starts_at, ends_at";

/** `timestamptz` → valor de un <input type="datetime-local"> en hora local. */
const aLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
};

export default function StoreBannersEditor({ storeId }: { storeId: string | null }) {
  const { orgId } = useOrganization();
  const [banners, setBanners] = useState<BannerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [imagenesRotas, setImagenesRotas] = useState<Set<string>>(() => new Set());

  const cargar = useCallback(async () => {
    if (!orgId || !storeId) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("store_banners").select(COLS)
      .eq("store_id", storeId).order("sort_order");
    setLoading(false);
    if (error) { toast.error("No se pudieron cargar los banners"); return; }
    setBanners((data ?? []) as BannerRow[]);
  }, [orgId, storeId]);

  useEffect(() => { cargar(); }, [cargar]);

  const editar = (id: string, patch: Partial<BannerRow>) =>
    setBanners(prev => prev.map(b => (b.id === id ? { ...b, ...patch } : b)));

  const registrarValidez = useCallback((id: string, valid: boolean) => {
    setImagenesRotas(prev => {
      const next = new Set(prev);
      if (valid) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const crear = async () => {
    if (!orgId || !storeId) return;
    const { data, error } = await supabase
      .from("store_banners")
      .insert({
        org_id: orgId, store_id: storeId, image_url: "",
        sort_order: (banners.at(-1)?.sort_order ?? 0) + 1,
        is_active: false,
      })
      .select(COLS).single();
    if (error) { toast.error("No se pudo crear"); return; }
    setBanners(prev => [...prev, data as BannerRow]);
  };

  const guardar = async (b: BannerRow) => {
    if (!b.image_url.trim()) { toast.error("Falta la URL de la imagen"); return; }
    if (b.is_active && imagenesRotas.has(b.id)) {
      toast.error("La imagen no responde. Reemplazala antes de activar el banner.");
      return;
    }
    setGuardando(b.id);
    const { error } = await supabase.from("store_banners").update({
      image_url: b.image_url.trim(),
      image_url_mobile: b.image_url_mobile?.trim() || null,
      title: b.title?.trim() || null,
      subtitle: b.subtitle?.trim() || null,
      link_url: b.link_url?.trim() || null,
      cta_label: b.cta_label?.trim() || null,
      alt_text: b.alt_text?.trim() || null,
      is_active: b.is_active,
      starts_at: b.starts_at || null,
      ends_at: b.ends_at || null,
      sort_order: b.sort_order,
    }).eq("id", b.id);
    setGuardando(null);
    if (error) { toast.error("No se pudo guardar"); return; }
    toast.success(b.is_active ? "Banner guardado y activo" : "Banner guardado (inactivo)");
  };

  const borrar = async (b: BannerRow) => {
    const { error } = await supabase.from("store_banners").delete().eq("id", b.id);
    if (error) { toast.error("No se pudo eliminar"); return; }
    setBanners(prev => prev.filter(x => x.id !== b.id));
    toast.success("Banner eliminado");
  };

  /** Intercambia el orden con el vecino y persiste ambos. */
  const mover = async (b: BannerRow, dir: -1 | 1) => {
    const idx = banners.findIndex(x => x.id === b.id);
    const otro = banners[idx + dir];
    if (!otro) return;
    const next = [...banners];
    next[idx] = { ...b, sort_order: otro.sort_order };
    next[idx + dir] = { ...otro, sort_order: b.sort_order };
    next.sort((x, y) => x.sort_order - y.sort_order);
    setBanners(next);
    await Promise.all([
      supabase.from("store_banners").update({ sort_order: otro.sort_order }).eq("id", b.id),
      supabase.from("store_banners").update({ sort_order: b.sort_order }).eq("id", otro.id),
    ]);
  };

  if (!storeId) {
    return (
      <div className="bg-card border border-border rounded-xl p-10 text-center text-sm text-muted-foreground">
        Creá la tienda antes de cargar banners.
      </div>
    );
  }

  if (loading) {
    return <div className="py-12 grid place-items-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">
          Los banners activos reemplazan al encabezado de la home. Se muestran en
          este orden y rotan solos cada 6 segundos.
        </p>
        <Button size="sm" className="gap-1.5 text-xs" onClick={crear}>
          <Plus className="w-3 h-3" />Nuevo banner
        </Button>
      </div>

      {banners.length === 0 && (
        <div className="bg-card border border-border rounded-xl p-10 text-center">
          <ImageIcon className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40" />
          <p className="font-medium">Sin banners</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            Mientras no haya ninguno, la home muestra el encabezado con el nombre
            y la descripción de la tienda.
          </p>
        </div>
      )}

      {banners.map((b, idx) => (
        <div key={b.id} className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-start gap-3 flex-wrap">
            <div className="flex-1 min-w-[240px]">
              <ImageUpload
                value={b.image_url || null}
                onChange={url => editar(b.id, { image_url: url ?? "" })}
                orgId={orgId ?? null}
                carpeta="banners"
                preset="banner"
                alto="h-28"
                etiqueta="Imagen del banner"
                ayuda="Apaisada, idealmente 1600×600 o más."
                onValidityChange={valid => registrarValidez(b.id, valid)}
              />
            </div>
            <div className="flex flex-col gap-1 pt-5">
              <div className="flex gap-1">
                <Button size="sm" variant="outline" className="px-2" disabled={idx === 0} onClick={() => mover(b, -1)}>
                  <ArrowUp className="w-3 h-3" />
                </Button>
                <Button size="sm" variant="outline" className="px-2" disabled={idx === banners.length - 1} onClick={() => mover(b, 1)}>
                  <ArrowDown className="w-3 h-3" />
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <ImageUpload
              value={b.image_url_mobile}
              onChange={url => editar(b.id, { image_url_mobile: url })}
              orgId={orgId ?? null}
              carpeta="banners"
              preset="banner"
              alto="h-28"
              etiqueta="Imagen para celular (opcional)"
              ayuda="Un recorte más vertical; si falta, se usa la de arriba."
            />
            <div>
              <label className="text-xs text-muted-foreground">
                Texto alternativo {!b.alt_text && <span className="text-yellow-500">— falta</span>}
              </label>
              <Input
                value={b.alt_text ?? ""}
                onChange={e => editar(b.id, { alt_text: e.target.value })}
                placeholder="Qué se ve en la imagen"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Título</label>
              <Input value={b.title ?? ""} onChange={e => editar(b.id, { title: e.target.value })} className="mt-1" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Subtítulo</label>
              <Input value={b.subtitle ?? ""} onChange={e => editar(b.id, { subtitle: e.target.value })} className="mt-1" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Adónde lleva</label>
              <Input
                value={b.link_url ?? ""}
                onChange={e => editar(b.id, { link_url: e.target.value })}
                placeholder="/productos?cat=slug-de-la-categoria"
                className="mt-1 text-xs font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Texto del botón</label>
              <Input
                value={b.cta_label ?? ""}
                onChange={e => editar(b.id, { cta_label: e.target.value })}
                placeholder="Ver la promo"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Desde (opcional)</label>
              <Input
                type="datetime-local" value={aLocal(b.starts_at)}
                onChange={e => editar(b.id, { starts_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Hasta (opcional)</label>
              <Input
                type="datetime-local" value={aLocal(b.ends_at)}
                onChange={e => editar(b.id, { ends_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
                className="mt-1"
              />
            </div>
          </div>

          {b.starts_at && b.ends_at && new Date(b.ends_at) <= new Date(b.starts_at) && (
            <p className="text-xs text-yellow-500 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              La fecha de fin es anterior a la de inicio: el banner no se va a ver nunca.
            </p>
          )}

          <div className="flex items-center gap-3 flex-wrap pt-1">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox" checked={b.is_active}
                onChange={e => {
                  if (e.target.checked && imagenesRotas.has(b.id)) {
                    toast.error("Reemplazá la imagen antes de activar el banner.");
                    return;
                  }
                  editar(b.id, { is_active: e.target.checked });
                }}
              />
              Activo
            </label>
            {!b.is_active && <Badge className="bg-zinc-500/15 text-zinc-400 border-zinc-500/20 text-[10px]">No se muestra</Badge>}
            <Button size="sm" className="gap-1.5 text-xs ml-auto" disabled={guardando === b.id} onClick={() => guardar(b)}>
              {guardando === b.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              Guardar
            </Button>
            <Button
              size="sm" variant="outline"
              className="gap-1.5 text-xs text-red-500 hover:text-red-500"
              onClick={() => borrar(b)}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
