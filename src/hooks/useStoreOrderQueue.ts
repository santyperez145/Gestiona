import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebounce } from "@/hooks/useDebounce";
import { supabase } from "@/integrations/supabase/client";
import { parseStoreOrderAmountQuery, parseStoreOrderMedio, parseStoreOrderSort, parseStoreOrderView } from "@/lib/storeOrderQueue";
import { parseStoreOrderPage, parseStoreOrderQueuePage } from "@/lib/storeOrderQueuePage";

export function useStoreOrderQueue(orgId: string | null, storeId: string | null, params: URLSearchParams) {
  const client = useQueryClient();
  const query = (params.get("q") ?? "").slice(0, 200);
  const debouncedQuery = useDebounce(query);
  const view = parseStoreOrderView(params.get("vista"));
  const sort = parseStoreOrderSort(params.get("orden"));
  const medio = parseStoreOrderMedio(params.get("medio"));
  const page = parseStoreOrderPage(params.get("pagina"));
  const result = useQuery({
    queryKey: ["store-order-queue", orgId, storeId, debouncedQuery, view, sort, medio, page],
    enabled: Boolean(orgId && storeId) && query === debouncedQuery,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    queryFn: async ({ signal }) => {
      const amount = parseStoreOrderAmountQuery(debouncedQuery);
      const { data, error } = await supabase.rpc("store_order_queue", {
        p_org_id: orgId!, p_store_id: storeId!, p_query: debouncedQuery,
        p_view: view, p_sort: sort, p_medio: medio, p_page: page,
        ...(amount === null ? {} : { p_amount: amount }),
      }).abortSignal(signal);
      if (error) throw error;
      return parseStoreOrderQueuePage(data);
    },
  });
  return {
    data: query === debouncedQuery ? result.data : undefined,
    loading: Boolean(orgId && storeId) && (result.isFetching || result.isPending || query !== debouncedQuery),
    error: result.isError ? "No pudimos leer los pedidos de la tienda. Reintentá." : null,
    reload: async () => {
      await client.invalidateQueries({ queryKey: ["store-order-queue", orgId, storeId] });
    },
  };
}
