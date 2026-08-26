/**
 * Cuánto le cuesta al comercio cobrar por cada medio de pago, y la calculadora.
 *
 * ── Dónde vive y por qué ──────────────────────────────────────────────────
 *
 * En **Ajustes → Finanzas y costos**, no en Gestiona Finance: esa superficie es
 * gestión de gastos corporativos (ADR 001) y no lleva nada más. Lo que cuesta
 * cobrar es configuración del comercio y afecta el margen, así que va junto al
 * tipo de cambio y las reglas de precio.
 *
 * ── Qué contesta, y qué NO ────────────────────────────────────────────────
 *
 * Contesta **"cuánto me va a costar cobrar así"** — antes de vender, para poder
 * fijar un precio. No confundir con `PaymentSettlementsPanel` en Movimientos
 * financieros, que contesta **"cuánto costó esta venta"** y sirve para
 * conciliar una operación ya hecha. Son complementarios; si hace falta un
 * tercero, primero revisar por qué.
 *
 * ── Estimado y cobrado son dos cosas ──────────────────────────────────────
 *
 * `costos_por_medio_de_pago` es la **estimación** y `comisiones_cobradas` es lo
 * que el proveedor informó que se llevó.
 *
 * ⚠️ Las tarifas cargadas **no están verificadas** contra la tarifa oficial de
 * MercadoPago. El panel lo dice en vez de presentarlas como verdad: un número
 * de costo con más certeza de la que tiene lleva a fijar un precio mal, que es
 * peor que no tener el número.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AlertTriangle, Calculator, Clock, Loader2, Percent, TrendingDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

interface CostoMedio {
  provider: string;
  proveedor: string;
  medio: string;
  cuotas: number;
  comision_pct: number;
  costo_proveedor_pct: number;
  comision_plataforma_pct: number;
  costo_total_pct: number;
  neto_cada_100: number;
  dias_para_cobrar: number | null;
  fuente: string | null;
  sin_verificar: boolean;
}

interface Desvio {
  proveedor: string;
  medio: string;
  cobros: number;
  real_promedio_pct: number | null;
  estimado_pct: number | null;
  desvio_pct: number | null;
  solo_montos_chicos: boolean;
}

const MEDIO: Record<string, string> = {
  credit: 'Tarjeta de crédito',
  debit: 'Tarjeta de débito',
  wallet: 'Dinero en cuenta',
  cash: 'Efectivo',
  transfer: 'Transferencia',
  default: 'Checkout',
};

const pct = (n: number) => `${n.toFixed(2).replace('.', ',')}%`;
const ars = (n: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n);

export default function CostoDeCobrar({ orgId }: { orgId?: string }) {
  const [costos, setCostos] = useState<CostoMedio[]>([]);
  const [desvios, setDesvios] = useState<Desvio[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [monto, setMonto] = useState('50000');

  const cargar = useCallback(async () => {
    if (!orgId) return;
    setCargando(true);

    const [c, d] = await Promise.all([
      supabase.from('costos_por_medio_de_pago').select('*').eq('org_id', orgId)
        .order('costo_total_pct', { ascending: true }),
      supabase.from('desvio_de_comisiones').select('*').eq('org_id', orgId),
    ]);

    // ⚠️ No se traga el error: "no tengo permiso" y "no hay medios cargados"
    // son problemas opuestos y se ven igual si se confunden.
    if (c.error) {
      setError(c.error.message);
      setCargando(false);
      return;
    }

    setCostos((c.data ?? []) as unknown as CostoMedio[]);
    setDesvios((d.data ?? []) as unknown as Desvio[]);
    setError(null);
    setCargando(false);
  }, [orgId]);

  useEffect(() => { void cargar(); }, [cargar]);

  /**
   * La calculadora.
   *
   * Aplica el mismo cálculo que la vista SQL y que `computeSettlement`: sobre
   * el bruto, la comisión del proveedor con su IVA más la de la plataforma.
   * Se calcula acá y no con otra fórmula propia — tres implementaciones del
   * mismo número es cómo terminan difiriendo.
   */
  const bruto = useMemo(() => {
    const n = Number(String(monto).replace(/[^0-9.,]/g, '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [monto]);

  const filas = useMemo(() => costos.map(c => {
    const costoProveedor = bruto * c.costo_proveedor_pct / 100;
    const costoPlataforma = bruto * c.comision_plataforma_pct / 100;
    return {
      ...c,
      costoProveedor,
      costoPlataforma,
      totalCosto: costoProveedor + costoPlataforma,
      neto: bruto - costoProveedor - costoPlataforma,
    };
  }), [costos, bruto]);

  if (cargando) {
    return (
      <div className="bg-card border border-border/60 rounded-[10px] p-4 md:p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Calculando el costo de cobrar…
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-card border border-destructive/25 rounded-[10px] p-4 md:p-6 text-sm">
        <p className="font-medium text-destructive">No se pudo leer el costo de los medios de pago</p>
        <p className="mt-1 text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (!costos.length) {
    return (
      <div className="bg-card border border-border/60 rounded-[10px] p-4 md:p-6 text-sm text-muted-foreground">
        <h2 className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2 text-foreground mb-2">
          <Percent className="w-4 h-4 text-primary" />Cuánto te cuesta cobrar
        </h2>
        Todavía no hay medios de pago habilitados. Cuando conectes uno, acá vas a
        ver cuánto te cuesta cobrar con cada uno y cuánto te queda.
      </div>
    );
  }

  const masBarato = filas[0];
  const masCaro = filas[filas.length - 1];
  const algunoSinVerificar = costos.some(c => c.sin_verificar);
  const hayDesvioReal = desvios.some(
    d => d.desvio_pct != null && Math.abs(d.desvio_pct) >= 1 && !d.solo_montos_chicos,
  );

  return (
    <div className="bg-card border border-border/60 rounded-[10px] p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2">
            <Percent className="w-4 h-4 text-primary" />Cuánto te cuesta cobrar
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Comisión del proveedor con su IVA, más la comisión de Gestiona si está activa.
          </p>
        </div>
        {masCaro.costo_total_pct - masBarato.costo_total_pct > 1 && (
          <div className="text-right text-xs">
            <p className="text-muted-foreground">Del más barato al más caro</p>
            <p className="text-base font-semibold text-amber-600 dark:text-amber-400">
              {pct(masCaro.costo_total_pct - masBarato.costo_total_pct)} de diferencia
            </p>
          </div>
        )}
      </div>

      {/* ⚠️ Arriba de la tabla: un costo presentado con más certeza de la que
          tiene lleva a fijar un precio mal. */}
      {algunoSinVerificar && (
        <div className="flex items-start gap-2 rounded-[8px] border border-amber-500/25 bg-amber-500/[0.05] p-3 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <p className="text-amber-700 dark:text-amber-300">
            Estas tarifas son una <strong>estimación</strong>: no están verificadas contra la
            tarifa oficial del proveedor. Lo que se cobró de verdad está más abajo.
          </p>
        </div>
      )}

      {/* ── La calculadora ──────────────────────────────────────────────── */}
      <div className="rounded-[8px] border border-primary/20 bg-primary/[0.04] p-3">
        <label className="text-xs font-medium flex items-center gap-1.5 mb-2">
          <Calculator className="w-3.5 h-3.5 text-primary" />
          Si cobrás
        </label>
        <Input
          value={monto}
          onChange={e => setMonto(e.target.value)}
          inputMode="decimal"
          className="bg-muted border-border max-w-[200px]"
          placeholder="50000"
        />
        {bruto > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Sobre {ars(bruto)}, la diferencia entre el medio más barato y el más caro es{' '}
            <strong className="text-foreground">
              {ars(masCaro.totalCosto - masBarato.totalCosto)}
            </strong>.
          </p>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="pb-2 pr-3 font-medium">Medio</th>
              <th className="pb-2 px-3 text-right font-medium">Proveedor</th>
              <th className="pb-2 px-3 text-right font-medium">Gestiona</th>
              <th className="pb-2 px-3 text-right font-medium">Costo total</th>
              <th className="pb-2 pl-3 text-right font-medium">Te queda</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((c, i) => (
              <tr key={`${c.provider}-${c.medio}-${c.cuotas}`} className="border-b border-border/40 last:border-0">
                <td className="py-2.5 pr-3">
                  <span className="font-medium">{MEDIO[c.medio] ?? c.medio}</span>
                  {c.cuotas > 0 && (
                    <Badge variant="secondary" className="ml-2 text-[10px]">{c.cuotas} cuotas</Badge>
                  )}
                  <span className="block text-[11px] text-muted-foreground">
                    {c.proveedor}
                    {c.dias_para_cobrar != null && c.dias_para_cobrar > 0 && (
                      <>
                        {' · '}
                        <Clock className="inline h-3 w-3" /> cobrás en {c.dias_para_cobrar} día
                        {c.dias_para_cobrar === 1 ? '' : 's'}
                      </>
                    )}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-right tabular-nums">
                  {bruto > 0 ? ars(c.costoProveedor) : pct(c.costo_proveedor_pct)}
                  <span className="block text-[10px] text-muted-foreground">
                    {pct(c.costo_proveedor_pct)}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-right tabular-nums text-muted-foreground">
                  {c.comision_plataforma_pct > 0
                    ? (bruto > 0 ? ars(c.costoPlataforma) : pct(c.comision_plataforma_pct))
                    : '—'}
                  {c.comision_plataforma_pct > 0 && (
                    <span className="block text-[10px]">{pct(c.comision_plataforma_pct)}</span>
                  )}
                </td>
                <td className="py-2.5 px-3 text-right font-semibold tabular-nums">
                  {bruto > 0 ? ars(c.totalCosto) : pct(c.costo_total_pct)}
                  <span className="block text-[10px] font-normal text-muted-foreground">
                    {pct(c.costo_total_pct)}
                  </span>
                </td>
                <td className={`py-2.5 pl-3 text-right font-semibold tabular-nums ${
                  i === 0 ? 'text-teal-600 dark:text-teal-400'
                    : i === filas.length - 1 ? 'text-amber-600 dark:text-amber-400' : ''
                }`}>
                  {bruto > 0 ? ars(c.neto) : ars(c.neto_cada_100)}
                  {bruto === 0 && (
                    <span className="block text-[10px] font-normal text-muted-foreground">
                      de cada $100
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {desvios.length > 0 && (
        <div className="rounded-[8px] border border-border/60 bg-muted/30 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <TrendingDown className="h-3.5 w-3.5" />
            Lo que el proveedor cobró de verdad
          </p>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {desvios.map(d => (
              <li key={`${d.proveedor}-${d.medio}`}>
                <span className="font-medium text-foreground">{MEDIO[d.medio] ?? d.medio}</span>
                {': '}
                {d.real_promedio_pct != null ? pct(d.real_promedio_pct) : '—'} real
                {d.estimado_pct != null && <> vs {pct(d.estimado_pct)} estimado</>}
                {' · '}{d.cobros} cobro{d.cobros === 1 ? '' : 's'}
                {d.solo_montos_chicos && (
                  <span className="ml-1 text-amber-600 dark:text-amber-400">
                    — importes muy chicos: el redondeo distorsiona el porcentaje y la
                    comparación no significa nada todavía
                  </span>
                )}
              </li>
            ))}
          </ul>
          {hayDesvioReal && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
              Hay diferencias de más de un punto entre lo estimado y lo cobrado. Conviene
              revisar la tarifa cargada contra la del proveedor.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
