import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { formatARS } from "@/lib/supabaseStore";
import { logAudit } from "@/lib/auditLog";
import { plural } from "@/lib/plural";
import { avisoConRecibo, reciboDesdeCobros } from "@/lib/reciboDeCobro";
import { useNegocioParaRecibo } from "@/hooks/useNegocioParaRecibo";
import { cobrarADeudor, cobrarSeleccion, excedenteDe, mensajeDeError, MEDIO_SALDO_A_FAVOR, MEDIOS_DE_COBRO, saldoAFavorDB, totalPendiente, type DeudaPendiente, type Deudor } from "@/lib/cuentaCorriente";

/**
 * Cobro de cuenta corriente: pago a cuenta de un cliente (de la deuda más
 * vieja a la más nueva) o de deudas elegidas. Lo usan Deudas y la caja; todo
 * pasa por `cobrar_cuenta_corriente`, con una clave por apertura del formulario.
 * Con un cliente elegido: lo que supere la deuda queda a favor (a la vista antes
 * de confirmar), sin deudas es un anticipo, y el saldo a favor sirve para pagar.
 */
export type ObjetivoCobro = { tipo: "cliente"; deudor: Deudor } | { tipo: "seleccion"; deudas: DeudaPendiente[] };

export default function CobroACuentaForm({ objetivo, orgId, userId, onDone }: { objetivo: ObjetivoCobro; orgId: string; userId: string; onDone: () => void }) {
  const deudas = objetivo.tipo === "cliente" ? objetivo.deudor.deudas : objetivo.deudas;
  const total = objetivo.tipo === "cliente" ? objetivo.deudor.total : totalPendiente(objetivo.deudas);
  const customerId = objetivo.tipo === "cliente" ? objetivo.deudor.customerId : null;
  const [amount, setAmount] = useState(total > 0 ? String(total) : "");
  const [medio, setMedio] = useState("efectivo");
  const [saldo, setSaldo] = useState<number | null>(null);
  const [nota, setNota] = useState("");
  const [saving, setSaving] = useState(false);
  const [fallidas, setFallidas] = useState<Array<{ deuda: DeudaPendiente; error: string }>>([]);
  // Una clave por apertura: reintentar (doble clic, corte de red, o volver a
  // tocar después de un error parcial) nunca cobra dos veces lo que ya entró.
  const [clave] = useState(() => crypto.randomUUID());
  const negocio = useNegocioParaRecibo();

  useEffect(() => {
    if (!customerId) return;
    let vigente = true;
    saldoAFavorDB(orgId, customerId)
      .then(s => { if (vigente) setSaldo(s); })
      // El saldo sólo se muestra; si no se pudo leer, no se ofrece pagar con él
      // y la base igual valida cada cobro.
      .catch(err => { console.warn("[cobro] saldo a favor", err); if (vigente) setSaldo(null); });
    return () => { vigente = false; };
  }, [orgId, customerId]);

  const usaSaldo = medio === MEDIO_SALDO_A_FAVOR;
  const montoIngresado = parseFloat(amount.replace(",", ".")) || 0;
  const topeConSaldo = Math.min(total, saldo ?? 0);
  const aFavor = objetivo.tipo === "cliente" && customerId && !usaSaldo ? excedenteDe(montoIngresado, total) : 0;
  const elegirMedio = (m: string) => {
    setMedio(m);
    if (m === MEDIO_SALDO_A_FAVOR) setAmount(String(topeConSaldo));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (objetivo.tipo === "cliente") {
      const monto = montoIngresado;
      if (monto <= 0) { toast.error("Ingresá un monto mayor a cero"); return; }
      if (usaSaldo && monto > topeConSaldo + 0.005) { toast.error(`Con saldo a favor podés pagar hasta ${formatARS(topeConSaldo)}`); return; }
      if (!customerId && monto > total + 0.005) {
        toast.error(`El pago supera lo que se debe (${formatARS(total)})`, { description: "Para dejar saldo a favor, cobrale desde la caja con el cliente elegido de la lista." });
        return;
      }
      setSaving(true);
      try {
        const r = await cobrarADeudor(objetivo.deudor, { orgId, monto, medio, clave, nota, excedenteAFavor: aFavor > 0 });
        await logAudit(userId, "update", "debt", r.cobro_id, { customer: objetivo.deudor.nombre, payment: r.aplicado, paymentMethod: medio, imputaciones: r.imputaciones.length });
        const saldadas = r.imputaciones.filter(i => Number(i.saldo) <= 0.01).length;
        const detalle = [
          saldadas ? plural(saldadas, "deuda saldada", "deudas saldadas") : "",
          Number(r.a_favor ?? 0) > 0 ? `Quedaron ${formatARS(Number(r.a_favor))} a favor` : "",
          r.en_caja ? "El cobro quedó en la caja abierta." : "",
        ].filter(Boolean).join(" · ");
        const titulo = total <= 0 ? `Anticipo de ${objetivo.deudor.nombre} registrado`
          : r.saldo_pendiente <= 0.01 ? `Cuenta de ${objetivo.deudor.nombre} saldada`
          : `Cobro registrado. Resta ${formatARS(r.saldo_pendiente)}`;
        const recibo = reciboDesdeCobros([r], { negocio, cliente: objetivo.deudor.nombre, medio, nota });
        toast.success(titulo, { description: detalle || undefined, ...avisoConRecibo(recibo, m => toast.error(m)) });
        onDone();
      } catch (err) {
        toast.error(mensajeDeError(err));
      } finally {
        setSaving(false);
      }
      return;
    }
    setSaving(true);
    try {
      const r = await cobrarSeleccion(objetivo.deudas, { medio, clave, nota });
      if (r.cobradas.length) {
        await logAudit(userId, "update", "debt", r.cobradas[0].cobro_id, { cobradas: r.cobradas.length, fallidas: r.fallidas.length, paymentMethod: medio });
      }
      if (r.fallidas.length === 0) {
        // Un recibo por cliente: si la selección mezcla clientes, no se ofrece.
        const clientes = new Set(objetivo.deudas.map(d => d.customer_name?.trim() || ""));
        const recibo = clientes.size === 1
          ? reciboDesdeCobros(r.cobradas, { negocio, cliente: [...clientes][0], medio, nota })
          : null;
        toast.success(plural(r.cobradas.length, "deuda cobrada", "deudas cobradas"),
          { description: r.cobradas.some(c => c.en_caja) ? "Los cobros quedaron en la caja abierta." : undefined,
            ...(recibo ? avisoConRecibo(recibo, m => toast.error(m)) : {}) });
        onDone();
      } else {
        setFallidas(r.fallidas);
        toast.error(`Se cobraron ${r.cobradas.length} de ${objetivo.deudas.length}. Revisá las que faltan y volvé a intentar.`);
      }
    } catch (err) {
      toast.error(mensajeDeError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pb-12">
      <div className="bg-muted/50 border border-border rounded-xl p-4 space-y-1.5">
        {deudas.slice(0, 8).map(d => (
          <div key={d.id} className="flex justify-between text-sm gap-3">
            <span className="text-muted-foreground truncate">{objetivo.tipo === "seleccion" ? d.customer_name : d.description || "Deuda"}</span>
            <span className="shrink-0">{formatARS(Number(d.remaining_ars))}</span>
          </div>
        ))}
        {deudas.length > 8 && <p className="text-xs text-muted-foreground">y {plural(deudas.length - 8, "deuda más", "deudas más")}</p>}
        <div className="flex justify-between font-bold pt-1.5 border-t border-border">
          <span>Total pendiente</span>
          <span className="text-destructive text-lg">{formatARS(total)}</span>
        </div>
        {saldo !== null && saldo > 0.009 && (
          <div className="flex justify-between text-sm" data-testid="cobro-saldo-a-favor">
            <span className="text-muted-foreground">Saldo a favor</span>
            <span className="font-semibold text-emerald-500">{formatARS(saldo)}</span>
          </div>
        )}
      </div>

      {objetivo.tipo === "cliente" && (
        <div>
          <label className="text-sm font-medium mb-1.5 block">Monto que paga (ARS)</label>
          <Input type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className="bg-muted border-border" />
          <p className="text-xs text-muted-foreground mt-1">
            {total > 0 ? "Se aplica primero a la deuda más vieja." : "No debe nada: todo queda como anticipo a su favor."}
          </p>
          {aFavor > 0 && total > 0 && (
            <p className="text-xs mt-1 text-amber-600 dark:text-amber-400" data-testid="cobro-excedente">
              Quedan {formatARS(aFavor)} a favor de {objetivo.tipo === "cliente" ? objetivo.deudor.nombre : "el cliente"}: se usan para pagar sus próximas deudas.
            </p>
          )}
        </div>
      )}

      <div>
        <label className="text-sm font-medium mb-1.5 block">Medio de cobro</label>
        <Select value={medio} onValueChange={elegirMedio}>
          <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MEDIOS_DE_COBRO.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            {objetivo.tipo === "cliente" && total > 0 && saldo !== null && saldo > 0.009 && (
              <SelectItem value={MEDIO_SALDO_A_FAVOR}>💰 Saldo a favor ({formatARS(saldo)})</SelectItem>
            )}
          </SelectContent>
        </Select>
        {usaSaldo && <p className="text-xs text-muted-foreground mt-1">No entra plata en la caja: se descuenta del saldo a favor.</p>}
      </div>

      <div>
        <label className="text-sm font-medium mb-1.5 block">Nota (opcional)</label>
        <Input value={nota} maxLength={200} onChange={e => setNota(e.target.value)} placeholder="Ej.: pagó en el local" className="bg-muted border-border" />
      </div>

      {fallidas.length > 0 && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs space-y-1">
          {fallidas.map(f => <p key={f.deuda.id}><span className="font-semibold">{f.deuda.customer_name}:</span> {f.error}</p>)}
        </div>
      )}

      <Button type="submit" disabled={saving} className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-semibold">
        {saving ? "Cobrando..." : fallidas.length ? "Reintentar las que faltan" : total <= 0 ? "Registrar anticipo" : "Registrar cobro"}
      </Button>
    </form>
  );
}
