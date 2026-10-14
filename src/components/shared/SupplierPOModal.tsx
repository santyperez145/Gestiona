/**
 * SupplierPOModal — pedirle mercadería a un proveedor desde Proveedores.
 *
 * 2026-10-14 (funciones incoherentes): antes mandaba un correo con un producto,
 * metía el resto en las notas, convertía con una cotización fija de $1.700 y le
 * ponía un número «PO-xxxxxx» que no quedaba en ningún lado: el pedido no
 * existía en Órdenes de compra y al llegar la mercadería no había qué recibir.
 * Ahora arma una orden de compra real (`guardar_orden_de_compra`) con lo que
 * está bajo el mínimo de ese proveedor —se puede sumar cualquier producto— y
 * la envía con el mismo diálogo que Órdenes de compra.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, ClipboardList, Loader2, Send, Trash2, Truck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { fetchOrgProducts, formatARS, formatUSD } from "@/lib/supabaseStore";
import { cotizacionDe } from "@/lib/exchangeRate";
import { mensajeDeError } from "@/lib/cuentaCorriente";
import { pasoParaCantidad } from "@/lib/presupuestos";
import { costoSugerido, fechaArgentina, type MonedaCompra } from "@/lib/compras";
import ProductCombobox from "@/components/shared/ProductCombobox";
import EnviarOrdenDialog from "@/components/compras/EnviarOrdenDialog";
import { cantidadSugerida } from "@/lib/ordenesDeCompra";

interface Proveedor { id: string; name: string; email: string | null; phone: string | null }
interface Producto {
  id: string; name: string; sku?: string | null; barcode?: string | null; brand?: string | null; stock: number | null; low_stock_threshold?: number | null;
  supplier_id?: string | null; unidad_medida?: string | null; is_active?: boolean | null;
  cost_currency?: string | null; cost_ars?: number | null; cost_usd?: number | null; total_cost_usd?: number | null;
}
interface Renglon { producto: Producto; qty: number; costo: number }
type OrdenCreada = {
  id: string; order_number: string; status: string; supplier_name: string; supplier_email: string | null; supplier_id: string | null;
  currency: string; total_amount: number; expected_date: string | null; notes: string | null;
  items: Array<{ product_name: string; sku: string | null; quantity_ordered: number }>;
};

interface Props {
  open: boolean;
  onClose: () => void;
  /** Proveedor preseleccionado. */
  supplierId?: string;
}

export default function SupplierPOModal({ open, onClose, supplierId }: Props) {
  const { activeOrg } = useOrg();
  const navigate = useNavigate();
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cotizacion, setCotizacion] = useState<number | null>(null);
  const [cargando, setCargando] = useState(false);
  const [proveedorId, setProveedorId] = useState(supplierId ?? "");
  const [moneda, setMoneda] = useState<MonedaCompra>("ARS");
  const [renglones, setRenglones] = useState<Renglon[]>([]);
  const [entrega, setEntrega] = useState("");
  const [notas, setNotas] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [creada, setCreada] = useState<OrdenCreada | null>(null);
  const [enviar, setEnviar] = useState(false);

  useEffect(() => {
    if (!open || !activeOrg) return;
    let vigente = true;
    setCreada(null); setEnviar(false); setNotas(""); setEntrega(""); setMoneda("ARS");
    setProveedorId(supplierId ?? "");
    setCargando(true);
    Promise.all([
      supabase.from("suppliers").select("id, name, email, phone").eq("org_id", activeOrg.id).order("name"),
      fetchOrgProducts<Producto>(activeOrg.id, "id, name, sku, barcode, brand, stock, low_stock_threshold, supplier_id, unidad_medida, is_active, cost_currency, cost_ars, cost_usd, total_cost_usd"),
      supabase.from("settings").select("exchange_rate").eq("org_id", activeOrg.id).maybeSingle(),
    ]).then(([prov, prods, ajustes]) => {
      if (!vigente) return;
      if (prov.error || prods.error) {
        toast.error(mensajeDeError(prov.error ?? prods.error, "No se pudieron cargar proveedores y productos"));
        return;
      }
      setProveedores((prov.data ?? []) as Proveedor[]);
      setProductos((prods.data ?? []).filter(p => p.is_active !== false));
      setCotizacion(cotizacionDe(ajustes.data as { exchange_rate?: number | null } | null));
    }).finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, [open, activeOrg, supplierId]);

  const proveedor = proveedores.find(p => p.id === proveedorId) ?? null;

  // Al elegir proveedor: lo suyo que está bajo el mínimo, con la cantidad sugerida.
  useEffect(() => {
    if (!proveedorId) { setRenglones([]); return; }
    setRenglones(productos
      .filter(p => p.supplier_id === proveedorId && Number(p.stock ?? 0) <= Number(p.low_stock_threshold ?? 3))
      .map(p => ({ producto: p, qty: cantidadSugerida(p), costo: costoSugerido(p, moneda, cotizacion) })));
    // La moneda se cambia aparte (reexpresa los costos); acá sólo el proveedor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proveedorId, productos]);

  const cambiarMoneda = (m: MonedaCompra) => {
    setMoneda(m);
    setRenglones(prev => prev.map(r => ({ ...r, costo: costoSugerido(r.producto, m, cotizacion) })));
  };
  const agregar = (p: Producto | null) => {
    if (!p) return;
    setRenglones(prev => prev.some(r => r.producto.id === p.id)
      ? prev.map(r => r.producto.id === p.id ? { ...r, qty: r.qty + 1 } : r)
      : [...prev, { producto: p, qty: cantidadSugerida(p), costo: costoSugerido(p, moneda, cotizacion) }]);
  };
  const cambiar = (id: string, cambios: Partial<Renglon>) => setRenglones(prev => prev.map(r => r.producto.id === id ? { ...r, ...cambios } : r));

  const validos = renglones.filter(r => r.qty > 0);
  const total = validos.reduce((s, r) => s + r.qty * r.costo, 0);
  const formato = moneda === "USD" ? formatUSD : formatARS;
  const disponibles = useMemo(() => productos, [productos]);

  const crear = async () => {
    if (!activeOrg || !proveedor) { toast.error("Elegí el proveedor"); return; }
    if (validos.length === 0) { toast.error("Agregá al menos un producto con cantidad"); return; }
    setGuardando(true);
    try {
      const { data, error } = await supabase.rpc("guardar_orden_de_compra" as never, {
        p_org: activeOrg.id, p_id: null,
        p_datos: {
          supplier_id: proveedor.id, supplier_name: proveedor.name, supplier_email: proveedor.email, currency: moneda,
          expected_date: entrega || null, notes: notas.trim() || null,
          items: validos.map(r => ({ product_id: r.producto.id, quantity_ordered: r.qty, unit_cost: r.costo, tax_rate: 0 })),
        },
      } as never);
      if (error) throw error;
      const fila = data as unknown as Omit<OrdenCreada, "items">;
      setCreada({ ...fila, items: validos.map(r => ({ product_name: r.producto.name, sku: r.producto.sku ?? null, quantity_ordered: r.qty })) });
      toast.success(`Orden ${fila.order_number} creada en borrador`);
    } catch (err) {
      toast.error(mensajeDeError(err, "No se pudo crear la orden de compra"));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <>
      <Dialog open={open && !enviar} onOpenChange={v => { if (!v && !guardando) onClose(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Truck className="h-5 w-5 text-primary" />Pedir a un proveedor</DialogTitle>
            <DialogDescription>Arma una orden de compra con lo que está bajo el mínimo. Queda en Órdenes de compra para enviarla, recibirla y que entre al stock.</DialogDescription>
          </DialogHeader>

          {creada ? (
            <div className="space-y-4 py-6 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/15"><Check className="h-7 w-7 text-success" /></div>
              <div>
                <p className="text-lg font-semibold">Orden {creada.order_number} creada</p>
                <p className="text-sm text-muted-foreground">{creada.items.length} {creada.items.length === 1 ? "producto" : "productos"} · {formato(Number(creada.total_amount))}</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => setEnviar(true)}><Send className="mr-2 h-4 w-4" />Enviar al proveedor</Button>
                <Button variant="outline" onClick={() => { onClose(); navigate("/ordenes-compra"); }}><ClipboardList className="mr-2 h-4 w-4" />Ver en Órdenes de compra</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                <label className="text-xs text-muted-foreground">Proveedor
                  <Select value={proveedorId} onValueChange={setProveedorId} disabled={cargando}>
                    <SelectTrigger className="h-9" aria-label="Proveedor"><SelectValue placeholder={cargando ? "Cargando…" : "Elegí el proveedor"} /></SelectTrigger>
                    <SelectContent>{proveedores.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </label>
                <label className="text-xs text-muted-foreground">Moneda
                  <Select value={moneda} onValueChange={v => cambiarMoneda(v as MonedaCompra)}>
                    <SelectTrigger className="h-9" aria-label="Moneda"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="ARS">Pesos</SelectItem><SelectItem value="USD">Dólares</SelectItem></SelectContent>
                  </Select>
                </label>
              </div>

              {proveedorId && (
                <>
                  {renglones.length === 0 && <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">Nada de este proveedor está bajo el mínimo. Sumá productos abajo.</p>}
                  <div className="space-y-2">
                    {renglones.map(r => (
                      <div key={r.producto.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 p-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{r.producto.name}</p>
                          <p className="text-[11px] text-muted-foreground">Stock {Number(r.producto.stock ?? 0).toLocaleString("es-AR")} · mínimo {r.producto.low_stock_threshold ?? 3}</p>
                        </div>
                        <label className="text-[11px] text-muted-foreground">Cantidad
                          <Input type="number" min="0" step={pasoParaCantidad(r.producto.unidad_medida)} inputMode="decimal" value={r.qty} className="h-8 w-20"
                            onChange={e => cambiar(r.producto.id, { qty: Math.max(0, Number(e.target.value)) })} />
                        </label>
                        <label className="text-[11px] text-muted-foreground">Costo ({moneda === "USD" ? "US$" : "$"})
                          <Input type="number" min="0" step="0.01" inputMode="decimal" value={r.costo} className="h-8 w-24"
                            onChange={e => cambiar(r.producto.id, { costo: Math.max(0, Number(e.target.value)) })} />
                        </label>
                        <button type="button" aria-label={`Quitar ${r.producto.name}`} className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => setRenglones(prev => prev.filter(x => x.producto.id !== r.producto.id))}><Trash2 className="h-4 w-4" /></button>
                      </div>
                    ))}
                  </div>
                  <ProductCombobox<Producto> products={disponibles} value={null} onChange={(_id, p) => agregar(p)} ariaLabel="Sumar un producto" placeholder="Sumar otro producto…" className="h-9" />

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs text-muted-foreground">Entrega esperada
                      <Input type="date" value={entrega} min={fechaArgentina()} onChange={e => setEntrega(e.target.value)} className="h-9" />
                    </label>
                    <label className="text-xs text-muted-foreground">Notas para el proveedor
                      <Textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2} maxLength={1000} placeholder="Opcional" />
                    </label>
                  </div>

                  <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
                    <span className="text-sm text-muted-foreground">{validos.length} {validos.length === 1 ? "producto" : "productos"} · sin IVA</span>
                    <span className="text-base font-bold">{formato(total)}</span>
                  </div>
                </>
              )}

              <div className="flex justify-end gap-2 border-t border-border pt-3">
                <Button variant="outline" onClick={onClose} disabled={guardando}>Cancelar</Button>
                <Button onClick={() => void crear()} disabled={guardando || !proveedorId || validos.length === 0} data-testid="crear-orden-proveedor">
                  {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Crear orden de compra
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {activeOrg && (
        <EnviarOrdenDialog
          open={enviar && !!creada}
          onOpenChange={v => { if (!v) { setEnviar(false); onClose(); } }}
          orgId={activeOrg.id}
          orden={creada}
          proveedor={proveedor}
          negocio={activeOrg.name ?? ""}
          onEnviada={() => undefined}
        />
      )}
    </>
  );
}
