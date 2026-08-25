/**
 * El selector de categoría, alimentado por las categorías de la organización.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 *
 * En la sesión 95 las categorías dejaron de estar hardcodeadas **para la
 * tienda**: nombre, orden, foto y jerarquía salen de `ecommerce_categories`.
 * Pero el formulario de producto siguió con las cuatro de siempre escritas a
 * mano, así que el comercio podía crear "Ropa de verano" y **no podía
 * asignársela a ningún producto**. La feature estaba a mitad de camino.
 *
 * Esto lo cierra: un solo componente que se usa en todos los lugares donde hay
 * que elegir una categoría, y que además deja **crearla desde ahí**. Obligar a
 * ir a otra pantalla, crearla y volver es la clase de fricción que hace que
 * nadie las use y todo termine en "otros".
 *
 * ── El respaldo, y por qué se achicó (2026-08-25) ─────────────────────────
 *
 * Si la organización todavía no creó ninguna, se ofrecen los slugs que ya usan
 * sus productos. Hasta esta fecha se sembraban **además** los cuatro nombres
 * heredados de perfumería, y eso hacía justo lo contrario de lo que el
 * respaldo busca: un comercio nuevo, de cualquier rubro, sin productos ni
 * categorías, abría la ficha y elegía entre "Perfume Árabe" y "Vaper".
 * Medido ese día: 3 de las 4 organizaciones estaban exactamente en ese estado.
 *
 * `NOMBRES_HEREDADOS` sigue vivo en `storeCategories.ts`, pero como **rótulo**
 * de un slug que ya está en los datos —ahí sí evita mostrar `perfume_arabe`
 * crudo a quien lo tiene cargado—, nunca como oferta.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  nombreDeCategoria, slugDeNombre, validarNombre, arbolDeCategorias,
} from "@/lib/storeCategories";
import { useOrgCategoryNames } from "@/hooks/useOrgCategoryNames";

const CREAR = "__crear__";

export interface OpcionCategoria {
  slug: string;
  label: string;
  /** Para indentar las subcategorías en la lista. */
  nivel: number;
}

/**
 * Las categorías de la organización, listas para un desplegable.
 *
 * Se exporta el hook además del componente porque hay pantallas —los filtros
 * del listado, la oferta masiva— que necesitan las opciones sin el control.
 * Las que sólo necesitan traducir un slug a un nombre usan
 * `useOrgCategoryNames`, que no consulta `products`.
 */
export function useOrgCategories(orgId: string | null | undefined) {
  const {
    categorias: filas, cargando: cargandoCategorias, recargar: recargarCategorias,
  } = useOrgCategoryNames(orgId);
  const [slugsEnUso, setSlugsEnUso] = useState<string[]>([]);
  const [cargandoSlugs, setCargandoSlugs] = useState(true);

  const cargarSlugs = useCallback(async () => {
    if (!orgId) { setSlugsEnUso([]); setCargandoSlugs(false); return; }
    const { data } = await supabase.from("products").select("category").eq("org_id", orgId);
    setSlugsEnUso(
      [...new Set(((data ?? []) as { category: string | null }[])
        .map(p => p.category).filter(Boolean) as string[])],
    );
    setCargandoSlugs(false);
  }, [orgId]);

  useEffect(() => { cargarSlugs(); }, [cargarSlugs]);

  const cargar = useCallback(async () => {
    await Promise.all([recargarCategorias(), cargarSlugs()]);
  }, [recargarCategorias, cargarSlugs]);

  const opciones = useMemo<OpcionCategoria[]>(() => {
    if (filas.length > 0) {
      // Jerárquico: cada padre seguido de sus hijas, para que se vea qué está
      // adentro de qué en vez de una lista plana.
      const salida: OpcionCategoria[] = [];
      for (const raiz of arbolDeCategorias(filas)) {
        salida.push({ slug: raiz.slug, label: nombreDeCategoria(raiz.slug, filas), nivel: 0 });
        for (const hija of raiz.hijos) {
          salida.push({ slug: hija.slug, label: nombreDeCategoria(hija.slug, filas), nivel: 1 });
        }
      }
      // Un slug que está en productos pero no en la tabla igual se ofrece: si
      // no, editar ese producto le cambiaría la categoría sin querer.
      for (const s of slugsEnUso) {
        if (!salida.some(o => o.slug === s)) {
          salida.push({ slug: s, label: nombreDeCategoria(s, filas), nivel: 0 });
        }
      }
      return salida;
    }

    // Sin categorías propias: **sólo** los slugs que la organización ya usa.
    // Nada de rubros ajenos sembrados por el código.
    return [...new Set(slugsEnUso)]
      .map(s => ({ slug: s, label: nombreDeCategoria(s), nivel: 0 }));
  }, [filas, slugsEnUso]);

  /** Crea una categoría y devuelve su slug, o `null` si falló. */
  const crear = useCallback(async (nombre: string): Promise<string | null> => {
    const error = validarNombre(nombre, filas);
    if (error) { toast.error(error); return null; }
    if (!orgId) { toast.error("Elegí una organización antes de crear una categoría"); return null; }

    const slug = slugDeNombre(nombre);

    // `store_id` se completa con la tienda de la organización si la tiene, para
    // dejar registro de qué canal la originó. Si todavía no tiene, va NULL:
    // desde `20260825000002_categoria_sin_rubro` la columna lo admite, y el
    // menú público no depende de ella —`get_store_categories` une por `org_id`
    // desde 20260805000002—.
    //
    // ⚠️ Hasta esa migración este insert **fallaba siempre**, con
    // `null value in column "store_id" ... violates not-null constraint`, así
    // que "Crear una categoría…" no funcionaba para ninguna organización.
    const { data: tienda } = await supabase
      .from("ecommerce_stores").select("id").eq("org_id", orgId)
      .order("created_at").limit(1).maybeSingle();

    const { error: err } = await supabase.from("ecommerce_categories").insert({
      org_id: orgId, store_id: tienda?.id ?? null, name: nombre.trim(), slug,
      sort_order: filas.length, is_active: true,
    } as never);
    if (err) { toast.error(err.message); return null; }

    await cargar();
    toast.success(`Categoría "${nombre.trim()}" creada`);
    return slug;
  }, [orgId, filas, cargar]);

  return {
    opciones, categorias: filas,
    cargando: cargandoCategorias || cargandoSlugs,
    crear, recargar: cargar,
  };
}

interface Props {
  value: string;
  onChange: (slug: string) => void;
  orgId: string | null | undefined;
  /** Si es false no se ofrece crear. Los filtros no deberían crear nada. */
  permitirCrear?: boolean;
  className?: string;
}

export default function CategorySelect({
  value, onChange, orgId, permitirCrear = true, className,
}: Props) {
  const { opciones, cargando, crear } = useOrgCategories(orgId);
  const [creando, setCreando] = useState(false);
  const [nombre, setNombre] = useState("");
  const [guardando, setGuardando] = useState(false);

  const confirmar = async () => {
    setGuardando(true);
    const slug = await crear(nombre);
    setGuardando(false);
    if (!slug) return;
    onChange(slug);
    setNombre("");
    setCreando(false);
  };

  if (creando) {
    return (
      <div className="flex gap-2">
        <Input
          autoFocus value={nombre} placeholder="Nombre de la categoría"
          onChange={e => setNombre(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") { e.preventDefault(); confirmar(); }
            if (e.key === "Escape") setCreando(false);
          }}
          className={className}
        />
        <Button size="sm" onClick={confirmar} disabled={guardando || !nombre.trim()}>
          {guardando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Crear"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setCreando(false)}>Cancelar</Button>
      </div>
    );
  }

  // Una organización nueva no tiene ninguna. El desplegable no puede quedar
  // mudo: si no hay nada que elegir, lo dice y ofrece crear la primera.
  const vacio = !cargando && opciones.length === 0;

  return (
    <Select
      value={value}
      onValueChange={v => { if (v === CREAR) setCreando(true); else onChange(v); }}
    >
      <SelectTrigger className={className}>
        <SelectValue placeholder={
          cargando ? "Cargando…" : vacio ? "Todavía no hay categorías" : "Elegí una categoría"
        } />
      </SelectTrigger>
      <SelectContent>
        {opciones.map(o => (
          <SelectItem key={o.slug} value={o.slug}>
            {/* Las subcategorías van indentadas con CSS, no con espacios:
                un espacio de ancho fijo dentro del texto es un carácter
                invisible que el linter marca y que se copia al portapapeles. */}
            <span style={o.nivel > 0 ? { paddingLeft: `${o.nivel * 0.75}rem` } : undefined}>
              {o.label}
            </span>
          </SelectItem>
        ))}
        {permitirCrear && (
          <SelectItem value={CREAR}>
            <span className="flex items-center gap-1.5 text-primary">
              <Plus className="w-3.5 h-3.5" />
              {vacio ? "Crear la primera categoría…" : "Crear una categoría…"}
            </span>
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}
