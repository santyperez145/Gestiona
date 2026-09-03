import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrg } from '@/lib/orgContext';
import { toast } from 'sonner';
import {
  MapPin, Plus, Trash2, Wand2, Calculator, ChevronDown, ChevronRight, Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AR_PROVINCES, PROVINCE_NAME, CARRIER_LABEL, SERVICE_LABEL,
  quoteShipping, type ShippingZone, type ShippingRate,
  type CarrierCode, type ServiceCode, type StoreShippingConfig,
} from '@/lib/shippingCalc';
import CompletarTarifario from './CompletarTarifario';
import ProvinceRatesPanel from './ProvinceRatesPanel';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';

const fmt = (n: number) => `$${n.toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;

const CARRIERS: CarrierCode[] = ['correo_argentino', 'andreani', 'oca', 'propio'];
const SERVICES: ServiceCode[] = ['domicilio', 'sucursal', 'express', 'prioritario'];

interface ZoneRow extends ShippingZone {
  org_id: string;
  sort_order: number;
}

/** Fila nueva del tarifario, antes de guardarla */
const emptyRate = (zoneId: string) => ({
  zone_id: zoneId,
  carrier: 'correo_argentino' as CarrierCode,
  service: 'domicilio' as ServiceCode,
  min_weight_kg: 0,
  max_weight_kg: 1 as number | null,
  price: 0,
  price_per_extra_kg: 0,
  delivery_days_min: 2 as number | null,
  delivery_days_max: 5 as number | null,
  free_above: null as number | null,
});

export default function ShippingZonesTab() {
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id ?? '';
  const { ask, dialog } = useConfirmDialog();

  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [rates, setRates] = useState<ShippingRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [newZoneName, setNewZoneName] = useState('');
  const [draftRate, setDraftRate] = useState<ReturnType<typeof emptyRate> | null>(null);

  // Simulador
  const [simProvince, setSimProvince] = useState('AR-C');
  const [simSubtotal, setSimSubtotal] = useState(25000);
  const [simWeight, setSimWeight] = useState(1);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const [{ data: z }, { data: r }] = await Promise.all([
      supabase.from('shipping_zones').select('*').eq('org_id', orgId).order('sort_order'),
      supabase.from('shipping_rates').select('*').eq('org_id', orgId),
    ]);
    setZones((z || []) as unknown as ZoneRow[]);
    setRates((r || []) as unknown as ShippingRate[]);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  // ── Zonas ────────────────────────────────────────────────────────────────

  async function seedZones() {
    setSaving(true);
    const { error } = await supabase.rpc('seed_default_shipping_zones' as never, { p_org_id: orgId } as never);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Zonas de Argentina creadas', {
      description: 'Ahora cargá el precio de cada zona.',
    });
    load();
  }

  async function addZone() {
    const name = newZoneName.trim();
    if (!name) return;
    const { error } = await supabase.from('shipping_zones').insert({
      org_id: orgId, name, provinces: [], sort_order: zones.length + 1,
    } as never);
    if (error) { toast.error(error.message); return; }
    setNewZoneName('');
    toast.success(`Zona "${name}" creada`);
    load();
  }

  async function deleteZone(z: ZoneRow) {
    const zoneRates = rates.filter(r => r.zone_id === z.id).length;
    const warning = zoneRates > 0
      ? `Se van a borrar también sus ${zoneRates} ${zoneRates === 1 ? 'tarifa' : 'tarifas'}.`
      : '';
    if (!(await ask({
      title: `¿Eliminar la zona "${z.name}"?`,
      description: warning || undefined,
      confirmText: "Eliminar",
    }))) return;
    const { error } = await supabase.from('shipping_zones').delete().eq('id', z.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Zona eliminada');
    load();
  }

  async function toggleProvince(z: ZoneRow, code: string) {
    const next = z.provinces.includes(code)
      ? z.provinces.filter(p => p !== code)
      : [...z.provinces, code];
    setZones(prev => prev.map(x => x.id === z.id ? { ...x, provinces: next } : x));
    const { error } = await supabase.from('shipping_zones')
      .update({ provinces: next } as never).eq('id', z.id);
    if (error) { toast.error(error.message); load(); }
  }

  // ── Tarifas ──────────────────────────────────────────────────────────────

  async function saveRate() {
    if (!draftRate) return;
    if (draftRate.price <= 0) { toast.error('Poné un precio mayor a 0'); return; }
    if (draftRate.max_weight_kg != null && draftRate.max_weight_kg <= draftRate.min_weight_kg) {
      toast.error('El peso máximo tiene que ser mayor al mínimo'); return;
    }
    setSaving(true);
    const { error } = await supabase.from('shipping_rates')
      .insert({ ...draftRate, org_id: orgId } as never);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    setDraftRate(null);
    toast.success('Tarifa agregada');
    load();
  }

  async function deleteRate(id: string) {
    const { error } = await supabase.from('shipping_rates').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    setRates(prev => prev.filter(r => r.id !== id));
  }

  // ── Simulador ────────────────────────────────────────────────────────────
  // Usa exactamente la misma función pura que el checkout, así lo que ve acá
  // el comercio es lo que va a pagar el comprador.
  const simStore: StoreShippingConfig = useMemo(
    () => ({ shipping_mode: 'zones', default_item_weight_kg: 0.5 }), []);

  const simulation = useMemo(() => quoteShipping({
    subtotal: simSubtotal,
    items: [{ qty: 1, weight_kg: simWeight }],
    provinceCode: simProvince,
    store: simStore,
    zones,
    rates,
  }), [simSubtotal, simWeight, simProvince, simStore, zones, rates]);

  const coveredProvinces = useMemo(
    () => new Set(zones.flatMap(z => z.provinces)), [zones]);
  const uncovered = AR_PROVINCES.filter(p => !coveredProvinces.has(p.code));

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground text-sm">Cargando zonas...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Sin zonas todavía */}
      {zones.length === 0 && (
        <div className="bg-card border border-border/60 rounded-[10px] p-6 text-center space-y-3">
          <MapPin className="w-8 h-8 mx-auto text-muted-foreground/40" />
          <div>
            <p className="font-medium text-sm">Todavía no tenés zonas de envío</p>
            <p className="text-xs text-muted-foreground mt-1">
              Sembramos las regiones de Argentina; el precio lo cargás por provincia
              (como en Tiendanube). Sin precio, esa provincia no tiene envío a domicilio.
            </p>
          </div>
          <Button onClick={seedZones} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Wand2 className="w-4 h-4 mr-1" />}
            Crear zonas de Argentina
          </Button>
        </div>
      )}

      {/* Provincias sin zona. Ojo: tener zona NO alcanza para poder vender —eso
          lo advierte `CompletarTarifario`, que mira si además hay tarifa. Las
          6 zonas por defecto cubren el país entero, así que este aviso queda
          callado mientras 23 provincias siguen sin poder comprar. */}
      {zones.length > 0 && uncovered.length > 0 && (
        <div className="bg-yellow-500/8 border border-yellow-500/25 rounded-[10px] px-4 py-3">
          <p className="text-xs text-yellow-500/90">
            <span className="font-semibold">{uncovered.length} provincias sin zona.</span>{' '}
            Un comprador de esas provincias no va a poder elegir envío:{' '}
            {uncovered.slice(0, 6).map(p => p.name).join(', ')}
            {uncovered.length > 6 && ` y ${uncovered.length - 6} más`}.
          </p>
        </div>
      )}

      <ProvinceRatesPanel orgId={orgId} zonas={zones} rates={rates} onDone={load} />

      <CompletarTarifario orgId={orgId} zonas={zones} rates={rates} onDone={load} />

      {/* Nueva zona */}
      {zones.length > 0 && (
        <div className="flex gap-2">
          <Input
            placeholder="Nombre de una zona nueva (ej: Interior)"
            value={newZoneName}
            onChange={e => setNewZoneName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addZone(); }}
            className="max-w-xs"
          />
          <Button variant="outline" onClick={addZone} disabled={!newZoneName.trim()}>
            <Plus className="w-4 h-4 mr-1" /> Agregar zona
          </Button>
        </div>
      )}

      {/* Zonas */}
      <div className="space-y-3">
        {zones.map(z => {
          const zoneRates = rates.filter(r => r.zone_id === z.id);
          const isOpen = expanded === z.id;
          return (
            <div key={z.id} className="bg-card border border-border/60 rounded-[10px] overflow-hidden">
              <button
                onClick={() => setExpanded(isOpen ? null : z.id)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
              >
                {isOpen ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                <MapPin className="w-4 h-4 text-primary shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm">{z.name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {z.provinces.length === 0
                      ? 'Sin provincias asignadas'
                      : z.provinces.map(p => PROVINCE_NAME[p] || p).join(', ')}
                  </p>
                </div>
                <Badge variant={zoneRates.length > 0 ? 'secondary' : 'outline'} className="shrink-0 text-[10px]">
                  {zoneRates.length} {zoneRates.length === 1 ? 'tarifa' : 'tarifas'}
                </Badge>
              </button>

              {isOpen && (
                <div className="border-t border-border/40 p-4 space-y-4">
                  {/* Provincias */}
                  <div>
                    <Label className="text-xs mb-2 block">Provincias de esta zona</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {AR_PROVINCES.map(p => {
                        const active = z.provinces.includes(p.code);
                        const takenElsewhere = !active && zones.some(
                          other => other.id !== z.id && other.provinces.includes(p.code));
                        return (
                          <button
                            key={p.code}
                            onClick={() => toggleProvince(z, p.code)}
                            title={takenElsewhere ? 'Ya está en otra zona' : undefined}
                            className={`px-2 py-1 rounded-md text-[11px] border transition-colors ${
                              active
                                ? 'bg-primary/15 border-primary/40 text-primary'
                                : takenElsewhere
                                ? 'bg-muted/20 border-border/40 text-muted-foreground/40'
                                : 'bg-muted/30 border-border/50 text-muted-foreground hover:border-primary/30'
                            }`}
                          >
                            {p.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Tarifario */}
                  <div>
                    <Label className="text-xs mb-2 block">Tarifario por peso</Label>
                    {zoneRates.length === 0 && !draftRate && (
                      <p className="text-xs text-muted-foreground mb-2">
                        Sin tarifas: esta zona no se va a poder cotizar.
                      </p>
                    )}
                    {zoneRates.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-muted-foreground border-b border-border/40">
                              <th className="text-left py-1.5 pr-2 font-medium">Transportista</th>
                              <th className="text-left py-1.5 pr-2 font-medium">Servicio</th>
                              <th className="text-right py-1.5 pr-2 font-medium">Peso (kg)</th>
                              <th className="text-right py-1.5 pr-2 font-medium">Precio</th>
                              <th className="text-right py-1.5 pr-2 font-medium">Kg extra</th>
                              <th className="text-right py-1.5 pr-2 font-medium">Días</th>
                              <th className="text-right py-1.5 pr-2 font-medium">Gratis desde</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/30">
                            {zoneRates
                              .slice()
                              .sort((a, b) => a.carrier.localeCompare(b.carrier) || a.min_weight_kg - b.min_weight_kg)
                              .map(r => (
                                <tr key={r.id}>
                                  <td className="py-1.5 pr-2">{CARRIER_LABEL[r.carrier]}</td>
                                  <td className="py-1.5 pr-2 text-muted-foreground">{SERVICE_LABEL[r.service]}</td>
                                  <td className="py-1.5 pr-2 text-right font-mono">
                                    {r.min_weight_kg}–{r.max_weight_kg ?? '∞'}
                                  </td>
                                  <td className="py-1.5 pr-2 text-right font-mono">{fmt(r.price)}</td>
                                  <td className="py-1.5 pr-2 text-right font-mono text-muted-foreground">
                                    {r.price_per_extra_kg ? fmt(r.price_per_extra_kg) : '—'}
                                  </td>
                                  <td className="py-1.5 pr-2 text-right text-muted-foreground">
                                    {r.delivery_days_min != null ? `${r.delivery_days_min}-${r.delivery_days_max ?? '?'}` : '—'}
                                  </td>
                                  <td className="py-1.5 pr-2 text-right text-muted-foreground">
                                    {r.free_above ? fmt(r.free_above) : '—'}
                                  </td>
                                  <td className="py-1.5 text-right">
                                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0"
                                      onClick={() => deleteRate(r.id)}>
                                      <Trash2 className="w-3 h-3 text-destructive/70" />
                                    </Button>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {draftRate?.zone_id === z.id ? (
                      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 p-3 rounded-[8px] bg-muted/20 border border-border/40">
                        <div>
                          <Label className="text-[10px]">Transportista</Label>
                          <Select value={draftRate.carrier}
                            onValueChange={v => setDraftRate({ ...draftRate, carrier: v as CarrierCode })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {CARRIERS.map(c => <SelectItem key={c} value={c}>{CARRIER_LABEL[c]}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-[10px]">Servicio</Label>
                          <Select value={draftRate.service}
                            onValueChange={v => setDraftRate({ ...draftRate, service: v as ServiceCode })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {SERVICES.map(s => <SelectItem key={s} value={s}>{SERVICE_LABEL[s]}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-[10px]">Peso desde (kg)</Label>
                          <Input type="number" step="0.1" className="h-8 text-xs"
                            value={draftRate.min_weight_kg}
                            onChange={e => setDraftRate({ ...draftRate, min_weight_kg: Number(e.target.value) })} />
                        </div>
                        <div>
                          <Label className="text-[10px]">Peso hasta (vacío = ∞)</Label>
                          <Input type="number" step="0.1" className="h-8 text-xs"
                            value={draftRate.max_weight_kg ?? ''}
                            onChange={e => setDraftRate({
                              ...draftRate,
                              max_weight_kg: e.target.value === '' ? null : Number(e.target.value),
                            })} />
                        </div>
                        <div>
                          <Label className="text-[10px]">Precio</Label>
                          <Input type="number" className="h-8 text-xs" value={draftRate.price}
                            onChange={e => setDraftRate({ ...draftRate, price: Number(e.target.value) })} />
                        </div>
                        <div>
                          <Label className="text-[10px]">Precio por kg extra</Label>
                          <Input type="number" className="h-8 text-xs" value={draftRate.price_per_extra_kg}
                            onChange={e => setDraftRate({ ...draftRate, price_per_extra_kg: Number(e.target.value) })} />
                        </div>
                        <div>
                          <Label className="text-[10px]">Días de entrega (min–max)</Label>
                          <div className="flex gap-1">
                            <Input type="number" className="h-8 text-xs" value={draftRate.delivery_days_min ?? ''}
                              onChange={e => setDraftRate({ ...draftRate, delivery_days_min: e.target.value === '' ? null : Number(e.target.value) })} />
                            <Input type="number" className="h-8 text-xs" value={draftRate.delivery_days_max ?? ''}
                              onChange={e => setDraftRate({ ...draftRate, delivery_days_max: e.target.value === '' ? null : Number(e.target.value) })} />
                          </div>
                        </div>
                        <div>
                          <Label className="text-[10px]">Envío gratis desde</Label>
                          <Input type="number" className="h-8 text-xs" placeholder="opcional"
                            value={draftRate.free_above ?? ''}
                            onChange={e => setDraftRate({ ...draftRate, free_above: e.target.value === '' ? null : Number(e.target.value) })} />
                        </div>
                        <div className="col-span-2 md:col-span-4 flex gap-2 justify-end">
                          <Button variant="ghost" size="sm" onClick={() => setDraftRate(null)}>Cancelar</Button>
                          <Button size="sm" onClick={saveRate} disabled={saving}>Guardar tarifa</Button>
                        </div>
                      </div>
                    ) : (
                      <Button variant="outline" size="sm" className="mt-2"
                        onClick={() => setDraftRate(emptyRate(z.id))}>
                        <Plus className="w-3.5 h-3.5 mr-1" /> Agregar tarifa
                      </Button>
                    )}
                  </div>

                  <div className="flex justify-end pt-1">
                    <Button variant="ghost" size="sm" className="text-destructive/70 hover:text-destructive"
                      onClick={() => deleteZone(z)}>
                      <Trash2 className="w-3.5 h-3.5 mr-1" /> Eliminar zona
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Simulador */}
      {zones.length > 0 && (
        <div className="bg-card border border-border/60 rounded-[10px] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Calculator className="w-4 h-4 text-primary" />
            <p className="font-medium text-sm">Simulador</p>
            <span className="text-[11px] text-muted-foreground">
              lo mismo que va a ver el comprador en el checkout
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <Label className="text-[10px]">Provincia</Label>
              <Select value={simProvince} onValueChange={setSimProvince}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AR_PROVINCES.map(p => <SelectItem key={p.code} value={p.code}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px]">Subtotal del carrito</Label>
              <Input type="number" className="h-8 text-xs" value={simSubtotal}
                onChange={e => setSimSubtotal(Number(e.target.value))} />
            </div>
            <div>
              <Label className="text-[10px]">Peso (kg)</Label>
              <Input type="number" step="0.1" className="h-8 text-xs" value={simWeight}
                onChange={e => setSimWeight(Number(e.target.value))} />
            </div>
          </div>

          {simulation.unavailableReason ? (
            <p className="text-xs text-destructive/80 bg-destructive/8 border border-destructive/20 rounded-[6px] px-3 py-2">
              {simulation.unavailableReason}
            </p>
          ) : (
            <div className="space-y-1.5">
              {simulation.zone && (
                <p className="text-[11px] text-muted-foreground">
                  Zona detectada: <span className="text-foreground font-medium">{simulation.zone.name}</span>
                </p>
              )}
              {simulation.options.map(o => (
                <div key={o.id} className="flex items-center justify-between px-3 py-2 rounded-[6px] bg-muted/20 border border-border/40">
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{o.label}</p>
                    {o.deliveryDaysMin != null && (
                      <p className="text-[10px] text-muted-foreground">
                        {o.deliveryDaysMin}–{o.deliveryDaysMax} días hábiles
                      </p>
                    )}
                  </div>
                  <span className={`text-xs font-mono font-semibold shrink-0 ${o.isFree ? 'text-emerald-400' : ''}`}>
                    {o.isFree ? 'GRATIS' : fmt(o.price)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {dialog}
    </div>
  );
}
