/**
 * Ingresos Brutos del mes (2026-10-22): el borrador de la liquidación de cada
 * jurisdicción, al lado de la posición de IVA. Ver `lib/liquidacionIibb.ts`.
 */
import { AlertTriangle, Landmark } from "lucide-react";
import { Link } from "react-router-dom";
import type { LiquidacionIibb } from "@/lib/liquidacionIibb";

const ars = (n: number) => n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
const coef = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 4, maximumFractionDigits: 6 });

export default function LiquidacionIibbMes({ liquidacion }: { liquidacion: LiquidacionIibb | null }) {
  if (!liquidacion) return null;
  const l = liquidacion;
  const totalSaldo = l.renglones.reduce((s, r) => s + r.saldo, 0);

  return (
    <div className="rounded-lg border border-border/40 p-3 text-sm space-y-2" aria-labelledby="iibb-mes">
      <p id="iibb-mes" className="flex items-center gap-2 font-medium"><Landmark className="h-4 w-4 text-primary" aria-hidden />Ingresos Brutos del período</p>

      {l.renglones.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Cargá en qué jurisdicciones estás inscripto (y el coeficiente si estás en Convenio Multilateral) en{" "}
          <Link to="/impuestos?tab=iibb" className="underline underline-offset-2">Impuestos → IIBB</Link> y acá aparece lo que te toca pagar en cada una.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">Liquidación de Ingresos Brutos por jurisdicción</caption>
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border/40">
                <th scope="col" className="py-1.5 pr-3 font-medium">Jurisdicción</th>
                <th scope="col" className="py-1.5 pr-3 font-medium text-right">Coeficiente</th>
                <th scope="col" className="py-1.5 pr-3 font-medium text-right">Base imponible</th>
                <th scope="col" className="py-1.5 pr-3 font-medium text-right">Alícuota</th>
                <th scope="col" className="py-1.5 pr-3 font-medium text-right">Impuesto</th>
                <th scope="col" className="py-1.5 pr-3 font-medium text-right">Retenciones</th>
                <th scope="col" className="py-1.5 font-medium text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {l.renglones.map(r => (
                <tr key={r.jurisdiccion} className="border-b border-border/20">
                  <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                    {r.jurisdiccion}<span className="ml-1 text-[10px] text-muted-foreground">{r.regimen === "convenio" ? "CM" : "local"}</span>
                  </th>
                  <td className="py-1.5 pr-3 text-right">{r.regimen === "convenio" ? coef(r.coeficiente) : "—"}</td>
                  <td className="py-1.5 pr-3 text-right">{ars(r.base)}</td>
                  <td className="py-1.5 pr-3 text-right">{r.alicuota.toLocaleString("es-AR")} %</td>
                  <td className="py-1.5 pr-3 text-right">{ars(r.impuesto)}</td>
                  <td className="py-1.5 pr-3 text-right">{r.retenciones ? `− ${ars(r.retenciones)}` : "—"}</td>
                  <td className="py-1.5 text-right font-medium">{r.saldo >= 0 ? ars(r.saldo) : `${ars(-r.saldo)} a favor`}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2} className="py-1.5 pr-3 text-left font-medium">Base del mes {ars(l.baseTotal)}</th>
                <td colSpan={4} className="py-1.5 pr-3 text-right text-muted-foreground">Total a pagar</td>
                <td className="py-1.5 text-right font-semibold">{ars(Math.max(totalSaldo, 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {l.percepcionesDeCompras > 0 && (
        <p className="text-xs text-muted-foreground">
          Tus compras traen {ars(l.percepcionesDeCompras)} de percepciones de IIBB: restalas en la jurisdicción que corresponda (el comprobante de compra no dice de cuál es).
        </p>
      )}
      {/* Sin inscripciones, el párrafo de arriba ya dice qué hacer. No es
          una alerta: es un aviso que queda a la vista mientras no se corrija. */}
      {l.renglones.length > 0 && (l.avisos.length > 0 || l.problemas.length > 0) && (
        <div role="note" aria-label="Avisos de Ingresos Brutos" className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs space-y-1">
          {l.avisos.map(a => <p key={a} className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />{a}</p>)}
          {l.problemas.length > 0 && (
            <p className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
              {l.problemas.length === 1 ? "1 comprobante no entra en la base" : `${l.problemas.length} comprobantes no entran en la base`}: {l.problemas.slice(0, 3).map(p => `${p.comprobante} (${p.motivo})`).join("; ")}.
            </p>
          )}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">Borrador del mes para SIFERE, ARBA o AGIP: no incluye saldos a favor anteriores, anticipos ni deducciones especiales.</p>
    </div>
  );
}
