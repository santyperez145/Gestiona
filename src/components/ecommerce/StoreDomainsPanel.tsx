import { useEffect, useMemo, useState } from 'react';
import { Copy, ExternalLink, Globe2, Loader2, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { detalleDeEdgeFunction } from '@/lib/edgeErrors';
import {
  storeDomainDnsRecords,
  storeDomainStatusCopy,
  validateCustomStoreDomain,
} from '@/lib/storeCustomDomain';

interface StoreDomainRow {
  id?: string | null;
  custom_domain?: string | null;
  custom_domain_status?: string | null;
  custom_domain_verification?: unknown;
  custom_domain_checked_at?: string | null;
  custom_domain_error_code?: string | null;
}

interface DomainResponse {
  ok?: boolean;
  domain?: string;
  status?: string;
  verification?: unknown;
  checkedAt?: string;
}

const toneVariant = {
  success: 'success',
  warning: 'warning',
  danger: 'destructive',
  neutral: 'outline',
} as const;

export default function StoreDomainsPanel({
  orgId,
  store,
  includedUrl,
  onStateChange,
}: {
  orgId: string;
  store: StoreDomainRow | null;
  includedUrl: string | null;
  onStateChange: (patch: Partial<StoreDomainRow>) => void;
}) {
  const [domainInput, setDomainInput] = useState(store?.custom_domain ?? '');
  const [busy, setBusy] = useState<'connect' | 'verify' | 'disconnect' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { ask, dialog } = useConfirmDialog();

  useEffect(() => setDomainInput(store?.custom_domain ?? ''), [store?.custom_domain]);

  const status = storeDomainStatusCopy(store?.custom_domain_status);
  const records = useMemo(
    () => storeDomainDnsRecords(store?.custom_domain_verification),
    [store?.custom_domain_verification],
  );

  const copy = async (value: string, label = 'Valor') => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copiado`);
    } catch {
      toast.error('No se pudo copiar');
    }
  };

  const invoke = async (action: 'connect' | 'verify' | 'disconnect', domain?: string) => {
    setBusy(action);
    setError(null);
    const { data, error: invokeError } = await supabase.functions.invoke<DomainResponse>('store-domain', {
      body: { action, orgId, ...(domain ? { domain } : {}) },
    });
    if (invokeError || !data?.ok) {
      const detail = await detalleDeEdgeFunction(invokeError, data);
      const message = detail.message || 'No se pudo administrar el dominio.';
      console.error('[dominio tienda]', detail.code || message);
      setError(message);
      toast.error(message);
      setBusy(null);
      return false;
    }

    if (action === 'disconnect') {
      onStateChange({
        custom_domain: null,
        custom_domain_status: 'none',
        custom_domain_verification: {},
        custom_domain_checked_at: new Date().toISOString(),
        custom_domain_error_code: null,
      });
      setDomainInput('');
    } else {
      onStateChange({
        custom_domain: data.domain ?? domain ?? store?.custom_domain ?? null,
        custom_domain_status: data.status ?? 'pending_verification',
        custom_domain_verification: data.verification ?? {},
        custom_domain_checked_at: data.checkedAt ?? new Date().toISOString(),
        custom_domain_error_code: null,
      });
    }
    setBusy(null);
    return true;
  };

  const connect = async () => {
    const checked = validateCustomStoreDomain(domainInput);
    if (!checked.valid) {
      setError(checked.error ?? 'Dominio inválido');
      return;
    }
    if (await invoke('connect', checked.domain)) {
      toast.success('Dominio agregado. Ahora configurá los registros DNS.');
    }
  };

  const verify = async () => {
    if (await invoke('verify')) {
      toast.success('Estado del dominio actualizado.');
    }
  };

  const disconnect = async () => {
    const approved = await ask({
      title: '¿Desconectar el dominio propio?',
      description: 'La tienda seguirá disponible en su dirección incluida de Nerqia. El dominio se quitará del hosting y puede dejar de abrir de inmediato.',
      confirmText: 'Desconectar dominio',
      cancelText: 'Conservar',
      variant: 'destructive',
    });
    if (!approved) return;
    if (await invoke('disconnect')) toast.success('Dominio desconectado.');
  };

  return (
    <section aria-labelledby="store-domains-title" className="rounded-2xl border border-border/60 bg-card shadow-sm">
      <div className="flex flex-col gap-3 border-b border-border/50 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-300">
            <Globe2 className="h-5 w-5" />
          </div>
          <div>
            <h2 id="store-domains-title" className="text-base font-semibold">Dominios de la tienda</h2>
            <p className="mt-0.5 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
              Una sola tienda, el mismo catálogo y checkout. Cambia la dirección; no se duplica stock, pedidos ni configuración.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-emerald-600" /> TLS automático al verificar DNS
        </div>
      </div>

      <div className="space-y-5 p-4 sm:p-5">
        <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">Dirección incluida</p>
                <Badge variant="success">Activa</Badge>
              </div>
              <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{includedUrl ?? 'Guardá la tienda para obtenerla'}</p>
            </div>
            {includedUrl ? (
              <div className="flex shrink-0 gap-2">
                <Button variant="outline" size="sm" className="min-h-11 gap-1.5" onClick={() => { void copy(includedUrl, 'Enlace'); }}>
                  <Copy className="h-3.5 w-3.5" /> Copiar
                </Button>
                <Button variant="outline" size="sm" className="min-h-11 gap-1.5" onClick={() => window.open(includedUrl, '_blank', 'noopener,noreferrer')}>
                  <ExternalLink className="h-3.5 w-3.5" /> Abrir
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        {!store?.id ? (
          <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            Primero guardá la tienda. Después vas a poder conectar un dominio que ya hayas comprado.
          </div>
        ) : !store.custom_domain ? (
          <div className="space-y-3">
            <div>
              <Label htmlFor="store-custom-domain">Dominio propio</Label>
              <p className="mt-1 text-xs text-muted-foreground">Por ejemplo, tienda.tumarca.com. Escribilo sin https:// ni rutas.</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="store-custom-domain"
                value={domainInput}
                onChange={event => setDomainInput(event.target.value)}
                placeholder="tienda.tumarca.com"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="min-h-11 font-mono"
                disabled={busy !== null}
              />
              <Button className="min-h-11 shrink-0" onClick={() => { void connect(); }} disabled={busy !== null}>
                {busy === 'connect' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe2 className="h-4 w-4" />}
                Conectar dominio
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-xl border border-border/60 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-mono text-sm font-semibold">{store.custom_domain}</p>
                  <Badge variant={toneVariant[status.tone]}>{status.label}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{status.detail}</p>
                {store.custom_domain_checked_at ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Último chequeo: {new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(store.custom_domain_checked_at))}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {store.custom_domain_status === 'active' ? (
                  <Button variant="outline" size="sm" className="min-h-11 gap-1.5" onClick={() => window.open(`https://${store.custom_domain}`, '_blank', 'noopener,noreferrer')}>
                    <ExternalLink className="h-3.5 w-3.5" /> Abrir
                  </Button>
                ) : null}
                <Button variant="outline" size="sm" className="min-h-11 gap-1.5" disabled={busy !== null} onClick={() => { void verify(); }}>
                  {busy === 'verify' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Verificar ahora
                </Button>
                <Button variant="outline" size="sm" className="min-h-11 gap-1.5 text-destructive hover:text-destructive" disabled={busy !== null} onClick={() => { void disconnect(); }}>
                  {busy === 'disconnect' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  Desconectar
                </Button>
              </div>
            </div>

            {records.length > 0 ? (
              <div className="overflow-hidden rounded-xl border border-border/60">
                <div className="border-b border-border/50 bg-muted/25 px-4 py-3">
                  <p className="text-sm font-medium">Registros que tenés que publicar</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Copialos en el proveedor donde compraste el dominio.</p>
                </div>
                <div className="divide-y divide-border/50">
                  {records.map((record, index) => (
                    <div key={`${record.type}-${record.name}-${index}`} className="grid gap-2 p-4 sm:grid-cols-[80px_minmax(0,1fr)_minmax(0,1.5fr)_44px] sm:items-center">
                      <Badge variant={record.purpose === 'ownership' ? 'warning' : 'blue'}>{record.type}</Badge>
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Nombre</p>
                        <p className="break-all font-mono text-xs">{record.name}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Valor</p>
                        <p className="break-all font-mono text-xs">{record.value}</p>
                      </div>
                      <Button variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label={`Copiar valor ${record.type}`} onClick={() => { void copy(record.value); }}>
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {error ? (
          <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="rounded-xl bg-amber-500/[0.08] px-4 py-3 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
          Los cambios de DNS pueden tardar hasta 48 horas. No borres registros MX o TXT de correo: podrías dejar de recibir emails aunque la tienda funcione.
        </div>
      </div>
      {dialog}
    </section>
  );
}
