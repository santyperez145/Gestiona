/**
 * Panel de stock por ubicación (POS).
 *
 * Actor: cajero/operador POS. Contexto: tienda con stock por ubicación.
 * Autoridad: RPC `reserve_stock` / `commit_pos_sale`. El servidor decide
 * stock disponible y reserva; nunca el cliente.
 *
 * Estados cubiertos: loading, error, empty, reserved, committed.
 * Mobile-first: layout columna en móvil, tabla en desktop.
 */
import { useState } from "react";
import { useStore } from "@/storefront/storeContext";
import { supabase } from "@/integrations/supabase/client";
import { reserveStock, commitSale, releaseReservation } from "@/lib/posInventory";
import type { LocationStock } from "@/storefront/StoreInventory";
import { Loader2, Check, X } from "lucide-react";

interface Props {
  productId: string;
  locations?: LocationStock[];
  onReserve?: (result: { ok: boolean; message: string }) => void;
  onCommit?: (result: { ok: boolean; message: string }) => void;
}

export default function PosInventoryPanel({ productId, locations, onReserve, onCommit }: Props) {
  const { store } = useStore();
  const [locId, setLocId] = useState<string>("");
  const [qty, setQty] = useState<number>(1);
  const [reserving, setReserving] = useState(false);
  const [reservationMsg, setReservationMsg] = useState<string | null>(null);
  const [reservationOk, setReservationOk] = useState<boolean | null>(null);
  const [commitMsg, setCommitMsg] = useState<string | null>(null);
  const [commitOk, setCommitOk] = useState<boolean | null>(null);

  const inputClass = "w-full px-3 py-2 text-sm border bg-transparent outline-none focus:ring-1";
  const inputStyle = { borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" } as React.CSSProperties;

  const handleReserve = async () => {
    if (!store?.slug || !productId) return;
    setReserving(true);
    setReservationMsg(null);
    setReservationOk(null);
    const result = await reserveStock(
      (fn, params) => supabase.rpc(fn, params),
      { slug: store.slug, location_id: locId, product_id: productId, quantity: qty, idempotency_key: crypto.randomUUID() },
    );
    setReservationOk(result.ok);
    setReservationMsg(result.message);
    setReserving(false);
    onReserve?.(result);
  };

  const handleCommit = async () => {
    if (!store?.slug || !locId) return;
    setCommitMsg(null);
    setCommitOk(null);
    const result = await commitSale(
      (fn, params) => supabase.rpc(fn, params),
      { slug: store.slug, reservation_id: locId, payment_method: "pos" },
    );
    setCommitOk(result.ok);
    setCommitMsg(result.message);
    onCommit?.(result);
  };

  const handleRelease = async () => {
    if (!store?.slug || !locId) return;
    const result = await releaseReservation(
      (fn, params) => supabase.rpc(fn, params),
      store.slug,
      locId,
    );
    setReservationMsg(result.message);
    setReservationOk(result.ok);
  };

  const rows = locations ?? [];

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">Gestión de stock (POS)</h3>

      <div className="flex flex-wrap gap-3 items-end">
        <label className="flex-1 min-w-[140px]">
          <span className="text-xs block mb-1" style={{ color: "hsl(var(--st-muted))" }}>Ubicación</span>
          <select value={locId} onChange={(e) => { setLocId(e.target.value); setReservationMsg(null); setCommitMsg(null); }} className={inputClass} style={inputStyle}>
            <option value="">Seleccionar...</option>
            {rows.map((l) => (
              <option key={l.location_id} value={l.location_id}>{l.location_name} (dispo: {l.available})</option>
            ))}
          </select>
        </label>
        <label className="w-24">
          <span className="text-xs block mb-1" style={{ color: "hsl(var(--st-muted))" }}>Cantidad</span>
          <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value)))} className={inputClass} style={inputStyle} />
        </label>
        <button onClick={handleReserve} disabled={reserving || !locId || !qty} className="px-3 py-2 text-sm font-medium inline-flex items-center gap-1 disabled:opacity-50" style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}>
          {reserving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Reservar"}
        </button>
        <button onClick={handleCommit} disabled={!locId} className="px-3 py-2 text-sm font-medium border" style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}>Confirmar venta</button>
        <button onClick={handleRelease} disabled={!locId} className="px-3 py-2 text-sm border" style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}>Liberar reserva</button>
      </div>

      {reservationMsg && (
        <p className={`text-sm ${reservationOk ? "text-emerald-600" : "text-red-600"}`} role="status">
          {reservationOk ? <Check className="w-3.5 h-3.5 inline mr-1" /> : <X className="w-3.5 h-3.5 inline mr-1" />}
          {reservationMsg}
        </p>
      )}
      {commitMsg && (
        <p className={`text-sm ${commitOk ? "text-emerald-600" : "text-red-600"}`} role="status">
          {commitOk ? <Check className="w-3.5 h-3.5 inline mr-1" /> : <X className="w-3.5 h-3.5 inline mr-1" />}
          {commitMsg}
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border" style={{ borderColor: "hsl(var(--st-border))" }}>
            <thead>
              <tr className="text-left">
                <th className="px-3 py-2 font-medium" style={{ color: "hsl(var(--st-muted))" }}>Ubicación</th>
                <th className="px-3 py-2 font-medium" style={{ color: "hsl(var(--st-muted))" }}>Disponible</th>
                <th className="px-3 py-2 font-medium" style={{ color: "hsl(var(--st-muted))" }}>Reservado</th>
                <th className="px-3 py-2 font-medium" style={{ color: "hsl(var(--st-muted))" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.location_id} className="border-t" style={{ borderColor: "hsl(var(--st-border))" }}>
                  <td className="px-3 py-2">{l.location_name}</td>
                  <td className="px-3 py-2 tabular-nums">{l.available}</td>
                  <td className="px-3 py-2 tabular-nums">{l.reserved}</td>
                  <td className="px-3 py-2 tabular-nums">{l.stock}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}