import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";
import { getPurchasesDB, formatARS, formatDateAR, formatUSD } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, BarChart3, CalendarClock, ClipboardList, FileSpreadsheet, Loader2, MoreHorizontal, Plus, Printer, RotateCcw, Search, ShoppingCart, Sparkles, Truck, Users, Wallet } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import EmptyState from "@/components/shared/EmptyState";
import DataPagination from "@/components/shared/DataPagination";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { TableSkeleton } from "@/components/shared/PageSkeleton";
import EditorDeCompra from "@/components/compras/EditorDeCompra";
import LectorDeFactura from "@/components/compras/LectorDeFactura";
import { useModulePermissions } from "@/lib/usePermissions";
import { usePageTitle } from "@/hooks/usePageTitle";
import { mensajeDeError } from "@/lib/cuentaCorriente";
import { plural } from "@/lib/plural";
import {
  ETIQUETA_DE_PAGO, agruparCompras, anularCompraDB, compraCoincide, contextoDeComprasDB, fechaArgentina,
  type Compra, type FacturaLeida, type FilaDeCompra,
} from "@/lib/compras";

/**
 * Compras (rearmada 2026-10-14, pedido del dueño: «además de lo visual, tienen
 * funciones totalmente legacy o incoherentes»). Lo que había:
 * · «Nueva compra» insertaba columnas que no existen: registrar fallaba siempre.
 * · Un producto por compra, costo en dólares + un 15 % fijo del importador original.
 * · Compras «programadas» y «en camino» que duplicaban Órdenes de compra, con
 *   un generador de Excel y un mail de un solo producto como «orden».
 * · Borrar un renglón dejaba la cuenta del proveedor y el egreso por el total.
 *
 * Ahora: lo que se pide va por Órdenes de compra; acá queda lo que entró (por
 * recepción de una orden o compra directa), como compras enteras. Registrar y
 * anular los hace la base (`registrar_compra`, `anular_compra`): el stock lo
 * mueve trg_purchase_stock_movement, el costo del producto se actualiza y la
 * cuenta a pagar o el egreso quedan atados a la compra.
 */

const POR_PAGINA = 20;
type Estado = "todas" | "a_pagar" | "vencidas" | "pagadas" | "por_orden";

const TONO_DE_PAGO: Record<Compra["estadoDePago"], "success" | "warning" | "destructive" | "secondary"> = {
  pagada: "success", a_pagar: "warning", pago_parcial: "warning", vencida: "destructive", sin_registrar: "secondary",
};

const restanteDe = (c: Compra) => (c.deuda ? Math.max(0, Number(c.deuda.remaining_ars ?? Number(c.deuda.amount_ars) - Number(c.deuda.paid_ars))) : 0);

export default function PurchasesPage() {
  usePageTitle("Compras");
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const navigate = useNavigate();
  const { canCreate, canDelete } = useModulePermissions("purchases");

  const [compras, setCompras] = useState<Compra[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorDeCarga, setErrorDeCarga] = useState<string | null>(null);
  const [editorAbierto, setEditorAbierto] = useState(false);
  const [factura, setFactura] = useState<FacturaLeida | null>(null);
  const [lectorAbierto, setLectorAbierto] = useState(false);
  const [detalle, setDetalle] = useState<Compra | null>(null);
  const [anulando, setAnulando] = useState<string | null>(null);

  const [vista, setVista] = useState<"compras" | "proveedores">("compras");
  const [busqueda, setBusqueda] = useState("");
  const [proveedor, setProveedor] = useState("todos");
  const [estado, setEstado] = useState<Estado>("todas");
  const [desde, setDesde] = useState<Date | undefined>();
  const [hasta, setHasta] = useState<Date | undefined>();
  const [pagina, setPagina] = useState(0);

  const cargar = useCallback(async () => {
    if (!user || !activeOrg) return;
    setErrorDeCarga(null);
    try {
      const [filas, contexto] = await Promise.all([
        getPurchasesDB(user.id, activeOrg.id) as Promise<FilaDeCompra[]>,
        contextoDeComprasDB(activeOrg.id),
      ]);
      setCompras(agruparCompras(filas, contexto.recepciones, contexto.deudas));
    } catch (err) {
      setErrorDeCarga(mensajeDeError(err, "No se pudieron cargar las compras"));
    } finally {
      setCargando(false);
    }
  }, [user, activeOrg]);
  useEffect(() => { void cargar(); }, [cargar]);

  // ── Filtros ──
  const desdeTxt = desde ? fechaArgentina(desde) : null;
  const hastaTxt = hasta ? fechaArgentina(hasta) : null;
  const enPeriodo = useMemo(() => compras.filter(c =>
    (!desdeTxt || c.fecha >= desdeTxt) && (!hastaTxt || c.fecha <= hastaTxt)), [compras, desdeTxt, hastaTxt]);
  const filtradas = useMemo(() => enPeriodo.filter(c => {
    if (proveedor !== "todos" && (c.proveedor ?? "") !== proveedor) return false;
    if (estado === "a_pagar" && !["a_pagar", "pago_parcial", "vencida"].includes(c.estadoDePago)) return false;
    if (estado === "vencidas" && c.estadoDePago !== "vencida") return false;
    if (estado === "pagadas" && c.estadoDePago !== "pagada") return false;
    if (estado === "por_orden" && !c.orden) return false;
    return compraCoincide(c, busqueda);
  }), [enPeriodo, proveedor, estado, busqueda]);
  useEffect(() => { setPagina(0); }, [busqueda, proveedor, estado, desdeTxt, hastaTxt, vista]);

  const proveedoresConCompras = useMemo(() =>
    Array.from(new Set(compras.map(c => c.proveedor).filter((p): p is string => !!p))).sort((a, b) => a.localeCompare(b, "es")), [compras]);

  // ── Indicadores ──
  const totalPeriodo = filtradas.reduce((s, c) => s + c.totalArs, 0);
  const aPagar = compras.reduce((s, c) => s + restanteDe(c), 0);
  const vencido = compras.filter(c => c.estadoDePago === "vencida").reduce((s, c) => s + restanteDe(c), 0);
  const porProveedor = useMemo(() => {
    const mapa = new Map<string, { nombre: string; total: number; compras: number; productos: Set<string>; ultima: string; aPagar: number }>();
    for (const c of filtradas) {
      const nombre = c.proveedor || "Sin proveedor";
      const fila = mapa.get(nombre) ?? { nombre, total: 0, compras: 0, productos: new Set<string>(), ultima: c.fecha, aPagar: 0 };
      fila.total += c.totalArs;
      fila.compras += 1;
      fila.aPagar += restanteDe(c);
      c.renglones.forEach(r => fila.productos.add(r.product_name));
      if (c.fecha > fila.ultima) fila.ultima = c.fecha;
      mapa.set(nombre, fila);
    }
    return [...mapa.values()].sort((a, b) => b.total - a.total);
  }, [filtradas]);
  const principal = porProveedor.find(p => p.nombre !== "Sin proveedor");

  const porMes = useMemo(() => {
    const ahora = new Date();
    const meses = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(ahora.getFullYear(), ahora.getMonth() - 11 + i, 1);
      return { clave: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, mes: d.toLocaleDateString("es-AR", { month: "short" }).replace(".", ""), total: 0 };
    });
    for (const c of compras) {
      const m = meses.find(x => x.clave === c.fecha.slice(0, 7));
      if (m) m.total += c.totalArs;
    }
    return meses;
  }, [compras]);

  const paginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA));
  const visibles = filtradas.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA);

  // ── Acciones ──
  const anular = async (c: Compra) => {
    if (!activeOrg) return;
    setAnulando(c.id);
    try {
      const r = await anularCompraDB(activeOrg.id, c.id);
      toast.success("Compra anulada", { description: `Se revirtió el stock de ${plural(r.renglones, "producto")}${c.deuda ? " y se quitó la cuenta a pagar" : ""}.` });
      setDetalle(null);
      await cargar();
    } catch (err) {
      toast.error(mensajeDeError(err, "No se pudo anular la compra"));
    } finally {
      setAnulando(null);
    }
  };

  const exportarCSV = () => {
    const celda = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const encabezado = ["Fecha", "Comprobante", "Orden", "Proveedor", "Producto", "Cantidad", "Total ARS", "Total USD", "Pago"];
    const filas = filtradas.flatMap(c => c.renglones.map(r => [
      c.fecha, c.comprobante ?? "", c.orden?.numero ?? "", c.proveedor ?? "", r.product_name, r.quantity,
      Number(r.total_ars || 0).toFixed(2), Number(r.total_usd || 0).toFixed(2), ETIQUETA_DE_PAGO[c.estadoDePago],
    ].map(celda).join(",")));
    const blob = new Blob(["﻿" + [encabezado.join(","), ...filas].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compras_${fechaArgentina()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${plural(filtradas.length, "compra")} exportadas`);
  };

  const imprimir = () => {
    const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));
    const periodo = desdeTxt ? `${formatDateAR(desdeTxt + "T12:00:00")} – ${formatDateAR((hastaTxt ?? fechaArgentina()) + "T12:00:00")}` : "Todo el período";
    const filas = filtradas.map(c => `<tr><td>${esc(formatDateAR(c.fecha + "T12:00:00"))}</td><td>${esc(c.comprobante || c.orden?.numero || "—")}</td><td>${esc(c.proveedor || "—")}</td><td>${esc(c.renglones.map(r => `${r.product_name} ×${Number(r.quantity).toLocaleString("es-AR")}`).join(", "))}</td><td style="text-align:right">${esc(formatARS(c.totalArs))}</td><td>${esc(ETIQUETA_DE_PAGO[c.estadoDePago])}</td></tr>`).join("");
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Compras</title><style>body{font-family:Arial,sans-serif;margin:20px;color:#111}h1{font-size:16px;margin:0}p{font-size:11px;color:#666}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{font-size:10px;padding:4px 6px;border-bottom:1px solid #eee;text-align:left;vertical-align:top}th{background:#f6f6f6;color:#555}</style></head><body><h1>Compras · ${esc(activeOrg?.name ?? "")}</h1><p>${esc(periodo)} · ${filtradas.length} compras · ${esc(formatARS(totalPeriodo))}</p><table><thead><tr><th>Fecha</th><th>Comprobante</th><th>Proveedor</th><th>Productos</th><th style="text-align:right">Total</th><th>Pago</th></tr></thead><tbody>${filas}</tbody></table></body></html>`;
    const w = window.open("", "_blank");
    if (!w) { toast.error("El navegador bloqueó la ventana de impresión"); return; }
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 300);
  };

  if (cargando) return <TableSkeleton rows={6} cols={6} />;

  return (
    <div className="space-y-5 pb-12">
      <PageHeader
        icon={ShoppingCart}
        eyebrow="Commerce · Compras"
        title="Compras"
        description="Lo que entró de tus proveedores: suma stock, actualiza costos y queda pagado o en cuentas a pagar."
        badge={vencido > 0 ? { label: `${formatARS(vencido)} vencido`, variant: "destructive" } : aPagar > 0 ? { label: `${formatARS(aPagar)} a pagar`, variant: "warning" } : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <DateRangePicker from={desde} to={hasta} onChange={(f, t) => { setDesde(f); setHasta(t); }} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9" aria-label="Más acciones de compras">
                  <MoreHorizontal className="h-4 w-4 sm:mr-2" /><span className="sr-only sm:not-sr-only sm:whitespace-nowrap">Más acciones</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuItem onClick={() => navigate("/ordenes-compra")}><ClipboardList className="mr-2 h-4 w-4" />Pedir mercadería (órdenes de compra)</DropdownMenuItem>
                {canCreate && <DropdownMenuItem onClick={() => setLectorAbierto(true)}><Sparkles className="mr-2 h-4 w-4 text-primary" />Cargar desde la factura (IA)</DropdownMenuItem>}
                <DropdownMenuItem onClick={exportarCSV} disabled={filtradas.length === 0}><FileSpreadsheet className="mr-2 h-4 w-4" />Exportar a Excel (CSV)</DropdownMenuItem>
                <DropdownMenuItem onClick={imprimir} disabled={filtradas.length === 0}><Printer className="mr-2 h-4 w-4" />Imprimir resumen</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {canCreate && (
              <Button className="h-9" onClick={() => { setFactura(null); setEditorAbierto(true); }} data-testid="nueva-compra">
                <Plus className="mr-2 h-4 w-4" />Nueva compra
              </Button>
            )}
          </div>
        }
      />

      {errorDeCarga && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm" role="alert">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <span className="flex-1">{errorDeCarga}</span>
          <Button size="sm" variant="outline" onClick={() => { setCargando(true); void cargar(); }}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />Reintentar</Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KPICard label="Comprado" value={formatARS(totalPeriodo)} sub={`${plural(filtradas.length, "compra")}${desde ? " en el período" : ""}`} icon={ShoppingCart} color="primary" />
        <KPICard label="A pagar" value={formatARS(aPagar)} sub="a proveedores, por compras" icon={Wallet} color={aPagar > 0 ? "warning" : "success"}
          onClick={aPagar > 0 ? () => setEstado("a_pagar") : undefined} />
        <KPICard label="Vencido" value={formatARS(vencido)} sub={vencido > 0 ? "pagalo en Cuentas a pagar" : "nada vencido"} icon={CalendarClock} color={vencido > 0 ? "destructive" : "success"}
          onClick={vencido > 0 ? () => setEstado("vencidas") : undefined} />
        <KPICard label="Proveedor principal" value={principal?.nombre ?? "—"} sub={principal ? formatARS(principal.total) : "sin compras con proveedor"} icon={Users} color="primary" />
      </div>

      {porMes.some(m => m.total > 0) && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><BarChart3 className="h-4 w-4 text-primary" />Compras por mes (últimos 12)</h3>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={porMes} margin={{ top: 0, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="mes" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => `$${Math.round(Number(v) / 1000)}k`} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={44} />
              <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [formatARS(v), "Comprado"]} />
              <Bar dataKey="total" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={vista} onValueChange={v => setVista(v as typeof vista)}>
          <TabsList>
            <TabsTrigger value="compras"><ShoppingCart className="mr-1.5 h-4 w-4" />Compras</TabsTrigger>
            <TabsTrigger value="proveedores"><Users className="mr-1.5 h-4 w-4" />Por proveedor</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Producto, proveedor, comprobante u orden…" className="h-9 pl-9" aria-label="Buscar compras" />
        </div>
        {proveedoresConCompras.length > 0 && (
          <Select value={proveedor} onValueChange={setProveedor}>
            <SelectTrigger className="h-9 w-full sm:w-[190px]" aria-label="Proveedor"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los proveedores</SelectItem>
              {proveedoresConCompras.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {vista === "compras" && (
          <Select value={estado} onValueChange={v => setEstado(v as Estado)}>
            <SelectTrigger className="h-9 w-full sm:w-[170px]" aria-label="Estado de pago"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              <SelectItem value="a_pagar">A pagar</SelectItem>
              <SelectItem value="vencidas">Vencidas</SelectItem>
              <SelectItem value="pagadas">Pagadas</SelectItem>
              <SelectItem value="por_orden">Recibidas por orden</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {vista === "proveedores" ? (
        porProveedor.length === 0 ? (
          <EmptyState icon={Users} title="Sin compras en el período" description="Cuando registres compras con proveedor vas a ver cuánto le comprás a cada uno." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 text-left font-semibold">Proveedor</th>
                  <th className="px-4 py-3 text-right font-semibold">Compras</th>
                  <th className="hidden px-4 py-3 text-right font-semibold md:table-cell">Productos</th>
                  <th className="px-4 py-3 text-right font-semibold">Total</th>
                  <th className="hidden px-4 py-3 text-right font-semibold lg:table-cell">A pagar</th>
                  <th className="hidden px-4 py-3 text-right font-semibold lg:table-cell">Última</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {porProveedor.map(p => (
                  <tr key={p.nombre} className="hover:bg-muted/20">
                    <td className="px-4 py-3 font-medium">{p.nombre}</td>
                    <td className="px-4 py-3 text-right">{p.compras}</td>
                    <td className="hidden px-4 py-3 text-right text-muted-foreground md:table-cell">{p.productos.size}</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatARS(p.total)}</td>
                    <td className="hidden px-4 py-3 text-right lg:table-cell">{p.aPagar > 0 ? formatARS(p.aPagar) : "—"}</td>
                    <td className="hidden px-4 py-3 text-right text-xs text-muted-foreground lg:table-cell">{formatDateAR(p.ultima + "T12:00:00")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : filtradas.length === 0 ? (
        compras.length === 0 ? (
          <EmptyState icon={ShoppingCart} title="Todavía no registraste compras"
            description="Registrá lo que te entrega el proveedor: suma el stock, actualiza el costo y deja el pago o la cuenta a pagar. Si pedís con órdenes de compra, al recibirlas aparecen acá solas."
            actionLabel={canCreate ? "Registrar una compra" : undefined} onAction={canCreate ? () => { setFactura(null); setEditorAbierto(true); } : undefined} />
        ) : (
          <EmptyState icon={Search} title="Ninguna compra coincide" description="Probá con otro texto, proveedor, estado o período." />
        )
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-border bg-card md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 text-left font-semibold">Fecha</th>
                  <th className="px-4 py-3 text-left font-semibold">Comprobante</th>
                  <th className="px-4 py-3 text-left font-semibold">Proveedor</th>
                  <th className="px-4 py-3 text-left font-semibold">Productos</th>
                  <th className="px-4 py-3 text-right font-semibold">Total</th>
                  <th className="px-4 py-3 text-left font-semibold">Pago</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibles.map(c => (
                  <tr key={c.id} className="cursor-pointer hover:bg-muted/20" onClick={() => setDetalle(c)} data-testid="fila-compra">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{formatDateAR(c.fecha + "T12:00:00")}</td>
                    <td className="px-4 py-3 text-xs">
                      {c.orden ? <span className="inline-flex items-center gap-1"><Truck className="h-3.5 w-3.5 text-primary" />{c.orden.numero}</span> : c.comprobante || <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3">{c.proveedor || <span className="text-muted-foreground">Sin proveedor</span>}</td>
                    <td className="max-w-[320px] px-4 py-3">
                      <span className="line-clamp-1">{c.renglones.map(r => r.product_name).join(", ")}</span>
                      {c.renglones.length > 1 && <span className="text-xs text-muted-foreground">{c.renglones.length} productos</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">{formatARS(c.totalArs)}</td>
                    <td className="px-4 py-3">
                      <Badge variant={TONO_DE_PAGO[c.estadoDePago]}>{ETIQUETA_DE_PAGO[c.estadoDePago]}</Badge>
                      {c.deuda && restanteDe(c) > 0 && <span className="ml-2 text-xs text-muted-foreground">{formatARS(restanteDe(c))}{c.deuda.due_date ? ` · vence ${formatDateAR(c.deuda.due_date + "T12:00:00")}` : ""}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 md:hidden">
            {visibles.map(c => (
              <button key={c.id} type="button" className="w-full rounded-lg border border-border bg-card p-4 text-left" onClick={() => setDetalle(c)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{c.proveedor || "Sin proveedor"}</p>
                    <p className="text-xs text-muted-foreground">{formatDateAR(c.fecha + "T12:00:00")} · {c.orden?.numero ?? c.comprobante ?? plural(c.renglones.length, "producto")}</p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold">{formatARS(c.totalArs)}</p>
                </div>
                <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{c.renglones.map(r => r.product_name).join(", ")}</p>
                <Badge className="mt-2" variant={TONO_DE_PAGO[c.estadoDePago]}>{ETIQUETA_DE_PAGO[c.estadoDePago]}</Badge>
              </button>
            ))}
          </div>

          <DataPagination page={pagina} totalPages={paginas} totalItems={filtradas.length} pageSize={POR_PAGINA} itemLabel="compras" onPageChange={setPagina} />
        </>
      )}

      {/* ── Detalle ── */}
      <Dialog open={!!detalle} onOpenChange={v => { if (!v && !anulando) setDetalle(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {detalle && (
            <>
              <DialogHeader>
                <DialogTitle>Compra{detalle.comprobante ? ` ${detalle.comprobante}` : ""}</DialogTitle>
                <DialogDescription>
                  {formatDateAR(detalle.fecha + "T12:00:00")} · {detalle.proveedor || "Sin proveedor"}
                  {detalle.orden && <> · recibida por la orden <Link to="/ordenes-compra" className="text-primary hover:underline">{detalle.orden.numero}</Link></>}
                </DialogDescription>
              </DialogHeader>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-xs text-muted-foreground">
                      <th className="px-3 py-2 text-left font-medium">Producto</th>
                      <th className="px-3 py-2 text-right font-medium">Cantidad</th>
                      <th className="px-3 py-2 text-right font-medium">Costo unit.</th>
                      <th className="px-3 py-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {detalle.renglones.map(r => (
                      <tr key={r.id}>
                        <td className="px-3 py-2">{r.product_name}</td>
                        <td className="px-3 py-2 text-right">{Number(r.quantity).toLocaleString("es-AR")}</td>
                        <td className="px-3 py-2 text-right">{formatARS(Number(r.quantity) > 0 ? Number(r.total_ars) / Number(r.quantity) : 0)}</td>
                        <td className="px-3 py-2 text-right font-medium">{formatARS(Number(r.total_ars))}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border bg-muted/20 font-semibold">
                      <td className="px-3 py-2" colSpan={3}>Total{detalle.totalUsd > 0 && Number(detalle.renglones[0]?.exchange_rate) > 1 ? ` (${formatUSD(detalle.totalUsd)})` : ""}</td>
                      <td className="px-3 py-2 text-right">{formatARS(detalle.totalArs)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant={TONO_DE_PAGO[detalle.estadoDePago]}>{ETIQUETA_DE_PAGO[detalle.estadoDePago]}</Badge>
                {detalle.deuda && restanteDe(detalle) > 0 && (
                  <span className="text-muted-foreground">
                    Resta {formatARS(restanteDe(detalle))}{detalle.deuda.due_date ? `, vence el ${formatDateAR(detalle.deuda.due_date + "T12:00:00")}` : ""} ·{" "}
                    <Link to="/proveedores" className="text-primary hover:underline">pagar en Proveedores</Link>
                  </span>
                )}
                {detalle.estadoDePago === "sin_registrar" && <span className="text-muted-foreground">Entró por una orden: el pago al proveedor se registra en Proveedores.</span>}
              </div>
              <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
                {canDelete && !detalle.orden && (
                  <ConfirmDialog
                    trigger={<Button variant="outline" className="text-destructive hover:text-destructive" disabled={!!anulando}>
                      {anulando === detalle.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Anular compra
                    </Button>}
                    title="¿Anular esta compra?"
                    description={`Se revierte el stock de ${plural(detalle.renglones.length, "producto")}${detalle.deuda ? ", se quita la cuenta a pagar" : " y se quita el egreso"}. Los costos de los productos no vuelven atrás. Queda registrado en la auditoría.`}
                    confirmText="Anular compra"
                    onConfirm={() => anular(detalle)}
                  />
                )}
                <Button variant="outline" onClick={() => setDetalle(null)} disabled={!!anulando}>Cerrar</Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {user && activeOrg && (
        <>
          <EditorDeCompra open={editorAbierto} onOpenChange={v => { setEditorAbierto(v); if (!v) setFactura(null); }} orgId={activeOrg.id} userId={user.id} factura={factura} onRegistrada={() => void cargar()} />
          <LectorDeFactura open={lectorAbierto} onOpenChange={setLectorAbierto} orgId={activeOrg.id} onLeida={f => { setFactura(f); setEditorAbierto(true); }} />
        </>
      )}
    </div>
  );
}
