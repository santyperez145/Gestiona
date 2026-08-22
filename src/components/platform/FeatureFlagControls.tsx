import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Building2, Loader2, Power, RotateCcw, ShieldCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type FlagOverride = {
  id: string;
  flag_key: string;
  org_id: string | null;
  enabled: boolean;
  reason: string | null;
  updated_at: string | null;
  organization?: { name?: string | null; slug?: string | null } | null;
};

type OrganizationOption = { id: string; name: string; slug: string | null };

type FeatureFlagsResponse = {
  ok?: boolean;
  error?: string;
  overrides?: FlagOverride[];
  organizations?: OrganizationOption[];
};

const FLAG_KEY = 'checkout_brick';

function apiError(error: unknown, data: unknown, fallback: string) {
  if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') return data.error;
  if (error instanceof Error) return error.message;
  return fallback;
}

function formatUpdatedAt(value: string | null) {
  if (!value) return 'sin cambios manuales';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'fecha no disponible' : date.toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function FeatureFlagControls({ isSuperadmin }: { isSuperadmin: boolean }) {
  const [overrides, setOverrides] = useState<FlagOverride[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationOption[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingScope, setSavingScope] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: invokeError } = await supabase.functions.invoke('platform-admin-action', {
      body: { action: 'getFeatureFlags' },
    });
    const response = data as FeatureFlagsResponse | null;
    if (invokeError || !response?.ok) {
      setError(apiError(invokeError, response, 'No se pudieron cargar los controles de lanzamiento.'));
      setOverrides([]);
      setOrganizations([]);
    } else {
      setOverrides((response.overrides ?? []).filter(item => item.flag_key === FLAG_KEY));
      setOrganizations(response.organizations ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const globalOverride = useMemo(
    () => overrides.find(item => item.org_id === null),
    [overrides],
  );
  const selectedOrg = useMemo(
    () => organizations.find(org => org.id === selectedOrgId) ?? null,
    [organizations, selectedOrgId],
  );
  const orgOverride = useMemo(
    () => overrides.find(item => item.org_id === selectedOrgId) ?? null,
    [overrides, selectedOrgId],
  );
  const globalEnabled = globalOverride?.enabled ?? true;
  const selectedEnabled = orgOverride?.enabled ?? globalEnabled;

  const save = async (orgId: string | null, enabled: boolean) => {
    if (!isSuperadmin) return;
    const scope = orgId ?? 'global';
    const scopeLabel = orgId ? selectedOrg?.name ?? 'este comercio' : 'todos los comercios';
    const decision = enabled ? 'habilitar' : 'pausar';
    if (!window.confirm(`¿Confirmás ${decision} el pago integrado para ${scopeLabel}? El checkout externo de MercadoPago seguirá disponible.`)) return;

    setSavingScope(scope);
    setError(null);
    setNotice(null);
    const { data, error: invokeError } = await supabase.functions.invoke('platform-admin-action', {
      body: { action: 'setFeatureFlag', flagKey: FLAG_KEY, orgId, enabled, reason: reason.trim() || null },
    });
    if (invokeError || !(data as FeatureFlagsResponse | null)?.ok) {
      setError(apiError(invokeError, data, 'No se pudo actualizar el control de lanzamiento.'));
    } else {
      setReason('');
      setNotice(`Cambio aplicado para ${scopeLabel}. Quedó registrado en la auditoría de plataforma.`);
      await load();
    }
    setSavingScope(null);
  };

  const clear = async (orgId: string | null) => {
    if (!isSuperadmin) return;
    const scope = orgId ?? 'global';
    const scopeLabel = orgId ? selectedOrg?.name ?? 'este comercio' : 'todos los comercios';
    if (!window.confirm(`¿Quitar el override para ${scopeLabel}? Volverá a heredar el valor por defecto.`)) return;

    setSavingScope(scope);
    setError(null);
    setNotice(null);
    const { data, error: invokeError } = await supabase.functions.invoke('platform-admin-action', {
      body: { action: 'clearFeatureFlag', flagKey: FLAG_KEY, orgId },
    });
    if (invokeError || !(data as FeatureFlagsResponse | null)?.ok) {
      setError(apiError(invokeError, data, 'No se pudo quitar el override.'));
    } else {
      setNotice(`Override quitado para ${scopeLabel}. Quedó registrado en la auditoría de plataforma.`);
      await load();
    }
    setSavingScope(null);
  };

  const controlButton = (orgId: string | null, enabled: boolean, label: string) => (
    <Button
      size="sm"
      variant={enabled ? 'outline' : 'default'}
      disabled={!isSuperadmin || savingScope === (orgId ?? 'global')}
      onClick={() => void save(orgId, enabled)}
    >
      {savingScope === (orgId ?? 'global') ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Power className="w-3.5 h-3.5 mr-1.5" />}
      {label}
    </Button>
  );

  return (
    <section className="overflow-hidden border border-violet-500/20 rounded-[10px] bg-card" aria-labelledby="feature-flags-title">
      <div className="border-b border-border/50 px-4 sm:px-5 py-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 h-8 w-8 shrink-0 rounded-[7px] border border-violet-500/25 bg-violet-500/10 text-violet-300 flex items-center justify-center"><ShieldCheck className="w-4 h-4" /></span>
          <div>
            <h2 id="feature-flags-title" className="text-sm font-semibold">Control de lanzamiento</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">El primer interruptor protege Checkout Brick: al pausarlo, el comprador conserva el checkout externo de MercadoPago. No reemplaza pruebas ni habilita experimentos porcentuales.</p>
          </div>
        </div>
        <Badge variant={globalEnabled ? 'default' : 'warning'}>{globalEnabled ? 'Integrado activo por defecto' : 'Integrado pausado por defecto'}</Badge>
      </div>

      <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-2">
        <article className="rounded-[8px] border border-border/60 p-4">
          <p className="text-xs font-semibold">Regla global</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Define el valor que heredan los comercios sin excepción propia.</p>
          <div className="mt-3 flex items-center justify-between gap-3">
            <Badge variant={globalEnabled ? 'default' : 'warning'}>{globalEnabled ? 'Habilitado' : 'Pausado'}</Badge>
            {globalOverride ? <span className="text-[10px] text-muted-foreground">Override · {formatUpdatedAt(globalOverride.updated_at)}</span> : <span className="text-[10px] text-muted-foreground">Valor seguro inicial</span>}
          </div>
          {globalOverride?.reason && <p className="mt-2 text-[11px] text-muted-foreground">Motivo: {globalOverride.reason}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {controlButton(null, true, 'Habilitar')}
            {controlButton(null, false, 'Pausar')}
            {globalOverride && (
              <Button size="sm" variant="ghost" disabled={!isSuperadmin || savingScope === 'global'} onClick={() => void clear(null)}>
                <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Usar valor seguro
              </Button>
            )}
          </div>
        </article>

        <article className="rounded-[8px] border border-border/60 p-4">
          <div className="flex items-center gap-2"><Building2 className="w-3.5 h-3.5 text-muted-foreground" /><p className="text-xs font-semibold">Excepción por comercio</p></div>
          <p className="mt-1 text-[11px] text-muted-foreground">Sirve para un lanzamiento controlado o para aislar un comercio sin afectar al resto.</p>
          <Select value={selectedOrgId || '__none'} onValueChange={value => setSelectedOrgId(value === '__none' ? '' : value)} disabled={loading}>
            <SelectTrigger className="mt-3 h-9 w-full text-xs" aria-label="Seleccionar comercio para el control de lanzamiento">
              <SelectValue placeholder="Seleccioná un comercio" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">Seleccioná un comercio</SelectItem>
              {organizations.map(org => <SelectItem key={org.id} value={org.id}>{org.name}{org.slug ? ` · ${org.slug}` : ''}</SelectItem>)}
            </SelectContent>
          </Select>
          {selectedOrg && (
            <>
              <div className="mt-3 flex items-center justify-between gap-3">
                <Badge variant={selectedEnabled ? 'default' : 'warning'}>{selectedEnabled ? 'Habilitado' : 'Pausado'}</Badge>
                <span className="text-[10px] text-muted-foreground">{orgOverride ? `Override · ${formatUpdatedAt(orgOverride.updated_at)}` : `Hereda regla global (${globalEnabled ? 'habilitada' : 'pausada'})`}</span>
              </div>
              {orgOverride?.reason && <p className="mt-2 text-[11px] text-muted-foreground">Motivo: {orgOverride.reason}</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                {controlButton(selectedOrg.id, true, 'Habilitar')}
                {controlButton(selectedOrg.id, false, 'Pausar')}
                {orgOverride && (
                  <Button size="sm" variant="ghost" disabled={!isSuperadmin || savingScope === selectedOrg.id} onClick={() => void clear(selectedOrg.id)}>
                    <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Heredar global
                  </Button>
                )}
              </div>
            </>
          )}
        </article>
      </div>

      {isSuperadmin && (
        <div className="border-t border-border/50 px-4 sm:px-5 py-3">
          <label className="block text-[11px] font-medium" htmlFor="feature-flag-reason">Motivo del próximo cambio <span className="font-normal text-muted-foreground">(opcional, queda en auditoría)</span></label>
          <input id="feature-flag-reason" maxLength={500} value={reason} onChange={event => setReason(event.target.value)} className="mt-1.5 h-9 w-full rounded-md border border-input bg-background px-3 text-xs" placeholder="Ej.: pausa preventiva mientras revisamos rechazos de tarjeta" />
        </div>
      )}

      {!isSuperadmin && <p className="border-t border-border/50 px-4 sm:px-5 py-3 text-[11px] text-muted-foreground">Podés consultar el alcance; sólo superadmin puede cambiarlo.</p>}
      {loading && <p className="border-t border-border/50 px-4 sm:px-5 py-3 text-[11px] text-muted-foreground"><Loader2 className="inline w-3.5 h-3.5 animate-spin mr-1.5" />Cargando controles…</p>}
      {notice && <p className="border-t border-emerald-500/20 bg-emerald-500/[0.04] px-4 sm:px-5 py-3 text-[11px] text-emerald-300" aria-live="polite">{notice}</p>}
      {error && <p className="border-t border-destructive/20 bg-destructive/5 px-4 sm:px-5 py-3 text-[11px] text-destructive" role="alert"><AlertTriangle className="inline w-3.5 h-3.5 mr-1.5" />{error}</p>}
    </section>
  );
}
