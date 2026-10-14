/**
 * Solicitudes de compra: pedidos internos con aprobación, dentro de Órdenes de
 * compra (/ordenes-compra).
 *
 * Rearmada 2026-10-14 (funciones incoherentes). Antes los ítems eran texto
 * suelto, toda solicitud se numeraba «temp», un vendedor quedaba con una
 * solicitud vacía (los renglones exigían administrador), cualquiera aprobaba
 * la suya y «Marcar pedida» / «Recibida» eran etiquetas sin orden ni stock.
 * Ahora: se pide con productos del catálogo (o un ítem libre), en una
 * operación que numera la base (`guardar_solicitud_de_compra`); aprueban o
 * rechazan el dueño o un administrador; una aprobada se convierte en una orden
 * de compra real (`convertir_solicitud_en_orden`) y queda recibida sola cuando
 * esa orden se recibe completa.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { AlertCircle, CheckCircle, ChevronDown, ChevronRight, ClipboardList, Clock, Loader2, PenLine, Plus, RotateCcw, ShoppingBag, Trash2, XCircle } from "lucide-react";
import KPICard from "@/components/shared/KPICard";
import ProductCombobox from "@/components/shared/ProductCombobox";
import { fetchOrgProducts, formatARS } from "@/lib/supabaseStore";
import { mensajeDeError } from "@/lib/cuentaCorriente";
import { costoSugerido, fechaArgentina } from "@/lib/compras";
import { pasoParaCantidad } from "@/lib/presupuestos";

interface Solicitud {
  id: string;
  request_number: string;
  title: string;
  requested_by: string;
  department: string | null;
  priority: string;
  status: string;
  total_estimated: number;
  approved_at: string | null;
  rejected_reason: string | null;
  notes: string | null;
  needed_by: string | null;
  created_at: string;
  purchase_order_id: string | null;
  purchase_orders?: { order_number: string; status: string } | null;
  purchase_request_items?: Array<{ id: string; product_name: string; description: string | null; quantity: number; unit: string; estimated_price: number; total_estimated: number; preferred_supplier: string | null }>;
}
interface Producto { id: string; name: string; sku?: string | null; barcode?: string | null; brand?: string | null; unidad_medida?: string | null; is_active?: boolean | null; cost_currency?: string | null; cost_ars?: number | null; cost_usd?: number | null; total_cost_usd?: number | null }
interface Proveedor { id: string; name: string; email: string | null }
interface Renglon { clave: number; productId: string | null; nombre: string; unidad: string | null; qty: number; precio: number; libre: boolean }

const ESTADOS: Record<string, { label: string; variant: "default" | "secondary" | "success" | "warning" | "destructive" | "outline"; icon: React.ReactNode }> = {
  draft: { label: "Borrador", variant: "secondary", icon: <Clock className="h-3 w-3" /> },
  submitted: { label: "Para aprobar", variant: "warning", icon: <Clock className="h-3 w-3" /> },
  approved: { label: "Aprobada", variant: "success", icon: <CheckCircle className="h-3 w-3" /> },
  rejected: { label: "Rechazada", variant: "destructive", icon: <XCircle className="h-3 w-3" /> },
  ordered: { label: "Pedida", variant: "default", icon: <ClipboardList className="h-3 w-3" /> },
  received: { label: "Recibida", variant: "success", icon: <CheckCircle className="h-3 w-3" /> },
  cancelled: { label: "Cancelada", variant: "outline", icon: <XCircle className="h-3 w-3" /> },
};
const PRIORIDADES: Record<string, string> = { low: "Baja", normal: "Normal", high: "Alta", urgent: "Urgente" };

let claves = 0;
const renglonVacio = (libre = false): Renglon => ({ clave: ++claves, productId: null, nombre: "", unidad: null, qty: 1, precio: 0, libre });

export default function PurchaseRequestsTab() {
  const { activeOrg, activeRole } = useOrg();
  const orgId = activeOrg?.id ?? "";
  const puedeAprobar = activeRole === "owner" || activeRole === "admin";

  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorDeCarga, setErrorDeCarga] = useState<string | null>(null);
  const [filtro, setFiltro] = useState("all");
  const [abierta, setAbierta] = useState<string | null>(null);

  const [nueva, setNueva] = useState(false);
  const [form, setForm] = useState({ title: "", requested_by: "", department: "", priority: "normal", needed_by: "", notes: "" });
  const [renglones, setRenglones] = useState<Renglon[]>([renglonVacio()]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [guardando, setGuardando] = useState(false);

  const [rechazando, setRechazando] = useState<Solicitud | null>(null);
  const [motivo, setMotivo] = useState("");
  const [convirtiendo, setConvirtiendo] = useState<Solicitud | null>(null);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [proveedorId, setProveedorId] = useState("");
  const [proveedorLibre, setProveedorLibre] = useState("");
  const [trabajando, setTrabajando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!orgId) return;
    setErrorDeCarga(null);
    const { data, error } = await supabase.from("purchase_requests")
      .select("*, purchase_request_items(*), purchase_orders(order_number, status)")
      .eq("org_id", orgId).order("created_at", { ascending: false }).limit(500);
    if (error) setErrorDeCarga(mensajeDeError(error, "No se pudieron cargar las solicitudes"));
    else setSolicitudes((data ?? []) as unknown as Solicitud[]);
    setCargando(false);
  }, [orgId]);
  useEffect(() => { void cargar(); }, [cargar]);

  const abrirNueva = async () => {
    setForm({ title: "", requested_by: "", department: "", priority: "normal", needed_by: "", notes: "" });
    setRenglones([renglonVacio()]);
    setNueva(true);
    if (productos.length === 0 && orgId) {
      const r = await fetchOrgProducts<Producto>(orgId, "id, name, sku, barcode, brand, unidad_medida, is_active, cost_currency, cost_ars, cost_usd, total_cost_usd");
      if (r.error) toast.error(mensajeDeError(r.error, "No se pudo cargar el catálogo"));
      else setProductos((r.data ?? []).filter(p => p.is_active !== false));
    }
  };

  const cambiar = (clave: number, cambios: Partial<Renglon>) => setRenglones(prev => prev.map(r => r.clave === clave ? { ...r, ...cambios } : r));
  const totalNueva = renglones.reduce((s, r) => s + (r.productId || r.nombre.trim() ? r.qty * r.precio : 0), 0);

  const guardar = async () => {
    const usados = renglones.filter(r => r.productId || r.nombre.trim());
    if (!form.title.trim()) { toast.error("Poné un título a la solicitud"); return; }
    if (usados.length === 0) { toast.error("Agregá al menos un producto"); return; }
    if (usados.some(r => !(r.qty > 0))) { toast.error("Las cantidades tienen que ser mayores a cero"); return; }
    setGuardando(true);
    try {
      const { data, error } = await supabase.rpc("guardar_solicitud_de_compra" as never, {
        p_org: orgId,
        p_datos: {
          ...form, title: form.title.trim(), needed_by: form.needed_by || null,
          items: usados.map(r => ({ product_id: r.productId, product_name: r.productId ? null : r.nombre.trim(), quantity: r.qty, unit: r.unidad ?? "un", estimated_price: r.precio })),
        },
      } as never);
      if (error) throw error;
      toast.success(`Solicitud ${(data as unknown as Solicitud).request_number} enviada para aprobar`);
      setNueva(false);
      await cargar();
    } catch (err) {
      toast.error(mensajeDeError(err, "No se pudo enviar la solicitud"));
    } finally {
      setGuardando(false);
    }
  };

  const cambiarEstado = async (s: Solicitud, status: string, extra: Record<string, unknown> = {}) => {
    setTrabajando(s.id);
    const { error } = await supabase.from("purchase_requests").update({ status, ...extra } as never).eq("id", s.id);
    setTrabajando(null);
    if (error) { toast.error(mensajeDeError(error, "No se pudo actualizar la solicitud")); return false; }
    await cargar();
    return true;
  };

  const abrirConversion = async (s: Solicitud) => {
    setConvirtiendo(s);
    const preferido = s.purchase_request_items?.find(i => i.preferred_supplier)?.preferred_supplier ?? "";
    setProveedorLibre(preferido);
    const { data, error } = await supabase.from("suppliers").select("id, name, email").eq("org_id", orgId).order("name");
    if (error) { toast.error(mensajeDeError(error, "No se pudieron cargar los proveedores")); return; }
    const lista = (data ?? []) as Proveedor[];
    setProveedores(lista);
    setProveedorId(lista.find(p => p.name.toLowerCase() === preferido.toLowerCase())?.id ?? "");
  };

  const convertir = async () => {
    if (!convirtiendo) return;
    const prov = proveedores.find(p => p.id === proveedorId);
    const nombre = prov?.name ?? proveedorLibre.trim();
    if (!nombre) { toast.error("Elegí el proveedor de la orden"); return; }
    setTrabajando(convirtiendo.id);
    try {
      const { data, error } = await supabase.rpc("convertir_solicitud_en_orden" as never, {
        p_org: orgId, p_solicitud: convirtiendo.id,
        p_datos: { supplier_id: prov?.id ?? null, supplier_name: nombre, supplier_email: prov?.email ?? null, currency: "ARS" },
      } as never);
      if (error) throw error;
      toast.success(`Orden ${(data as unknown as { order_number: string }).order_number} creada en borrador`, { description: "Revisala y enviala al proveedor desde la pestaña Órdenes." });
      setConvirtiendo(null);
      await cargar();
    } catch (err) {
      toast.error(mensajeDeError(err, "No se pudo crear la orden"));
    } finally {
      setTrabajando(null);
    }
  };

  const filtradas = filtro === "all" ? solicitudes : solicitudes.filter(s => s.status === filtro);
  const kpis = useMemo(() => ({
    total: solicitudes.length,
    paraAprobar: solicitudes.filter(s => s.status === "submitted").length,
    aprobadas: solicitudes.filter(s => s.status === "approved").length,
    valor: solicitudes.filter(s => s.status === "approved").reduce((a, s) => a + Number(s.total_estimated), 0),
  }), [solicitudes]);

  if (cargando) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Lo que pide el equipo. Aprobada, se convierte en una orden de compra.</p>
        <Button onClick={() => void abrirNueva()}><Plus className="mr-2 h-4 w-4" />Nueva solicitud</Button>
      </div>

      {errorDeCarga && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm" role="alert">
          <AlertCircle className="h-4 w-4 text-destructive" /><span className="flex-1">{errorDeCarga}</span>
          <Button size="sm" variant="outline" onClick={() => { setCargando(true); void cargar(); }}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />Reintentar</Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPICard label="Solicitudes" value={kpis.total} icon={ShoppingBag} color="primary" />
        <KPICard label="Para aprobar" value={kpis.paraAprobar} icon={AlertCircle} color={kpis.paraAprobar > 0 ? "warning" : "success"} sub={puedeAprobar ? "esperan tu aprobación" : "esperan al dueño o un administrador"} />
        <KPICard label="Aprobadas sin pedir" value={kpis.aprobadas} icon={CheckCircle} color="success" sub="convertilas en orden" />
        <KPICard label="Valor aprobado" value={formatARS(kpis.valor)} icon={ClipboardList} color="blue" sub="estimado, sin pedir todavía" />
      </div>

      <div className="flex flex-wrap gap-2">
        {["all", ...Object.keys(ESTADOS)].map(st => (
          <button key={st} type="button" onClick={() => setFiltro(st)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${filtro === st ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50"}`}>
            {st === "all" ? `Todas (${solicitudes.length})` : ESTADOS[st].label}
          </button>
        ))}
      </div>

      {filtradas.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground">
          <ShoppingBag className="mx-auto mb-3 h-12 w-12 opacity-30" />
          <p>{solicitudes.length === 0 ? "Todavía no hay solicitudes de compra" : "Ninguna solicitud en este estado"}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtradas.map(s => {
            const e = ESTADOS[s.status] ?? ESTADOS.draft;
            const exp = abierta === s.id;
            return (
              <div key={s.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <button type="button" className="flex min-w-0 flex-1 items-start gap-2 text-left" onClick={() => setAbierta(exp ? null : s.id)}>
                    {exp ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" />}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{s.request_number}</span>
                        <span className="font-medium">{s.title}</span>
                        {s.priority !== "normal" && <Badge variant={s.priority === "urgent" ? "destructive" : "secondary"}>{PRIORIDADES[s.priority] ?? s.priority}</Badge>}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {s.requested_by}{s.department ? ` · ${s.department}` : ""} · {new Date(s.created_at).toLocaleDateString("es-AR")}
                        {s.needed_by ? ` · para el ${new Date(`${s.needed_by}T12:00:00`).toLocaleDateString("es-AR")}` : ""}
                        {s.purchase_orders ? ` · orden ${s.purchase_orders.order_number}` : ""}
                      </p>
                    </div>
                  </button>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{formatARS(Number(s.total_estimated))}</span>
                    <Badge variant={e.variant} className="gap-1">{e.icon}{e.label}</Badge>
                    {puedeAprobar && s.status === "submitted" && (
                      <>
                        <Button size="sm" className="h-7 text-xs" disabled={trabajando === s.id} onClick={() => void cambiarEstado(s, "approved").then(ok => ok && toast.success(`Solicitud ${s.request_number} aprobada`))}>Aprobar</Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs text-destructive" disabled={trabajando === s.id} onClick={() => { setRechazando(s); setMotivo(""); }}>Rechazar</Button>
                      </>
                    )}
                    {puedeAprobar && s.status === "approved" && (
                      <Button size="sm" className="h-7 text-xs" disabled={trabajando === s.id} onClick={() => void abrirConversion(s)}><ClipboardList className="mr-1 h-3.5 w-3.5" />Crear orden de compra</Button>
                    )}
                    {["draft", "submitted", "approved"].includes(s.status) && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={trabajando === s.id} onClick={() => void cambiarEstado(s, "cancelled").then(ok => ok && toast.success("Solicitud cancelada"))}>Cancelar</Button>
                    )}
                  </div>
                </div>
                {exp && (
                  <div className="mt-3 space-y-1.5 border-t border-border pt-3">
                    {(s.purchase_request_items ?? []).map(i => (
                      <div key={i.id} className="flex justify-between gap-3 rounded bg-muted/20 px-3 py-1.5 text-sm">
                        <span className="min-w-0 truncate">{i.product_name}{i.preferred_supplier ? <span className="ml-2 text-xs text-muted-foreground">({i.preferred_supplier})</span> : null}</span>
                        <span className="shrink-0 text-muted-foreground">{Number(i.quantity).toLocaleString("es-AR")} {i.unit} · {formatARS(Number(i.total_estimated))}</span>
                      </div>
                    ))}
                    {s.rejected_reason && <p className="rounded bg-destructive/10 px-3 py-2 text-sm text-destructive">Motivo del rechazo: {s.rejected_reason}</p>}
                    {s.notes && <p className="text-sm italic text-muted-foreground">{s.notes}</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Nueva ── */}
      <Dialog open={nueva} onOpenChange={v => { if (!guardando) setNueva(v); }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nueva solicitud de compra</DialogTitle>
            <DialogDescription>La aprueba el dueño o un administrador; después se convierte en una orden de compra.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="block text-xs text-muted-foreground">Qué se necesita
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Reposición de cables para el local" maxLength={200} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-muted-foreground">Quién pide
                <Input value={form.requested_by} onChange={e => setForm(f => ({ ...f, requested_by: e.target.value }))} placeholder="Si lo dejás vacío, tu nombre" />
              </label>
              <label className="text-xs text-muted-foreground">Área
                <Input value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} placeholder="Depósito, local…" />
              </label>
              <label className="text-xs text-muted-foreground">Prioridad
                <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(PRIORIDADES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </label>
              <label className="text-xs text-muted-foreground">Para cuándo
                <Input type="date" min={fechaArgentina()} value={form.needed_by} onChange={e => setForm(f => ({ ...f, needed_by: e.target.value }))} />
              </label>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Productos</p>
              {renglones.map((r, i) => (
                <div key={r.clave} className="space-y-2 rounded-lg border border-border bg-muted/20 p-2.5">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      {r.libre ? (
                        <Input value={r.nombre} onChange={e => cambiar(r.clave, { nombre: e.target.value })} placeholder="Algo que no está en el catálogo (resmas, herramientas…)" className="h-9" />
                      ) : (
                        <ProductCombobox<Producto> products={productos} value={r.productId} ariaLabel={`Producto ${i + 1}`} placeholder="Buscar por nombre, marca o código…" className="h-9"
                          onChange={(_id, p) => cambiar(r.clave, p ? { productId: p.id, nombre: p.name, unidad: p.unidad_medida ?? null, precio: costoSugerido(p, "ARS", null) } : { productId: null, nombre: "" })} />
                      )}
                    </div>
                    <button type="button" aria-label={`Quitar producto ${i + 1}`} className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setRenglones(prev => prev.length > 1 ? prev.filter(x => x.clave !== r.clave) : [renglonVacio()])}><Trash2 className="h-4 w-4" /></button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <label className="text-[11px] text-muted-foreground">Cantidad{r.unidad && r.unidad !== "unidad" ? ` (${r.unidad})` : ""}
                      <Input type="number" min="0" step={pasoParaCantidad(r.unidad)} inputMode="decimal" value={r.qty} className="h-8" onChange={e => cambiar(r.clave, { qty: Number(e.target.value) })} />
                    </label>
                    <label className="text-[11px] text-muted-foreground">Precio estimado
                      <Input type="number" min="0" step="0.01" inputMode="decimal" value={r.precio} className="h-8" onChange={e => cambiar(r.clave, { precio: Number(e.target.value) })} />
                    </label>
                    <div className="text-[11px] text-muted-foreground">Subtotal<div className="flex h-8 items-center justify-end text-sm font-semibold text-foreground">{formatARS(r.qty * r.precio)}</div></div>
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setRenglones(prev => [...prev, renglonVacio()])}><Plus className="mr-1 h-3.5 w-3.5" />Producto del catálogo</Button>
                <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setRenglones(prev => [...prev, renglonVacio(true)])}><PenLine className="mr-1 h-3.5 w-3.5" />Otra cosa</Button>
              </div>
              <p className="text-right text-sm font-medium">Total estimado: {formatARS(totalNueva)}</p>
            </div>

            <label className="block text-xs text-muted-foreground">Notas
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} maxLength={2000} />
            </label>
            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <Button variant="outline" onClick={() => setNueva(false)} disabled={guardando}>Cancelar</Button>
              <Button onClick={() => void guardar()} disabled={guardando} data-testid="enviar-solicitud">
                {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Enviar para aprobar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Rechazar ── */}
      <Dialog open={!!rechazando} onOpenChange={v => { if (!v) setRechazando(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Rechazar {rechazando?.request_number}</DialogTitle></DialogHeader>
          <label className="block text-xs text-muted-foreground">Motivo
            <Textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={3} placeholder="Para que quien pidió sepa por qué" />
          </label>
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setRechazando(null)}>Volver</Button>
            <Button variant="destructive" className="flex-1" disabled={!motivo.trim() || trabajando === rechazando?.id}
              onClick={() => rechazando && void cambiarEstado(rechazando, "rejected", { rejected_reason: motivo.trim() }).then(ok => { if (ok) { toast.success("Solicitud rechazada"); setRechazando(null); } })}>Rechazar</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Convertir en orden ── */}
      <Dialog open={!!convirtiendo} onOpenChange={v => { if (!v && !trabajando) setConvirtiendo(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Orden de compra para {convirtiendo?.request_number}</DialogTitle>
            <DialogDescription>Se crea en borrador con los productos y precios estimados de la solicitud; la revisás y la enviás desde Órdenes.</DialogDescription>
          </DialogHeader>
          {proveedores.length > 0 ? (
            <label className="block text-xs text-muted-foreground">Proveedor
              <Select value={proveedorId} onValueChange={setProveedorId}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Elegí el proveedor" /></SelectTrigger>
                <SelectContent>{proveedores.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </label>
          ) : (
            <label className="block text-xs text-muted-foreground">Proveedor
              <Input value={proveedorLibre} onChange={e => setProveedorLibre(e.target.value)} placeholder="Nombre del proveedor" />
            </label>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConvirtiendo(null)} disabled={!!trabajando}>Volver</Button>
            <Button onClick={() => void convertir()} disabled={!!trabajando}>{trabajando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Crear orden</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
