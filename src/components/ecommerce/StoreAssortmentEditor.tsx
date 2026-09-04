import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  PackageOpen,
  Search,
  SlidersHorizontal,
  Star,
  Tags,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useOrganization } from "@/hooks/useOrganization";
import { orgViewKey, usePersistedState } from "@/hooks/usePersistedState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import WorkspaceState from "@/components/shared/WorkspaceState";
import {
  assortmentPageCount,
  buildStoreAssortmentChange,
  parseStoreAssortmentRow,
  parseStoreAssortmentSummary,
  STORE_ASSORTMENT_PAGE_SIZE,
  storeAssortmentDraft,
  validateStoreAssortmentDraft,
  visibilityChange,
  type StoreAssortmentDraft,
  type StoreAssortmentFilter,
  type StoreAssortmentRow,
  type StoreAssortmentSummary,
} from "@/lib/storeAssortment";

interface StoreCategoryOption {
  slug: string;
  name: string;
}

interface Props {
  storeId: string | null;
  storeName?: string | null;
  storeSlug?: string | null;
  canEdit: boolean;
  onSummaryChange?: (summary: StoreAssortmentSummary) => void;
}

const FILTERS: Array<{ id: StoreAssortmentFilter; label: string }> = [
  { id: "all", label: "Todos" },
  { id: "published", label: "Publicados" },
  { id: "hidden", label: "Ocultos" },
  { id: "customized", label: "Personalizados" },
  { id: "unavailable", label: "Con problemas" },
];

const EMPTY_SUMMARY: StoreAssortmentSummary = {
  total: 0,
  published: 0,
  hidden: 0,
  customized: 0,
  unavailable: 0,
  withoutWeight: 0,
};

const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

export default function StoreAssortmentEditor({
  storeId,
  storeName,
  storeSlug,
  canEdit,
  onSummaryChange,
}: Props) {
  const { orgId } = useOrganization();
  const [filter, setFilter] = usePersistedState<StoreAssortmentFilter>(
    orgViewKey(`commerce.assortment.filter.${storeId ?? "none"}`, orgId),
    "all",
  );
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<StoreAssortmentRow[]>([]);
  const [categories, setCategories] = useState<StoreCategoryOption[]>([]);
  const [summary, setSummary] = useState<StoreAssortmentSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(Boolean(storeId));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<StoreAssortmentRow | null>(null);
  const [draft, setDraft] = useState<StoreAssortmentDraft | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [debouncedQuery, filter, storeId]);

  const loadSummary = useCallback(async () => {
    if (!storeId) {
      setSummary(EMPTY_SUMMARY);
      return;
    }
    const { data, error: summaryError } = await supabase.rpc(
      "get_store_assortment_summary",
      { p_store_id: storeId },
    );
    if (summaryError) {
      console.error("No se pudo leer el resumen del surtido", summaryError);
      return;
    }
    const parsed = parseStoreAssortmentSummary(data);
    if (!parsed) {
      console.error("El resumen del surtido no cumple el contrato", data);
      return;
    }
    setSummary(parsed);
    onSummaryChange?.(parsed);
  }, [onSummaryChange, storeId]);

  const loadRows = useCallback(async () => {
    const requestId = ++requestRef.current;
    if (!storeId) {
      setRows([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: rowsError } = await supabase.rpc("get_store_assortment", {
      p_store_id: storeId,
      p_query: debouncedQuery || undefined,
      p_filter: filter,
      p_limit: STORE_ASSORTMENT_PAGE_SIZE,
      p_offset: (page - 1) * STORE_ASSORTMENT_PAGE_SIZE,
    });
    if (requestId !== requestRef.current) return;
    setLoading(false);
    if (rowsError) {
      console.error("No se pudo leer el surtido de la tienda", rowsError);
      setRows([]);
      setError("No pudimos abrir el surtido de esta tienda. Reintentá.");
      return;
    }
    const parsed = (data ?? []).map(parseStoreAssortmentRow);
    if (parsed.some(row => row === null)) {
      console.error("Una fila del surtido no cumple el contrato", data);
      setRows([]);
      setError("El catálogo respondió con datos inválidos. Reintentá.");
      return;
    }
    const nextRows = parsed as StoreAssortmentRow[];
    const total = nextRows[0]?.totalCount ?? 0;
    const maxPage = assortmentPageCount(total);
    if (page > maxPage) {
      setPage(maxPage);
      return;
    }
    setRows(nextRows);
  }, [debouncedQuery, filter, page, storeId]);

  const loadCategories = useCallback(async () => {
    if (!orgId) return;
    const { data, error: categoriesError } = await supabase
      .from("ecommerce_categories")
      .select("slug, name")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .or(`store_id.is.null,store_id.eq.${storeId}`)
      .order("sort_order")
      .order("name");
    if (categoriesError) {
      console.error("No se pudieron leer las categorías para el surtido", categoriesError);
      return;
    }
    setCategories((data ?? []) as StoreCategoryOption[]);
  }, [orgId, storeId]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    void loadSummary();
    void loadCategories();
  }, [loadCategories, loadSummary]);

  const total = rows[0]?.totalCount ?? 0;
  const pageCount = assortmentPageCount(total);
  const selectedRows = useMemo(
    () => rows.filter(row => selected.has(row.productId)),
    [rows, selected],
  );
  const allPageSelected = rows.length > 0 && rows.every(row => selected.has(row.productId));

  const saveChanges = useCallback(async (
    changes: ReturnType<typeof visibilityChange>[],
    successMessage: string,
  ) => {
    if (!storeId || changes.length === 0 || saving) return false;
    setSaving(true);
    const { error: saveError } = await supabase.rpc("save_store_product_publications", {
      p_store_id: storeId,
      p_changes: changes as unknown as Json,
    });
    setSaving(false);
    if (saveError) {
      console.error("No se pudo guardar el surtido", saveError);
      toast.error(saveError.message || "No pudimos guardar el surtido.");
      return false;
    }
    toast.success(successMessage);
    setSelected(new Set());
    await Promise.all([loadRows(), loadSummary()]);
    return true;
  }, [loadRows, loadSummary, saving, storeId]);

  const setVisibility = async (
    targetRows: StoreAssortmentRow[],
    visibility: "published" | "hidden",
  ) => {
    const changes = targetRows.map(row => visibilityChange(row, visibility));
    await saveChanges(
      changes,
      visibility === "published"
        ? `${changes.length} ${changes.length === 1 ? "producto publicado" : "productos publicados"}`
        : `${changes.length} ${changes.length === 1 ? "producto oculto" : "productos ocultos"}`,
    );
  };

  const openEditor = (row: StoreAssortmentRow) => {
    setEditing(row);
    setDraft(storeAssortmentDraft(row));
  };

  const saveEditor = async () => {
    if (!editing || !draft) return;
    const validation = validateStoreAssortmentDraft(draft);
    if (validation) {
      toast.error(validation);
      return;
    }
    const saved = await saveChanges(
      [buildStoreAssortmentChange(editing, draft)],
      "Presentación de la tienda actualizada",
    );
    if (saved) {
      setEditing(null);
      setDraft(null);
    }
  };

  if (!storeId) {
    return (
      <WorkspaceState
        kind="empty-first-use"
        title="Creá una tienda para definir su surtido"
        description="Los productos siguen en el Business Core; cada vitrina decide cuáles publica."
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 border-b border-border/70 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1.5">
              <PackageOpen className="h-3.5 w-3.5" />Surtido por vitrina
            </Badge>
            {storeSlug ? <span className="text-xs text-muted-foreground">/{storeSlug}</span> : null}
          </div>
          <h2 className="text-xl font-semibold tracking-normal">
            Productos de {storeName || "esta tienda"}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Elegí qué se vende y cómo se presenta aquí. El stock, los costos y la ficha maestra siguen compartidos con todo el negocio.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <SummaryValue label="Publicados" value={summary.published} tone="text-emerald-600" />
          <SummaryValue label="Ocultos" value={summary.hidden} />
          <SummaryValue label="Personalizados" value={summary.customized} tone="text-primary" />
          <SummaryValue label="Con problemas" value={summary.unavailable} tone={summary.unavailable ? "text-amber-600" : undefined} />
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Buscar por producto o marca"
            className="min-h-11 pl-9"
            aria-label="Buscar en el surtido"
          />
        </div>
        <div className="flex max-w-full gap-1 overflow-x-auto rounded-lg border border-border/70 bg-muted/20 p-1" role="tablist" aria-label="Filtrar surtido">
          {FILTERS.map(option => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={filter === option.id}
              onClick={() => setFilter(option.id)}
              className={`min-h-9 whitespace-nowrap rounded-md px-3 text-xs font-medium transition-colors ${
                filter === option.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {selectedRows.length > 0 ? (
        <div className="flex flex-col gap-3 border-y border-primary/20 bg-primary/[0.04] px-3 py-3 sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1 text-sm font-medium">
            {selectedRows.length} {selectedRows.length === 1 ? "producto seleccionado" : "productos seleccionados"}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!canEdit || saving}
              onClick={() => void setVisibility(selectedRows, "hidden")}
            >
              <EyeOff className="mr-1.5 h-4 w-4" />Ocultar
            </Button>
            <Button
              size="sm"
              disabled={!canEdit || saving}
              onClick={() => void setVisibility(selectedRows, "published")}
            >
              <Eye className="mr-1.5 h-4 w-4" />Publicar
            </Button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <WorkspaceState kind="initial-loading" title="Cargando surtido" />
      ) : error ? (
        <WorkspaceState
          kind="error-recoverable"
          title="No pudimos abrir el surtido"
          description={error}
          actionLabel="Reintentar"
          onAction={() => void loadRows()}
        />
      ) : rows.length === 0 ? (
        <WorkspaceState
          kind={debouncedQuery || filter !== "all" ? "empty-filtered" : "empty-first-use"}
          title={debouncedQuery || filter !== "all" ? "No hay coincidencias" : "Todavía no hay productos"}
          description={debouncedQuery || filter !== "all"
            ? "Probá otra búsqueda o cambiá el filtro."
            : "Creá el primer producto en el Business Core para publicarlo en esta tienda."}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead className="border-b border-border/70 bg-muted/25 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="w-12 px-4 py-3">
                    <Checkbox
                      checked={allPageSelected}
                      onCheckedChange={checked => setSelected(
                        checked ? new Set(rows.map(row => row.productId)) : new Set(),
                      )}
                      aria-label="Seleccionar esta página"
                    />
                  </th>
                  <th className="px-3 py-3 font-medium">Producto</th>
                  <th className="px-3 py-3 font-medium">Presentación</th>
                  <th className="px-3 py-3 font-medium">Stock</th>
                  <th className="px-3 py-3 font-medium">Estado</th>
                  <th className="w-24 px-4 py-3 text-right font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map(row => (
                  <tr key={row.productId} className="transition-colors hover:bg-muted/20">
                    <td className="px-4 py-3 align-middle">
                      <Checkbox
                        checked={selected.has(row.productId)}
                        onCheckedChange={checked => setSelected(current => {
                          const next = new Set(current);
                          if (checked) next.add(row.productId);
                          else next.delete(row.productId);
                          return next;
                        })}
                        aria-label={`Seleccionar ${row.name}`}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex min-w-[15rem] items-center gap-3">
                        <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-md border border-border/60 bg-muted/30">
                          {row.imageUrl ? (
                            <img src={row.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                          ) : (
                            <PackageOpen className="h-5 w-5 text-muted-foreground/50" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{row.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {row.brand || "Sin marca"}{row.hasVariants ? " · Con variantes" : ""}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-medium tabular-nums">{money.format(row.effectivePriceArs)}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <Tags className="h-3.5 w-3.5" />
                        <span>{categoryName(row.effectiveCategory, categories)}</span>
                        {row.customized ? <Badge variant="outline" className="h-5 px-1.5 text-[10px]">Personalizado</Badge> : null}
                        {row.featured ? <Star className="h-3.5 w-3.5 fill-current text-amber-500" aria-label="Destacado" /> : null}
                      </div>
                    </td>
                    <td className="px-3 py-3 tabular-nums">
                      <span className={row.stock > 0 ? "text-foreground" : "text-amber-600"}>
                        {row.stock} unidades
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {row.visibility === "hidden" ? (
                        <Badge variant="outline" className="gap-1 text-muted-foreground">
                          <EyeOff className="h-3 w-3" />Oculto
                        </Badge>
                      ) : row.sellable ? (
                        <Badge className="gap-1 border-emerald-500/20 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/10">
                          <Check className="h-3 w-3" />Publicado
                        </Badge>
                      ) : (
                        <Badge className="gap-1 border-amber-500/20 bg-amber-500/10 text-amber-700 hover:bg-amber-500/10">
                          <AlertTriangle className="h-3 w-3" />Revisar ficha
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9"
                          title={row.visibility === "published" ? "Ocultar de esta tienda" : "Publicar en esta tienda"}
                          disabled={!canEdit || saving}
                          onClick={() => void setVisibility(
                            [row], row.visibility === "published" ? "hidden" : "published",
                          )}
                        >
                          {row.visibility === "published"
                            ? <EyeOff className="h-4 w-4" />
                            : <Eye className="h-4 w-4" />}
                          <span className="sr-only">
                            {row.visibility === "published" ? "Ocultar" : "Publicar"} {row.name}
                          </span>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9"
                          title="Personalizar para esta tienda"
                          disabled={!canEdit || saving}
                          onClick={() => openEditor(row)}
                        >
                          <SlidersHorizontal className="h-4 w-4" />
                          <span className="sr-only">Personalizar {row.name}</span>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-2 border-t border-border/70 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
              {total.toLocaleString("es-AR")} {total === 1 ? "resultado" : "resultados"} · Página {page} de {pageCount}
            </span>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9"
                title="Página anterior"
                disabled={page <= 1 || loading}
                onClick={() => setPage(current => Math.max(1, current - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
                <span className="sr-only">Página anterior</span>
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9"
                title="Página siguiente"
                disabled={page >= pageCount || loading}
                onClick={() => setPage(current => Math.min(pageCount, current + 1))}
              >
                <ChevronRight className="h-4 w-4" />
                <span className="sr-only">Página siguiente</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      <Dialog open={Boolean(editing && draft)} onOpenChange={open => {
        if (!open && !saving) {
          setEditing(null);
          setDraft(null);
        }
      }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Presentación en {storeName || "esta tienda"}</DialogTitle>
            <DialogDescription>
              {editing?.name}. Dejá un campo vacío para heredar el valor del Business Core.
            </DialogDescription>
          </DialogHeader>
          {editing && draft ? (
            <div className="space-y-5 py-2">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="assortment-price">Precio en esta tienda</Label>
                  <Input
                    id="assortment-price"
                    type="number"
                    min="0"
                    step="0.01"
                    value={draft.priceArs}
                    onChange={event => setDraft(current => current
                      ? { ...current, priceArs: event.target.value }
                      : current)}
                    placeholder={String(editing.coreDiscountPriceArs || editing.corePriceArs)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Base del Core: {money.format(editing.coreDiscountPriceArs || editing.corePriceArs)}.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="assortment-compare">Precio de referencia</Label>
                  <Input
                    id="assortment-compare"
                    type="number"
                    min="0"
                    step="0.01"
                    value={draft.compareAtPriceArs}
                    onChange={event => setDraft(current => current
                      ? { ...current, compareAtPriceArs: event.target.value }
                      : current)}
                    placeholder="Sin precio tachado"
                  />
                  <p className="text-xs text-muted-foreground">Debe ser mayor al precio que se cobra.</p>
                </div>
              </div>

              {editing.hasVariants ? (
                <div className="flex gap-2 border-l-2 border-amber-500/50 pl-3 text-xs leading-relaxed text-muted-foreground">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  Las variantes con precio propio conservan ese valor. Este override cambia el precio base del producto.
                </div>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Categoría en esta tienda</Label>
                  <Select
                    value={draft.categorySlug || "__inherit__"}
                    onValueChange={value => setDraft(current => current
                      ? { ...current, categorySlug: value === "__inherit__" ? "" : value }
                      : current)}
                  >
                    <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__inherit__">
                        Heredar · {categoryName(editing.coreCategory, categories)}
                      </SelectItem>
                      {categories.map(category => (
                        <SelectItem key={category.slug} value={category.slug}>{category.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Destacado</Label>
                  <Select
                    value={draft.featured}
                    onValueChange={(value: StoreAssortmentDraft["featured"]) => setDraft(current => current
                      ? { ...current, featured: value }
                      : current)}
                  >
                    <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inherit">Heredar del producto</SelectItem>
                      <SelectItem value="yes">Destacar en esta tienda</SelectItem>
                      <SelectItem value="no">No destacar aquí</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="assortment-order">Orden manual</Label>
                  <Input
                    id="assortment-order"
                    type="number"
                    min="0"
                    step="1"
                    value={draft.sortOrder}
                    onChange={event => setDraft(current => current
                      ? { ...current, sortOrder: event.target.value }
                      : current)}
                    placeholder="Automático"
                  />
                  <p className="text-xs text-muted-foreground">Los números menores aparecen primero.</p>
                </div>
              </div>
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" disabled={saving} onClick={() => {
              if (!editing) return;
              setDraft({
                priceArs: "",
                compareAtPriceArs: "",
                categorySlug: "",
                featured: "inherit",
                sortOrder: "",
              });
            }}>
              Usar valores del Core
            </Button>
            <Button disabled={saving} onClick={() => void saveEditor()}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Guardar presentación
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryValue({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <div>
      <p className={`text-lg font-semibold tabular-nums ${tone ?? "text-foreground"}`}>{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function categoryName(slug: string | null, categories: StoreCategoryOption[]): string {
  if (!slug) return "Sin categoría";
  return categories.find(category => category.slug === slug)?.name
    ?? slug.replaceAll("_", " ");
}
