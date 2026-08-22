/**
 * AdvancedWebhooksPanel — multi-event outbound webhooks with delivery log.
 *
 * Ported from the former standalone WebhooksPage (`/webhooks`, now redirected
 * to `/integraciones?tab=webhooks`). Uses the `webhook_configs` table — a
 * richer, event-catalog-driven system than the single simple webhook stored
 * on `settings` (also available on this page, in "Webhook simple").
 */
import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { useUserRole } from "@/lib/useUserRole";
import { toast } from "sonner";
import {
  Webhook, Plus, X, Save, Trash2, Edit2, CheckCircle, XCircle,
  RefreshCw, Play, ChevronDown, ChevronUp, Shield, BarChart3, Info, Loader2, Link, Clock,
} from "lucide-react";
import KPICard from "@/components/shared/KPICard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

// ── Available events ─────────────────────────────────────────────────────────
const EVENTS = [
  { group: 'Ventas', events: [
    { key: 'sale.created', label: 'Nueva venta' },
    { key: 'sale.refunded', label: 'Venta devuelta' },
    { key: 'invoice.generated', label: 'Factura generada' },
  ]},
  { group: 'Clientes', events: [
    { key: 'customer.created', label: 'Cliente creado' },
    { key: 'customer.updated', label: 'Cliente actualizado' },
    { key: 'customer.churn_risk', label: 'Riesgo de churn detectado' },
  ]},
  { group: 'Pipeline CRM', events: [
    { key: 'deal.created', label: 'Deal creado' },
    { key: 'deal.stage_changed', label: 'Deal cambió de etapa' },
    { key: 'deal.won', label: 'Deal ganado' },
    { key: 'deal.lost', label: 'Deal perdido' },
  ]},
  { group: 'Soporte', events: [
    { key: 'ticket.created', label: 'Ticket creado' },
    { key: 'ticket.sla_breach', label: 'SLA vencido' },
    { key: 'ticket.resolved', label: 'Ticket resuelto' },
  ]},
  { group: 'Inventario', events: [
    { key: 'stock.low', label: 'Stock bajo' },
    { key: 'stock.depleted', label: 'Sin stock' },
    { key: 'transfer.completed', label: 'Transferencia completada' },
  ]},
  { group: 'Pagos', events: [
    { key: 'payment.received', label: 'Pago recibido' },
    { key: 'debt.overdue', label: 'Deuda vencida' },
    { key: 'installment.due', label: 'Cuota vence hoy' },
  ]},
];

const ALL_EVENTS = EVENTS.flatMap(g => g.events);

const SAMPLE_PAYLOADS: Record<string, object> = {
  'sale.created': {
    event: 'sale.created', timestamp: new Date().toISOString(),
    data: { id: 'sale_abc123', total_ars: 15000, customer: 'Juan García', items: 3, seller: 'María López' }
  },
  'customer.created': {
    event: 'customer.created', timestamp: new Date().toISOString(),
    data: { id: 'cust_xyz456', name: 'Carlos Rodríguez', email: 'carlos@example.com', phone: '+54 9 11 1234-5678' }
  },
  'deal.won': {
    event: 'deal.won', timestamp: new Date().toISOString(),
    data: { id: 'deal_789', title: 'Acuerdo Marco 2026', amount: 250000, customer: 'Empresa ABC', reason: 'Precio competitivo' }
  },
  'ticket.created': {
    event: 'ticket.created', timestamp: new Date().toISOString(),
    data: { id: 'SP-20260523-0042', title: 'Error en facturación', priority: 'high', customer: 'Pedro Gómez' }
  },
  'stock.low': {
    event: 'stock.low', timestamp: new Date().toISOString(),
    data: { product_id: 'prod_001', name: 'Perfume X', stock: 3, threshold: 5 }
  },
};

interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  event_types: string[];
  active: boolean;
  secret_header: string | null;
  secret_value: string | null;
  retry_on_fail: boolean;
  max_retries: number;
  timeout_seconds: number;
  last_triggered_at: string | null;
  total_deliveries: number;
  success_count: number;
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
  delivered_at: string | null;
  created_at: string;
}

const emptyForm = () => ({
  name: '', url: 'https://', event_types: [] as string[],
  active: true, secret_header: '', secret_value: '',
  retry_on_fail: true, max_retries: '3', timeout_seconds: '10',
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
  const [testEvent, setTestEvent] = useState('sale.created');

  const load = async () => {
    if (!activeOrg?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("webhook_configs")
        .select("*")
        .eq("org_id", activeOrg.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setWebhooks((data ?? []) as unknown as WebhookConfig[]);
    } catch (e: any) {
      toast.error("Error: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadDeliveries = async (webhookId: string) => {
    if (deliveries[webhookId]) return;
    // `webhook_deliveries` no referencia el config: se correlaciona por URL.
    const url = webhooks.find(w => w.id === webhookId)?.url;
    if (!url) return;
    const { data } = await supabase
      .from("webhook_deliveries")
      .select("id, event, delivered, last_response_status, attempt_count, delivered_at, created_at")
      .eq("webhook_url", url)
      .order("created_at", { ascending: false })
      .limit(20);
    if (data) {
      setDeliveries(prev => ({
        ...prev,
        [webhookId]: data.map(d => ({
          id: d.id,
          event_type: d.event,
          status: d.delivered ? 'success' : 'failed',
          http_status: d.last_response_status,
          attempt: d.attempt_count,
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
      secret_header: w.secret_header ?? '',
      secret_value: w.secret_value ?? '',
      retry_on_fail: w.retry_on_fail,
      max_retries: w.max_retries.toString(),
      timeout_seconds: w.timeout_seconds.toString(),
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error("El nombre es obligatorio"); return; }
    if (!form.url.startsWith('http')) { toast.error("La URL debe comenzar con http:// o https://"); return; }
    if (form.event_types.length === 0) { toast.error("Seleccioná al menos un evento"); return; }
    if (!activeOrg?.id) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        url: form.url.trim(),
        event_types: form.event_types,
        active: form.active,
        secret_header: form.secret_header.trim() || null,
        secret_value: form.secret_value.trim() || null,
        retry_on_fail: form.retry_on_fail,
        max_retries: parseInt(form.max_retries) || 3,
        timeout_seconds: parseInt(form.timeout_seconds) || 10,
      };
      if (editing) {
        const { error } = await supabase.from("webhook_configs").update(payload).eq("id", editing.id);
        if (error) throw error;
        toast.success("Webhook actualizado");
      } else {
        const { error } = await supabase.from("webhook_configs").insert({ ...payload, org_id: activeOrg.id });
        if (error) throw error;
        toast.success("Webhook creado");
      }
      setShowForm(false);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteWebhook = async (id: string) => {
    if (!confirm("¿Eliminar este webhook?")) return;
    await supabase.from("webhook_configs").delete().eq("id", id);
    load();
    toast.success("Webhook eliminado");
  };

  const toggleActive = async (w: WebhookConfig) => {
    await supabase.from("webhook_configs").update({ active: !w.active }).eq("id", w.id);
    load();
    toast.success(w.active ? "Webhook desactivado" : "Webhook activado");
  };

  const testWebhook = async (webhook: WebhookConfig) => {
    setTesting(webhook.id);
    const payload = SAMPLE_PAYLOADS[testEvent] || { event: testEvent, timestamp: new Date().toISOString(), data: {} };
    const start = Date.now();
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Gestiona-Event': testEvent };
      if (webhook.secret_header && webhook.secret_value) {
        headers[webhook.secret_header] = webhook.secret_value;
      }
      const res = await fetch(webhook.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(webhook.timeout_seconds * 1000),
      });
      const ms = Date.now() - start;
      await supabase.from("webhook_deliveries").insert({
        org_id: activeOrg!.id,
        webhook_url: webhook.url,
        event: testEvent,
        payload: payload as any,
        delivered: res.ok,
        last_response_status: res.status,
        attempt_count: 1,
        delivered_at: res.ok ? new Date().toISOString() : null,
      });
      if (res.ok) {
        toast.success(`✅ Test exitoso (${res.status}) en ${ms}ms`);
      } else {
        toast.error(`❌ HTTP ${res.status} en ${ms}ms`);
      }
      setDeliveries(prev => { const copy = { ...prev }; delete copy[webhook.id]; return copy; });
      loadDeliveries(webhook.id);
      load();
    } catch (e: any) {
      const ms = Date.now() - start;
      await supabase.from("webhook_deliveries").insert({
        org_id: activeOrg!.id,
        webhook_url: webhook.url,
        event: testEvent,
        payload: payload as any,
        delivered: false,
        attempt_count: 1,
        last_response_body: String(e?.message ?? '').slice(0, 2000),
      });
      toast.error(`Error de conexión: ${e.message}`);
    } finally {
      setTesting(null);
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
    const totalDeliveries = webhooks.reduce((s, w) => s + w.total_deliveries, 0);
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
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          {isAdmin && (
            <Button size="sm" className="gradient-gold text-primary-foreground gap-2" onClick={openCreate}>
              <Plus className="w-4 h-4" /> Nuevo webhook
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <KPICard label="Activos"          value={kpis.active}                      icon={Webhook}   color="purple" />
        <KPICard label="Entregas totales" value={kpis.totalDeliveries}             icon={BarChart3} color="blue" />
        <KPICard label="Tasa de éxito"    value={`${kpis.successRate}%`}           icon={CheckCircle} color={kpis.successRate >= 95 ? "success" : kpis.successRate >= 80 ? "warning" : "destructive"} />
      </div>

      <div className="flex items-start gap-3 p-3.5 rounded-xl bg-purple-500/5 border border-purple-500/15 text-sm">
        <Info className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
        <p className="text-muted-foreground">
          Los webhooks envían un HTTP POST a tu URL cuando ocurren eventos en Gestiona.
          Usá Zapier (<code className="text-purple-300">zapier.com/hooks/catch</code>), Make,
          n8n, o tu propio servidor para recibir y procesar los datos.
        </p>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-card border border-border/60 rounded-xl w-full max-w-xl shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="font-display font-bold">{editing ? 'Editar webhook' : 'Nuevo webhook'}</h2>
              <button onClick={() => setShowForm(false)}><X className="w-4 h-4 text-muted-foreground" /></button>
            </div>
            <div className="px-5 py-4 space-y-4">
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
                <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5"><Shield className="w-3.5 h-3.5" />Seguridad (opcional)</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Nombre del header</label>
                    <Input value={form.secret_header} onChange={e => setForm(f => ({ ...f, secret_header: e.target.value }))} className="bg-muted text-xs" placeholder="X-Gestiona-Secret" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Valor del secret</label>
                    <Input value={form.secret_value} onChange={e => setForm(f => ({ ...f, secret_value: e.target.value }))} className="bg-muted text-xs" type="password" placeholder="tu-secret-aqui" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Timeout (seg)</label>
                  <Input type="number" value={form.timeout_seconds} onChange={e => setForm(f => ({ ...f, timeout_seconds: e.target.value }))} className="bg-muted" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Reintentos</label>
                  <Input type="number" value={form.max_retries} onChange={e => setForm(f => ({ ...f, max_retries: e.target.value }))} className="bg-muted" />
                </div>
                <div className="flex flex-col justify-end">
                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} className="w-4 h-4 accent-primary" />
                    Activo
                  </label>
                </div>
              </div>
            </div>
            <div className="flex gap-2 px-5 pb-5">
              <Button variant="outline" className="flex-1" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button className="flex-1 gradient-gold text-primary-foreground gap-1.5" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {editing ? 'Guardar' : 'Crear webhook'}
              </Button>
            </div>
          </div>
        </div>
      )}

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
            const successRate = webhook.total_deliveries > 0
              ? Math.round((webhook.success_count / webhook.total_deliveries) * 100)
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
                      {webhook.total_deliveries > 0 && (
                        <span className={successRate !== null && successRate >= 95 ? 'text-emerald-400' : 'text-amber-400'}>
                          {successRate}% éxito
                        </span>
                      )}
                      {webhook.last_triggered_at && (
                        <span>{formatDistanceToNow(new Date(webhook.last_triggered_at), { locale: es, addSuffix: true })}</span>
                      )}
                    </div>
                  </button>

                  <div className="flex items-center gap-1 shrink-0">
                    <Select value={testEvent} onValueChange={setTestEvent}>
                      <SelectTrigger className="h-7 w-[132px] text-[10px]" aria-label="Evento para probar el webhook" onClick={event => event.stopPropagation()}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ALL_EVENTS.map(event => <SelectItem key={event.key} value={event.key}>{event.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="outline" onClick={() => testWebhook(webhook)} disabled={testing === webhook.id} className="gap-1 text-xs h-7">
                      {testing === webhook.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                      Test
                    </Button>
                    <button onClick={() => toggleActive(webhook)} className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${webhook.active ? 'text-emerald-400 hover:bg-emerald-500/10' : 'text-muted-foreground hover:bg-muted/50'}`}>
                      <Webhook className="w-3.5 h-3.5" />
                    </button>
                    {isAdmin && (
                      <>
                        <button onClick={() => openEdit(webhook)} className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => deleteWebhook(webhook.id)} className="w-7 h-7 rounded-lg flex items-center justify-center text-destructive/50 hover:text-destructive hover:bg-destructive/8">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
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
                              <span className="text-muted-foreground/50">
                                {formatDistanceToNow(new Date(d.created_at), { locale: es, addSuffix: true })}
                              </span>
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
