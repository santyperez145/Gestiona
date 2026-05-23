/**
 * usePrevious — Track the previous value of any reactive value.
 *
 * Stores the previous render's value in a ref. Useful for animations,
 * comparison rendering, undo previews, and transition detection.
 *
 * Usage:
 *   const [count, setCount] = useState(0);
 *   const prevCount = usePrevious(count);
 *   // prevCount is the value from the last render
 *   const trend = count > (prevCount ?? 0) ? "up" : "down";
 *
 *   // With complex state
 *   const prevStatus = usePrevious(order.status);
 *   useEffect(() => {
 *     if (order.status === "shipped" && prevStatus === "pending") {
 *       toast("Tu pedido fue enviado!");
 *     }
 *   }, [order.status, prevStatus]);
 */
import { useRef, useEffect } from "react";

export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref.current;
}
