/**
 * AdvancedApiKeysPanel — scoped, environment-aware API key management.
 *
 * Ported from the former standalone APIKeysPage (`/api-keys`, now redirected
 * to `/integraciones?tab=apikeys`). Uses the `api_keys` table (scopes,
 * environments, rate limits, expiry) — a separate, more advanced system than
 * the simple single-key / `org_api_keys` tools also available on this page.
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Key, Plus, Copy, Activity, CheckCircle2, XCircle, Code2,
} from "lucide-react";
import { toast } from "sonner";
import KPICard from "@/components/shared/KPICard";

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

function generateMockKey(env: string): string {
  const prefix = env === "production" ? "sk_live" : env === "sandbox" ? "sk_test" : "sk_dev";
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${rand}`;
}

export default function AdvancedApiKeysPanel() {
  const { orgId } = useOrganization();
  const [apiKeys, setApiKeys] = useState<APIKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [showSecretDialog, setShowSecretDialog] = useState(false);
  const [newKeyValue, setNewKeyValue] = useState("");
  const [keyForm, setKeyForm] = useState({ name: "", description: "", environment: "production", scopes: [] as string[], rate_limit_rpm: "1000", expires_at: "" });

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const { data } = await supabase.from("api_keys").select("*").eq("org_id", orgId).order("created_at", { ascending: false });
    if (data) setApiKeys(data as unknown as APIKey[]);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  async function createKey() {
    if (!orgId || !keyForm.name.trim()) return;
    const fullKey = generateMockKey(keyForm.environment);
    const prefix = fullKey.slice(0, 16) + "…";
    const { error } = await supabase.from("api_keys").insert({
      org_id: orgId, name: keyForm.name, description: keyForm.description || null,
      key_prefix: prefix, key_hash: btoa(fullKey),
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

  function toggleScope(scope: string) {
    setKeyForm(p => ({ ...p, scopes: p.scopes.includes(scope) ? p.scopes.filter(s => s !== scope) : [...p.scopes, scope] }));
  }

  const activeKeys = apiKeys.filter(k => k.is_active).length;
  const totalRequests = apiKeys.reduce((s, k) => s + k.request_count, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><Code2 className="w-4 h-4 text-primary" />API Keys avanzadas</h3>
          <p className="text-xs text-muted-foreground">Claves con permisos (scopes), entornos y rate limiting</p>
        </div>
        <Button size="sm" onClick={() => { setKeyForm({ name: "", description: "", environment: "production", scopes: [], rate_limit_rpm: "1000", expires_at: "" }); setShowKeyDialog(true); }}>
          <Plus className="w-4 h-4 mr-1" /> Crear API Key
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Keys activas"     value={activeKeys}                            icon={Key}      color="success" />
        <KPICard label="Requests totales" value={totalRequests.toLocaleString("es-AR")} icon={Activity} color="blue" />
      </div>

      {loading ? (
        <div className="flex justify-center py-10 text-muted-foreground text-sm">Cargando…</div>
      ) : (
        <div className="space-y-3">
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
            <div className="text-center py-12 text-muted-foreground border border-dashed border-border rounded-xl">
              <Key className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Sin API Keys avanzadas creadas</p>
              <p className="text-sm mt-1">Creá una con scopes y rate limit para integraciones con permisos acotados</p>
            </div>
          )}
        </div>
      )}

      {/* ── Create Key Dialog ── */}
      <Dialog open={showKeyDialog} onOpenChange={setShowKeyDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Crear API Key</DialogTitle></DialogHeader>
          <div className="space-y-3">
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
          <div className="space-y-3">
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
    </div>
  );
}
