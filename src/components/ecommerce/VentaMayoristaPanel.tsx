/**
 * Venta mayorista online (2026-10-30), migración 20261023000600.
 *
 * El comercio elige el modo de su tienda (sin mayorista, mixto o sólo
 * mayoristas), la compra mínima y si acepta pedidos a cuenta corriente; y
 * resuelve las solicitudes de sus compradores: al aprobar, el comprador queda
 * vinculado a un cliente de gestión con su lista de precios, su límite de
 * crédito y el permiso de cuenta corriente. El precio lo aplica la base.
 */
import { useCallback, useEffect, useState } from "react";
import { Building2, Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import { isMissingColumn, isMissingFunction } from "@/lib/publicDataSource";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Modo = "off" | "mixto" | "exclusivo";
type Solicitud = {
  id: string; email: string; name: string | null; customer_id: string | null;
  mayorista_estado: "pendiente" | "aprobado" | "rechazado";
  mayorista_solicitud: { razon_social?: string; cuit?: string; telefono?: string | null; mensaje?: string | null } | null;
  mayorista_solicitado_at: string | null; mayorista_motivo: string | null;
  customers: { name: string | null; price_list_id: string | null; credit_limit_ars: number | null; cuenta_corriente_online: boolean | null } | null;
};
type Lista = { id: string; name: string };

const MODOS: Record<Modo, { titulo: string; detalle: string }> = {
  off: { titulo: "Sin venta mayorista", detalle: "Todos compran al precio de la tienda." },
  mixto: { titulo: "Minorista y mayorista", detalle: "El público ve el precio de la tienda; tus mayoristas aprobados ven y pagan el suyo." },
  exclusivo: { titulo: "Sólo mayoristas", detalle: "Sólo compran los clientes que aprobaste; el resto ve la tienda y pide el alta." },
};

const SIN_LISTA = "sin-lista";

export default function VentaMayoristaPanel({ storeId, orgId }: { storeId: string; orgId: string }) {
  const [disponible, setDisponible] = useState(true);
  const [modo, setModo] = useState<Modo>("off");
  const [minimo, setMinimo] = useState("0");
  const [cuentaCorriente, setCuentaCorriente] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [listas, setListas] = useState<Lista[]>([]);
  const [resolviendo, setResolviendo] = useState<Solicitud | null>(null);

  const cargar = useCallback(async () => {
    const [tienda, sols, lis] = await Promise.all([
      // Con * hasta que types.ts se regenere con la migración (como reserva_local).
      supabase.from("ecommerce_stores").select("*").eq("id", storeId).maybeSingle(),
      supabase.from("store_customers")
        .select("id, email, name, customer_id, mayorista_estado, mayorista_solicitud, mayorista_solicitado_at, mayorista_motivo, customers(name, price_list_id, credit_limit_ars, cuenta_corriente_online)" as never)
        .eq("store_id", storeId).neq("mayorista_estado" as never, "ninguno" as never).order("mayorista_solicitado_at" as never, { ascending: false }).limit(200),
      supabase.from("price_lists").select("id, name").eq("org_id", orgId).eq("is_active", true).order("name"),
    ]);
    if (tienda.error) {
      if (isMissingColumn(tienda.error)) { setDisponible(false); return; }
      console.error("[Mayorista] tienda", tienda.error);
      toast.error("No se pudo leer la configuración mayorista");
      return;
    }
    const t = tienda.data as unknown as { mayorista_modo?: Modo; mayorista_minimo_ars: number; mayorista_cuenta_corriente: boolean } | null;
    // Sin la migración la fila no trae las columnas: el panel no se muestra.
    if (t && t.mayorista_modo === undefined) { setDisponible(false); return; }
    if (t && t.mayorista_modo) { setModo(t.mayorista_modo); setMinimo(String(Number(t.mayorista_minimo_ars ?? 0))); setCuentaCorriente(!!t.mayorista_cuenta_corriente); }
    if (sols.error) { console.error("[Mayorista] solicitudes", sols.error); toast.error("No se pudieron leer las solicitudes mayoristas"); }
    else setSolicitudes((sols.data ?? []) as unknown as Solicitud[]);
    if (!lis.error) setListas((lis.data ?? []) as Lista[]);
  }, [storeId, orgId]);
  useEffect(() => { void cargar(); }, [cargar]);

  const guardar = async () => {
    const valor = Number(minimo.replace(",", "."));
    if (!Number.isFinite(valor) || valor < 0) { toast.error("La compra mínima no es válida"); return; }
    setGuardando(true);
    const { error } = await supabase.from("ecommerce_stores").update({
      mayorista_modo: modo, mayorista_minimo_ars: valor, mayorista_cuenta_corriente: modo !== "off" && cuentaCorriente,
    } as never).eq("id", storeId);
    setGuardando(false);
    if (error) { console.error("[Mayorista] guardar", error); toast.error("No se pudo guardar la venta mayorista"); return; }
    toast.success("Venta mayorista guardada");
    await cargar();
  };

  if (!disponible) return null;
  const pendientes = solicitudes.filter(s => s.mayorista_estado === "pendiente");
  const aprobados = solicitudes.filter(s => s.mayorista_estado === "aprobado");

  return (
    <div className="bg-card border border-border/40 rounded-xl p-5 space-y-4">
      <h3 className="font-semibold flex items-center gap-2"><Building2 className="w-4 h-4 text-primary" />Venta mayorista</h3>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto] max-w-2xl">
        <div className="space-y-1">
          <Label htmlFor="mayorista-modo" className="text-xs">Modo de la tienda</Label>
          <Select value={modo} onValueChange={v => setModo(v as Modo)}>
            <SelectTrigger id="mayorista-modo" className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(MODOS) as Modo[]).map(m => <SelectItem key={m} value={m}>{MODOS[m].titulo}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">{MODOS[modo].detalle}</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="mayorista-minimo" className="text-xs">Compra mínima mayorista</Label>
          <Input id="mayorista-minimo" inputMode="decimal" value={minimo} disabled={modo === "off"}
            onChange={e => setMinimo(e.target.value.replace(/[^0-9.,]/g, ""))} className="h-9 w-36" />
          <p className="text-[11px] text-muted-foreground">0 = sin mínimo</p>
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm max-w-2xl">
        <Checkbox checked={cuentaCorriente} disabled={modo === "off"} onCheckedChange={v => setCuentaCorriente(v === true)} className="mt-0.5" />
        <span>Aceptar pedidos a cuenta corriente
          <span className="block text-xs text-muted-foreground">Sólo para los mayoristas que habilites y dentro de su límite de crédito. Vos aprobás cada pedido y ahí nace la deuda.</span>
        </span>
      </label>
      <Button size="sm" onClick={() => void guardar()} disabled={guardando}>{guardando ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}Guardar</Button>

      {modo !== "off" && (
        <div className="space-y-2 border-t border-border/40 pt-4">
          <p className="text-sm font-medium">Solicitudes {pendientes.length > 0 && <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{pendientes.length} nuevas</span>}</p>
          {pendientes.length === 0 && aprobados.length === 0 ? (
            <p className="text-xs text-muted-foreground">Cuando un comprador pida su cuenta mayorista desde la tienda, aparece acá.</p>
          ) : (
            <ul className="divide-y divide-border/40 text-sm">
              {[...pendientes, ...aprobados].map(s => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <p className="font-medium">{s.mayorista_solicitud?.razon_social ?? s.customers?.name ?? s.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.mayorista_solicitud?.cuit ? `CUIT ${s.mayorista_solicitud.cuit} · ` : ""}{s.email}
                      {s.mayorista_estado === "aprobado" && ` · ${listas.find(l => l.id === s.customers?.price_list_id)?.name ?? "sin lista"}`}
                      {s.mayorista_estado === "aprobado" && s.customers?.credit_limit_ars != null && ` · crédito ${formatARS(Number(s.customers.credit_limit_ars))}`}
                    </p>
                    {s.mayorista_solicitud?.mensaje && <p className="text-xs text-muted-foreground italic">«{s.mayorista_solicitud.mensaje}»</p>}
                  </div>
                  <Button size="sm" variant={s.mayorista_estado === "pendiente" ? "default" : "outline"} onClick={() => setResolviendo(s)}>
                    {s.mayorista_estado === "pendiente" ? "Revisar" : "Condiciones"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ResolverSolicitud solicitud={resolviendo} listas={listas} tiendaConCuentaCorriente={cuentaCorriente}
        onClose={() => setResolviendo(null)} onListo={() => { setResolviendo(null); void cargar(); }} />
    </div>
  );
}

function ResolverSolicitud({ solicitud, listas, tiendaConCuentaCorriente, onClose, onListo }: {
  solicitud: Solicitud | null; listas: Lista[]; tiendaConCuentaCorriente: boolean; onClose: () => void; onListo: () => void;
}) {
  const [lista, setLista] = useState(SIN_LISTA);
  const [credito, setCredito] = useState("");
  const [cuentaCorriente, setCuentaCorriente] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!solicitud) return;
    setLista(solicitud.customers?.price_list_id ?? SIN_LISTA);
    setCredito(solicitud.customers?.credit_limit_ars != null ? String(Number(solicitud.customers.credit_limit_ars)) : "");
    setCuentaCorriente(!!solicitud.customers?.cuenta_corriente_online);
    setMotivo("");
  }, [solicitud]);

  const resolver = async (aprobar: boolean) => {
    if (!solicitud) return;
    const limite = credito.trim() === "" ? null : Number(credito.replace(",", "."));
    if (limite !== null && (!Number.isFinite(limite) || limite < 0)) { toast.error("El límite de crédito no es válido"); return; }
    setEnviando(true);
    const { error } = await supabase.rpc("resolver_cuenta_mayorista" as never, {
      p_store_customer_id: solicitud.id, p_aprobar: aprobar, p_customer_id: solicitud.customer_id,
      p_price_list_id: lista === SIN_LISTA ? null : lista, p_credit_limit_ars: limite,
      p_cuenta_corriente: cuentaCorriente, p_motivo: motivo.trim() || null,
    } as never);
    setEnviando(false);
    if (error) {
      toast.error(isMissingFunction(error) ? "La venta mayorista todavía no está disponible en tu cuenta." : error.message);
      return;
    }
    toast.success(aprobar ? "Cuenta mayorista aprobada" : "Solicitud rechazada");
    onListo();
  };

  const s = solicitud?.mayorista_solicitud;
  return (
    <Dialog open={!!solicitud} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{s?.razon_social ?? solicitud?.email}</DialogTitle>
          <DialogDescription>
            {s?.cuit ? `CUIT ${s.cuit}` : ""}{s?.telefono ? ` · ${s.telefono}` : ""} · {solicitud?.email}.
            Al aprobar queda vinculado a un cliente de gestión (el del mismo CUIT si ya existe).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="resolver-lista" className="text-xs">Lista de precios</Label>
            <Select value={lista} onValueChange={setLista}>
              <SelectTrigger id="resolver-lista" className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={SIN_LISTA}>Sin lista (precio de la tienda)</SelectItem>
                {listas.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {listas.length === 0 && <p className="text-[11px] text-muted-foreground">Creá una en Productos › Listas de precios.</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="resolver-credito" className="text-xs">Límite de crédito</Label>
            <Input id="resolver-credito" inputMode="decimal" value={credito} onChange={e => setCredito(e.target.value.replace(/[^0-9.,]/g, ""))}
              placeholder="Vacío = sin límite" className="h-9 w-48" />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={cuentaCorriente} disabled={!tiendaConCuentaCorriente} onCheckedChange={v => setCuentaCorriente(v === true)} className="mt-0.5" />
            <span>Puede pedir a cuenta corriente
              {!tiendaConCuentaCorriente && <span className="block text-xs text-muted-foreground">Primero activá la cuenta corriente en la tienda.</span>}
            </span>
          </label>
          {solicitud?.mayorista_estado === "pendiente" && (
            <div className="space-y-1">
              <Label htmlFor="resolver-motivo" className="text-xs">Motivo si la rechazás (lo ve el comprador)</Label>
              <Input id="resolver-motivo" value={motivo} onChange={e => setMotivo(e.target.value.slice(0, 500))} className="h-9" />
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          {solicitud?.mayorista_estado === "pendiente" && (
            <Button variant="outline" onClick={() => void resolver(false)} disabled={enviando} className="gap-1"><X className="w-3.5 h-3.5" />Rechazar</Button>
          )}
          <Button onClick={() => void resolver(true)} disabled={enviando} className="gap-1">
            {enviando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {solicitud?.mayorista_estado === "aprobado" ? "Guardar condiciones" : "Aprobar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
