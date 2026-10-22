/**
 * Lo que ARCA necesita además de los renglones (2026-10-22): concepto y
 * período del servicio, moneda y cotización, y percepciones u otros
 * tributos. Ver `supabase/functions/_shared/wsfeComprobante.ts`.
 */
import { Calculator, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { TributoManual } from "@/lib/manualInvoiceTax";
import type { DetalleFiscal } from "@/lib/detalleFiscal";
import { TIPOS_DE_TRIBUTO } from "../../../supabase/functions/_shared/wsfeComprobante";

const CONCEPTOS = [
  { valor: "1", texto: "Productos" },
  { valor: "2", texto: "Servicios" },
  { valor: "3", texto: "Productos y servicios" },
];

export default function DetalleFiscalFactura({ valor, onChange, netoGravado, claseC, onPercepcionesDelCliente, calculandoPercepciones = false }: {
  valor: DetalleFiscal;
  onChange: (d: DetalleFiscal) => void;
  /** Base sugerida para una percepción nueva. */
  netoGravado: number;
  claseC: boolean;
  /** Si el comercio es agente: calcula las percepciones del cliente con el padrón. */
  onPercepcionesDelCliente?: () => void;
  calculandoPercepciones?: boolean;
}) {
  const set = <K extends keyof DetalleFiscal>(k: K, v: DetalleFiscal[K]) => onChange({ ...valor, [k]: v });
  const setTributo = (i: number, cambios: Partial<TributoManual>) =>
    set("tributos", valor.tributos.map((t, j) => (j === i ? { ...t, ...cambios } : t)));

  return (
    <fieldset className="space-y-4 rounded-[10px] border border-border/60 p-3" aria-label="Datos fiscales de la factura">
      <legend className="px-1 text-xs font-semibold text-muted-foreground">Datos para ARCA</legend>

      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <Label htmlFor="fac-concepto" className="text-xs">Concepto</Label>
          <Select value={String(valor.concepto)} onValueChange={v => set("concepto", Number(v) as 1 | 2 | 3)}>
            <SelectTrigger id="fac-concepto"><SelectValue /></SelectTrigger>
            <SelectContent>{CONCEPTOS.map(c => <SelectItem key={c.valor} value={c.valor}>{c.texto}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {valor.concepto !== 1 && (
          <>
            <div>
              <Label htmlFor="fac-serv-desde" className="text-xs">Servicio desde</Label>
              <Input id="fac-serv-desde" type="date" value={valor.servicioDesde} onChange={e => set("servicioDesde", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="fac-serv-hasta" className="text-xs">Servicio hasta</Label>
              <Input id="fac-serv-hasta" type="date" value={valor.servicioHasta} onChange={e => set("servicioHasta", e.target.value)} />
            </div>
            <p className="text-[11px] text-muted-foreground md:col-span-3">ARCA pide el período del servicio y el vencimiento del pago (el campo «Vencimiento» de arriba; vacío, vence el día de la factura).</p>
          </>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <Label htmlFor="fac-moneda" className="text-xs">Moneda</Label>
          <Select value={valor.moneda} onValueChange={v => set("moneda", v as DetalleFiscal["moneda"])}>
            <SelectTrigger id="fac-moneda"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ARS">Pesos</SelectItem>
              <SelectItem value="USD">Dólares</SelectItem>
              <SelectItem value="EUR">Euros</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {valor.moneda !== "ARS" && (
          <>
            <div>
              <Label htmlFor="fac-cotizacion" className="text-xs">Cotización <span className="font-normal text-muted-foreground">(opcional)</span></Label>
              <Input id="fac-cotizacion" inputMode="decimal" placeholder="La oficial de ARCA" value={valor.cotizacion} onChange={e => set("cotizacion", e.target.value)} />
            </div>
            <label className="flex items-center gap-2 self-end pb-2 text-xs">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={valor.mismaMoneda} onChange={e => set("mismaMoneda", e.target.checked)} />
              Se cobra en la misma moneda
            </label>
            <p className="text-[11px] text-muted-foreground md:col-span-3">Los precios de los renglones van en {valor.moneda === "USD" ? "dólares" : "euros"}. Sin cotización, se usa la que informa ARCA al autorizar.</p>
          </>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-medium">Percepciones y otros tributos</p>
            <p className="text-[11px] text-muted-foreground">Sólo si sos agente de percepción o la operación lleva un impuesto aparte.</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {onPercepcionesDelCliente && (
              <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={calculandoPercepciones} onClick={onPercepcionesDelCliente}>
                {calculandoPercepciones ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Calculator className="mr-1 h-3 w-3" />}Percepciones del cliente
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs"
              onClick={() => set("tributos", [...valor.tributos, { tipo: 7, descripcion: "", base: netoGravado, alicuota: 0 }])}>
              <Plus className="mr-1 h-3 w-3" />Agregar
            </Button>
          </div>
        </div>
        {valor.tributos.map((t, i) => {
          const importe = t.alicuota > 0 ? Math.round(t.base * t.alicuota) / 100 : Number(t.importe) || 0;
          return (
            <div key={i} className="grid grid-cols-2 items-end gap-2 rounded-md bg-muted/20 p-2 md:grid-cols-12">
              <div className="col-span-2 md:col-span-3">
                <Label htmlFor={`trib-tipo-${i}`} className="text-[10px]">Tipo</Label>
                <Select value={String(t.tipo)} onValueChange={v => setTributo(i, { tipo: Number(v) })}>
                  <SelectTrigger id={`trib-tipo-${i}`} className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(TIPOS_DE_TRIBUTO).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="col-span-2 md:col-span-3">
                <Label htmlFor={`trib-desc-${i}`} className="text-[10px]">Detalle</Label>
                <Input id={`trib-desc-${i}`} className="h-8 text-xs" maxLength={80} placeholder="Ej.: IIBB Buenos Aires" value={t.descripcion ?? ""} onChange={e => setTributo(i, { descripcion: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor={`trib-base-${i}`} className="text-[10px]">Base</Label>
                <Input id={`trib-base-${i}`} className="h-8 text-right text-xs" type="number" min={0} step="0.01" value={t.base} onChange={e => setTributo(i, { base: Number(e.target.value) })} />
              </div>
              <div className="md:col-span-1">
                <Label htmlFor={`trib-alic-${i}`} className="text-[10px]">Alíc. %</Label>
                <Input id={`trib-alic-${i}`} className="h-8 text-right text-xs" type="number" min={0} max={100} step="0.01" value={t.alicuota} onChange={e => setTributo(i, { alicuota: Number(e.target.value) })} />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor={`trib-imp-${i}`} className="text-[10px]">Importe</Label>
                <Input id={`trib-imp-${i}`} className="h-8 text-right text-xs" type="number" min={0} step="0.01" disabled={t.alicuota > 0}
                  value={t.alicuota > 0 ? importe : t.importe ?? 0} onChange={e => setTributo(i, { importe: Number(e.target.value) })} />
              </div>
              <Button type="button" size="icon" variant="ghost" className="h-8 w-8 justify-self-end md:col-span-1" aria-label={`Quitar tributo ${i + 1}`}
                onClick={() => set("tributos", valor.tributos.filter((_, j) => j !== i))}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          );
        })}
        {claseC && valor.tributos.length > 0 && (
          <p className="text-[11px] text-muted-foreground">En una factura C los tributos se suman al total; el IVA no se discrimina.</p>
        )}
      </div>
    </fieldset>
  );
}
