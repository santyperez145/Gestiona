/**
 * Completar el tarifario de una sola vez.
 *
 * Sin esto la carga son 6 zonas × 8 campos, uno por uno, y por eso hace meses
 * que hay tarifas en una sola zona y la tienda no le puede vender a 23 de las
 * 24 provincias. Un precio aproximado vende; "No hay envío disponible" no
 * vende nunca, y corregir una tarifa después lleva treinta segundos.
 *
 * El cálculo vive en `shippingRateFill.ts` (22 tests). Acá sólo se elige la
 * tarifa de referencia, se muestra exactamente lo que se va a crear —un botón
 * que inserta veinte filas sin decir cuáles no se usa dos veces— y se inserta.
 */
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Wand2, Loader2, AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AR_PROVINCES, PROVINCE_NAME, CARRIER_LABEL, SERVICE_LABEL,
  type CarrierCode, type ServiceCode, type ShippingRate,
} from "@/lib/shippingCalc";
import {
  completarTarifario, provinciasSinCobertura,
  type TarifaBase, type ZonaParaCompletar,
} from "@/lib/shippingRateFill";

const CARRIERS: CarrierCode[] = ["correo_argentino", "andreani", "oca", "propio"];
const SERVICES: ServiceCode[] = ["domicilio", "sucursal", "express", "prioritario"];

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;

interface Props {
  orgId: string;
  zonas: ZonaParaCompletar[];
  rates: ShippingRate[];
  onDone: () => void;
}

export default function CompletarTarifario({ orgId, zonas, rates, onDone }: Props) {
  const zonasConTarifa = useMemo(
    () => new Set(rates.map(r => r.zone_id)), [rates]);

  // La tarifa de referencia arranca de la que ya esté cargada —normalmente
  // CABA, la más barata— para que los multiplicadores por distancia partan del
  // número real del comercio y no de uno inventado.
  const referencia = useMemo(() => {
    const base = [...rates].sort((a, b) => Number(a.price) - Number(b.price))[0];
    return {
      carrier: (base?.carrier ?? "correo_argentino") as CarrierCode,
      service: (base?.service ?? "domicilio") as ServiceCode,
      min_weight_kg: Number(base?.min_weight_kg ?? 0),
      max_weight_kg: base?.max_weight_kg == null ? null : Number(base.max_weight_kg),
      price: Number(base?.price ?? 0),
      price_per_extra_kg: Number(base?.price_per_extra_kg ?? 0),
      free_above: base?.free_above == null ? null : Number(base.free_above),
    } satisfies TarifaBase;
  }, [rates]);

  const [abierto, setAbierto] = useState(false);
  const [form, setForm] = useState<TarifaBase>(referencia);
  const [pisar, setPisar] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const sinCobertura = useMemo(
    () => provinciasSinCobertura(zonas, zonasConTarifa, AR_PROVINCES.map(p => p.code)),
    [zonas, zonasConTarifa],
  );

  const previa = useMemo(
    () => completarTarifario(zonas, form, { zonasConTarifa, saltearConTarifa: !pisar }),
    [zonas, form, zonasConTarifa, pisar],
  );

  const abrir = () => { setForm(referencia); setAbierto(true); };

  async function crear() {
    if (form.price <= 0) { toast.error("Poné un precio de referencia mayor a 0"); return; }
    if (previa.length === 0) { toast.error("No hay zonas para completar"); return; }
    setGuardando(true);
    const { error } = await supabase.from("shipping_rates").insert(
      previa.map(f => ({
        org_id: orgId,
        zone_id: f.zone_id,
        carrier: f.carrier,
        service: f.service,
        min_weight_kg: f.min_weight_kg,
        max_weight_kg: f.max_weight_kg,
        price: f.price,
        price_per_extra_kg: f.price_per_extra_kg,
        delivery_days_min: f.delivery_days_min,
        delivery_days_max: f.delivery_days_max,
        free_above: f.free_above,
      })) as never,
    );
    setGuardando(false);
    if (error) { toast.error("No se pudieron crear las tarifas: " + error.message); return; }
    toast.success(`${previa.length} ${previa.length === 1 ? "tarifa creada" : "tarifas creadas"}`, {
      description: "Revisá zona por zona y ajustá el precio que haga falta.",
    });
    setAbierto(false);
    onDone();
  }

  if (zonas.length === 0) return null;

  return (
    <div className="bg-card border border-border/60 rounded-[10px] overflow-hidden">
      {/* La advertencia real: no es "provincias sin zona" —todas tienen— sino
          provincias a las que no se les puede cobrar el envío. */}
      {sinCobertura.length > 0 && (
        <div className="bg-yellow-500/8 border-b border-yellow-500/25 px-4 py-3">
          <p className="text-xs text-yellow-500/90 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              <span className="font-semibold">
                No le podés vender a {sinCobertura.length} de las {AR_PROVINCES.length} provincias.
              </span>{" "}
              Su zona existe pero no tiene tarifa cargada, así que en el checkout ven
              "No hay envío disponible":{" "}
              {sinCobertura.slice(0, 5).map(c => PROVINCE_NAME[c] ?? c).join(", ")}
              {sinCobertura.length > 5 && ` y ${sinCobertura.length - 5} más`}.
            </span>
          </p>
        </div>
      )}

      <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
        <Wand2 className="w-4 h-4 text-primary shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm">Completar el tarifario</p>
          <p className="text-[11px] text-muted-foreground">
            Toma una tarifa de referencia y estima el resto por distancia. Sirve para
            empezar a vender hoy; después se ajusta zona por zona.
          </p>
        </div>
        {!abierto ? (
          <Button size="sm" onClick={abrir}>Completar</Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setAbierto(false)}>Cancelar</Button>
        )}
      </div>

      {abierto && (
        <div className="border-t border-border/40 p-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Label className="text-xs">Transportista</Label>
              <Select value={form.carrier} onValueChange={v => setForm(f => ({ ...f, carrier: v }))}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CARRIERS.map(c => <SelectItem key={c} value={c}>{CARRIER_LABEL[c]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Servicio</Label>
              <Select value={form.service} onValueChange={v => setForm(f => ({ ...f, service: v }))}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SERVICES.map(s => <SelectItem key={s} value={s}>{SERVICE_LABEL[s]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Precio en la zona más cercana</Label>
              <Input
                type="number" className="h-9" value={form.price}
                onChange={e => setForm(f => ({ ...f, price: Number(e.target.value) || 0 }))}
              />
            </div>
            <div>
              <Label className="text-xs">Envío gratis desde (vacío = nunca)</Label>
              <Input
                type="number" className="h-9"
                value={form.free_above ?? ""}
                onChange={e => setForm(f => ({
                  ...f, free_above: e.target.value === "" ? null : Number(e.target.value),
                }))}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={pisar} onChange={e => setPisar(e.target.checked)} />
            Incluir también las zonas que ya tienen tarifa
            <span className="text-[11px]">(agrega otra fila, no reemplaza la que hay)</span>
          </label>

          {previa.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Todas las zonas ya tienen tarifa. Marcá la casilla de arriba si querés
              agregar otra.
            </p>
          ) : (
            <div className="border border-border/60 rounded-lg overflow-x-auto">
              <table className="w-full text-xs min-w-[34rem]">
                <thead className="bg-muted/20 border-b border-border/60">
                  <tr className="text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Zona</th>
                    <th className="px-3 py-2 font-medium text-right">Precio</th>
                    <th className="px-3 py-2 font-medium text-right">Kg extra</th>
                    <th className="px-3 py-2 font-medium text-right">Entrega</th>
                    <th className="px-3 py-2 font-medium text-right">Sobre la base</th>
                  </tr>
                </thead>
                <tbody>
                  {previa.map(f => (
                    <tr key={f.zone_id} className="border-b border-border/40 last:border-0">
                      <td className="px-3 py-1.5">{f.zone_name}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{pesos(f.price)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                        {pesos(f.price_per_extra_kg)}
                      </td>
                      <td className="px-3 py-1.5 text-right text-muted-foreground">
                        {f.delivery_days_min}–{f.delivery_days_max} días
                      </td>
                      <td className="px-3 py-1.5 text-right text-muted-foreground">×{f.multiplicador}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" onClick={crear} disabled={guardando || previa.length === 0}>
              {guardando ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
              Crear {previa.length} {previa.length === 1 ? "tarifa" : "tarifas"}
            </Button>
            <span className="text-[11px] text-muted-foreground">
              Se pueden borrar una por una si algo no cierra.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
