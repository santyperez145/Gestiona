/**
 * ApiKeysManager — Full multi-key API management component.
 *
 * Uses the `org_api_keys` table (key stored as SHA-256 hash for security).
 * The raw key is shown ONCE on creation and never stored in plain text.
 *
 * Features:
 *   - Create named keys (e.g., "Shopify integration", "Mobile app")
 *   - View key metadata: label, created_at, last_used_at, use_count
 *   - Revoke individual keys
 *   - Copy key prefix mask (gst_<first8chars>...)
 *   - One-time reveal dialog on key creation
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Key, Plus, Trash2, Copy, CheckCircle2, Clock, RefreshCw, Eye, AlertTriangle } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface ApiKey {
  id: string;
  label: string | null;
  key_hash: string;
  created_at: string;
  last_used_at: string | null;
  use_count: number;
  revoked: boolean;
  revoked_at: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a cryptographically random API key: gst_live_<32 hex chars> */
function generateApiKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  return `gst_live_${hex}`;
}

/** SHA-256 hash of the key (stored in DB) */
async function hashKey(key: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(key);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function maskKey(key: string): string {
  if (key.length <= 12) return key.slice(0, 6) + "••••••••";
  return key.slice(0, 12) + "••••••••••••••••";
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function ApiKeysManager() {
  const { activeOrg } = useOrg();
  const { user } = useAuth();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);

  // Create key flow
  const [createOpen, setCreateOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);

  // One-time reveal
  const [revealKey, setRevealKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!activeOrg) return;
    const { data } = await supabase
      .from("org_api_keys")
      .select("*")
      .eq("org_id", activeOrg.id)
      .order("created_at", { ascending: false });
    setKeys((data || []) as ApiKey[]);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!activeOrg || !user) return;
    if (!newLabel.trim()) { toast.error("Ingresá un nombre para la key"); return; }
    setCreating(true);
    try {
      const raw = generateApiKey();
      const hash = await hashKey(raw);
      const { error } = await supabase.from("org_api_keys").insert({
        org_id: activeOrg.id,
        label: newLabel.trim(),
        key_hash: hash,
      });
      if (error) throw error;
      setRevealKey(raw);
      setCreateOpen(false);
      setNewLabel("");
      await load();
      toast.success("API Key creada");
    } catch (e: any) {
      toast.error("Error al crear key: " + e.message);
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string, label: string | null) => {
    if (!confirm(`¿Revocar la key "${label ?? "Sin nombre"}"? Esta acción no se puede deshacer.`)) return;
    const { error } = await supabase.from("org_api_keys").update({
      revoked: true,
      revoked_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) { toast.error("Error al revocar"); return; }
    toast.success("Key revocada");
    await load();
  };

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Copiado al portapapeles");
  };

  const activeKeys  = keys.filter(k => !k.revoked);
  const revokedKeys = keys.filter(k => k.revoked);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Key className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">API Keys ({activeKeys.length} activas)</span>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={load}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button size="sm" className="gradient-gold text-primary-foreground font-semibold text-xs h-8" onClick={() => setCreateOpen(true)}>
            <Plus className="w-3.5 h-3.5 mr-1" />Nueva key
          </Button>
        </div>
      </div>

      {/* Keys list */}
      {loading ? (
        <div className="text-center py-8 text-muted-foreground text-sm">Cargando…</div>
      ) : activeKeys.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm rounded-lg border border-dashed border-border">
          <Key className="w-8 h-8 mx-auto mb-2 opacity-20" />
          <p>Sin API Keys activas</p>
          <p className="text-xs mt-1">Creá una para integrarte con sistemas externos</p>
        </div>
      ) : (
        <div className="space-y-2">
          {activeKeys.map(k => (
            <div key={k.id} className="flex items-start justify-between gap-3 bg-muted/20 border border-border/50 rounded-lg px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="text-sm font-medium truncate">{k.label ?? "Sin nombre"}</span>
                </div>
                <div className="font-mono text-xs text-muted-foreground">
                  {maskKey("gst_live_" + k.key_hash.slice(0, 8))}
                </div>
                <div className="flex gap-4 text-[10px] text-muted-foreground mt-1">
                  <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5" />{fmtDate(k.created_at)}</span>
                  {k.last_used_at && <span>Últ. uso: {fmtDate(k.last_used_at)}</span>}
                  {k.use_count > 0 && <span>{k.use_count.toLocaleString("es-AR")} solicitudes</span>}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                onClick={() => handleRevoke(k.id, k.label)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Revoked keys (collapsible) */}
      {revokedKeys.length > 0 && (
        <details className="group">
          <summary className="text-xs text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors">
            {revokedKeys.length} keys revocadas
          </summary>
          <div className="mt-2 space-y-1.5">
            {revokedKeys.map(k => (
              <div key={k.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/10 border border-border/30 opacity-50">
                <AlertTriangle className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-muted-foreground line-through truncate">{k.label ?? "Sin nombre"}</span>
                  <p className="text-[10px] text-muted-foreground/60">Revocada {fmtDate(k.revoked_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Create key dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-[hsl(228_24%_7%)] border-border/60 max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <Key className="w-4 h-4 text-primary" />Nueva API Key
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Nombre / uso de la key *</label>
              <Input
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                placeholder="Ej: Integración Shopify, App móvil…"
                onKeyDown={e => e.key === "Enter" && handleCreate()}
              />
            </div>
            <p className="text-xs text-muted-foreground bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
              ⚠️ La key solo se mostrará una vez. Guardala en un lugar seguro.
            </p>
            <div className="flex gap-2">
              <Button className="flex-1 gradient-gold text-primary-foreground font-semibold" onClick={handleCreate} disabled={creating || !newLabel.trim()}>
                {creating ? "Generando…" : "Generar key"}
              </Button>
              <Button variant="outline" onClick={() => { setCreateOpen(false); setNewLabel(""); }}>
                Cancelar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* One-time key reveal dialog */}
      <Dialog open={!!revealKey} onOpenChange={open => { if (!open) setRevealKey(null); }}>
        <DialogContent className="bg-[hsl(228_24%_7%)] border-border/60 max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <Eye className="w-4 h-4 text-emerald-400" />Tu nueva API Key
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4 space-y-3">
              <p className="text-xs text-emerald-400 font-medium">
                ✅ Copiá esta key ahora. No se volverá a mostrar.
              </p>
              <div className="flex gap-2 items-center">
                <code className="flex-1 text-xs font-mono bg-muted/30 rounded-lg px-3 py-2 break-all select-all text-foreground">
                  {revealKey}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  className={`shrink-0 ${copied ? "border-emerald-500/50 text-emerald-400" : ""}`}
                  onClick={() => revealKey && handleCopy(revealKey)}
                >
                  {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Usala en el header <code className="bg-muted/30 px-1 rounded">Authorization: Bearer {"<key>"}</code> de tus llamadas a la API.
            </p>
            <Button className="w-full" variant="outline" onClick={() => setRevealKey(null)}>
              Entendido, ya la copié
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
