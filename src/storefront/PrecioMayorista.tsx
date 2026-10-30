/**
 * Precio mayorista en la vitrina (2026-10-30). Al comprador aprobado le muestra
 * su precio y los tramos por cantidad (de `get_store_precios_mayoristas`, la
 * misma regla que cobra la base). En una tienda «sólo mayoristas», a quien no
 * está aprobado no se le muestra el precio minorista: se lo invita a pedir su
 * cuenta.
 */
import { Link } from "react-router-dom";
import { useStore } from "./storeContext";

/** ¿Hay que ocultar el precio? Tienda sólo mayoristas y comprador no aprobado. */
export function usePrecioReservado(): boolean {
  const { mayorista } = useStore();
  return mayorista?.modo === "exclusivo" && mayorista.comprador?.estado !== "aprobado";
}

export function PrecioReservado({ grande = false }: { grande?: boolean }) {
  const { basePath } = useStore();
  return (
    <span className={grande ? "text-base font-semibold" : "text-sm font-semibold"}>
      Precio para mayoristas ·{" "}
      <Link to={`${basePath}/cuenta`} className="underline" style={{ color: "hsl(var(--st-link))" }}>pedí tu cuenta</Link>
    </span>
  );
}

export default function PrecioMayorista({ productId, ficha = false }: { productId: string; ficha?: boolean }) {
  const { tramosMayoristas, fmt } = useStore();
  const tramos = tramosMayoristas[productId];
  if (!tramos?.length) return null;
  const [primero, ...siguientes] = tramos;
  return (
    <div className={ficha ? "mt-2 text-sm" : "mt-1 text-xs"} aria-label="Tu precio mayorista">
      <p className="font-semibold">Tu precio: {fmt(primero.precio)}{primero.desde > 1 ? ` desde ${primero.desde} u.` : ""}</p>
      {siguientes.length > 0 && (
        <p style={{ color: "hsl(var(--st-muted))" }}>
          {siguientes.map(t => `desde ${t.desde} u.: ${fmt(t.precio)}`).join(" · ")}
        </p>
      )}
    </div>
  );
}
