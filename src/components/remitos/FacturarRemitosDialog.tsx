/**
 * «Facturar juntos» en Remitos (2026-10-22): elegir un cliente y sus ventas
 * entregadas sin facturar, y emitir una sola factura. Ver
 * `lib/facturarRemitos.ts`.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fechaFiscalArgentina } from "@/lib/arcaInvoice";
import { clientesParaFacturar, type VentaDeRemito } from "@/lib/facturarRemitos";
import { isMissingFunction } from "@/lib/publicDataSource";
import { retryRead } from "@/lib/transientRead";
import type { Remito } from "@/lib/remitos";

const ars = (n: number) => n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });

export default function FacturarRemitosDialog({ open, onOpenChange, orgId, remitos }: {
  open: boolean; onOpenChange: (v: boolean) => void; orgId: string | null; remitos: Remito[];
}) {
  const navigate = useNavigate();
  const [ventas, setVentas] = useState<VentaDeRemito[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cliente, setCliente] = useState("");
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [facturando, setFacturando] = useState(false);

  const transacciones = useMemo(() => [...new Set(remitos.filter(r => r.estado !== "anulado" && r.sale_transaction_id && r.customer_id)
    .map(r => r.sale_transaction_id as string))], [remitos]);

  useEffect(() => {
    if (!open || !orgId) return;
    let vigente = true;
    setVentas(null); setError(null); setCliente(""); setElegidas(new Set());
    void (async () => {
      const filas: VentaDeRemito[] = [];
      for (let i = 0; i < transacciones.length; i += 200) {
        const r = await retryRead(() => supabase.from("sales").select("sale_transaction_id, invoice_id, total_ars")
          .eq("org_id", orgId).in("sale_transaction_id", transacciones.slice(i, i + 200)));
        if (!vigente) return;
        if (r.error) { setError("No se pudieron leer las ventas de los remitos. Probá de nuevo."); return; }
        filas.push(...((r.data ?? []) as VentaDeRemito[]));
      }
      if (vigente) setVentas(filas);
    })();
    return () => { vigente = false; };
  }, [open, orgId, transacciones]);

  const clientes = useMemo(() => (ventas ? clientesParaFacturar(remitos, ventas) : []), [remitos, ventas]);
  const elegido = clientes.find(c => c.customerId === cliente) ?? null;
  const total = elegido?.ventas.filter(v => elegidas.has(v.transaccion)).reduce((s, v) => s + v.total, 0) ?? 0;

  const facturar = async () => {
    if (!orgId || elegidas.size < 2) return;
    setFacturando(true);
    const { data, error: rpcError } = await supabase.rpc("facturar_ventas_juntas", { p_org: orgId, p_transacciones: [...elegidas] });
    setFacturando(false);
    if (rpcError) {
      toast.error(isMissingFunction(rpcError) ? "Facturar remitos juntos todavía no está disponible. Probá más tarde."
        : rpcError.code === "22023" || rpcError.code === "42501" ? rpcError.message : "No se pudo crear la factura. Probá de nuevo.");
      return;
    }
    const r = data as { invoice_id?: string; number?: string; ventas?: number };
    toast.success(`Factura ${r.number ?? ""} creada con ${r.ventas ?? elegidas.size} ventas. Se autoriza en ARCA sola.`);
    onOpenChange(false);
    if (r.invoice_id) navigate(`/facturas?invoice=${r.invoice_id}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Facturar remitos juntos</DialogTitle>
          <DialogDescription>Una sola factura por varias ventas del mismo cliente: la factura del mes del mayorista. Cada venta queda facturada.</DialogDescription>
        </DialogHeader>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!error && !ventas && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Buscando ventas sin facturar…</p>}
        {ventas && clientes.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Ningún cliente registrado tiene dos o más ventas con remito sin facturar. Los remitos manuales (sin venta) no tienen precios y no se facturan desde acá.
          </p>
        )}
        {clientes.length > 0 && (
          <div className="space-y-3">
            <div>
              <Label htmlFor="facturar-cliente" className="text-xs">Cliente</Label>
              <Select value={cliente} onValueChange={v => { setCliente(v); setElegidas(new Set(clientes.find(c => c.customerId === v)?.ventas.map(x => x.transaccion) ?? [])); }}>
                <SelectTrigger id="facturar-cliente"><SelectValue placeholder="Elegí un cliente" /></SelectTrigger>
                <SelectContent>
                  {clientes.map(c => <SelectItem key={c.customerId} value={c.customerId}>{c.nombre} · {c.ventas.length} ventas</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {elegido && (
              <fieldset className="space-y-1.5">
                <legend className="text-xs font-medium">Ventas a facturar</legend>
                {elegido.ventas.map(v => (
                  <label key={v.transaccion} className="flex items-start gap-2 rounded-md border border-border/50 p-2 text-sm">
                    <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={elegidas.has(v.transaccion)}
                      onChange={ev => setElegidas(prev => { const n = new Set(prev); if (ev.target.checked) n.add(v.transaccion); else n.delete(v.transaccion); return n; })} />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">Venta del {fechaFiscalArgentina(v.fecha)}</span>
                      <span className="block truncate text-xs text-muted-foreground">Remito{v.remitos.length > 1 ? "s" : ""} {v.remitos.join(", ")}</span>
                    </span>
                    <span className="font-mono text-xs">{ars(v.total)}</span>
                  </label>
                ))}
              </fieldset>
            )}
          </div>
        )}

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="text-sm text-muted-foreground">{elegidas.size >= 2 ? `${elegidas.size} ventas · ${ars(total)}` : "Elegí al menos dos ventas"}</span>
          <Button disabled={elegidas.size < 2 || facturando} onClick={() => void facturar()}>
            {facturando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Facturar juntas
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
