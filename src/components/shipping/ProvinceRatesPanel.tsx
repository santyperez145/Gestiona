/**
 * Grilla provincia → precio (Tiendanube traducido).
 * Escribe en shipping_zones / shipping_rates; no inventa montos.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AR_PROVINCES } from "@/lib/shippingCalc";
import {
  CARRIER_PROVINCIA,
  SERVICE_PROVINCIA,
  filasProvinciaVista,
  planificarPrecioProvincia,
  resumenCoberturaProvincias,
  type TarifaProvincia,
  type ZonaProvincia,
} from "@/lib/provinceShippingRates";

interface Props {
  orgId: string;
  zonas: ZonaProvincia[];
  rates: TarifaProvincia[];
  onDone: () => void;
}

export default function ProvinceRatesPanel({ orgId, zonas, rates, onDone }: Props) {
  const filas = useMemo(
    () => filasProvinciaVista(zonas, rates, AR_PROVINCES),
    [zonas, rates],
  );
  const resumen = useMemo(() => resumenCoberturaProvincias(filas), [filas]);

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const f of filas) {
      next[f.code] = f.price != null && f.price > 0 ? String(Math.round(f.price)) : "";
    }
    setDraft(next);
  }, [filas]);

  const dirty = useMemo(() => {
    return filas.filter((f) => {
      const raw = (draft[f.code] ?? "").trim();
      const n = raw === "" ? null : Number(raw);
      const actual = f.price != null && f.price > 0 ? Math.round(f.price) : null;
      if (raw === "" && actual == null) return false;
      if (n == null || !Number.isFinite(n) || n <= 0) return false;
      return actual !== Math.round(n);
    });
  }, [filas, draft]);

  async function activarModoZonas() {
    const { error } = await supabase
      .from("ecommerce_stores")
      .update({ shipping_mode: "zones" } as never)
      .eq("org_id", orgId);
    if (error) {
      console.error("No se pudo pasar la tienda a modo zonas", error);
    }
  }

  async function guardar() {
    if (dirty.length === 0) {
      toast.message("No hay precios nuevos para guardar");
      return;
    }
    setGuardando(true);
    let zonasTrabajo = [...zonas];
    let sort = Math.max(0, ...zonas.map((z) => z.sort_order ?? 0)) + 1;
    let guardados = 0;

    try {
      for (const f of dirty) {
        const price = Number((draft[f.code] ?? "").trim());
        const plan = planificarPrecioProvincia({
          zones: zonasTrabajo,
          rates,
          code: f.code,
          price,
          nextSortOrder: sort,
        });
        if (!plan) continue;

        let zoneId = plan.rate.zoneIdExistente;

        if (plan.quitarDeZona) {
          const { error } = await supabase
            .from("shipping_zones")
            .update({ provinces: plan.quitarDeZona.provinces } as never)
            .eq("id", plan.quitarDeZona.zoneId);
          if (error) throw error;
          zonasTrabajo = zonasTrabajo.map((z) =>
            z.id === plan.quitarDeZona!.zoneId
              ? { ...z, provinces: plan.quitarDeZona!.provinces }
              : z,
          );
        }

        if (plan.zonaNueva) {
          const { data, error } = await supabase
            .from("shipping_zones")
            .insert({
              org_id: orgId,
              name: plan.zonaNueva.name,
              provinces: plan.zonaNueva.provinces,
              sort_order: plan.zonaNueva.sort_order,
              is_active: true,
            } as never)
            .select("id, name, provinces, sort_order")
            .single();
          if (error) throw error;
          zoneId = (data as { id: string }).id;
          zonasTrabajo = [
            ...zonasTrabajo,
            {
              id: zoneId,
              name: plan.zonaNueva.name,
              provinces: plan.zonaNueva.provinces,
              sort_order: plan.zonaNueva.sort_order,
            },
          ];
          sort += 1;
        }

        if (!zoneId) throw new Error("Sin zona para la tarifa");

        if (plan.rate.rateIdToUpdate) {
          const { error } = await supabase
            .from("shipping_rates")
            .update({
              price: plan.rate.price,
              delivery_days_min: plan.rate.delivery_days_min,
              delivery_days_max: plan.rate.delivery_days_max,
              is_active: true,
            } as never)
            .eq("id", plan.rate.rateIdToUpdate);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("shipping_rates").insert({
            org_id: orgId,
            zone_id: zoneId,
            carrier: CARRIER_PROVINCIA,
            service: SERVICE_PROVINCIA,
            min_weight_kg: 0,
            max_weight_kg: null,
            price: plan.rate.price,
            price_per_extra_kg: 0,
            delivery_days_min: plan.rate.delivery_days_min,
            delivery_days_max: plan.rate.delivery_days_max,
            free_above: null,
            is_active: true,
          } as never);
          if (error) throw error;
        }
        guardados += 1;
      }

      await activarModoZonas();
      toast.success(
        guardados === 1
          ? "Precio de envío guardado para 1 provincia"
          : `Precios de envío guardados para ${guardados} provincias`,
        { description: "La tienda cotiza por zonas; el checkout usa estos precios." },
      );
      onDone();
    } catch (e) {
      console.error("No se pudo guardar el tarifario por provincia", e);
      toast.error("No se pudieron guardar los precios. Reintentá.");
      onDone();
    } finally {
      setGuardando(false);
    }
  }

  if (zonas.length === 0) return null;

  return (
    <div className="bg-card border border-border/60 rounded-[10px] overflow-hidden">
      <div className="px-4 py-3 border-b border-border/40 flex flex-wrap items-start gap-3 justify-between">
        <div className="min-w-0">
          <p className="font-medium text-sm flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary shrink-0" />
            Precio por provincia
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Como en Tiendanube: una fila por provincia. Vacío = sin envío a domicilio ahí.
            No se inventan precios; tipiá los tuyos.
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            {resumen.conPrecio} con precio · {resumen.sinPrecio} sin cobertura de domicilio
          </p>
        </div>
        <Button
          onClick={() => { void guardar(); }}
          disabled={guardando || dirty.length === 0}
          className="shrink-0"
        >
          {guardando ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
          Guardar {dirty.length > 0 ? `(${dirty.length})` : "precios"}
        </Button>
      </div>

      <div className="max-h-[28rem] overflow-y-auto divide-y divide-border/40">
        {filas.map((f) => (
          <label
            key={f.code}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/20"
          >
            <span className="min-w-0 flex-1">
              <span className="text-sm block truncate">{f.name}</span>
              {f.compartida && f.price == null && (
                <span className="text-[10px] text-muted-foreground">
                  Al guardar se separa de «{f.zoneName}» para no mezclar precios
                </span>
              )}
              {f.compartida && f.price != null && (
                <span className="text-[10px] text-muted-foreground">
                  Hoy comparte tarifa con otras provincias de «{f.zoneName}»
                </span>
              )}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-xs text-muted-foreground">$</span>
              <Input
                inputMode="numeric"
                className="w-28 h-9 tabular-nums"
                placeholder="Sin envío"
                value={draft[f.code] ?? ""}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^\d]/g, "");
                  setDraft((d) => ({ ...d, [f.code]: v }));
                }}
                aria-label={`Precio de envío a ${f.name}`}
              />
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}
