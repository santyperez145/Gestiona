import { Check, Loader2, Plus, Store, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CommerceStore } from "@/hooks/useCommerceStores";

type Props = {
  stores: CommerceStore[];
  selectedStoreId: string | null;
  loading?: boolean;
  error?: string | null;
  creating?: boolean;
  onSelect: (storeId: string) => void;
  onCreate?: () => void;
  onCancelCreate?: () => void;
  onMakePrimary?: () => void;
};

export default function StoreWorkspacePicker({
  stores,
  selectedStoreId,
  loading = false,
  error,
  creating = false,
  onSelect,
  onCreate,
  onCancelCreate,
  onMakePrimary,
}: Props) {
  const selected = stores.find(store => store.id === selectedStoreId) ?? null;

  return (
    <section
      className="flex flex-col gap-3 border-y border-border/70 bg-card/35 px-1 py-4 md:flex-row md:items-center"
      aria-label="Tienda de trabajo"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Store className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">{creating ? "Nueva tienda" : selected?.name ?? "Tienda online"}</p>
            {!creating && selected?.is_primary ? (
              <Badge variant="outline" className="gap-1 text-[10px]">
                <Check className="h-3 w-3" />Principal
              </Badge>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {error ?? (stores.length > 1
              ? `${stores.length} tiendas comparten productos y stock; diseño, pedidos y dominio quedan separados.`
              : "Productos y stock pertenecen al negocio; esta tienda define su experiencia de venta.")}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 md:justify-end">
        {loading ? (
          <span className="inline-flex min-h-11 items-center gap-2 px-3 text-xs text-muted-foreground" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin" />Cargando tiendas
          </span>
        ) : stores.length > 0 ? (
          <Select value={creating ? "" : selectedStoreId ?? ""} onValueChange={onSelect}>
            <SelectTrigger className="min-h-11 w-full min-w-[15rem] sm:w-auto" aria-label="Elegir tienda">
              <SelectValue placeholder={creating ? "Nueva tienda sin guardar" : "Elegir tienda"} />
            </SelectTrigger>
            <SelectContent>
              {stores.map(store => (
                <SelectItem key={store.id} value={store.id}>
                  {store.name}{store.is_primary ? " · Principal" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {!creating && selected && !selected.is_primary && onMakePrimary ? (
          <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={onMakePrimary}>
            Hacer principal
          </Button>
        ) : null}
        {creating && onCancelCreate && stores.length > 0 ? (
          <Button type="button" variant="outline" size="icon" className="h-11 w-11" onClick={onCancelCreate} title="Cancelar nueva tienda">
            <X className="h-4 w-4" />
            <span className="sr-only">Cancelar nueva tienda</span>
          </Button>
        ) : null}
        {!creating && onCreate ? (
          <Button type="button" size="sm" className="min-h-11 gap-1.5" onClick={onCreate}>
            <Plus className="h-4 w-4" />Nueva tienda
          </Button>
        ) : null}
      </div>
    </section>
  );
}
