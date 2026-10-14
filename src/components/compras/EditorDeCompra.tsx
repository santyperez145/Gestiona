import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ProductCombobox from "@/components/shared/ProductCombobox";
import { toast } from "sonner";
import { Loader2, Plus, ScanBarcode, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatARS, formatUSD, getProductsDB, getSettingsDB } from "@/lib/supabaseStore";
import { cotizacionDe } from "@/lib/exchangeRate";
import { mensajeDeError } from "@/lib/cuentaCorriente";
import { pasoParaCantidad, productoPorCodigo } from "@/lib/presupuestos";
import {
  MEDIOS_DE_PAGO, compraDesdeFactura, costoSugerido, fechaArgentina, fechaArgentinaEnDias, nuevaClaveCompra, problemasDeLaCompra, registrarCompraDB, totalDeCompra,
  totalDeRenglonCompra, totalEnPesos, type FacturaLeida, type FormularioCompra, type MedioDePago, type MonedaCompra, type RenglonCompra,
} from "@/lib/compras";

/**
 * Registrar una compra entera (2026-10-14). Los renglones salen del catálogo
 * —búsqueda por nombre, marca, SKU o código; el lector de códigos agrega
 * directo y suma si se repite—, con el costo actual precargado en la moneda de
 * la compra. Se guarda con `registrar_compra`: suma el stock, actualiza el costo
 * de los productos y deja el egreso o la cuenta a pagar al proveedor. Si viene
 * de una factura leída con IA, llega precargado: los renglones sin un producto
 * seguro muestran el nombre de la factura para elegirlo.
 */

type Producto = {
  id: string; name: string; brand?: string | null; sku?: string | null; barcode?: string | null; barcode_aliases?: string[] | null;
  stock?: number | null; maneja_stock?: boolean | null; unidad_medida?: string | null; is_active?: boolean | null;
  cost_currency?: string | null; cost_ars?: number | null; cost_usd?: number | null; total_cost_usd?: number | null;
};
type Proveedor = { id: string; name: string };

const hoy = () => fechaArgentina();
const renglonVacio = (): RenglonCompra => ({ clave: nuevaClaveCompra(), productId: null, nombre: "", qty: 1, costo: 0 });

const formularioInicial = (): FormularioCompra => ({
  proveedorId: null, proveedor: "", comprobante: "", fecha: hoy(), moneda: "ARS", cotizacion: null,
  renglones: [renglonVacio()], aPagar: false, vencimiento: fechaArgentinaEnDias(30), medio: "efectivo", nota: "", actualizarCostos: true,
});

export default function EditorDeCompra({ open, onOpenChange, orgId, userId, factura = null, onRegistrada }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  userId: string;
  factura?: FacturaLeida | null;
  onRegistrada: () => void;
}) {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [cotizacionDelNegocio, setCotizacionDelNegocio] = useState<number | null>(null);
  const [cargando, setCargando] = useState(false);
  const [f, setF] = useState<FormularioCompra>(formularioInicial);
  const [codigo, setCodigo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const codigoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let vigente = true;
    setF(formularioInicial());
    setCodigo("");
    setCargando(true);
    Promise.all([
      getProductsDB(userId, orgId),
      getSettingsDB(userId, orgId),
      supabase.from("suppliers").select("id, name").eq("org_id", orgId).order("name"),
    ])
      .then(([prods, settings, prov]) => {
        if (!vigente) return;
        setProductos((prods as unknown as Producto[]).filter(p => p.is_active !== false));
        const tc = cotizacionDe(settings as { exchange_rate?: number | null } | null);
        setCotizacionDelNegocio(tc);
        if (prov.error) throw prov.error;
        const listaDeProveedores = (prov.data ?? []) as Proveedor[];
        setProveedores(listaDeProveedores);
        if (!factura) { setF(prev => ({ ...prev, cotizacion: tc })); return; }
        const activos = (prods as unknown as Producto[]).filter(p => p.is_active !== false);
        const leida = compraDesdeFactura(factura, activos, listaDeProveedores, tc);
        setF(prev => ({ ...prev, cotizacion: tc, ...leida.cambios }));
        const avisos = [
          leida.sinProducto > 0 ? `${leida.sinProducto} ${leida.sinProducto === 1 ? "renglón necesita" : "renglones necesitan"} que elijas el producto` : null,
          leida.proveedorSinCargar ? `el proveedor «${leida.proveedorSinCargar}» no está en tu lista` : null,
          leida.monedasMezcladas ? "la factura mezcla pesos y dólares: revisá los costos" : null,
        ].filter(Boolean);
        toast.success("Factura leída: revisala y registrá la compra", { description: avisos.length ? avisos.join(" · ") : undefined, duration: 8000 });
      })
      .catch(err => toast.error(mensajeDeError(err, "No se pudo cargar el catálogo")))
      .finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, [open, orgId, userId, factura]);

  const porId = useMemo(() => new Map(productos.map(p => [p.id, p])), [productos]);
  const cambiar = (cambios: Partial<FormularioCompra>) => setF(prev => ({ ...prev, ...cambios }));
  const cambiarRenglon = (clave: string, cambios: Partial<RenglonCompra>) =>
    setF(prev => ({ ...prev, renglones: prev.renglones.map(r => (r.clave === clave ? { ...r, ...cambios } : r)) }));

  const renglonDe = (p: Producto, qty = 1): RenglonCompra => ({
    clave: nuevaClaveCompra(), productId: p.id, nombre: p.name, unidad: p.unidad_medida ?? null, qty,
    costo: costoSugerido(p, f.moneda, f.cotizacion),
  });

  const elegirProducto = (clave: string, p: Producto | null) => {
    if (!p) { cambiarRenglon(clave, { productId: null, nombre: "" }); return; }
    cambiarRenglon(clave, { productId: p.id, nombre: p.name, unidad: p.unidad_medida ?? null, costo: costoSugerido(p, f.moneda, f.cotizacion) });
  };

  const agregarPorCodigo = () => {
    const p = productoPorCodigo(productos, codigo);
    if (!p) { toast.error(`No hay un producto con el código «${codigo.trim()}»`); return; }
    setF(prev => {
      const existente = prev.renglones.find(r => r.productId === p.id);
      if (existente) return { ...prev, renglones: prev.renglones.map(r => (r === existente ? { ...r, qty: Number(r.qty) + 1 } : r)) };
      const sinVacios = prev.renglones.filter(r => r.productId);
      return { ...prev, renglones: [...sinVacios, renglonDe(p)] };
    });
    setCodigo("");
    codigoRef.current?.focus();
  };

  // Cambiar la moneda reexpresa los costos precargados del catálogo; los que
  // ya se tocaron a mano se convierten con la cotización.
  const cambiarMoneda = (moneda: MonedaCompra) => {
    if (moneda === f.moneda) return;
    const tc = f.cotizacion && f.cotizacion > 0 ? f.cotizacion : null;
    setF(prev => ({
      ...prev, moneda,
      renglones: prev.renglones.map(r => {
        if (!r.productId) return r;
        const p = porId.get(r.productId);
        const delCatalogo = p ? costoSugerido(p, prev.moneda, tc) : null;
        if (p && delCatalogo === r.costo) return { ...r, costo: costoSugerido(p, moneda, tc) };
        if (!tc) return { ...r, costo: 0 };
        return { ...r, costo: moneda === "USD" ? Math.round((r.costo / tc) * 10000) / 10000 : Math.round(r.costo * tc * 100) / 100 };
      }),
    }));
  };

  const total = totalDeCompra(f.renglones);
  const enPesos = totalEnPesos(f);
  const formato = f.moneda === "USD" ? formatUSD : formatARS;

  const guardar = async () => {
    const problemas = problemasDeLaCompra(f);
    if (problemas.length) {
      toast.error(problemas[0], { description: problemas.length > 1 ? `y ${problemas.length - 1} más` : undefined });
      return;
    }
    setGuardando(true);
    try {
      const r = await registrarCompraDB(orgId, f);
      toast.success(`Compra registrada: ${r.renglones} ${r.renglones === 1 ? "producto" : "productos"} · ${formatARS(Number(r.total_ars))}`, {
        description: [
          "El stock ya está actualizado",
          r.costos_actualizados > 0 ? `costo actualizado en ${r.costos_actualizados}` : null,
          r.deuda_id ? "quedó en Cuentas a pagar" : null,
        ].filter(Boolean).join(" · "),
      });
      onRegistrada();
      onOpenChange(false);
    } catch (err) {
      toast.error(mensajeDeError(err, "No se pudo registrar la compra"));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!guardando) onOpenChange(v); }}>
      <DialogContent className="max-w-4xl max-h-[94vh] overflow-y-auto" data-testid="editor-compra">
        <DialogHeader>
          <DialogTitle>Registrar compra</DialogTitle>
          <DialogDescription>
            Lo que entró del proveedor: suma el stock y actualiza el costo de cada producto. Para pedir mercadería usá Órdenes de compra.
          </DialogDescription>
        </DialogHeader>

        {/* ── Proveedor y comprobante ── */}
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs text-muted-foreground sm:col-span-2">Proveedor
            {proveedores.length > 0 ? (
              <Select value={f.proveedorId ?? "__ninguno"} onValueChange={v => cambiar(v === "__ninguno" ? { proveedorId: null, proveedor: "" } : { proveedorId: v, proveedor: proveedores.find(p => p.id === v)?.name ?? "" })}>
                <SelectTrigger className="h-9" aria-label="Proveedor"><SelectValue placeholder="Sin proveedor" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__ninguno">Sin proveedor</SelectItem>
                  {proveedores.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <Input value={f.proveedor} onChange={e => cambiar({ proveedor: e.target.value })} placeholder="Nombre del proveedor (opcional)" className="h-9" aria-label="Proveedor" />
            )}
          </label>
          <label className="text-xs text-muted-foreground">Comprobante
            <Input value={f.comprobante} onChange={e => cambiar({ comprobante: e.target.value })} placeholder="Factura A 0001-00001234" maxLength={80} className="h-9" />
          </label>
          <label className="text-xs text-muted-foreground">Fecha
            <Input type="date" value={f.fecha} max={hoy()} onChange={e => cambiar({ fecha: e.target.value })} className="h-9" />
          </label>
          <label className="text-xs text-muted-foreground">Moneda
            <Select value={f.moneda} onValueChange={v => cambiarMoneda(v as MonedaCompra)}>
              <SelectTrigger className="h-9" aria-label="Moneda"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ARS">Pesos</SelectItem>
                <SelectItem value="USD">Dólares</SelectItem>
              </SelectContent>
            </Select>
          </label>
          {f.moneda === "USD" && (
            <label className="text-xs text-muted-foreground">Cotización del dólar
              <Input type="number" min="0" step="0.01" inputMode="decimal" value={f.cotizacion ?? ""} className="h-9"
                onChange={e => cambiar({ cotizacion: Number(e.target.value) > 0 ? Number(e.target.value) : null })}
                placeholder={cotizacionDelNegocio ? String(cotizacionDelNegocio) : "Cargala"} />
            </label>
          )}
        </section>

        {/* ── Productos ── */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Productos</h3>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <ScanBarcode className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input ref={codigoRef} value={codigo} onChange={e => setCodigo(e.target.value)} className="pl-8" disabled={cargando}
                placeholder={cargando ? "Cargando catálogo…" : "Escaneá o escribí un código y Enter"} aria-label="Agregar por código"
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (codigo.trim()) agregarPorCodigo(); } }} />
            </div>
            {cargando && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>

          <div className="space-y-2">
            {f.renglones.map((r, i) => {
              const p = r.productId ? porId.get(r.productId) : undefined;
              return (
                <div key={r.clave} className="rounded-lg border border-border bg-muted/20 p-2.5" data-testid="renglon-compra">
                  <div className="flex items-start gap-2">
                    <span className="mt-2.5 w-5 shrink-0 text-right text-xs text-muted-foreground">{i + 1}</span>
                    <div className="min-w-0 flex-1 space-y-2">
                      {!r.productId && r.nombre && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400">En la factura: «{r.nombre}». Elegí el producto del catálogo.</p>
                      )}
                      <ProductCombobox<Producto> products={productos} value={r.productId} disabled={cargando}
                        placeholder={cargando ? "Cargando catálogo…" : "Buscar por nombre, marca, SKU o código…"}
                        ariaLabel={`Producto del renglón ${i + 1}`}
                        describe={prod => [prod.sku, prod.maneja_stock === false ? null : `stock ${Number(prod.stock ?? 0).toLocaleString("es-AR")}`].filter(Boolean).join(" · ")}
                        onChange={(_id, prod) => elegirProducto(r.clave, prod)} className="h-9" />
                      <div className="grid grid-cols-3 gap-2">
                        <label className="text-[11px] text-muted-foreground">Cantidad{p?.unidad_medida && p.unidad_medida !== "unidad" ? ` (${p.unidad_medida})` : ""}
                          <Input type="number" min="0" step={pasoParaCantidad(p?.unidad_medida)} inputMode="decimal" value={r.qty} className="h-8"
                            onChange={e => cambiarRenglon(r.clave, { qty: Number(e.target.value) })} />
                        </label>
                        <label className="text-[11px] text-muted-foreground">Costo unitario ({f.moneda === "USD" ? "US$" : "$"})
                          <Input type="number" min="0" step="0.01" inputMode="decimal" value={r.costo} className="h-8"
                            onChange={e => cambiarRenglon(r.clave, { costo: Number(e.target.value) })} />
                        </label>
                        <div className="text-[11px] text-muted-foreground">Subtotal
                          <div className="flex h-8 items-center justify-end text-sm font-semibold text-foreground">{formato(totalDeRenglonCompra(r))}</div>
                        </div>
                      </div>
                    </div>
                    <button type="button" aria-label={`Quitar renglón ${i + 1}`} className="mt-1.5 rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setF(prev => ({ ...prev, renglones: prev.renglones.length > 1 ? prev.renglones.filter(x => x.clave !== r.clave) : [renglonVacio()] }))}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setF(prev => ({ ...prev, renglones: [...prev.renglones, renglonVacio()] }))}>
            <Plus className="mr-1 h-3.5 w-3.5" />Otro producto
          </Button>
        </section>

        {/* ── Pago y total ── */}
        <section className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1 text-sm" role="radiogroup" aria-label="Pago de la compra">
              {([["pagada", "Pagada"], ["a_pagar", "A pagar"]] as const).map(([id, label]) => (
                <button key={id} type="button" role="radio" aria-checked={(id === "a_pagar") === f.aPagar}
                  className={`flex-1 rounded-md px-3 py-1.5 font-medium transition-colors ${(id === "a_pagar") === f.aPagar ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => cambiar({ aPagar: id === "a_pagar" })}>{label}</button>
              ))}
            </div>
            {f.aPagar ? (
              <label className="block text-xs text-muted-foreground">Vence el
                <Input type="date" value={f.vencimiento} onChange={e => cambiar({ vencimiento: e.target.value })} className="h-9" />
                <span className="mt-1 block text-[11px]">Queda en Cuentas a pagar del proveedor.</span>
              </label>
            ) : (
              <label className="block text-xs text-muted-foreground">Medio de pago
                <Select value={f.medio} onValueChange={v => cambiar({ medio: v as MedioDePago })}>
                  <SelectTrigger className="h-9" aria-label="Medio de pago"><SelectValue /></SelectTrigger>
                  <SelectContent>{MEDIOS_DE_PAGO.map(m => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}</SelectContent>
                </Select>
                <span className="mt-1 block text-[11px]">Queda como egreso en Movimientos.</span>
              </label>
            )}
            <label className="block text-xs text-muted-foreground">Nota
              <Textarea value={f.nota} onChange={e => cambiar({ nota: e.target.value })} rows={2} maxLength={500} placeholder="Opcional" />
            </label>
          </div>
          <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Productos</span><span>{f.renglones.filter(r => r.productId).length}</span></div>
            <div className="flex justify-between border-t border-border pt-1.5 text-base font-bold"><span>Total</span><span className="text-primary">{formato(total)}</span></div>
            {f.moneda === "USD" && (
              <div className="flex justify-between text-xs text-muted-foreground"><span>En pesos</span><span>{enPesos === null ? "falta la cotización" : formatARS(enPesos)}</span></div>
            )}
            <label className="flex items-start gap-2 pt-1 text-xs text-muted-foreground">
              <Checkbox checked={f.actualizarCostos} onCheckedChange={v => cambiar({ actualizarCostos: v === true })} className="mt-0.5" />
              <span>Actualizar el costo de los productos con esta compra (márgenes y reportes usan el costo nuevo)</span>
            </label>
          </div>
        </section>

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={guardando}>Cancelar</Button>
          <Button type="button" onClick={() => void guardar()} disabled={guardando || cargando} data-testid="guardar-compra">
            {guardando ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Registrando…</> : "Registrar compra"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
