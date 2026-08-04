/**
 * Subir una imagen por archivo, sin pegar URLs.
 *
 * Tres formas de cargar, porque cada persona usa la que tiene a mano: elegir el
 * archivo, arrastrarlo encima, o pegarlo con Ctrl+V — esto último es lo más
 * rápido cuando venís de recortar algo.
 *
 * Antes varias pantallas pedían la URL de la imagen en un campo de texto. Eso
 * obliga a subir el archivo a otro lado primero, y termina en banners que
 * apuntan a un Drive que alguien despublica seis meses después.
 *
 * La compresión es automática y sucede en el navegador: una foto de teléfono
 * pesa entre 3 y 8 MB, y un banner de 6 MB arruina la carga de la home aunque
 * se vea bien.
 */
import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  validarImagen, comprimirImagen, rutaDeSubida, pesoLegible,
  PRESETS, type Limites,
} from "@/lib/imageUpload";
import { Upload, ImageIcon, X, Loader2 } from "lucide-react";

export default function ImageUpload({
  value,
  onChange,
  orgId,
  bucket = "marketing-images",
  carpeta = "",
  preset = "banner",
  alto = "h-32",
  etiqueta = "Subí una imagen",
  ayuda,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  orgId: string | null;
  bucket?: string;
  carpeta?: string;
  preset?: keyof typeof PRESETS;
  /** Clase de alto para la caja; un logo necesita menos que un banner. */
  alto?: string;
  etiqueta?: string;
  ayuda?: string;
}) {
  const [subiendo, setSubiendo] = useState(false);
  const [encima, setEncima] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const subir = useCallback(async (file: File) => {
    if (!orgId) { toast.error("Elegí una organización primero"); return; }

    const check = validarImagen(file);
    if (!check.ok) { toast.error(check.motivo); return; }

    setSubiendo(true);
    try {
      const original = file.size;
      const listo = await comprimirImagen(file, PRESETS[preset] as Limites);
      const ruta = rutaDeSubida(orgId, listo, carpeta);

      const { error } = await supabase.storage.from(bucket).upload(ruta, listo, {
        // Un año: el nombre es un uuid, así que el archivo nunca cambia.
        cacheControl: "31536000",
        contentType: listo.type,
        upsert: false,
      });
      if (error) throw error;

      const { data } = supabase.storage.from(bucket).getPublicUrl(ruta);
      onChange(data.publicUrl);

      // Se avisa el ahorro sólo cuando fue real: "0 KB menos" es ruido.
      const ahorro = original - listo.size;
      toast.success(ahorro > 50_000
        ? `Imagen subida (${pesoLegible(original)} → ${pesoLegible(listo.size)})`
        : "Imagen subida");
    } catch (e) {
      toast.error("No se pudo subir: " + (e as Error).message);
    } finally {
      setSubiendo(false);
      if (input.current) input.current.value = "";   // permite re-elegir el mismo
    }
  }, [orgId, bucket, carpeta, preset, onChange]);

  const primeraImagenDe = (items?: DataTransferItemList | null): File | null => {
    for (const item of Array.from(items ?? [])) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const f = item.getAsFile();
        if (f) return f;
      }
    }
    return null;
  };

  return (
    <div>
      {(etiqueta || ayuda) && (
        <div className="mb-1.5">
          {etiqueta && <label className="text-xs text-muted-foreground">{etiqueta}</label>}
          {ayuda && <p className="text-[11px] text-muted-foreground/70">{ayuda}</p>}
        </div>
      )}

      {value ? (
        <div className={`relative ${alto} rounded-lg overflow-hidden border border-border bg-muted/30 group`}>
          <img src={value} alt="" className="w-full h-full object-contain" />
          <Button
            type="button" size="sm" variant="secondary"
            className="absolute top-2 right-2 h-7 gap-1.5 text-xs opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
            onClick={() => onChange(null)}
          >
            <X className="w-3 h-3" />Quitar
          </Button>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={() => input.current?.click()}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.current?.click(); } }}
          onDragOver={e => { e.preventDefault(); setEncima(true); }}
          onDragLeave={() => setEncima(false)}
          onDrop={e => {
            e.preventDefault();
            setEncima(false);
            const f = primeraImagenDe(e.dataTransfer?.items) ?? e.dataTransfer?.files?.[0];
            if (f) subir(f); else toast.error("Eso no era una imagen");
          }}
          onPaste={e => {
            const f = primeraImagenDe(e.clipboardData?.items);
            if (f) { e.preventDefault(); subir(f); }
          }}
          className={`${alto} w-full rounded-lg border-2 border-dashed grid place-items-center cursor-pointer transition-colors ${
            encima ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
          }`}
        >
          {subiendo ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Subiendo…
            </div>
          ) : (
            <div className="text-center px-4">
              <ImageIcon className="w-6 h-6 mx-auto mb-1.5 text-muted-foreground/40" />
              <p className="text-xs font-medium">Elegí, arrastrá o pegá una imagen</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                JPG, PNG o WebP · se comprime sola
              </p>
            </div>
          )}
        </div>
      )}

      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) subir(f); }}
      />

      {value && (
        <Button
          type="button" size="sm" variant="ghost"
          className="mt-1.5 h-7 gap-1.5 text-xs text-muted-foreground"
          disabled={subiendo}
          onClick={() => input.current?.click()}
        >
          <Upload className="w-3 h-3" />Reemplazar
        </Button>
      )}
    </div>
  );
}
