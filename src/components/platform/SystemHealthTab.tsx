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

/**
 * Qué es cada secreto, para que el panel no muestre nombres crudos.
 *
 * ⚠️ Esto **ya no es la lista**: la autoridad es `platform-admin-action`, que
 * es la única que puede leer el entorno. Antes había dos listas que tenían que
 * coincidir y —medido el 2026-08-28— habían divergido en las dos direcciones:
 * mostraban Twilio y Tiendanube, que nadie usa, y no mostraban
 * `BACKUP_CRON_SECRET` ni `SMTP_PASSWORD`, de los que dependen los 19 crons y
 * todo el correo.
 *
 * 📌 Un secreto que la función reporte y no esté acá se muestra igual, con una
 * descripción genérica. Es a propósito: **la lista no puede esconder algo que
 * el servidor sí ve.**
 */
const DESCRIPCIONES: Record<string, Omit<SecretStatus, "configured" | "name">> = {
  SUPABASE_URL:              { required: true,  category: "core",  description: "Inyectado automáticamente por Supabase" },
  SUPABASE_ANON_KEY:         { required: true,  category: "core",  description: "Inyectado automáticamente por Supabase" },
  SUPABASE_SERVICE_ROLE_KEY: { required: true,  category: "core",  description: "Inyectado automáticamente por Supabase" },

  ANTHROPIC_API_KEY:         { required: true,  category: "ai",    description: "Sin esta clave TODA la IA responde error: copiloto, descripciones, análisis y recomendaciones" },
  EXPENSE_RECEIPT_EXTRACTION_ENABLED: { required: false, category: "ai", description: "Habilita comprobantes de Gastos sólo después de aprobar proveedor, privacidad y revisión humana" },

  RESEND_API_KEY:            { required: false, category: "email", description: "Envío por Resend. Alternativa: SMTP propio" },
  FROM_EMAIL:                { required: false, category: "email", description: "Remitente verificado en Resend" },
  SMTP_PASSWORD:             { required: true,  category: "email", description: "Clave del SMTP propio. Es por acá que sale el correo hoy" },
  RESEND_WEBHOOK_SECRET:     { required: false, category: "email", description: "Verifica los webhooks de Resend (rebotes, quejas)" },

  MP_APP_ID:                 { required: true,  category: "payments", description: "Identificador público de la app. Con el secret deriva el token de plataforma" },
  MP_APP_SECRET:             { required: true,  category: "payments", description: "Secreto de la app: OAuth de los comercios y token de plataforma" },
  MP_WEBHOOK_SECRET:         { required: true,  category: "payments", description: "Verifica la firma de los webhooks. Sin esto una compra queda pagada de un lado e impaga del otro" },
  MP_PLATFORM_ACCESS_TOKEN:  { required: false, category: "payments", description: "Token de plataforma explícito. Si falta se deriva de MP_APP_ID + MP_APP_SECRET" },

  BACKUP_CRON_SECRET:        { required: true,  category: "core",  description: "Identifica al cron ante las 19 tareas programadas. Sin esto ninguna corre" },

  WHATSAPP_TOKEN:            { required: false, category: "whatsapp", description: "Token de la API oficial de Meta. Sin esto no sale ningún WhatsApp" },

  VAPID_PUBLIC_KEY:          { required: false, category: "core", description: "Notificaciones push del navegador" },
  VAPID_PRIVATE_KEY:         { required: false, category: "core", description: "Notificaciones push del navegador" },
  VAPID_SUBJECT:             { required: false, category: "core", description: "Contacto declarado en las push (mailto:)" },

  PUBLIC_BASE_URL:           { required: false, category: "core", description: "Base de los enlaces que salen en emails y WhatsApp" },
  PLATFORM_ALLOWED_ORIGINS:  { required: false, category: "core", description: "Orígenes permitidos para las funciones de plataforma" },

  FINANCE_DOCUMENT_EXTRACTION_ENABLED: { required: false, category: "integrations", description: "Habilita la extracción automática en el buzón de Finance" },
  FINANCE_DOCUMENT_MODEL:              { required: false, category: "integrations", description: "Modelo usado para extraer un comprobante" },
  FINANCE_DOCUMENT_SCANNER_URL:        { required: false, category: "integrations", description: "Scanner de archivos subidos a Finance" },
  FINANCE_DOCUMENT_SCANNER_TOKEN:      { required: false, category: "integrations", description: "Auth del scanner de Finance" },

  STRIPE_SECRET_KEY:         { required: false, category: "payments", description: "Sólo lo lee `stripe-webhook`. El cobro real es por MercadoPago" },
  STRIPE_WEBHOOK_SECRET:     { required: false, category: "payments", description: "Sólo lo lee `stripe-webhook`. El cobro real es por MercadoPago" },
};

const CATEGORY_META: Record<SecretStatus["category"], { label: string; icon: typeof KeyRound; color: string }> = {
  core: { label: "Sistema", icon: Server, color: "text-slate-400" },
  ai: { label: "Inteligencia Artificial", icon: Zap, color: "text-violet-400" },
  email: { label: "Emails", icon: Activity, color: "text-blue-400" },
  payments: { label: "Pagos", icon: KeyRound, color: "text-emerald-400" },
  integrations: { label: "Integraciones", icon: Shield, color: "text-amber-400" },
  whatsapp: { label: "WhatsApp", icon: Activity, color: "text-green-400" },
};

export default function SystemHealthTab() {
  const [secrets, setSecrets] = useState<SecretStatus[]>([]);
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
        // La función manda qué secretos existen; acá sólo se les pone nombre.
        // Uno que ella reporte y no esté en DESCRIPCIONES se muestra igual.
        setSecrets(Object.entries(data.secrets as Record<string, boolean>).map(([name, ok]) => ({
          name,
          configured: ok === true,
          ...(DESCRIPCIONES[name] ?? {
            required: false,
            category: "core" as const,
            description: "Sin descripción todavía — se agrega en SystemHealthTab.",
          }),
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
            <div key={cat} className="bg-card border border-border/60 rounded-xl overflow-hidden">
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
        <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
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
