import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Server, CheckCircle2, XCircle, AlertCircle, RefreshCw,
  KeyRound, Activity, TrendingUp, AlertTriangle,
  ExternalLink, Shield, Zap,
} from "lucide-react";

/**
 * System health tab for the platform admin.
 * Shows what's configured and what's missing — read-only for security.
 * Actual secret values are never exposed to the client.
 */
interface SecretStatus {
  name: string;
  required: boolean;
  category: "core" | "ai" | "email" | "payments" | "integrations" | "whatsapp";
  description: string;
  configured: boolean | null; // null = unknown
}

interface FunctionStat {
  name: string;
  invocations24h: number;
  errors24h: number;
  status: "ok" | "warning" | "error" | "unknown";
}

const EXPECTED_SECRETS: Omit<SecretStatus, "configured">[] = [
  // Always auto-injected — no action needed
  { name: "SUPABASE_URL", required: true, category: "core", description: "Inyectado automáticamente por Supabase" },
  { name: "SUPABASE_ANON_KEY", required: true, category: "core", description: "Inyectado automáticamente por Supabase" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", required: true, category: "core", description: "Inyectado automáticamente por Supabase" },

  // Required for core functionality
  { name: "ANTHROPIC_API_KEY", required: true, category: "ai", description: "Habilita Chat IA, predicciones, descripciones automáticas" },
  { name: "RESEND_API_KEY", required: true, category: "email", description: "Envía emails (facturas, campañas, recuperación de contraseña)" },
  { name: "FROM_EMAIL", required: true, category: "email", description: "Dirección remitente verificada en Resend" },

  // Payments
  { name: "STRIPE_SECRET_KEY", required: false, category: "payments", description: "Cobros de suscripciones del SaaS" },
  { name: "STRIPE_WEBHOOK_SECRET", required: false, category: "payments", description: "Verifica webhooks de Stripe" },
  { name: "MP_WEBHOOK_SECRET", required: false, category: "payments", description: "Verifica webhooks de Mercado Pago" },

  // Integrations
  { name: "TIENDANUBE_CLIENT_SECRET", required: false, category: "integrations", description: "Verifica webhooks de Tiendanube" },

  // WhatsApp (optional)
  { name: "TWILIO_ACCOUNT_SID", required: false, category: "whatsapp", description: "Mensajes de WhatsApp en automatizaciones" },
  { name: "TWILIO_AUTH_TOKEN", required: false, category: "whatsapp", description: "Auth de Twilio" },
  { name: "TWILIO_WHATSAPP_FROM", required: false, category: "whatsapp", description: "Número Twilio (whatsapp:+1...)" },
];

const CATEGORY_META: Record<SecretStatus["category"], { label: string; icon: typeof KeyRound; color: string }> = {
  core: { label: "Sistema", icon: Server, color: "text-slate-400" },
  ai: { label: "Inteligencia Artificial", icon: Zap, color: "text-violet-400" },
  email: { label: "Emails", icon: Activity, color: "text-blue-400" },
  payments: { label: "Pagos", icon: KeyRound, color: "text-emerald-400" },
  integrations: { label: "Integraciones", icon: Shield, color: "text-amber-400" },
  whatsapp: { label: "WhatsApp", icon: Activity, color: "text-green-400" },
};

export default function SystemHealthTab() {
  const [secrets, setSecrets] = useState<SecretStatus[]>(EXPECTED_SECRETS.map(s => ({ ...s, configured: null })));
  const [functionStats, setFunctionStats] = useState<FunctionStat[]>([]);
  const [errorCount24h, setErrorCount24h] = useState(0);
  const [loading, setLoading] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const check = useCallback(async () => {
    setLoading(true);

    // Ask the backend which secrets are configured (returns booleans only — never the values)
    try {
      const { data, error } = await supabase.functions.invoke("platform-admin-action", {
        body: { action: "checkSecrets" },
      });
      if (!error && data?.secrets) {
        setSecrets(EXPECTED_SECRETS.map(s => ({
          ...s,
          configured: data.secrets[s.name] === true,
        })));
      }
    } catch {
      // backend doesn't support this action yet — leave as unknown
    }

    // Get edge function activity from integration_logs
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: logs } = await supabase
      .from("integration_logs")
      .select("integration, status")
      .gte("created_at", since);

    if (logs) {
      const grouped: Record<string, { invocations: number; errors: number }> = {};
      for (const l of logs) {
        if (!grouped[l.integration]) grouped[l.integration] = { invocations: 0, errors: 0 };
        grouped[l.integration].invocations++;
        if (l.status === "error") grouped[l.integration].errors++;
      }
      const stats: FunctionStat[] = Object.entries(grouped).map(([name, s]) => ({
        name,
        invocations24h: s.invocations,
        errors24h: s.errors,
        status: s.errors > 0 ? (s.errors / s.invocations > 0.1 ? "error" : "warning") : "ok",
      }));
      setFunctionStats(stats.sort((a, b) => b.invocations24h - a.invocations24h));
      setErrorCount24h(stats.reduce((acc, s) => acc + s.errors24h, 0));
    }

    setLastChecked(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { check(); }, [check]);

  const byCategory = secrets.reduce((acc, s) => {
    (acc[s.category] = acc[s.category] || []).push(s);
    return acc;
  }, {} as Record<string, SecretStatus[]>);

  const configuredCount = secrets.filter(s => s.configured === true).length;
  const requiredMissing = secrets.filter(s => s.required && s.configured === false).length;

  return (
    <div className="space-y-5">
      {/* Header with refresh + summary */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 justify-between">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Server className="w-4 h-4 text-primary" /> Estado del sistema
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configuración de la plataforma y salud de los servicios.
            {lastChecked && <span className="ml-2">Última verificación: {lastChecked.toLocaleTimeString("es-AR")}</span>}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={check} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Re-verificar
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground uppercase tracking-wide">Secretos config.</span>
            <KeyRound className="w-4 h-4 text-primary" />
          </div>
          <div className="text-2xl font-display font-bold">{configuredCount} / {secrets.length}</div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {requiredMissing > 0 ? (
              <span className="text-red-400">{requiredMissing} requeridos faltan</span>
            ) : (
              <span className="text-green-400">✓ Todos los requeridos OK</span>
            )}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground uppercase tracking-wide">Errores 24h</span>
            <AlertTriangle className={`w-4 h-4 ${errorCount24h > 0 ? "text-red-400" : "text-muted-foreground"}`} />
          </div>
          <div className="text-2xl font-display font-bold">{errorCount24h}</div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {errorCount24h === 0 ? "Sin errores recientes" : "Revisar logs"}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground uppercase tracking-wide">Actividad 24h</span>
            <TrendingUp className="w-4 h-4 text-primary" />
          </div>
          <div className="text-2xl font-display font-bold">
            {functionStats.reduce((acc, f) => acc + f.invocations24h, 0)}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">invocaciones registradas</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground uppercase tracking-wide">Servicios activos</span>
            <Activity className="w-4 h-4 text-green-400" />
          </div>
          <div className="text-2xl font-display font-bold">{functionStats.filter(f => f.status === "ok").length}</div>
          <p className="text-xs text-muted-foreground mt-0.5">de {functionStats.length} con logs</p>
        </div>
      </div>

      {/* Required missing alert */}
      {requiredMissing > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/5 border border-red-500/20">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-400">Faltan {requiredMissing} secretos requeridos</p>
            <p className="text-xs text-muted-foreground mt-1">
              La plataforma funcionará parcialmente hasta que configures estos secretos en{" "}
              <a
                href="https://supabase.com/dashboard/project/hummeopatkniwkyrrhwc/settings/functions"
                target="_blank" rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-0.5"
              >
                Supabase → Edge Functions → Secrets <ExternalLink className="w-3 h-3" />
              </a>
            </p>
          </div>
        </div>
      )}

      {/* Secrets by category */}
      <div className="grid gap-4 lg:grid-cols-2">
        {Object.entries(byCategory).map(([cat, items]) => {
          const meta = CATEGORY_META[cat as SecretStatus["category"]];
          const Icon = meta.icon;
          return (
            <div key={cat} className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
                <Icon className={`w-4 h-4 ${meta.color}`} />
                <span className="text-sm font-semibold">{meta.label}</span>
                <Badge variant="outline" className="ml-auto text-[10px] h-4 px-1.5">
                  {items.filter(i => i.configured === true).length} / {items.length}
                </Badge>
              </div>
              <div className="divide-y divide-border/40">
                {items.map(s => (
                  <div key={s.name} className="px-4 py-2.5 flex items-start gap-3">
                    {s.configured === true ? (
                      <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
                    ) : s.configured === false ? (
                      s.required
                        ? <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                        : <AlertCircle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
                    ) : (
                      <div className="w-4 h-4 rounded-full bg-muted-foreground/20 shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="text-xs font-mono font-semibold">{s.name}</code>
                        {s.required && (
                          <Badge variant="outline" className="text-[9px] h-3.5 px-1 border-red-500/30 text-red-400">Requerido</Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{s.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Function activity */}
      {functionStats.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold">Actividad de servicios (24h)</span>
          </div>
          <div className="divide-y divide-border/40">
            {functionStats.map(f => (
              <div key={f.name} className="px-4 py-2.5 flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full shrink-0 ${
                  f.status === "ok" ? "bg-green-400"
                  : f.status === "warning" ? "bg-yellow-400"
                  : f.status === "error" ? "bg-red-400 animate-pulse"
                  : "bg-muted-foreground/30"
                }`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium capitalize">{f.name.replace(/_/g, " ")}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-mono">{f.invocations24h.toLocaleString()}</p>
                  {f.errors24h > 0 && (
                    <p className="text-[10px] text-red-400">{f.errors24h} error{f.errors24h !== 1 ? "es" : ""}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick links */}
      <div className="bg-muted/20 border border-border/50 rounded-xl p-4 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Accesos rápidos</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {[
            { label: "Edge Functions logs", href: "https://supabase.com/dashboard/project/hummeopatkniwkyrrhwc/functions" },
            { label: "Database logs", href: "https://supabase.com/dashboard/project/hummeopatkniwkyrrhwc/logs/postgres-logs" },
            { label: "Auth users", href: "https://supabase.com/dashboard/project/hummeopatkniwkyrrhwc/auth/users" },
            { label: "Configurar secretos", href: "https://supabase.com/dashboard/project/hummeopatkniwkyrrhwc/settings/functions" },
            { label: "Auth providers", href: "https://supabase.com/dashboard/project/hummeopatkniwkyrrhwc/auth/providers" },
            { label: "SQL Editor", href: "https://supabase.com/dashboard/project/hummeopatkniwkyrrhwc/sql/new" },
          ].map(l => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card border border-border/40 hover:border-primary/40 transition-colors text-xs"
            >
              <ExternalLink className="w-3 h-3 text-muted-foreground" />
              <span className="flex-1 truncate">{l.label}</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
