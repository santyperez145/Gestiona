export interface PaginationRange {
  page: number;
  from: number;
  to: number;
  total: number;
}

export function getPaginationRange(
  page: number,
  pageSize: number,
  totalItems: number,
): PaginationRange {
  const safeTotal = Math.max(0, Math.trunc(totalItems));
  const safePageSize = Math.max(1, Math.trunc(pageSize));
  const totalPages = Math.max(1, Math.ceil(safeTotal / safePageSize));
  const safePage = Math.min(Math.max(0, Math.trunc(page)), totalPages - 1);

  if (safeTotal === 0) return { page: safePage, from: 0, to: 0, total: 0 };

  const from = safePage * safePageSize + 1;
  return {
    page: safePage,
    from,
    to: Math.min(from + safePageSize - 1, safeTotal),
    total: safeTotal,
  };
}
