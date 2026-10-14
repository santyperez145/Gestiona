import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { formatARS } from "@/lib/supabaseStore";
import { logAudit } from "@/lib/auditLog";
import { plural } from "@/lib/plural";
import { cobrarADeudor, cobrarSeleccion, mensajeDeError, MEDIOS_DE_COBRO, totalPendiente, type DeudaPendiente, type Deudor } from "@/lib/cuentaCorriente";

/**
 * Cobro de cuenta corriente: pago a cuenta de un cliente (de la deuda más
 * vieja a la más nueva) o de deudas elegidas. Lo usan Deudas y la caja; todo
 * pasa por `cobrar_cuenta_corriente`, con una clave por apertura del formulario.
 */
export type ObjetivoCobro = { tipo: "cliente"; deudor: Deudor } | { tipo: "seleccion"; deudas: DeudaPendiente[] };

export default function CobroACuentaForm({ objetivo, orgId, userId, onDone }: { objetivo: ObjetivoCobro; orgId: string; userId: string; onDone: () => void }) {
  const deudas = objetivo.tipo === "cliente" ? objetivo.deudor.deudas : objetivo.deudas;
  const total = objetivo.tipo === "cliente" ? objetivo.deudor.total : totalPendiente(objetivo.deudas);
  const [amount, setAmount] = useState(String(total));
  const [medio, setMedio] = useState("efectivo");
  const [nota, setNota] = useState("");
  const [saving, setSaving] = useState(false);
  const [fallidas, setFallidas] = useState<Array<{ deuda: DeudaPendiente; error: string }>>([]);
  // Una clave por apertura: reintentar (doble clic, corte de red, o volver a
  // tocar después de un error parcial) nunca cobra dos veces lo que ya entró.
  const [clave] = useState(() => crypto.randomUUID());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (objetivo.tipo === "cliente") {
      const monto = parseFloat(amount.replace(",", ".")) || 0;
      if (monto <= 0) { toast.error("Ingresá un monto mayor a cero"); return; }
      if (monto > total + 0.005) { toast.error(`El pago supera lo que se debe (${formatARS(total)})`); return; }
      setSaving(true);
      try {
        const r = await cobrarADeudor(objetivo.deudor, { orgId, monto, medio, clave, nota });
        await logAudit(userId, "update", "debt", r.cobro_id, { customer: objetivo.deudor.nombre, payment: r.aplicado, paymentMethod: medio, imputaciones: r.imputaciones.length });
        const saldadas = r.imputaciones.filter(i => Number(i.saldo) <= 0.01).length;
        const detalle = [
          saldadas ? plural(saldadas, "deuda saldada", "deudas saldadas") : "",
          r.en_caja ? "El cobro quedó en la caja abierta." : "",
        ].filter(Boolean).join(" · ");
        toast.success(r.saldo_pendiente <= 0.01 ? `Cuenta de ${objetivo.deudor.nombre} saldada` : `Cobro registrado. Resta ${formatARS(r.saldo_pendiente)}`,
          { description: detalle || undefined });
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
        toast.success(plural(r.cobradas.length, "deuda cobrada", "deudas cobradas"),
          { description: r.cobradas.some(c => c.en_caja) ? "Los cobros quedaron en la caja abierta." : undefined });
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
      </div>

      {objetivo.tipo === "cliente" && (
        <div>
          <label className="text-sm font-medium mb-1.5 block">Monto que paga (ARS)</label>
          <Input type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className="bg-muted border-border" />
          <p className="text-xs text-muted-foreground mt-1">Se aplica primero a la deuda más vieja.</p>
        </div>
      )}

      <div>
        <label className="text-sm font-medium mb-1.5 block">Medio de cobro</label>
        <Select value={medio} onValueChange={setMedio}>
          <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MEDIOS_DE_COBRO.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
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
        {saving ? "Cobrando..." : fallidas.length ? "Reintentar las que faltan" : "Registrar cobro"}
      </Button>
    </form>
  );
}
