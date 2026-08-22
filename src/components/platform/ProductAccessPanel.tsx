import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock3, Loader2, PackageCheck, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

interface ProductRow {
  product_key: 'business' | 'finance';
  status: 'available' | 'requested' | 'enabled';
  requested_at: string | null;
  decided_at: string | null;
  updated_at: string;
}

function formatDate(value: string | null) {
  if (!value) return 'Sin fecha';
  return new Date(value).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function ProductAccessPanel({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<{ enabled: boolean } | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: invokeError } = await supabase.functions.invoke('platform-admin-action', {
      body: { action: 'getProductAccess', orgId },
    });
    if (invokeError || data?.error) {
      setRows([]);
      setError(data?.error || invokeError?.message || 'No se pudo leer el acceso por producto.');
    } else {
      setRows((data?.products || []) as ProductRow[]);
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  const finance = rows.find(row => row.product_key === 'finance');
  const applyDecision = async () => {
    if (!decision || reason.trim().length < 10) return;
    setSaving(true);
    const { data, error: invokeError } = await supabase.functions.invoke('platform-admin-action', {
      body: {
        action: 'setProductAccess',
        orgId,
        productKey: 'finance',
        enabled: decision.enabled,
        reason: reason.trim(),
      },
    });
    setSaving(false);
    if (invokeError || data?.error) {
      toast.error(data?.error || invokeError?.message || 'No se pudo cambiar el producto.');
      return;
    }
    toast.success(decision.enabled ? 'Finance habilitado' : 'Finance deshabilitado');
    setDecision(null);
    setReason('');
    await load();
  };

  return (
    <section className="space-y-4 rounded-[10px] border border-violet-500/20 bg-card p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-2">
          <PackageCheck className="h-4 w-4 text-violet-300" />
          <div>
            <h2 className="text-sm font-semibold">Acceso por producto</h2>
            <p className="text-[11px] text-muted-foreground">Entitlement de la organización; los permisos del equipo se administran aparte.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Actualizar
        </Button>
      </div>

      {error ? (
        <div className="rounded-[8px] border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">{error}</div>
      ) : loading ? (
        <div className="flex items-center py-6 text-xs text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Leyendo productos...</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <ProductCard title="Gestiona Business" status="enabled" detail="Core operativo: productos, ventas, clientes, stock y margen." />
          <ProductCard
            title="Gestiona Finance"
            status={finance?.status || 'available'}
            detail={finance?.status === 'requested'
              ? `Solicitado ${formatDate(finance.requested_at)}`
              : finance?.status === 'enabled'
                ? `Habilitado · decisión ${formatDate(finance.decided_at)}`
                : 'Disponible para solicitar; todavía sin acceso al producto.'}
          />
        </div>
      )}

      {!loading && !error && canManage && finance && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant={finance.status === 'enabled' ? 'outline' : 'default'}
            onClick={() => { setDecision({ enabled: finance.status !== 'enabled' }); setReason(''); }}
          >
            {finance.status === 'enabled' ? 'Deshabilitar Finance' : finance.status === 'requested' ? 'Aprobar Finance' : 'Habilitar piloto'}
          </Button>
        </div>
      )}

      {!canManage && <p className="text-[10px] text-muted-foreground">Sólo staff de plataforma `finance` o `superadmin` puede cambiar entitlements.</p>}

      <Dialog open={Boolean(decision)} onOpenChange={open => { if (!open && !saving) setDecision(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{decision?.enabled ? 'Habilitar Gestiona Finance' : 'Deshabilitar Gestiona Finance'}</DialogTitle>
            <DialogDescription>El cambio afecta el acceso de toda la organización y queda auditado. No modifica datos del Business Core.</DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={500} placeholder="Motivo de la decisión (mínimo 10 caracteres)" />
          <p className="text-right text-[10px] text-muted-foreground">{reason.trim().length}/500</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecision(null)} disabled={saving}>Cancelar</Button>
            <Button onClick={() => void applyDecision()} disabled={saving || reason.trim().length < 10}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ProductCard({ title, status, detail }: { title: string; status: ProductRow['status']; detail: string }) {
  const enabled = status === 'enabled';
  const requested = status === 'requested';
  return (
    <article className={`rounded-[8px] border p-3.5 ${enabled ? 'border-emerald-500/20 bg-emerald-500/[0.04]' : requested ? 'border-amber-500/25 bg-amber-500/[0.04]' : 'border-border/60 bg-muted/15'}`}>
      <div className="flex items-start gap-3">
        {enabled ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400" /> : requested ? <Clock3 className="mt-0.5 h-4 w-4 text-amber-400" /> : <ShieldCheck className="mt-0.5 h-4 w-4 text-muted-foreground" />}
        <div><h3 className="text-xs font-semibold">{title}</h3><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{detail}</p><p className="mt-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{enabled ? 'Habilitado' : requested ? 'Solicitado' : 'Disponible'}</p></div>
      </div>
    </article>
  );
}
