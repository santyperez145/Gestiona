import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Key, Plus, Copy, Eye, EyeOff, Trash2, Zap, Globe, Activity,
  CheckCircle2, XCircle, Clock, AlertTriangle, RefreshCcw, Code2, Webhook, Loader2
} from "lucide-react";
import { toast } from "sonner";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";

/* ─────────────────────────── types ─────────────────────────── */
interface APIKey {
  id: string;
  name: string;
  description: string | null;
  key_prefix: string;
  environment: string;
  scopes: string[];
  rate_limit_rpm: number;
  expires_at: string | null;
  last_used_at: string | null;
  request_count: number;
  is_active: boolean;
  created_at: string;
  revoked_at: string | null;
}

interface WebhookAdv {
  id: string;
  name: string;
  url: string;
  secret: string;
  events: string[];
  is_active: boolean;
  retry_count: number;
  timeout_ms: number;
  last_triggered: string | null;
  last_status: number | null;
  success_count: number;
  failure_count: number;
  created_at: string;
}

interface WebhookDelivery {
  id: number;
  webhook_id: string;
  event_type: string;
  status: string;
  attempt_count: number;
  response_code: number | null;
  error_message: string | null;
  created_at: string;
  delivered_at: string | null;
}

/* ─────────────────────────── configs ─────────────────────────── */
const ENVIRONMENTS: Record<string, { label: string; color: string }> = {
  production:  { label: "Producción",   color: "bg-green-500/15 text-green-400 border-green-500/20" },
  sandbox:     { label: "Sandbox",      color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20" },
  development: { label: "Desarrollo",   color: "bg-blue-500/15 text-blue-400 border-blue-500/20" },
};

const ALL_SCOPES = [
  "products:read", "products:write",
  "sales:read", "sales:write",
  "clients:read", "clients:write",
  "expenses:read", "expenses:write",
  "invoices:read", "invoices:write",
  "reports:read",
  "inventory:read", "inventory:write",
  "users:read",
];

const WEBHOOK_EVENTS = [
  "sale.created", "sale.updated", "sale.cancelled",
  "product.created", "product.updated", "product.deleted",
  "client.created", "client.updated",
  "invoice.created", "invoice.paid",
  "expense.created",
  "stock.low", "stock.out",
];

const DELIVERY_STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  delivered: { label: "Entregado",  color: "bg-green-100 text-green-700", icon: <CheckCircle2 className="w-3 h-3" /> },
  failed:    { label: "Fallido",    color: "bg-red-100 text-red-700",     icon: <XCircle className="w-3 h-3" /> },
  pending:   { label: "Pendiente",  color: "bg-yellow-100 text-yellow-700", icon: <Clock className="w-3 h-3" /> },
  retrying:  { label: "Reintentando", color: "bg-orange-100 text-orange-700", icon: <RefreshCcw className="w-3 h-3" /> },
};

const TABS = ["API Keys", "Webhooks", "Entregas", "Documentación"] as const;
type Tab = typeof TABS[number];

/* ─────────────────────────── helpers ─────────────────────────── */
function generateMockKey(env: string): string {
  const prefix = env === "production" ? "sk_live" : env === "sandbox" ? "sk_test" : "sk_dev";
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${rand}`;
}

export default function APIKeysPage() {
  usePageTitle("API & Webhooks");
  const { orgId } = useOrganization();
  const [activeTab, setActiveTab] = useState<Tab>("API Keys");
  const [apiKeys, setApiKeys] = useState<APIKey[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookAdv[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [loading, setLoading] = useState(true);

  /* dialogs */
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [showWebhookDialog, setShowWebhookDialog] = useState(false);
  const [showSecretDialog, setShowSecretDialog] = useState(false);
  const [newKeyValue, setNewKeyValue] = useState("");
  const [editingWebhook, setEditingWebhook] = useState<WebhookAdv | null>(null);
  const [revealedSecrets, setRevealedSecrets] = useState<Set<string>>(new Set());

  /* forms */
  const [keyForm, setKeyForm] = useState({ name: "", description: "", environment: "production", scopes: [] as string[], rate_limit_rpm: "1000", expires_at: "" });
  const [hookForm, setHookForm] = useState({ name: "", url: "", events: [] as string[], retry_count: "3", timeout_ms: "10000", is_active: true });

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const [kr, wr, dr] = await Promise.allSettled([
      supabase.from("api_keys").select("*").eq("org_id", orgId).order("created_at", { ascending: false }),
      supabase.from("webhooks_advanced").select("*").eq("org_id", orgId).order("created_at", { ascending: false }),
      supabase.from("webhook_deliveries").select("*").eq("org_id", orgId).order("created_at", { ascending: false }).limit(100),
    ]);
    if (kr.status === "fulfilled" && kr.value.data) setApiKeys(kr.value.data as APIKey[]);
    if (wr.status === "fulfilled" && wr.value.data) setWebhooks(wr.value.data as WebhookAdv[]);
    if (dr.status === "fulfilled" && dr.value.data) setDeliveries(dr.value.data as WebhookDelivery[]);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  /* ── Create API Key ── */
  async function createKey() {
    if (!orgId || !keyForm.name.trim()) return;
    const fullKey = generateMockKey(keyForm.environment);
    const prefix = fullKey.slice(0, 16) + "…";
    // In production: hash the key server-side. Here we store prefix + hash placeholder.
    const { error } = await supabase.from("api_keys").insert({
      org_id: orgId, name: keyForm.name, description: keyForm.description || null,
      key_prefix: prefix, key_hash: btoa(fullKey), // placeholder; real impl uses bcrypt server-side
      environment: keyForm.environment, scopes: keyForm.scopes,
      rate_limit_rpm: parseInt(keyForm.rate_limit_rpm) || 1000,
      expires_at: keyForm.expires_at || null,
    });
    if (error) { toast.error(error.message); return; }
    setNewKeyValue(fullKey);
    setShowKeyDialog(false);
    setShowSecretDialog(true);
    load();
  }

  async function revokeKey(id: string) {
    await supabase.from("api_keys").update({ is_active: false, revoked_at: new Date().toISOString() }).eq("id", id);
    toast.success("API Key revocada");
    load();
  }

  /* ── Webhooks ── */
  function openNewHook() {
    setEditingWebhook(null);
    setHookForm({ name: "", url: "", events: [], retry_count: "3", timeout_ms: "10000", is_active: true });
    setShowWebhookDialog(true);
  }
  function openEditHook(w: WebhookAdv) {
    setEditingWebhook(w);
    setHookForm({ name: w.name, url: w.url, events: w.events, retry_count: String(w.retry_count), timeout_ms: String(w.timeout_ms), is_active: w.is_active });
    setShowWebhookDialog(true);
  }
  async function saveWebhook() {
    if (!orgId || !hookForm.name.trim() || !hookForm.url.trim()) return;
    const payload = { org_id: orgId, name: hookForm.name, url: hookForm.url, events: hookForm.events, retry_count: parseInt(hookForm.retry_count) || 3, timeout_ms: parseInt(hookForm.timeout_ms) || 10000, is_active: hookForm.is_active };
    if (editingWebhook) {
      const { error } = await supabase.from("webhooks_advanced").update(payload).eq("id", editingWebhook.id);
      if (error) { toast.error(error.message); return; }
    } else {
      const { error } = await supabase.from("webhooks_advanced").insert(payload);
      if (error) { toast.error(error.message); return; }
    }
    toast.success("Webhook guardado");
    setShowWebhookDialog(false);
    load();
  }

  function toggleScope(scope: string) {
    setKeyForm(p => ({ ...p, scopes: p.scopes.includes(scope) ? p.scopes.filter(s => s !== scope) : [...p.scopes, scope] }));
  }
  function toggleEvent(evt: string) {
    setHookForm(p => ({ ...p, events: p.events.includes(evt) ? p.events.filter(e => e !== evt) : [...p.events, evt] }));
  }

  const activeKeys = apiKeys.filter(k => k.is_active).length;
  const totalRequests = apiKeys.reduce((s, k) => s + k.request_count, 0);
  const activeWebhooks = webhooks.filter(w => w.is_active).length;
  const failedDeliveries = deliveries.filter(d => d.status === "failed").length;

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Code2}
        title="API & Webhooks"
        description="Gestión de claves API, webhooks y portal de desarrolladores"
        actions={
          <>
            {activeTab === "API Keys" && <Button size="sm" onClick={() => { setKeyForm({ name: "", description: "", environment: "production", scopes: [], rate_limit_rpm: "1000", expires_at: "" }); setShowKeyDialog(true); }}><Plus className="w-4 h-4 mr-1" /> Crear API Key</Button>}
            {activeTab === "Webhooks" && <Button size="sm" onClick={openNewHook}><Plus className="w-4 h-4 mr-1" /> Nuevo Webhook</Button>}
          </>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Keys activas"      value={activeKeys}                            icon={Key}           color="success" />
        <KPICard label="Requests totales"  value={totalRequests.toLocaleString("es-AR")} icon={Activity}      color="blue" />
        <KPICard label="Webhooks activos"  value={activeWebhooks}                        icon={Webhook}       color="purple" />
        <KPICard label="Entregas fallidas" value={failedDeliveries}                      icon={AlertTriangle} color="destructive" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted rounded-lg p-1 w-fit">
        {TABS.map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === t ? "bg-card shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-7 h-7 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* ── API Keys ── */}
          {activeTab === "API Keys" && (
            <div className="space-y-3 pb-12">
              {apiKeys.map(k => {
                const env = ENVIRONMENTS[k.environment] ?? ENVIRONMENTS.production;
                return (
                  <div key={k.id} className={`bg-card rounded-xl border p-4 flex items-center gap-4 ${!k.is_active ? "opacity-60" : ""}`}>
                    <div className="p-2 bg-muted rounded-lg"><Key className="w-5 h-5 text-muted-foreground" /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-foreground">{k.name}</p>
                        <Badge className={`${env.color} text-xs`}>{env.label}</Badge>
                        {!k.is_active && <Badge className="bg-destructive/15 text-destructive text-xs">Revocada</Badge>}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono text-muted-foreground">{k.key_prefix}</code>
                        <button onClick={() => { navigator.clipboard.writeText(k.key_prefix); toast.success("Prefijo copiado"); }} className="text-muted-foreground hover:text-foreground"><Copy className="w-3.5 h-3.5" /></button>
                      </div>
                      <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                        {k.scopes.slice(0, 4).map(s => <span key={s} className="bg-muted/50 px-1.5 py-0.5 rounded">{s}</span>)}
                        {k.scopes.length > 4 && <span>+{k.scopes.length - 4} más</span>}
                      </div>
                    </div>
                    <div className="text-right text-xs text-muted-foreground shrink-0">
                      <p>{k.request_count.toLocaleString("es-AR")} requests</p>
                      <p>Límite: {k.rate_limit_rpm} rpm</p>
                      {k.last_used_at && <p>Último: {new Date(k.last_used_at).toLocaleDateString("es-AR")}</p>}
                      {k.expires_at && <p className={new Date(k.expires_at) < new Date() ? "text-red-500" : ""}>Expira: {k.expires_at}</p>}
                    </div>
                    {k.is_active && (
                      <Button variant="outline" size="sm" className="text-red-400 border-red-500/30 hover:bg-red-500/10 shrink-0" onClick={() => revokeKey(k.id)}>
                        <XCircle className="w-4 h-4 mr-1" /> Revocar
                      </Button>
                    )}
                  </div>
                );
              })}
              {apiKeys.length === 0 && (
                <div className="text-center py-16 text-muted-foreground">
                  <Key className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">Sin API Keys creadas</p>
                  <p className="text-sm mt-1">Creá tu primera clave para integrar con el API</p>
                </div>
              )}
            </div>
          )}

          {/* ── Webhooks ── */}
          {activeTab === "Webhooks" && (
            <div className="space-y-3 pb-12">
              {webhooks.map(w => {
                const successRate = w.success_count + w.failure_count > 0
                  ? Math.round((w.success_count / (w.success_count + w.failure_count)) * 100) : 100;
                const revealed = revealedSecrets.has(w.id);
                return (
                  <div key={w.id} className={`bg-card rounded-xl border p-4 ${!w.is_active ? "opacity-60" : ""}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-purple-500/10 rounded-lg"><Webhook className="w-5 h-5 text-violet-400" /></div>
                        <div>
                          <p className="font-semibold text-foreground">{w.name}</p>
                          <a href={w.url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-500 hover:underline flex items-center gap-1"><Globe className="w-3 h-3" />{w.url}</a>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch checked={w.is_active} onCheckedChange={async v => { await supabase.from("webhooks_advanced").update({ is_active: v }).eq("id", w.id); load(); }} />
                        <Button variant="ghost" size="sm" onClick={() => openEditHook(w)}><Zap className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="sm" className="text-red-500" onClick={() => supabase.from("webhooks_advanced").delete().eq("id", w.id).then(load)}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    </div>
                    <div className="mt-3 space-y-2">
                      <div className="flex gap-1 flex-wrap">
                        {w.events.map(e => <span key={e} className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded font-mono">{e}</span>)}
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>✅ {w.success_count} exitosos</span>
                        <span>❌ {w.failure_count} fallidos</span>
                        <span className={`font-medium ${successRate >= 95 ? "text-green-600" : successRate >= 80 ? "text-yellow-600" : "text-red-500"}`}>{successRate}% éxito</span>
                        {w.last_triggered && <span>Último: {new Date(w.last_triggered).toLocaleDateString("es-AR")}</span>}
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">Secret:</span>
                        <code className="font-mono bg-muted px-2 py-0.5 rounded text-muted-foreground">
                          {revealed ? w.secret : "••••••••••••••••"}
                        </code>
                        <button onClick={() => setRevealedSecrets(s => { const n = new Set(s); n.has(w.id) ? n.delete(w.id) : n.add(w.id); return n; })} className="text-muted-foreground hover:text-foreground">
                          {revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                        <button onClick={() => { navigator.clipboard.writeText(w.secret); toast.success("Secret copiado"); }} className="text-muted-foreground hover:text-foreground"><Copy className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {webhooks.length === 0 && <div className="text-center py-16 text-muted-foreground"><Webhook className="w-12 h-12 mx-auto mb-3 opacity-30" /><p>Sin webhooks configurados</p></div>}
            </div>
          )}

          {/* ── Entregas ── */}
          {activeTab === "Entregas" && (
            <div className="bg-card rounded-xl border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>{["Fecha","Webhook","Evento","Estado","Intentos","HTTP","Error"].map(h => <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y">
                  {deliveries.map(d => {
                    const wh = webhooks.find(w => w.id === d.webhook_id);
                    const st = DELIVERY_STATUS_CONFIG[d.status] ?? DELIVERY_STATUS_CONFIG.pending;
                    return (
                      <tr key={d.id} className="hover:bg-muted/20">
                        <td className="px-4 py-3 text-muted-foreground text-xs">{new Date(d.created_at).toLocaleString("es-AR")}</td>
                        <td className="px-4 py-3 font-medium text-foreground">{wh?.name ?? "—"}</td>
                        <td className="px-4 py-3 font-mono text-xs text-violet-400">{d.event_type}</td>
                        <td className="px-4 py-3"><Badge className={`${st.color} flex items-center gap-1 text-xs`}>{st.icon}{st.label}</Badge></td>
                        <td className="px-4 py-3 text-muted-foreground">{d.attempt_count}</td>
                        <td className="px-4 py-3">
                          {d.response_code && <span className={`font-mono text-sm ${d.response_code < 300 ? "text-emerald-400" : d.response_code < 500 ? "text-yellow-400" : "text-red-400"}`}>{d.response_code}</span>}
                        </td>
                        <td className="px-4 py-3 text-red-500 text-xs truncate max-w-xs">{d.error_message ?? "—"}</td>
                      </tr>
                    );
                  })}
                  {deliveries.length === 0 && <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">Sin entregas registradas</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Documentación ── */}
          {activeTab === "Documentación" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-card rounded-xl border p-6 space-y-4">
                <h2 className="font-semibold text-foreground flex items-center gap-2"><Code2 className="w-4 h-4" /> Autenticación</h2>
                <p className="text-sm text-muted-foreground">Incluí tu API Key en el header de cada request:</p>
                <pre className="bg-gray-900 text-green-400 rounded-lg p-4 text-xs overflow-auto">{`Authorization: Bearer sk_live_xxxxxxxxxxxxxxxx

# Ejemplo con curl:
curl https://api.gestiona.app/v1/products \\
  -H "Authorization: Bearer sk_live_xxx" \\
  -H "Content-Type: application/json"`}</pre>
              </div>
              <div className="bg-card rounded-xl border p-6 space-y-4">
                <h2 className="font-semibold text-foreground flex items-center gap-2"><Webhook className="w-4 h-4" /> Webhooks</h2>
                <p className="text-sm text-muted-foreground">Validá la firma HMAC-SHA256 en cada entrega:</p>
                <pre className="bg-gray-900 text-blue-300 rounded-lg p-4 text-xs overflow-auto">{`const crypto = require('crypto');

function verifyWebhook(payload, secret, signature) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  return \`sha256=\${expected}\` === signature;
}

// En tu endpoint:
const sig = req.headers['x-gestiona-signature'];
const valid = verifyWebhook(req.body, SECRET, sig);`}</pre>
              </div>
              <div className="bg-card rounded-xl border p-6 space-y-3 lg:col-span-2">
                <h2 className="font-semibold text-foreground">Endpoints disponibles</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[
                    { method: "GET",    path: "/v1/products",     scope: "products:read" },
                    { method: "POST",   path: "/v1/products",     scope: "products:write" },
                    { method: "GET",    path: "/v1/sales",        scope: "sales:read" },
                    { method: "POST",   path: "/v1/sales",        scope: "sales:write" },
                    { method: "GET",    path: "/v1/clients",      scope: "clients:read" },
                    { method: "GET",    path: "/v1/reports/daily",scope: "reports:read" },
                  ].map(ep => (
                    <div key={ep.path} className="flex items-center gap-3 bg-muted/30 rounded-lg px-3 py-2">
                      <Badge className={ep.method === "GET" ? "bg-blue-500/15 text-blue-400" : "bg-emerald-500/15 text-emerald-400"} >{ep.method}</Badge>
                      <code className="text-xs font-mono text-foreground flex-1">{ep.path}</code>
                      <span className="text-xs text-muted-foreground">{ep.scope}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Create Key Dialog ── */}
      <Dialog open={showKeyDialog} onOpenChange={setShowKeyDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Crear API Key</DialogTitle></DialogHeader>
          <div className="space-y-3 pb-12">
            <div><Label>Nombre *</Label><Input value={keyForm.name} onChange={e => setKeyForm(p => ({ ...p, name: e.target.value }))} placeholder="ej. Integración Shopify" /></div>
            <div><Label>Descripción</Label><Input value={keyForm.description} onChange={e => setKeyForm(p => ({ ...p, description: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Entorno</Label>
                <Select value={keyForm.environment} onValueChange={v => setKeyForm(p => ({ ...p, environment: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(ENVIRONMENTS).map(([k,v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Rate limit (req/min)</Label><Input type="number" value={keyForm.rate_limit_rpm} onChange={e => setKeyForm(p => ({ ...p, rate_limit_rpm: e.target.value }))} /></div>
            </div>
            <div><Label>Expira el (vacío = no expira)</Label><Input type="date" value={keyForm.expires_at} onChange={e => setKeyForm(p => ({ ...p, expires_at: e.target.value }))} /></div>
            <div>
              <Label>Permisos (scopes)</Label>
              <div className="grid grid-cols-2 gap-1 mt-2 max-h-48 overflow-y-auto">
                {ALL_SCOPES.map(s => (
                  <label key={s} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/50 rounded px-2 py-1">
                    <input type="checkbox" checked={keyForm.scopes.includes(s)} onChange={() => toggleScope(s)} className="rounded" />
                    <span className="font-mono">{s}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowKeyDialog(false)}>Cancelar</Button>
            <Button onClick={createKey}><Key className="w-4 h-4 mr-1" /> Generar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Show New Key Dialog ── */}
      <Dialog open={showSecretDialog} onOpenChange={setShowSecretDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-green-500" /> API Key creada</DialogTitle></DialogHeader>
          <div className="space-y-3 pb-12">
            <p className="text-sm text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">⚠️ Esta es la única vez que verás la clave completa. Copiala y guardala en un lugar seguro.</p>
            <div className="flex items-center gap-2 bg-zinc-900 rounded-lg px-4 py-3">
              <code className="flex-1 text-emerald-400 text-sm font-mono break-all">{newKeyValue}</code>
              <button onClick={() => { navigator.clipboard.writeText(newKeyValue); toast.success("Clave copiada"); }} className="text-muted-foreground hover:text-foreground shrink-0"><Copy className="w-4 h-4" /></button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setShowSecretDialog(false)}>Entendido, ya la copié</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Webhook Dialog ── */}
      <Dialog open={showWebhookDialog} onOpenChange={setShowWebhookDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editingWebhook ? "Editar Webhook" : "Nuevo Webhook"}</DialogTitle></DialogHeader>
          <div className="space-y-3 pb-12">
            <div><Label>Nombre *</Label><Input value={hookForm.name} onChange={e => setHookForm(p => ({ ...p, name: e.target.value }))} /></div>
            <div><Label>URL *</Label><Input value={hookForm.url} onChange={e => setHookForm(p => ({ ...p, url: e.target.value }))} placeholder="https://mi-servidor.com/webhook" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Reintentos</Label><Input type="number" value={hookForm.retry_count} onChange={e => setHookForm(p => ({ ...p, retry_count: e.target.value }))} /></div>
              <div><Label>Timeout (ms)</Label><Input type="number" value={hookForm.timeout_ms} onChange={e => setHookForm(p => ({ ...p, timeout_ms: e.target.value }))} /></div>
            </div>
            <div>
              <Label>Eventos</Label>
              <div className="grid grid-cols-2 gap-1 mt-2 max-h-52 overflow-y-auto">
                {WEBHOOK_EVENTS.map(e => (
                  <label key={e} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/50 rounded px-2 py-1">
                    <input type="checkbox" checked={hookForm.events.includes(e)} onChange={() => toggleEvent(e)} className="rounded" />
                    <span className="font-mono">{e}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3"><Switch checked={hookForm.is_active} onCheckedChange={v => setHookForm(p => ({ ...p, is_active: v }))} /><Label>Activo</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowWebhookDialog(false)}>Cancelar</Button>
            <Button onClick={saveWebhook}>{editingWebhook ? "Guardar" : "Crear"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
