/**
 * En cuántas cuotas vende el comercio.
 *
 * ── El modelo, verificado contra Tiendanube (2026-08-26) ──────────────────
 *
 * Tres piezas, y las tres importan:
 *
 *   1. Qué planes ofrecer.
 *   2. Con o sin interés. Con interés lo paga el comprador; **sin interés lo
 *      absorbe el comercio**, vía la tarifa de la pasarela.
 *   3. Monto mínimo por plan.
 *
 * ⚠️ La tercera es la que salva el margen. Doce cuotas sin interés cuestan
 * 22,51%: en una venta de $10.000 el comercio se queda con $7.749, y si su
 * margen era del 30% acaba de regalar tres cuartas partes. El piso hace que ese
 * plan sólo aparezca cuando la venta lo aguanta.
 *
 * 📌 Con MercadoPago hay una capa más: las cuotas sin interés se habilitan en el
 * panel del propio MercadoPago (Tu negocio → Costos). Esto es lo que el comercio
 * **decide ofrecer**; que MercadoPago las tenga habilitadas es condición aparte
 * y no se puede verificar desde acá.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { AlertTriangle, CreditCard, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

interface Posible {
  provider: string;
  installments: number;
  costo_sin_interes_pct: number;
  costo_con_interes_pct: number | null;
  tarifa_sin_verificar: boolean;
}

interface Plan {
  id: string;
  provider: string;
  installments: number;
  sin_interes: boolean;
  monto_minimo: number;
  activo: boolean;
}

const pct = (n: number | null) => (n == null ? '—' : `${n.toFixed(2).replace('.', ',')}%`);
const ars = (n: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);

export default function PlanesDeCuotas({ orgId }: { orgId?: string }) {
  const [posibles, setPosibles] = useState<Posible[]>([]);
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [simular, setSimular] = useState('100000');

  const cargar = useCallback(async () => {
    if (!orgId) return;
    setCargando(true);
    const [p, c] = await Promise.all([
      supabase.from('planes_de_cuotas_posibles').select('*').order('installments'),
      supabase.from('org_installment_plans').select('*').eq('org_id', orgId),
    ]);
    // ⚠️ No se traga: "no tengo permiso" y "no hay planes" se ven igual.
    if (p.error) { setError(p.error.message); setCargando(false); return; }
    setPosibles((p.data ?? []) as unknown as Posible[]);
    setPlanes((c.data ?? []) as unknown as Plan[]);
    setError(null);
    setCargando(false);
  }, [orgId]);

  useEffect(() => { void cargar(); }, [cargar]);

  const monto = useMemo(() => {
    const n = Number(String(simular).replace(/[^0-9.,]/g, '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [simular]);

  const planDe = (prov: string, n: number) =>
    planes.find(p => p.provider === prov && p.installments === n);

  const guardar = async (prov: string, n: number, cambios: Partial<Plan>) => {
    if (!orgId) return;
    const clave = `${prov}-${n}`;
    setGuardando(clave);
    const actual = planDe(prov, n);

    const fila = {
      org_id: orgId,
      provider: prov,
      installments: n,
      sin_interes: cambios.sin_interes ?? actual?.sin_interes ?? false,
      monto_minimo: cambios.monto_minimo ?? actual?.monto_minimo ?? 0,
      activo: cambios.activo ?? actual?.activo ?? true,
    };

    const { error: err } = await supabase
      .from('org_installment_plans')
      .upsert(fila as never, { onConflict: 'org_id,provider,installments' });

    setGuardando(null);
    if (err) { toast.error(err.message); return; }
    await cargar();
  };

  if (cargando) {
    return (
      <div className="bg-card border border-border/60 rounded-[10px] p-4 md:p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando planes de cuotas…
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-card border border-destructive/25 rounded-[10px] p-4 md:p-6 text-sm">
        <p className="font-medium text-destructive">No se pudieron leer los planes de cuotas</p>
        <p className="mt-1 text-muted-foreground">{error}</p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border/60 rounded-[10px] p-4 md:p-6 space-y-4">
      <div>
        <h2 className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-primary" />En cuántas cuotas vendés
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          <strong>Sin interés</strong> lo pagás vos con la tarifa de la pasarela.{' '}
          <strong>Con interés</strong> lo paga quien compra, y a vos te cuesta como un pago.
        </p>
      </div>

      {posibles.some(p => p.tarifa_sin_verificar) && (
        <div className="flex items-start gap-2 rounded-[8px] border border-amber-500/25 bg-amber-500/[0.05] p-3 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <p className="text-amber-700 dark:text-amber-300">
            Los costos de abajo salen de tarifas <strong>sin verificar</strong> contra la del
            proveedor. Con MercadoPago, además, las cuotas sin interés se habilitan en su panel
            (Tu negocio → Costos): acá elegís cuáles ofrecer.
          </p>
        </div>
      )}

      <div className="rounded-[8px] border border-primary/20 bg-primary/[0.04] p-3">
        <label className="text-xs font-medium block mb-2">Ver el costo sobre una venta de</label>
        <Input
          value={simular}
          onChange={e => setSimular(e.target.value)}
          inputMode="decimal"
          className="bg-muted border-border max-w-[200px]"
        />
      </div>

      <div className="space-y-2">
        {posibles.map(p => {
          const plan = planDe(p.provider, p.installments);
          const activo = plan?.activo ?? false;
          const sinInteres = plan?.sin_interes ?? false;
          const piso = plan?.monto_minimo ?? 0;
          const costoPct = sinInteres ? p.costo_sin_interes_pct : (p.costo_con_interes_pct ?? 0);
          const clave = `${p.provider}-${p.installments}`;
          const seOfrece = activo && monto >= piso;

          return (
            <div
              key={clave}
              className={`rounded-[8px] border p-3 transition-colors ${
                activo ? 'border-border bg-muted/20' : 'border-border/50 bg-transparent'
              }`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <Switch
                  checked={activo}
                  disabled={guardando === clave}
                  onCheckedChange={v => guardar(p.provider, p.installments, { activo: v })}
                />
                <span className="font-medium text-sm min-w-[70px]">{p.installments} cuotas</span>

                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Switch
                    checked={sinInteres}
                    disabled={!activo || guardando === clave}
                    onCheckedChange={v => guardar(p.provider, p.installments, { sin_interes: v })}
                  />
                  sin interés
                </label>

                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  desde
                  <Input
                    type="number" min="0" step="1000"
                    defaultValue={piso}
                    disabled={!activo || guardando === clave}
                    onBlur={e => {
                      const v = Number(e.target.value) || 0;
                      if (v !== piso) guardar(p.provider, p.installments, { monto_minimo: v });
                    }}
                    className="bg-muted border-border h-7 w-[110px] text-xs"
                  />
                </label>

                <div className="ml-auto text-right text-xs">
                  <span className={activo ? 'font-semibold' : 'text-muted-foreground'}>
                    te cuesta {pct(costoPct)}
                  </span>
                  {activo && monto > 0 && (
                    <span className="block text-[11px] text-muted-foreground">
                      {ars(monto * costoPct / 100)} · te quedan{' '}
                      {ars(monto - monto * costoPct / 100)} · cuota de{' '}
                      {ars(monto / p.installments)}
                    </span>
                  )}
                </div>
              </div>

              {/* ⚠️ El aviso que evita regalar el margen sin darse cuenta. */}
              {activo && sinInteres && monto > 0 && costoPct > 15 && (
                <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
                  Absorbiendo {pct(costoPct)} sobre {ars(monto)} entregás{' '}
                  {ars(monto * costoPct / 100)}. Si tu margen es menor a eso, esta venta pierde
                  plata: conviene subir el mínimo.
                </p>
              )}

              {activo && monto > 0 && !seOfrece && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  No se ofrece en esta venta: el mínimo es {ars(piso)}.
                </p>
              )}
            </div>
          );
        })}
      </div>

      {!posibles.length && (
        <p className="text-sm text-muted-foreground">
          Todavía no hay tarifas cargadas por cantidad de cuotas. Sin ellas no se puede saber
          qué cuesta cada plan, y elegir a ciegas es peor que no ofrecer cuotas.
        </p>
      )}
    </div>
  );
}
