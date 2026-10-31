/**
 * «Gastos de la compra» (2026-10-31), dentro del detalle de una compra: flete,
 * seguro, aduana y despachante se reparten entre los productos y forman su
 * costo puesto. La base reparte y actualiza los costos; ver
 * `src/lib/gastosDeCompra.ts`.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Receipt, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import { supabase } from "@/integrations/supabase/client";
import { formatARS, formatUSD } from "@/lib/supabaseStore";
import { hoyAR } from "@/lib/fechaAR";
import { mensajeDeError } from "@/lib/cuentaCorriente";
import { isMissingFunction } from "@/lib/publicDataSource";
import { MEDIOS_DE_PAGO, type MedioDePago, type MonedaCompra } from "@/lib/compras";
import {
  CONCEPTOS_DE_GASTO, PAGOS_DE_GASTO, REPARTOS_DE_GASTO, agregarGastoDB, etiquetaDeGasto, formularioGastoVacio,
  leerGastosDeCompraDB, problemasDelGasto, quitarGastoDB, recargoDeLosGastos, textoDelReparto,
  type ConceptoDeGasto, type FormularioGasto, type GastoDeCompra, type PagoDeGasto, type RepartoDeGasto,
} from "@/lib/gastosDeCompra";

const OTRO_PROVEEDOR = "__otro";
const SIN_PROVEEDOR = "__ninguno";

const ETIQUETA_DE_PAGO: Record<PagoDeGasto, string> = { pagado: "Pagado", a_pagar: "A pagar", registrado: "Ya registrado" };

function errorDeGastos(err: unknown, porDefecto: string): string {
  if (isMissingFunction(err as { code?: string; message?: string })) return "Los gastos de la compra todavía no están habilitados en este negocio.";
  return mensajeDeError(err, porDefecto);
}

export default function GastosDeLaCompra({ orgId, compraId, totalCompraArs, puedeEditar, onCambio }: {
  orgId: string;
  compraId: string;
  totalCompraArs: number;
  puedeEditar: boolean;
  onCambio: () => void;
}) {
  const [gastos, setGastos] = useState<GastoDeCompra[] | null>(null);
  const [disponible, setDisponible] = useState(true);
  const [errorDeCarga, setErrorDeCarga] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [f, setF] = useState<FormularioGasto>(() => formularioGastoVacio(hoyAR()));
  const [proveedores, setProveedores] = useState<Array<{ id: string; name: string }>>([]);
  const [escribirProveedor, setEscribirProveedor] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [quitando, setQuitando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await leerGastosDeCompraDB(orgId, compraId);
      setDisponible(r.disponible);
      setGastos(r.gastos);
      setErrorDeCarga(false);
    } catch (err) {
      console.error("[gastos de la compra] no se pudieron leer", err);
      setErrorDeCarga(true);
    }
  }, [orgId, compraId]);
  useEffect(() => { setGastos(null); setAbierto(false); void cargar(); }, [cargar]);

  const abrir = async () => {
    setF(formularioGastoVacio(hoyAR()));
    setEscribirProveedor(false);
    setAbierto(true);
    const { data, error } = await supabase.from("suppliers").select("id, name").eq("org_id", orgId).order("name");
    if (error) { console.error("[gastos de la compra] no se pudieron leer los proveedores", error); return; }
    const lista = (data ?? []) as Array<{ id: string; name: string }>;
    setProveedores(lista);
    if (lista.length === 0) setEscribirProveedor(true);
  };

  const cambiar = (parte: Partial<FormularioGasto>) => setF(actual => ({ ...actual, ...parte }));
  const problemas = problemasDelGasto(f);

  const agregar = async () => {
    if (problemas.length) { toast.error(problemas[0]); return; }
    setGuardando(true);
    try {
      const r = await agregarGastoDB(orgId, compraId, f);
      toast.success("Gasto agregado", { description: textoDelReparto(r, f.actualizarCostos) });
      setAbierto(false);
      await cargar();
      onCambio();
    } catch (err) {
      toast.error(errorDeGastos(err, "No se pudo agregar el gasto"));
    } finally {
      setGuardando(false);
    }
  };

  const quitar = async (g: GastoDeCompra) => {
    setQuitando(g.id);
    try {
      const r = await quitarGastoDB(orgId, g.id);
      toast.success("Gasto quitado", { description: textoDelReparto(r, true) });
      await cargar();
      onCambio();
    } catch (err) {
      toast.error(errorDeGastos(err, "No se pudo quitar el gasto"));
    } finally {
      setQuitando(null);
    }
  };

  if (!disponible) return null;
  const totalGastos = (gastos ?? []).reduce((s, g) => s + Number(g.monto_ars || 0), 0);
  const recargo = recargoDeLosGastos(totalCompraArs, totalGastos);

  return (
    <section className="space-y-3 rounded-lg border border-border p-3 text-sm" aria-labelledby="gastos-de-la-compra" data-testid="gastos-de-la-compra">
      <div className="flex items-start gap-2">
        <Receipt className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h3 id="gastos-de-la-compra" className="font-medium">Gastos de la compra</h3>
          <p className="text-xs text-muted-foreground">
            Flete, seguro, aduana y despachante se reparten entre los productos y forman su costo puesto. Sin IVA ni percepciones: son crédito fiscal, no costo.
          </p>
        </div>
        {puedeEditar && !abierto && gastos && (
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => void abrir()}>
            <Plus className="mr-1 h-3.5 w-3.5" />Agregar gasto
          </Button>
        )}
      </div>

      {errorDeCarga && <p className="text-xs text-destructive">No pudimos leer los gastos de esta compra. Cerrá y volvé a abrirla en un rato.</p>}
      {!errorDeCarga && !gastos && <p className="text-xs text-muted-foreground">Leyendo…</p>}
      {gastos && gastos.length === 0 && !abierto && (
        <p className="text-xs text-muted-foreground">Sin gastos cargados: el costo de cada producto es el de la factura.</p>
      )}

      {gastos && gastos.length > 0 && (
        <>
          <ul className="divide-y divide-border rounded-md border border-border/60">
            {gastos.map(g => (
              <li key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{etiquetaDeGasto(g)}</p>
                  <p className="text-xs text-muted-foreground">
                    {[g.proveedor, g.comprobante, REPARTOS_DE_GASTO.find(r => r.id === g.reparto)?.label.toLowerCase(), ETIQUETA_DE_PAGO[g.pago]]
                      .filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="text-right tabular-nums">
                  <p className="font-medium">{formatARS(Number(g.monto_ars))}</p>
                  {(g.moneda === "USD" || Number(g.impuestos) > 0) && (
                    <p className="text-xs text-muted-foreground">
                      {g.moneda === "USD" ? formatUSD(Number(g.monto)) : ""}
                      {g.moneda === "USD" && Number(g.impuestos) > 0 ? " · " : ""}
                      {Number(g.impuestos) > 0 ? `+ ${g.moneda === "USD" ? formatUSD(Number(g.impuestos)) : formatARS(Number(g.impuestos))} de impuestos` : ""}
                    </p>
                  )}
                </div>
                {puedeEditar && (
                  <ConfirmDialog
                    trigger={<Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" aria-label={`Quitar ${etiquetaDeGasto(g)}`} disabled={!!quitando}>
                      {quitando === g.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </Button>}
                    title="¿Quitar este gasto?"
                    description={`Se vuelve a repartir lo que queda y se recalcula el costo de los productos${g.pago === "a_pagar" ? "; se quita la cuenta a pagar" : g.pago === "pagado" ? "; se quita el egreso" : ""}. Queda registrado en la auditoría.`}
                    confirmText="Quitar gasto"
                    onConfirm={() => quitar(g)}
                  />
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground" data-testid="total-gastos-de-la-compra">
            Suman {formatARS(totalGastos)}{recargo !== null ? `: un ${recargo.toLocaleString("es-AR")}% sobre lo comprado` : ""}.
          </p>
        </>
      )}

      {abierto && (
        <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3" data-testid="formulario-gasto">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-muted-foreground">Qué es
              <Select value={f.concepto} onValueChange={v => cambiar({ concepto: v as ConceptoDeGasto })}>
                <SelectTrigger className="h-9" aria-label="Qué es"><SelectValue /></SelectTrigger>
                <SelectContent>{CONCEPTOS_DE_GASTO.map(c => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="text-xs text-muted-foreground">Detalle{f.concepto === "otro" ? "" : " (opcional)"}
              <Input value={f.detalle} onChange={e => cambiar({ detalle: e.target.value })} maxLength={200} className="h-9"
                placeholder={f.concepto === "otro" ? "Ej.: certificado de origen" : "Ej.: courier, contenedor"} />
            </label>
            <label className="text-xs text-muted-foreground">Monto sin IVA
              <div className="flex gap-2">
                <Input value={f.monto} onChange={e => cambiar({ monto: e.target.value })} inputMode="decimal" className="h-9" aria-label="Monto sin IVA" placeholder="0" />
                <Select value={f.moneda} onValueChange={v => cambiar({ moneda: v as MonedaCompra })}>
                  <SelectTrigger className="h-9 w-24" aria-label="Moneda del gasto"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="ARS">Pesos</SelectItem><SelectItem value="USD">Dólares</SelectItem></SelectContent>
                </Select>
              </div>
            </label>
            {f.moneda === "USD" ? (
              <label className="text-xs text-muted-foreground">Cotización del pago
                <Input value={f.cotizacion} onChange={e => cambiar({ cotizacion: e.target.value })} inputMode="decimal" className="h-9" aria-label="Cotización" placeholder="Pesos por dólar" />
              </label>
            ) : <div className="hidden sm:block" />}
            <label className="text-xs text-muted-foreground">IVA y percepciones (opcional)
              <Input value={f.impuestos} onChange={e => cambiar({ impuestos: e.target.value })} inputMode="decimal" className="h-9" aria-label="IVA y percepciones" placeholder="0" />
              <span className="mt-0.5 block text-[11px]">Se pagan con el gasto, pero no entran al costo.</span>
            </label>
            <label className="text-xs text-muted-foreground">Cómo se reparte
              <Select value={f.reparto} onValueChange={v => cambiar({ reparto: v as RepartoDeGasto })}>
                <SelectTrigger className="h-9" aria-label="Cómo se reparte"><SelectValue /></SelectTrigger>
                <SelectContent>{REPARTOS_DE_GASTO.map(r => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="text-xs text-muted-foreground">A quién
              {!escribirProveedor ? (
                <Select value={f.proveedorId ?? SIN_PROVEEDOR} onValueChange={v => {
                  if (v === OTRO_PROVEEDOR) { setEscribirProveedor(true); cambiar({ proveedorId: null, proveedor: "" }); return; }
                  cambiar(v === SIN_PROVEEDOR ? { proveedorId: null, proveedor: "" } : { proveedorId: v, proveedor: proveedores.find(p => p.id === v)?.name ?? "" });
                }}>
                  <SelectTrigger className="h-9" aria-label="A quién"><SelectValue placeholder="Sin indicar" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SIN_PROVEEDOR}>Sin indicar</SelectItem>
                    {proveedores.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    <SelectItem value={OTRO_PROVEEDOR}>Otro: escribir el nombre</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input value={f.proveedor} onChange={e => cambiar({ proveedor: e.target.value })} maxLength={200} className="h-9" aria-label="A quién" placeholder="Despachante, transporte…" />
              )}
            </label>
            <label className="text-xs text-muted-foreground">Comprobante (opcional)
              <Input value={f.comprobante} onChange={e => cambiar({ comprobante: e.target.value })} maxLength={80} className="h-9" placeholder="Factura A 0003-00000055" />
            </label>
            <label className="text-xs text-muted-foreground">Fecha
              <Input type="date" value={f.fecha} onChange={e => cambiar({ fecha: e.target.value })} className="h-9" aria-label="Fecha del gasto" />
            </label>
            <label className="text-xs text-muted-foreground">Pago
              <Select value={f.pago} onValueChange={v => cambiar({ pago: v as PagoDeGasto })}>
                <SelectTrigger className="h-9" aria-label="Pago del gasto"><SelectValue /></SelectTrigger>
                <SelectContent>{PAGOS_DE_GASTO.map(p => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            {f.pago === "pagado" && (
              <label className="text-xs text-muted-foreground">Medio
                <Select value={f.medio} onValueChange={v => cambiar({ medio: v as MedioDePago })}>
                  <SelectTrigger className="h-9" aria-label="Medio de pago del gasto"><SelectValue /></SelectTrigger>
                  <SelectContent>{MEDIOS_DE_PAGO.map(m => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}</SelectContent>
                </Select>
              </label>
            )}
            {f.pago === "a_pagar" && (
              <label className="text-xs text-muted-foreground">Vencimiento (opcional)
                <Input type="date" value={f.vencimiento} onChange={e => cambiar({ vencimiento: e.target.value })} className="h-9" aria-label="Vencimiento del gasto" />
              </label>
            )}
          </div>
          {f.pago === "registrado" && (
            <p className="text-xs text-muted-foreground">Sólo suma al costo: no se crea otra cuenta a pagar ni otro egreso, para no contar dos veces la misma factura.</p>
          )}
          <label className="flex items-center gap-2 text-xs">
            <Checkbox checked={f.actualizarCostos} onCheckedChange={v => cambiar({ actualizarCostos: v === true })} />
            Actualizar el costo de los productos (los que no tuvieron una compra posterior)
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setAbierto(false)} disabled={guardando}>Cancelar</Button>
            <Button size="sm" onClick={() => void agregar()} disabled={guardando || problemas.length > 0}>
              {guardando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Agregar gasto
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
