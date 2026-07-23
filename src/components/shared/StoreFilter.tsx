/**
 * StoreFilter — shared, URL-persisted store/location filter.
 *
 * Fetches the active org's locations (same `locations` table LocationsPage.tsx
 * reads) and renders a dropdown. Selection is written to the `store` URL
 * search param via `useSearchParams`, so it survives navigation/refresh.
 *
 * Gracefully renders nothing when the org has 0 or 1 locations configured —
 * there's nothing meaningful to scope by ("all stores" is already the state).
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useOrg } from "@/lib/orgContext";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Store } from "lucide-react";

export const STORE_PARAM = "store";

type LocationOption = { id: string; name: string };

/** Reads/writes the shared store-filter URL param and loads the org's locations. */
export function useStoreFilter() {
  const { activeOrg } = useOrg();
  const [searchParams, setSearchParams] = useSearchParams();
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeOrg) {
      setLocations([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    supabase
      .from("locations")
      .select("id, name")
      .eq("org_id", activeOrg.id)
      .eq("active", true)
      .order("is_main", { ascending: false })
      .order("name")
      .then(({ data }) => {
        if (!cancelled) {
          setLocations(data || []);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeOrg?.id]);

  const raw = searchParams.get(STORE_PARAM);
  const storeId = raw && raw !== "all" ? raw : null;

  const setStore = (id: string | null) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (!id || id === "all") next.delete(STORE_PARAM);
        else next.set(STORE_PARAM, id);
        return next;
      },
      { replace: true }
    );
  };

  return { locations, storeId, setStore, loading, hasMultipleLocations: locations.length >= 2 };
}

export default function StoreFilter() {
  const { locations, storeId, setStore, loading, hasMultipleLocations } = useStoreFilter();

  // Nothing to scope by — 0 or 1 location means "all stores" is the only state.
  if (loading || !hasMultipleLocations) return null;

  return (
    <Select value={storeId ?? "all"} onValueChange={(v) => setStore(v === "all" ? null : v)}>
      <SelectTrigger className="bg-card border-border/50 w-full sm:w-[180px] h-9 text-xs rounded-lg">
        <Store className="w-3.5 h-3.5 mr-1.5 text-muted-foreground shrink-0" />
        <SelectValue placeholder="Todas las sucursales" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Todas las sucursales</SelectItem>
        {locations.map((l) => (
          <SelectItem key={l.id} value={l.id}>
            {l.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
