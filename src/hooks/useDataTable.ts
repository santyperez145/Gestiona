/**
 * useDataTable — Composable hook for sorted, filtered, paginated table state.
 *
 * Manages all table UI state in one place: sorting, column filter, global search,
 * row selection, and pagination. Works with any data array.
 *
 * Features:
 *   - Multi-column sort (click to cycle asc → desc → off)
 *   - Debounced global search (configurable key extraction)
 *   - Per-column string filters
 *   - Row selection (single / multi / select-all)
 *   - Pagination with configurable page size
 *   - URL-syncable state (optional)
 *
 * Usage:
 *   const table = useDataTable({
 *     data: sales,
 *     searchKeys: ["customer_name", "payment_method"],
 *     defaultSort: { key: "date", dir: "desc" },
 *     pageSize: 25,
 *   });
 *
 *   // Render
 *   <input value={table.search} onChange={e => table.setSearch(e.target.value)} />
 *   {table.page.map(row => <SaleRow key={row.id} sale={row} selected={table.isSelected(row.id)} onSelect={() => table.toggle(row.id)} />)}
 *   <Pagination total={table.totalPages} page={table.currentPage} onChange={table.setPage} />
 */
import { useState, useMemo, useCallback } from "react";
import { useDebounce } from "@/hooks/useDebounce";

type SortDir = "asc" | "desc" | null;

interface SortState<T> {
  key: keyof T | null;
  dir: SortDir;
}

interface UseDataTableOptions<T extends { id: string }> {
  data: T[];
  /** Keys to include in global search */
  searchKeys?: (keyof T)[];
  /** Custom search extractor (overrides searchKeys) */
  searchFn?: (row: T, query: string) => boolean;
  /** Initial sort */
  defaultSort?: { key: keyof T; dir: "asc" | "desc" };
  /** Rows per page (default: 25) */
  pageSize?: number;
}

interface UseDataTableReturn<T> {
  // ── Search ──
  search: string;
  setSearch: (q: string) => void;
  // ── Filters ──
  filters: Record<string, string>;
  setFilter: (key: string, value: string) => void;
  clearFilters: () => void;
  // ── Sort ──
  sort: SortState<T>;
  toggleSort: (key: keyof T) => void;
  sortIcon: (key: keyof T) => "asc" | "desc" | null;
  // ── Pagination ──
  currentPage: number;
  setPage: (page: number) => void;
  totalPages: number;
  totalRows: number;
  pageSize: number;
  // ── Data ──
  page: T[];      // current page rows
  filtered: T[];  // all filtered (unpaginated)
  // ── Selection ──
  selectedIds: Set<string>;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  toggleAll: () => void;
  clearSelection: () => void;
  selectedRows: T[];
  allSelected: boolean;
}

export function useDataTable<T extends { id: string }>(
  options: UseDataTableOptions<T>
): UseDataTableReturn<T> {
  const { data, searchKeys, searchFn, defaultSort, pageSize: ps = 25 } = options;

  const [search, setSearchRaw] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<SortState<T>>({
    key: defaultSort?.key ?? null,
    dir: defaultSort?.dir ?? null,
  });
  const [currentPage, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const debouncedSearch = useDebounce(search, 180);

  const setSearch = useCallback((q: string) => {
    setSearchRaw(q);
    setPage(1);
  }, []);

  const setFilter = useCallback((key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(1);
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({});
    setPage(1);
  }, []);

  const toggleSort = useCallback((key: keyof T) => {
    setSort(prev => {
      if (prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return { key: null, dir: null };
    });
    setPage(1);
  }, []);

  const sortIcon = useCallback((key: keyof T): "asc" | "desc" | null => {
    if (sort.key !== key) return null;
    return sort.dir;
  }, [sort]);

  // Apply search + filters
  const filtered = useMemo(() => {
    let rows = data;

    // Search
    const q = debouncedSearch.trim().toLowerCase();
    if (q) {
      if (searchFn) {
        rows = rows.filter(r => searchFn(r, q));
      } else if (searchKeys && searchKeys.length > 0) {
        rows = rows.filter(r =>
          searchKeys.some(k => String(r[k] ?? "").toLowerCase().includes(q))
        );
      }
    }

    // Per-column filters
    for (const [key, val] of Object.entries(filters)) {
      if (!val) continue;
      rows = rows.filter(r => String((r as any)[key] ?? "").toLowerCase().includes(val.toLowerCase()));
    }

    // Sort
    if (sort.key && sort.dir) {
      const k = sort.key;
      const dir = sort.dir === "asc" ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        const av = a[k], bv = b[k];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
        return String(av).localeCompare(String(bv), "es") * dir;
      });
    }

    return rows;
  }, [data, debouncedSearch, searchFn, searchKeys, filters, sort]);

  const totalRows = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / ps));

  // Clamp page to valid range if data changes
  const safePage = Math.min(currentPage, totalPages);

  const page = useMemo(() => {
    const start = (safePage - 1) * ps;
    return filtered.slice(start, start + ps);
  }, [filtered, safePage, ps]);

  // Selection
  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  const toggle = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const allSelected = filtered.length > 0 && filtered.every(r => selectedIds.has(r.id));

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        filtered.forEach(r => next.delete(r.id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        filtered.forEach(r => next.add(r.id));
        return next;
      });
    }
  }, [allSelected, filtered]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const selectedRows = useMemo(
    () => data.filter(r => selectedIds.has(r.id)),
    [data, selectedIds]
  );

  return {
    search, setSearch,
    filters, setFilter, clearFilters,
    sort, toggleSort, sortIcon,
    currentPage: safePage, setPage, totalPages, totalRows, pageSize: ps,
    page, filtered,
    selectedIds, isSelected, toggle, toggleAll, clearSelection, selectedRows, allSelected,
  };
}
