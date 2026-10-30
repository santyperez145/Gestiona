/**
 * Título y descripción para buscadores de un producto (2026-10-30,
 * migración 20261030000600). Se guarda aparte del formulario (como las
 * presentaciones): vacío usa el armado automático — nombre, marca, precio y
 * descripción. Sin la migración aplicada, la sección no se muestra.
 */
import { useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isMissingRelation } from "@/lib/publicDataSource";
import { SEO_DESCRIPCION_VISIBLE, SEO_TITULO_VISIBLE, recorteSeo } from "@/lib/productSeo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export default function ProductSeoSection({ productId, nombre, descripcionProducto }: { productId: string; nombre: string; descripcionProducto?: string | null }) {
  const [disponible, setDisponible] = useState(true);
  const [cargado, setCargado] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [origen, setOrigen] = useState<"manual" | "importado" | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    void supabase.from("product_seo" as never).select("titulo, descripcion, origen")
      .eq("product_id" as never, productId as never).maybeSingle()
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) {
          if (isMissingRelation(error)) { setDisponible(false); return; }
          console.error("[seo] no se pudo leer el SEO del producto", error);
          toast.error("No se pudo leer el SEO del producto");
          return;
        }
        const fila = data as { titulo: string | null; descripcion: string | null; origen: "manual" | "importado" } | null;
        setTitulo(fila?.titulo ?? "");
        setDescripcion(fila?.descripcion ?? "");
        setOrigen(fila?.origen ?? null);
        setCargado(true);
      });
    return () => { vivo = false; };
  }, [productId]);

  const guardar = async () => {
    setGuardando(true);
    const { error } = await supabase.rpc("guardar_seo_producto" as never, {
      p_product_id: productId, p_titulo: titulo, p_descripcion: descripcion,
    } as never);
    setGuardando(false);
    if (error) { console.error("[seo] guardar", error); toast.error(error.message || "No se pudo guardar el SEO"); return; }
    setOrigen(titulo.trim() || descripcion.trim() ? "manual" : null);
    toast.success(titulo.trim() || descripcion.trim() ? "SEO del producto guardado" : "El producto vuelve a usar el SEO automático");
  };

  if (!disponible) return null;
  const tituloVista = recorteSeo(titulo || nombre, SEO_TITULO_VISIBLE);
  const descripcionVista = recorteSeo(descripcion || descripcionProducto || "", SEO_DESCRIPCION_VISIBLE);

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div>
        <p className="text-sm font-medium flex items-center gap-1.5"><Search className="w-4 h-4" />Buscadores (SEO)</p>
        <p className="text-[11px] text-muted-foreground">
          Cómo aparece este producto en Google. Vacío usa el nombre, la marca, el precio y la descripción.
          {origen === "importado" && " Lo trajo la importación desde tu tienda anterior."}
        </p>
      </div>
      {!cargado ? (
        <div className="py-2"><Loader2 className="w-4 h-4 animate-spin opacity-50" /></div>
      ) : (
        <>
          <div>
            <label className="text-xs text-muted-foreground" htmlFor={`seo-titulo-${productId}`}>Título</label>
            <Input id={`seo-titulo-${productId}`} value={titulo} maxLength={120} placeholder={nombre}
              onChange={e => setTitulo(e.target.value)} className="bg-muted border-border" />
            <p className={`text-[10px] mt-0.5 ${titulo.length > SEO_TITULO_VISIBLE ? "text-amber-600" : "text-muted-foreground"}`}>
              {titulo.length}/{SEO_TITULO_VISIBLE}{titulo.length > SEO_TITULO_VISIBLE ? " — Google corta lo que pasa de ~60" : ""}
            </p>
          </div>
          <div>
            <label className="text-xs text-muted-foreground" htmlFor={`seo-descripcion-${productId}`}>Descripción</label>
            <Textarea id={`seo-descripcion-${productId}`} value={descripcion} maxLength={400} rows={2}
              onChange={e => setDescripcion(e.target.value)} className="bg-muted border-border text-sm" />
            <p className={`text-[10px] mt-0.5 ${descripcion.length > SEO_DESCRIPCION_VISIBLE ? "text-amber-600" : "text-muted-foreground"}`}>
              {descripcion.length}/{SEO_DESCRIPCION_VISIBLE}{descripcion.length > SEO_DESCRIPCION_VISIBLE ? " — Google corta lo que pasa de ~160" : ""}
            </p>
          </div>
          <div className="rounded-md bg-muted/40 p-2" aria-label="Vista previa en Google">
            <p className="text-sm text-blue-700 dark:text-blue-400 truncate">{tituloVista}</p>
            {descripcionVista && <p className="text-xs text-muted-foreground line-clamp-2">{descripcionVista}</p>}
          </div>
          <Button type="button" size="sm" variant="outline" disabled={guardando} onClick={() => void guardar()}>
            {guardando && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}Guardar SEO
          </Button>
        </>
      )}
    </div>
  );
}
