/**
 * Editor de las páginas de contenido de la tienda.
 *
 * Arranca sembrando cuatro borradores ya redactados para Argentina (incluido
 * el botón de arrepentimiento de la Ley 24.240) en vez de una hoja en blanco:
 * una tienda que empieza con las páginas vacías las deja vacías.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FileText, Plus, Trash2, Loader2, ExternalLink, Save } from "lucide-react";
import LegalPagesPanel from "./LegalPagesPanel";

interface PageRow {
  id: string;
  slug: string;
  title: string;
  content: string;
  status: string;
  show_in_footer: boolean;
  sort_order: number;
  meta_description: string | null;
}

/** Slug seguro para URL a partir del título. */
function slugify(t: string) {
  return t
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")   // saca tildes
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export default function StorePagesEditor({ storeId, storeSlug }: { storeId: string | null; storeSlug: string | null }) {
  const { orgId } = useOrganization();
  const [pages, setPages] = useState<PageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sembrando, setSembrando] = useState(false);
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [borrador, setBorrador] = useState<PageRow | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    if (!orgId || !storeId) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("store_pages")
      .select("id, slug, title, content, status, show_in_footer, sort_order, meta_description")
      .eq("store_id", storeId)
      .order("sort_order");
    setLoading(false);
    if (error) { toast.error("No se pudieron cargar las páginas"); return; }
    setPages((data ?? []) as PageRow[]);
  }, [orgId, storeId]);

  useEffect(() => { cargar(); }, [cargar]);

  // Al elegir otra página se descarta el borrador anterior sin guardar. Es
  // deliberado: guardar en silencio lo a medio escribir es peor.
  const elegir = (p: PageRow) => { setSeleccion(p.id); setBorrador({ ...p }); };

  const sembrar = async () => {
    if (!storeId) return;
    setSembrando(true);
    const { data, error } = await supabase.rpc("seed_store_pages", { p_store_id: storeId });
    setSembrando(false);
    if (error) { toast.error(error.message.replace(/^.*?:\s*/, "")); return; }
    const creadas = (data as unknown as { creadas?: number })?.creadas ?? 0;
    toast.success(creadas > 0
      ? `${creadas} páginas creadas como borrador. Revisalas y publicalas.`
      : "Ya estaban todas creadas; no se pisó nada.");
    cargar();
  };

  const crear = async () => {
    if (!orgId || !storeId) return;
    const title = "Nueva página";
    let slug = "nueva-pagina";
    let n = 2;
    while (pages.some(p => p.slug === slug)) { slug = `nueva-pagina-${n++}`; }
    const { data, error } = await supabase
      .from("store_pages")
      .insert({
        org_id: orgId, store_id: storeId, slug, title,
        content: "", status: "draft",
        sort_order: (pages.at(-1)?.sort_order ?? 0) + 1,
      })
      .select("id, slug, title, content, status, show_in_footer, sort_order, meta_description")
      .single();
    if (error) { toast.error("No se pudo crear"); return; }
    setPages(prev => [...prev, data as PageRow]);
    elegir(data as PageRow);
  };

  const guardar = async () => {
    if (!borrador) return;
    const slug = slugify(borrador.slug || borrador.title);
    if (!slug) { toast.error("El título no puede quedar vacío"); return; }
    if (pages.some(p => p.slug === slug && p.id !== borrador.id)) {
      toast.error("Ya hay otra página con esa dirección"); return;
    }
    setGuardando(true);
    const patch = {
      slug, title: borrador.title.trim() || "Sin título",
      content: borrador.content,
      status: borrador.status,
      show_in_footer: borrador.show_in_footer,
      meta_description: borrador.meta_description?.trim() || null,
    };
    const { error } = await supabase.from("store_pages").update(patch).eq("id", borrador.id);
    setGuardando(false);
    if (error) { toast.error("No se pudo guardar"); return; }
    setPages(prev => prev.map(p => (p.id === borrador.id ? { ...p, ...patch } : p)));
    setBorrador(prev => (prev ? { ...prev, ...patch } : prev));
    toast.success(patch.status === "published" ? "Página publicada" : "Borrador guardado");
  };

  const borrar = async (p: PageRow) => {
    const { error } = await supabase.from("store_pages").delete().eq("id", p.id);
    if (error) { toast.error("No se pudo eliminar"); return; }
    setPages(prev => prev.filter(x => x.id !== p.id));
    if (seleccion === p.id) { setSeleccion(null); setBorrador(null); }
    toast.success("Página eliminada");
  };

  if (!storeId) {
    return (
      <div className="bg-card border border-border rounded-xl p-10 text-center text-sm text-muted-foreground">
        Creá la tienda antes de cargar las páginas de contenido.
      </div>
    );
  }

  if (loading) {
    return <div className="py-12 grid place-items-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
    {/* Va arriba de todo y no en una pestaña aparte: las dos páginas que
        genera son obligatorias, y esconderlas sería repetir el motivo por el
        que la plantilla quedó sin completar dos años. */}
    <LegalPagesPanel
      storeId={storeId}
      existentes={pages.map(p => ({ slug: p.slug, content: p.content }))}
      onAplicado={cargar}
    />

    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      {/* Listado */}
      <div className="space-y-2">
        {pages.length === 0 && (
          <div className="bg-card border border-border rounded-xl p-5 text-center">
            <FileText className="w-7 h-7 mx-auto mb-2 text-muted-foreground/40" />
            <p className="text-sm font-medium">Sin páginas todavía</p>
            <p className="text-xs text-muted-foreground mt-1">
              Empezá con las cuatro que toda tienda argentina necesita.
            </p>
            <Button size="sm" className="mt-3 gap-1.5 text-xs" disabled={sembrando} onClick={sembrar}>
              {sembrando ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Crear las básicas
            </Button>
          </div>
        )}

        {pages.map(p => (
          <button
            key={p.id} onClick={() => elegir(p)}
            className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
              seleccion === p.id ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium truncate">{p.title}</span>
              {p.status === "draft" && (
                <Badge className="bg-yellow-500/15 text-yellow-500 border-yellow-500/20 text-[10px] shrink-0">Borrador</Badge>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground truncate">/pagina/{p.slug}</p>
          </button>
        ))}

        {pages.length > 0 && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="gap-1.5 text-xs flex-1" onClick={crear}>
              <Plus className="w-3 h-3" />Nueva
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 text-xs" disabled={sembrando} onClick={sembrar}>
              {sembrando ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              Faltantes
            </Button>
          </div>
        )}
      </div>

      {/* Editor */}
      {borrador ? (
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs text-muted-foreground">Título</label>
              <Input
                value={borrador.title}
                onChange={e => setBorrador({ ...borrador, title: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Dirección</label>
              <Input
                value={borrador.slug}
                onChange={e => setBorrador({ ...borrador, slug: e.target.value })}
                onBlur={e => setBorrador({ ...borrador, slug: slugify(e.target.value) })}
                className="mt-1 font-mono text-xs"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground">
              Contenido — admite <code>## Título</code>, <code>- listas</code> y <code>**negrita**</code>
            </label>
            <textarea
              value={borrador.content}
              onChange={e => setBorrador({ ...borrador, content: e.target.value })}
              rows={18}
              className="mt-1 w-full px-3 py-2 text-sm font-mono bg-background border border-border rounded-lg outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground">Descripción para Google (opcional)</label>
            <Input
              value={borrador.meta_description ?? ""}
              onChange={e => setBorrador({ ...borrador, meta_description: e.target.value.slice(0, 160) })}
              className="mt-1"
            />
          </div>

          <div className="flex items-center gap-4 flex-wrap text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox" checked={borrador.status === "published"}
                onChange={e => setBorrador({ ...borrador, status: e.target.checked ? "published" : "draft" })}
              />
              Publicada
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox" checked={borrador.show_in_footer}
                onChange={e => setBorrador({ ...borrador, show_in_footer: e.target.checked })}
              />
              Mostrar en el pie de la tienda
            </label>
          </div>

          <div className="flex gap-2 flex-wrap pt-1">
            <Button size="sm" className="gap-1.5 text-xs" disabled={guardando} onClick={guardar}>
              {guardando ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              Guardar
            </Button>
            {storeSlug && borrador.status === "published" && (
              <Button
                size="sm" variant="outline" className="gap-1.5 text-xs"
                onClick={() => window.open(`${window.location.origin}/tienda/${storeSlug}/pagina/${borrador.slug}`, "_blank")}
              >
                <ExternalLink className="w-3 h-3" />Ver
              </Button>
            )}
            <Button
              size="sm" variant="outline"
              className="gap-1.5 text-xs text-red-500 hover:text-red-500 ml-auto"
              onClick={() => borrar(borrador)}
            >
              <Trash2 className="w-3 h-3" />Eliminar
            </Button>
          </div>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl p-10 text-center text-sm text-muted-foreground">
          Elegí una página de la izquierda para editarla.
        </div>
      )}
    </div>
    </div>
  );
}
