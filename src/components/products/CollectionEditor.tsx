/**
 * Editor de colecciones (surtido por tienda).
 *
 * Traduce el patrón de Shopify Catalogs / Tiendanube Categorías a un overlay
 * del canal sobre el producto. No copia assets ni textos; declara solo:
 * actor (admin/comercio), contexto (tienda), permiso (rol), entrada/salida,
 * autoridad (storeCollection RPC) y estados (loading, error, vacío, dirty).
 */
import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/storefront/storeContext";
import { slugifyCollection } from "@/lib/storeCollection";
import { Check, Plus, Trash2, ImageIcon, Loader2 } from "lucide-react";

export interface CollectionEditorProps {
  collectionId?: string; // si existe, editar; si no, crear
  onSave?: () => void;
  onCancel?: () => void;
}

export default function CollectionEditor({ collectionId, onSave, onCancel }: CollectionEditorProps) {
  const { store } = useStore();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [isPublished, setIsPublished] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const inputClass = "w-full px-3 py-2 text-sm border bg-transparent outline-none focus:ring-1";
  const inputStyle = { borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" } as React.CSSProperties;

  useEffect(() => {
    if (!collectionId) {
      setName(""); setSlug(""); setDescription(""); setIsPublished(true);
      setDirty(false);
      return;
    }
    // En producción, cargar con RPC: get_store_collection
    // Por ahora inicializamos vacío y marcamos como dirty si el usuario escribe.
    setName(""); setSlug("");
  }, [collectionId]);

  const onNameChange = useCallback((value: string) => {
    setName(value);
    setSlug(slugifyCollection(value));
    setDirty(true);
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!store?.slug) return;
    if (!name.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Aquí se invocaría el RPC real; mantenemos la interfaz.
      // const result = collectionId ? await updateStoreCollection(...) : await createStoreCollection(...);
      await new Promise((r) => setTimeout(r, 500)); // simulación de latencia
      setDirty(false);
      onSave?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la colección.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-4" aria-label="Editor de colección">
      <div>
        <label htmlFor="col-name" className="text-xs font-medium block mb-1.5" style={{ color: "hsl(var(--st-muted))" }}>
          Nombre de la colección
        </label>
        <input
          id="col-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Ej. Perfumes de verano"
          className={inputClass}
          style={inputStyle}
          aria-required="true"
        />
      </div>

      <div>
        <label htmlFor="col-desc" className="text-xs font-medium block mb-1.5" style={{ color: "hsl(var(--st-muted))" }}>
          Descripción (opcional)
        </label>
        <textarea
          id="col-desc"
          value={description}
          onChange={(e) => { setDescription(e.target.value); setDirty(true); }}
          rows={3}
          placeholder="Qué productos incluye esta colección..."
          className={inputClass}
          style={inputStyle}
        />
      </div>

      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={isPublished}
            onChange={(e) => { setIsPublished(e.target.checked); setDirty(true); }}
            aria-label="Publicar colección"
          />
          <span>Publicar inmediatamente</span>
        </label>
      </div>

      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}

      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={saving || !dirty || !name.trim()}
          className="px-4 py-2 text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50"
          style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {collectionId ? "Guardar cambios" : "Crear colección"}
        </button>
        <button
          type="button"
          onClick={() => onCancel?.()}
          className="px-4 py-2 text-sm border"
          style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)", color: "hsl(var(--st-text))" }}
          aria-label="Cancelar"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
