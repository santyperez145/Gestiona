import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrg } from '@/lib/orgContext';
import { toast } from 'sonner';
import { Truck, Save, ShieldCheck, Loader2, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CARRIER_LABEL, type CarrierCode } from '@/lib/shippingCalc';

/**
 * Configuración de transportistas por organización.
 *
 * Dos modos por transportista:
 *   'table' → cotiza con el tarifario que el comercio carga en Zonas y tarifas.
 *             No necesita contrato ni credenciales. Es el default.
 *   'api'   → cotiza en vivo contra el correo usando el contrato del comercio.
 *
 * Las credenciales son del contrato del comercio con el correo, no de la
 * plataforma. Se guardan en `shipping_carriers.credentials`, cuya RLS sólo
 * permite owner/admin — un vendedor no ve el contrato.
 */

interface CarrierRow {
  id?: string;
  carrier: CarrierCode;
  is_enabled: boolean;
  mode: 'table' | 'api';
  credentials: Record<string, string>;
  markup_pct: number;
  markup_fixed: number;
  default_origin: Record<string, string>;
}

/** Campos de credenciales que pide cada correo, y si soporta cotización por API */
const CARRIER_SPEC: Record<CarrierCode, {
  supportsApi: boolean;
  docsUrl?: string;
  fields: Array<{ key: string; label: string; type?: string; hint?: string }>;
  note: string;
}> = {
  correo_argentino: {
    supportsApi: true,
    docsUrl: 'https://www.correoargentino.com.ar/mi-correo',
    fields: [
      { key: 'user', label: 'Usuario de Mi Correo' },
      { key: 'password', label: 'Contraseña', type: 'password' },
      { key: 'customer_id', label: 'ID de cliente', hint: 'El que te dieron al firmar el contrato' },
    ],
    note: 'Necesitás un contrato de Mi Correo / Paq.ar. Sin contrato, usá el tarifario propio.',
  },
  andreani: {
    supportsApi: true,
    docsUrl: 'https://developers.andreani.com',
    fields: [
      { key: 'user', label: 'Usuario API' },
      { key: 'password', label: 'Contraseña API', type: 'password' },
      { key: 'contract', label: 'Número de contrato' },
      { key: 'client_code', label: 'Código de cliente', hint: 'Opcional según el contrato' },
    ],
    note: 'Requiere cuenta de empresa con Andreani y credenciales de su portal de desarrolladores.',
  },
  oca: {
    supportsApi: false,
    fields: [
      { key: 'cuit', label: 'CUIT' },
      { key: 'account', label: 'Número de cuenta' },
    ],
    note: 'Todavía cotizamos OCA sólo con tarifario propio. La cotización en vivo está pendiente.',
  },
  propio: {
    supportsApi: false,
    fields: [],
    note: 'Envío con tu propia logística o un cadete. Se cotiza siempre con tu tarifario.',
  },
  retiro: {
    supportsApi: false,
    fields: [],
    note: 'El retiro en tienda se configura en la tienda online, no acá.',
  },
};

const CARRIERS: CarrierCode[] = ['correo_argentino', 'andreani', 'oca', 'propio'];

const blank = (carrier: CarrierCode): CarrierRow => ({
  carrier,
  is_enabled: false,
  mode: 'table',
  credentials: {},
  markup_pct: 0,
  markup_fixed: 0,
  default_origin: {},
});

export default function CarriersTab() {
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id ?? '';
  const [rows, setRows] = useState<Record<string, CarrierRow>>({});
  const [loading, setLoading] = useState(true);
  const [savingCarrier, setSavingCarrier] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const { data, error } = await supabase.from('shipping_carriers').select('*').eq('org_id', orgId);
    if (error) {
      // RLS limita esta tabla a owner/admin: un vendedor cae acá
      toast.error('No tenés permiso para ver la configuración de transportistas');
      setLoading(false);
      return;
    }
    const byCarrier: Record<string, CarrierRow> = {};
    CARRIERS.forEach(c => { byCarrier[c] = blank(c); });
    ((data || []) as unknown as CarrierRow[]).forEach(r => {
      byCarrier[r.carrier] = {
        ...r,
        credentials: r.credentials || {},
        default_origin: r.default_origin || {},
      };
    });
    setRows(byCarrier);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  function patch(carrier: CarrierCode, changes: Partial<CarrierRow>) {
    setRows(prev => ({ ...prev, [carrier]: { ...prev[carrier], ...changes } }));
  }

  async function save(carrier: CarrierCode) {
    const row = rows[carrier];
    if (!row) return;

    if (row.mode === 'api') {
      const spec = CARRIER_SPEC[carrier];
      const missing = spec.fields
        .filter(f => !f.hint?.startsWith('Opcional'))
        .filter(f => !row.credentials[f.key]?.trim());
      if (missing.length > 0) {
        toast.error(`Faltan credenciales: ${missing.map(m => m.label).join(', ')}`);
        return;
      }
      if (!row.default_origin.postal_code?.trim()) {
        toast.error('Para cotizar en vivo hace falta el código postal de despacho');
        return;
      }
    }

    setSavingCarrier(carrier);
    const { error } = await supabase.from('shipping_carriers').upsert({
      org_id: orgId,
      carrier,
      is_enabled: row.is_enabled,
      mode: row.mode,
      credentials: row.credentials,
      markup_pct: row.markup_pct,
      markup_fixed: row.markup_fixed,
      default_origin: row.default_origin,
    } as never, { onConflict: 'org_id,carrier' });
    setSavingCarrier(null);

    if (error) { toast.error(error.message); return; }
    toast.success(`${CARRIER_LABEL[carrier]} guardado`);
    load();
  }

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground text-sm">Cargando transportistas...</div>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Habilitá los correos con los que despachás. Con <span className="text-foreground font-medium">tarifario propio</span> cotizás
        con los precios que cargás en Zonas y tarifas — no hace falta contrato. Con{' '}
        <span className="text-foreground font-medium">cotización en vivo</span> le preguntamos el precio al correo en cada checkout.
      </p>

      {CARRIERS.map(carrier => {
        const row = rows[carrier];
        const spec = CARRIER_SPEC[carrier];
        if (!row) return null;

        return (
          <div key={carrier} className="bg-card border border-border/60 rounded-[10px] overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40">
              <Truck className={`w-4 h-4 shrink-0 ${row.is_enabled ? 'text-primary' : 'text-muted-foreground/40'}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm">{CARRIER_LABEL[carrier]}</p>
                  {row.is_enabled && (
                    <Badge variant="secondary" className="text-[9px]">
                      {row.mode === 'api' ? 'cotiza en vivo' : 'tarifario propio'}
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">{spec.note}</p>
              </div>
              <Switch
                checked={row.is_enabled}
                onCheckedChange={v => patch(carrier, { is_enabled: v })}
                className="shrink-0"
              />
            </div>

            {row.is_enabled && (
              <div className="p-4 space-y-4">
                {/* Modo */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-[10px]">Cómo cotiza</Label>
                    <Select
                      value={row.mode}
                      onValueChange={v => patch(carrier, { mode: v as 'table' | 'api' })}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="table">Tarifario propio</SelectItem>
                        <SelectItem value="api" disabled={!spec.supportsApi}>
                          Cotización en vivo {!spec.supportsApi && '(no disponible)'}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[10px]">Markup %</Label>
                    <Input type="number" step="0.5" className="h-8 text-xs" value={row.markup_pct}
                      onChange={e => patch(carrier, { markup_pct: Number(e.target.value) })} />
                  </div>
                  <div>
                    <Label className="text-[10px]">Markup fijo</Label>
                    <Input type="number" className="h-8 text-xs" value={row.markup_fixed}
                      onChange={e => patch(carrier, { markup_fixed: Number(e.target.value) })} />
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground -mt-2">
                  El markup cubre packaging y manipuleo: se suma sobre la tarifa del correo.
                </p>

                {/* Origen del despacho */}
                <div>
                  <Label className="text-xs mb-2 block">Desde dónde despachás</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <Input className="h-8 text-xs" placeholder="Código postal"
                      value={row.default_origin.postal_code || ''}
                      onChange={e => patch(carrier, { default_origin: { ...row.default_origin, postal_code: e.target.value } })} />
                    <Input className="h-8 text-xs" placeholder="Ciudad"
                      value={row.default_origin.city || ''}
                      onChange={e => patch(carrier, { default_origin: { ...row.default_origin, city: e.target.value } })} />
                    <Input className="h-8 text-xs col-span-2" placeholder="Calle y número"
                      value={row.default_origin.street || ''}
                      onChange={e => patch(carrier, { default_origin: { ...row.default_origin, street: e.target.value } })} />
                  </div>
                </div>

                {/* Credenciales — sólo tienen sentido en modo API */}
                {row.mode === 'api' && spec.fields.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <ShieldCheck className="w-3.5 h-3.5 text-muted-foreground" />
                      <Label className="text-xs">Credenciales de tu contrato</Label>
                      {spec.docsUrl && (
                        <a href={spec.docsUrl} target="_blank" rel="noopener noreferrer"
                          className="text-[10px] text-primary hover:underline inline-flex items-center gap-0.5 ml-1">
                          documentación <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {spec.fields.map(f => (
                        <div key={f.key}>
                          <Input
                            className="h-8 text-xs"
                            type={f.type || 'text'}
                            placeholder={f.label}
                            autoComplete="off"
                            value={row.credentials[f.key] || ''}
                            onChange={e => patch(carrier, {
                              credentials: { ...row.credentials, [f.key]: e.target.value },
                            })}
                          />
                          {f.hint && <p className="text-[9px] text-muted-foreground mt-0.5">{f.hint}</p>}
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-2">
                      Si el correo no responde o rechaza las credenciales, el checkout cae
                      automáticamente a tu tarifario propio. Nunca deja de cotizar.
                    </p>
                  </div>
                )}

                <div className="flex justify-end">
                  <Button size="sm" onClick={() => save(carrier)} disabled={savingCarrier === carrier}>
                    {savingCarrier === carrier
                      ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                      : <Save className="w-3.5 h-3.5 mr-1" />}
                    Guardar
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
