/**
 * useDebounce — returns a debounced version of the value.
 * The returned value only updates after `delay` ms have elapsed
 * since the last update to the input.
 *
 * Usage:
 *   const debouncedSearch = useDebounce(search, 300);
 *   useEffect(() => { fetchResults(debouncedSearch); }, [debouncedSearch]);
 */
import { useEffect, useState } from "react";

export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
