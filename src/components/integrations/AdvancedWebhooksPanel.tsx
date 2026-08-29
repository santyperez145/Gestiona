/**
 * AdvancedWebhooksPanel — multi-event outbound webhooks with delivery log.
 *
 * Es la única superficie de webhooks de la organización. La configuración se
 * guarda mediante RPCs; el secret se genera en servidor, se muestra una vez y
 * nunca vuelve en las lecturas normales.
 */
import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { useUserRole } from "@/lib/useUserRole";
import { toast } from "sonner";
import {
  Webhook, Plus, Save, Trash2, Edit2, CheckCircle, XCircle,
  RefreshCw, Play, ChevronDown, ChevronUp, Shield, BarChart3, Info, Loader2, Link,
  Copy, RotateCcw, Send, FileJson, ExternalLink, Code2,
} from "lucide-react";
import KPICard from "@/components/shared/KPICard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

// ── Available events ─────────────────────────────────────────────────────────
const EVENTS = [
  { group: 'Ventas', events: [
    { key: 'sale.created', label: 'Nueva venta' },
  ]},
  { group: 'Automatizaciones', events: [
    { key: 'automation.triggered', label: 'Automatización ejecutada' },
  ]},
];

const ALL_EVENTS = EVENTS.flatMap(g => g.events);
const PUBLIC_WEBHOOK_CONTRACT = "/developer/webhooks/openapi.json";
const HUMAN_WEBHOOK_GUIDE = "https://github.com/santyperez145/exentryimports/blob/main/docs/WEBHOOKS.md";
const SIGNATURE_EXAMPLE = `const rawBody = await request.text();
const { t, v1 } = Object.fromEntries(
  request.headers.get("X-Gestiona-Signature")
    .split(",").map(part => part.split("="))
);
const expected = createHmac("sha256", secret)
  .update(t + "." + rawBody, "utf8").digest("hex");
// Rechazá > 5 min y compará v1/expected en tiempo constante.`;

interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  event_types: string[];
  active: boolean;
  retry_on_fail: boolean;
  max_retries: number;
  timeout_seconds: number;
  last_fired_at: string | null;
  success_count: number;
  failure_count: number;
  created_at: string;
}

// Vista de UI sobre `webhook_deliveries`, que la Edge Function `send-webhook`
// escribe con otros nombres (event / delivered / last_response_status /
// attempt_count) y sin tiempo de respuesta.
interface Delivery {
  id: string;
  event_type: string;
  status: 'success' | 'failed';
  http_status: number | null;
  attempt: number;
  duration_ms: number | null;
  delivered_at: string | null;
  created_at: string;
}

const emptyForm = () => ({
  name: '', url: 'https://', event_types: [] as string[],
  active: true, retry_on_fail: true, max_retries: '2', timeout_seconds: '10',
});

export default function AdvancedWebhooksPanel() {
  const { activeOrg } = useOrg();
  const { isAdmin } = useUserRole();
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
  const [deliveries, setDeliveries] = useState<Record<string, Delivery[]>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<WebhookConfig | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [revealedSecret, setRevealedSecret] = useState("");
  const [showContract, setShowContract] = useState(false);

  const load = async () => {
    if (!activeOrg?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("webhook_configs")
        .select("id, name, url, event_types, active, retry_on_fail, max_retries, timeout_seconds, last_fired_at, success_count, failure_count, created_at")
        .eq("org_id", activeOrg.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setWebhooks((data ?? []) as unknown as WebhookConfig[]);
    } catch (e: any) {
      console.error("webhooks: no se pudieron cargar las configuraciones", e);
      toast.error("Error: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadDeliveries = async (webhookId: string, force = false) => {
    if (!force && deliveries[webhookId]) return;
    const { data, error } = await supabase
      .from("webhook_deliveries")
      .select("id, event, delivered, last_response_status, attempt_count, duration_ms, delivered_at, created_at")
      .eq("webhook_id", webhookId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) {
      console.error("webhooks: no se pudo cargar el historial", error);
      toast.error("No se pudo cargar el historial de entregas");
      return;
    }
    if (data) {
      setDeliveries(prev => ({
        ...prev,
        [webhookId]: data.map(d => ({
          id: d.id,
          event_type: d.event,
          status: d.delivered ? 'success' : 'failed',
          http_status: d.last_response_status,
          attempt: d.attempt_count,
          duration_ms: d.duration_ms,
          delivered_at: d.delivered_at,
          created_at: d.created_at,
        })),
      }));
    }
  };

  useEffect(() => { load(); }, [activeOrg?.id]);

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setShowForm(true); };
  const openEdit = (w: WebhookConfig) => {
    setEditing(w);
    setForm({
      name: w.name, url: w.url,
      event_types: w.event_types,
      active: w.active,
      retry_on_fail: w.retry_on_fail,
      max_retries: w.max_retries.toString(),
      timeout_seconds: w.timeout_seconds.toString(),
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error("El nombre es obligatorio"); return; }
    if (!form.url.startsWith('https://')) { toast.error("La URL debe comenzar con https://"); return; }
    if (form.event_types.length === 0) { toast.error("Seleccioná al menos un evento"); return; }
    if (!activeOrg?.id) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("webhook_config_guardar" as never, {
        p_org_id: activeOrg.id,
        p_webhook_id: editing?.id ?? null,
        p_name: form.name.trim(),
        p_url: form.url.trim(),
        p_event_types: form.event_types,
        p_active: form.active,
        p_retry_on_fail: form.retry_on_fail,
        p_max_retries: Number(form.max_retries),
        p_timeout_seconds: Number(form.timeout_seconds),
      } as never) as { data: { signing_secret?: string | null } | null; error: { message: string } | null };
      if (error) throw error;
      toast.success(editing ? "Webhook actualizado" : "Webhook creado y firmado");
      setShowForm(false);
      if (data?.signing_secret) setRevealedSecret(data.signing_secret);
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteWebhook = async (id: string) => {
    if (!activeOrg?.id) return;
    const { error } = await supabase.rpc("webhook_config_eliminar" as never, {
      p_org_id: activeOrg.id,
      p_webhook_id: id,
    } as never);
    if (error) { toast.error(error.message); return; }
    await load();
    toast.success("Webhook y secret eliminados");
  };

  const toggleActive = async (w: WebhookConfig) => {
    if (!activeOrg?.id) return;
    const { error } = await supabase.rpc("webhook_config_guardar" as never, {
      p_org_id: activeOrg.id,
      p_webhook_id: w.id,
      p_name: w.name,
      p_url: w.url,
      p_event_types: w.event_types,
      p_active: !w.active,
      p_retry_on_fail: w.retry_on_fail,
      p_max_retries: w.max_retries,
      p_timeout_seconds: w.timeout_seconds,
    } as never);
    if (error) { toast.error(error.message); return; }
    await load();
    toast.success(w.active ? "Webhook desactivado" : "Webhook activado");
  };

  const testWebhook = async (webhook: WebhookConfig) => {
    setTesting(webhook.id);
    try {
      const { data, error } = await supabase.functions.invoke("send-webhook", {
        body: { action: "test", orgId: activeOrg!.id, webhookId: webhook.id },
      });
      if (error) throw error;
      const result = data?.results?.[0];
      if (result?.delivered) toast.success(`Prueba confirmada en ${result.duration_ms} ms`);
      else toast.error(result?.error || "El endpoint no confirmó la prueba");
      setDeliveries(prev => { const copy = { ...prev }; delete copy[webhook.id]; return copy; });
      await loadDeliveries(webhook.id, true);
      await load();
    } catch (e: any) {
      toast.error(`No se pudo completar la prueba: ${e.message}`);
    } finally {
      setTesting(null);
    }
  };

  const rotateSecret = async (webhook: WebhookConfig) => {
    if (!activeOrg?.id) return;
    const { data, error } = await supabase.rpc("webhook_secret_rotar" as never, {
      p_org_id: activeOrg.id,
      p_webhook_id: webhook.id,
    } as never) as { data: string | null; error: { message: string } | null };
    if (error || !data) { toast.error(error?.message || "No se pudo rotar el secret"); return; }
    setRevealedSecret(data);
    toast.success("Secret rotado; el valor anterior dejó de firmar");
  };

  const retryDelivery = async (delivery: Delivery, webhookId: string) => {
    if (!activeOrg?.id) return;
    setRetrying(delivery.id);
    try {
      const { data, error } = await supabase.functions.invoke("send-webhook", {
        body: { action: "retry", orgId: activeOrg.id, deliveryId: delivery.id },
      });
      if (error) throw error;
      if (data?.delivered) toast.success("Entrega confirmada");
      else toast.error("El endpoint volvió a rechazar la entrega");
      setDeliveries(prev => { const copy = { ...prev }; delete copy[webhookId]; return copy; });
      await loadDeliveries(webhookId, true);
      await load();
    } catch (error: any) {
      toast.error(error?.message || "No se pudo reintentar");
    } finally {
      setRetrying(null);
    }
  };

  const toggleEvent = (key: string) => {
    setForm(f => ({
      ...f,
      event_types: f.event_types.includes(key)
        ? f.event_types.filter(e => e !== key)
        : [...f.event_types, key],
    }));
  };

  const kpis = useMemo(() => {
    const active = webhooks.filter(w => w.active).length;
    const totalDeliveries = webhooks.reduce((s, w) => s + w.success_count + w.failure_count, 0);
    const totalSuccess = webhooks.reduce((s, w) => s + w.success_count, 0);
    const successRate = totalDeliveries > 0 ? Math.round((totalSuccess / totalDeliveries) * 100) : 0;
    return { active, totalDeliveries, successRate };
  }, [webhooks]);

  const statusIcon = (s: Delivery['status']) => {
    if (s === 'success') return <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />;
    return <XCircle className="w-3.5 h-3.5 text-red-400" />;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><Webhook className="w-4 h-4 text-primary" />Webhooks por evento</h3>
          <p className="text-xs text-muted-foreground">Conectá con Zapier, Make, n8n o cualquier HTTP endpoint por tipo de evento</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowContract(true)} className="gap-2">
            <FileJson className="w-3.5 h-3.5" /> Contrato
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2" aria-label="Actualizar webhooks">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          {isAdmin && (
            <Button size="sm" className="gradient-gold text-primary-foreground gap-2" onClick={openCreate}>
              <Plus className="w-4 h-4" /> Nuevo webhook
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KPICard label="Activos"          value={kpis.active}                      icon={Webhook}   color="purple" />
        <KPICard label="Entregas totales" value={kpis.totalDeliveries}             icon={BarChart3} color="blue" />
        <KPICard label="Tasa de éxito"    value={`${kpis.successRate}%`}           icon={CheckCircle} color={kpis.successRate >= 95 ? "success" : kpis.successRate >= 80 ? "warning" : "destructive"} />
      </div>

      <div className="flex items-start gap-3 p-3.5 rounded-xl bg-purple-500/5 border border-purple-500/15 text-sm">
        <Info className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
        <p className="text-muted-foreground">
          Cada endpoint recibe POST firmados con HMAC-SHA256, timestamp contra replay,
          identificador de entrega y reintentos auditables. El secret se genera en el
          servidor y se muestra una sola vez.
        </p>
      </div>

      <Dialog open={showContract} onOpenChange={setShowContract}>
        <DialogContent className="sm:max-w-3xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">OpenAPI 3.1</span>
              <span className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">HMAC-SHA256</span>
              <span className="font-mono text-[10px] text-muted-foreground">v2026-08-29</span>
            </div>
            <DialogTitle className="flex items-center gap-2"><FileJson className="w-5 h-5 text-primary" />Contrato OpenAPI de webhooks</DialogTitle>
            <DialogDescription>
              Una integración puede validar el payload sin leer el código de Gestiona ni adivinar qué cambia en un reintento.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl border border-border/70 bg-card p-3">
              <p className="text-xs font-semibold">Evento estable</p>
              <p className="text-[11px] text-muted-foreground mt-1"><code>id</code> se conserva; deduplicá por él.</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-card p-3">
              <p className="text-xs font-semibold">Entrega auditable</p>
              <p className="text-[11px] text-muted-foreground mt-1"><code>delivery_id</code> une el ciclo con su log.</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-card p-3">
              <p className="text-xs font-semibold">Entrega honesta</p>
              <p className="text-[11px] text-muted-foreground mt-1">Al menos una vez, sin orden garantizado.</p>
            </div>
          </div>

          <div className="rounded-xl border border-border/70 bg-muted/35 overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-xs font-semibold">
              <Code2 className="w-3.5 h-3.5 text-primary" />Validación mínima en Node.js
            </div>
            <pre className="overflow-x-auto p-3 text-[11px] leading-relaxed text-foreground/80"><code>{SIGNATURE_EXAMPLE}</code></pre>
          </div>

          <div className="rounded-xl border border-amber-500/20 bg-amber-500/8 p-3 text-xs text-muted-foreground">
            Validá la firma sobre el cuerpo crudo, rechazá timestamps de más de 5 minutos,
            persistí <code>id</code> con unicidad, encolá el trabajo y respondé cualquier <code>2xx</code> rápido.
          </div>

          <DialogFooter className="sm:justify-between gap-2">
            <Button variant="outline" asChild>
              <a href={HUMAN_WEBHOOK_GUIDE} target="_blank" rel="noreferrer">
                Guía de implementación <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </Button>
            <Button asChild>
              <a href={PUBLIC_WEBHOOK_CONTRACT} target="_blank" rel="noreferrer">
                Abrir contrato JSON <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={showForm} onOpenChange={setShowForm}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing ? 'Editar webhook' : 'Nuevo webhook'}</SheetTitle>
            <SheetDescription>Configurá destino, eventos, seguridad y política de reintentos.</SheetDescription>
          </SheetHeader>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Nombre *</label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="bg-muted" placeholder="Ej: Zapier — Nuevas ventas" autoFocus />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Link className="w-3 h-3" />URL del endpoint *</label>
                <Input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} className="bg-muted font-mono text-xs" placeholder="https://hooks.zapier.com/hooks/catch/..." />
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-2 block">Eventos a escuchar *</label>
                <div className="space-y-3">
                  {EVENTS.map(group => (
                    <div key={group.group}>
                      <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide mb-1">{group.group}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {group.events.map(ev => (
                          <button
                            key={ev.key}
                            type="button"
                            onClick={() => toggleEvent(ev.key)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                              form.event_types.includes(ev.key)
                                ? 'bg-purple-500/15 text-purple-400 border-purple-500/30'
                                : 'border-border text-muted-foreground hover:bg-muted/50'
                            }`}
                          >
                            {ev.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {form.event_types.length > 0 && (
                  <p className="text-xs text-purple-400 mt-2">{form.event_types.length} evento{form.event_types.length > 1 ? 's' : ''} seleccionado{form.event_types.length > 1 ? 's' : ''}</p>
                )}
              </div>

              <div className="space-y-2 border-t border-border/50 pt-3">
                <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5"><Shield className="w-3.5 h-3.5" />Firma administrada por Gestiona</p>
                <p className="text-xs text-muted-foreground">
                  La firma llega en <code>X-Gestiona-Signature: t=...,v1=...</code>. Validá el
                  HMAC de <code>timestamp.cuerpo</code> y rechazá timestamps con más de 5 minutos.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Timeout (seg)</label>
                  <Input type="number" min={3} max={15} value={form.timeout_seconds} onChange={e => setForm(f => ({ ...f, timeout_seconds: e.target.value }))} className="bg-muted" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Reintentos</label>
                  <Input type="number" min={0} max={3} value={form.max_retries} onChange={e => setForm(f => ({ ...f, max_retries: e.target.value }))} className="bg-muted" disabled={!form.retry_on_fail} />
                </div>
                <div className="flex flex-col justify-end">
                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} className="w-4 h-4 accent-primary" />
                    Activo
                  </label>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="checkbox" checked={form.retry_on_fail} onChange={e => setForm(f => ({ ...f, retry_on_fail: e.target.checked }))} className="w-4 h-4 accent-primary" />
                Reintentar cuando el endpoint no responda con HTTP 2xx
              </label>
            </div>
            <SheetFooter>
              <Button variant="outline" className="flex-1" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button className="flex-1 gradient-gold text-primary-foreground gap-1.5" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {editing ? 'Guardar' : 'Crear webhook'}
              </Button>
            </SheetFooter>
        </SheetContent>
      </Sheet>

      <Dialog open={!!revealedSecret} onOpenChange={(open) => { if (!open) setRevealedSecret(""); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Shield className="w-5 h-5 text-primary" />Guardá el secret ahora</DialogTitle>
            <DialogDescription>
              Por seguridad no se volverá a mostrar. Si se pierde, podés rotarlo y actualizar tu receptor.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 font-mono text-xs break-all select-all">
            {revealedSecret}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              void navigator.clipboard.writeText(revealedSecret);
              toast.success("Secret copiado");
            }}><Copy className="w-4 h-4 mr-2" />Copiar</Button>
            <Button onClick={() => setRevealedSecret("")}>Ya lo guardé</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : webhooks.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border border-dashed border-border rounded-xl">
          <Webhook className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No hay webhooks configurados.</p>
          <p className="text-sm mt-1">Conectá con Zapier, Make o n8n para automatizar tu negocio.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {webhooks.map(webhook => {
            const isExpanded = expandedId === webhook.id;
            const totalDeliveries = webhook.success_count + webhook.failure_count;
            const successRate = totalDeliveries > 0
              ? Math.round((webhook.success_count / totalDeliveries) * 100)
              : null;
            return (
              <div key={webhook.id} className={`bg-card border rounded-xl overflow-hidden transition-all ${webhook.active ? 'border-border' : 'border-border/40 opacity-60'}`}>
                <div className="p-4 flex items-center gap-3">
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${webhook.active ? 'bg-emerald-400 shadow-[0_0_8px_hsl(152_69%_60%/0.6)]' : 'bg-slate-500'}`} />

                  <button className="flex-1 text-left" onClick={() => { setExpandedId(isExpanded ? null : webhook.id); if (!isExpanded) loadDeliveries(webhook.id); }}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-semibold text-sm">{webhook.name}</p>
                      {!webhook.active && <span className="text-[10px] text-muted-foreground">(inactivo)</span>}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="font-mono text-[10px] truncate max-w-[200px]">{webhook.url}</span>
                      <span>{webhook.event_types.length} eventos</span>
                      {totalDeliveries > 0 && (
                        <span className={successRate !== null && successRate >= 95 ? 'text-emerald-400' : 'text-amber-400'}>
                          {successRate}% éxito
                        </span>
                      )}
                      {webhook.last_fired_at && (
                        <span>{formatDistanceToNow(new Date(webhook.last_fired_at), { locale: es, addSuffix: true })}</span>
                      )}
                    </div>
                  </button>

                  <div className="flex items-center justify-end gap-1 shrink-0 flex-wrap">
                    {isAdmin && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => testWebhook(webhook)} disabled={testing === webhook.id} className="gap-1 text-xs h-8">
                          {testing === webhook.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                          Probar
                        </Button>
                        <button onClick={() => toggleActive(webhook)} aria-label={webhook.active ? "Desactivar webhook" : "Activar webhook"} className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${webhook.active ? 'text-emerald-600 hover:bg-emerald-500/10' : 'text-muted-foreground hover:bg-muted/50'}`}>
                          <Webhook className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => openEdit(webhook)} className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => rotateSecret(webhook)} aria-label="Rotar secret" className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50">
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                        <ConfirmDialog
                          title="¿Eliminar este webhook?"
                          description="Se eliminarán el endpoint y su secret. El historial queda disponible para auditoría."
                          confirmText="Eliminar webhook"
                          onConfirm={() => deleteWebhook(webhook.id)}
                          trigger={<button aria-label="Eliminar webhook" className="w-8 h-8 rounded-lg flex items-center justify-center text-destructive/70 hover:text-destructive hover:bg-destructive/10"><Trash2 className="w-3.5 h-3.5" /></button>}
                        />
                      </>
                    )}
                    <button onClick={() => { setExpandedId(isExpanded ? null : webhook.id); if (!isExpanded) loadDeliveries(webhook.id); }} className="text-muted-foreground/40">
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-border bg-muted/20 p-4 space-y-3">
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Eventos suscritos</p>
                      <div className="flex flex-wrap gap-1.5">
                        {webhook.event_types.map(e => {
                          const ev = ALL_EVENTS.find(x => x.key === e);
                          return (
                            <span key={e} className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400">
                              {ev?.label ?? e}
                            </span>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Log de entregas (últimas 20)</p>
                      {(deliveries[webhook.id] ?? []).length === 0 ? (
                        <p className="text-xs text-muted-foreground/50 italic">Sin entregas registradas. Usá el botón Test para enviar un payload de prueba.</p>
                      ) : (
                        <div className="space-y-1">
                          {(deliveries[webhook.id] ?? []).map(d => (
                            <div key={d.id} className="flex items-center gap-3 text-xs bg-card rounded-lg px-3 py-2">
                              {statusIcon(d.status)}
                              <span className="font-mono text-muted-foreground/60">{d.event_type}</span>
                              <span className="flex-1">{d.status}</span>
                              {d.http_status && (
                                <span className={`${d.http_status < 300 ? 'text-emerald-400' : 'text-red-400'}`}>HTTP {d.http_status}</span>
                              )}
                              {d.attempt > 1 && <span className="text-muted-foreground">{d.attempt} intentos</span>}
                              {d.duration_ms !== null && <span className="text-muted-foreground">{d.duration_ms} ms</span>}
                              <span className="text-muted-foreground/50">
                                {formatDistanceToNow(new Date(d.created_at), { locale: es, addSuffix: true })}
                              </span>
                              {isAdmin && d.status === 'failed' && (
                                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => retryDelivery(d, webhook.id)} disabled={retrying === d.id}>
                                  {retrying === d.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                                  <span className="sr-only">Reintentar entrega</span>
                                </Button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
