// Alertas: lo que te avisó Nerqia y las reglas que lo deciden.
//
// 2026-10-15: se rehízo. Antes administraba `smart_alert_rules`, que sólo
// evalúa el motor de presupuestos (una regla de stock o clientes creada acá no
// disparaba nunca), mientras las reglas que sí corren todos los días
// (`alert_rules`, función check-alerts) no se veían en ninguna pantalla. La
// pestaña de eventos leía `alert_events`, donde no llegan los resúmenes
// diarios, y la de canales decía «Configurado» fijo con botones que sólo
// mostraban un aviso. Ver `src/lib/reglasDeAlertas.ts`.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Check, Loader2, Settings, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { useAuth } from "@/lib/auth";
import { useModulePerms } from "@/lib/permissionsContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import { orgViewKey, usePersistedState } from "@/hooks/usePersistedState";
import { fechaLocal } from "@/lib/fechaAR";
import { rutaDelAviso } from "@/lib/rutaDelAviso";
import { mensajeDeError } from "@/lib/cuentaCorriente";
import {
  REGLAS_DE_ALERTA, describirRegla, validarUmbral, type DefinicionDeRegla, type TipoDeRegla,
} from "@/lib/reglasDeAlertas";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Aviso {
  id: string;
  origen: "notificacion" | "evento";
  titulo: string;
  mensaje: string;
  fecha: string;
  pendiente: boolean;
  ruta: string | null;
}

interface FilaRegla {
  id?: string;
  type: TipoDeRegla;
  enabled: boolean;
  threshold_value: number | null;
  threshold_days: number | null;
  last_run_at: string | null;
}

const cuando = (iso: string) =>
  fechaLocal(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function Regla({ def, fila, puedeEditar, onGuardada }: {
  def: DefinicionDeRegla; fila: FilaRegla | undefined; puedeEditar: boolean; onGuardada: (f: FilaRegla) => void;
}) {
  const { activeOrg } = useOrg();
  const actual = Number(fila?.[def.campo] ?? def.porDefecto);
  const [texto, setTexto] = useState(String(actual));
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { setTexto(String(actual)); }, [actual]);
  const activa = fila?.enabled ?? false;

  const guardar = async (cambios: { enabled?: boolean; valor?: number }) => {
    if (!activeOrg) return;
    setGuardando(true);
    try {
      const payload = {
        org_id: activeOrg.id,
        type: def.tipo,
        enabled: cambios.enabled ?? activa,
        [def.campo]: cambios.valor ?? actual,
      };
      const { data, error } = await supabase
        .from("alert_rules")
        .upsert(payload, { onConflict: "org_id,type" })
        .select("id, type, enabled, threshold_value, threshold_days, last_run_at")
        .single();
      if (error) throw error;
      onGuardada(data as FilaRegla);
      toast.success(cambios.enabled === undefined ? "Umbral guardado" : cambios.enabled ? "Regla activada" : "Regla pausada");
    } catch (e) {
      toast.error(`No se pudo guardar la regla: ${mensajeDeError(e)}`);
    } finally {
      setGuardando(false);
    }
  };

  const guardarUmbral = () => {
    const r = validarUmbral(def, texto);
    if ("error" in r) { toast.error(r.error); return; }
    if (r.valor === actual) return;
    void guardar({ valor: r.valor });
  };

  return (
    <div className="flex flex-col gap-3 border-b border-border/40 py-4 last:border-0 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{def.titulo}</p>
        <p className="text-xs text-muted-foreground">{describirRegla(def, actual)}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground/80">
          {!fila ? "Sin configurar" : fila.last_run_at ? `Revisada el ${cuando(fila.last_run_at)}` : "Todavía no se revisó"}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Input
          className="h-8 w-28 text-right tabular-nums" inputMode="decimal" aria-label={`Umbral de ${def.titulo} en ${def.unidad}`}
          value={texto} disabled={!puedeEditar || guardando}
          onChange={e => setTexto(e.target.value)} onBlur={guardarUmbral}
          onKeyDown={e => { if (e.key === "Enter") guardarUmbral(); }}
        />
        <span className="w-14 text-xs text-muted-foreground">{def.unidad}</span>
        {guardando ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : (
          <Switch checked={activa} disabled={!puedeEditar} aria-label={`${activa ? "Pausar" : "Activar"} ${def.titulo}`}
            onCheckedChange={v => void guardar({ enabled: v })} />
        )}
      </div>
    </div>
  );
}

export default function SmartAlertsPage() {
  usePageTitle("Alertas");
  const { activeOrg } = useOrg();
  const { user } = useAuth();
  const navigate = useNavigate();
  const ajustes = useModulePerms("settings");
  const [tab, setTab] = usePersistedState<"avisos" | "reglas" | "canales">(orgViewKey(activeOrg?.id, "alertas:tab"), "avisos");
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [reglas, setReglas] = useState<FilaRegla[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!activeOrg || !user) return;
    setCargando(true);
    setError(null);
    const [notifRes, eventosRes, reglasRes] = await Promise.all([
      supabase.from("notifications").select("id, title, message, read, created_at, entity_type, entity_id")
        .eq("org_id", activeOrg.id).eq("user_id", user.id).order("created_at", { ascending: false }).limit(60),
      supabase.from("alert_events").select("id, title, message, acknowledged_at, created_at")
        .eq("org_id", activeOrg.id).order("created_at", { ascending: false }).limit(60),
      supabase.from("alert_rules").select("id, type, enabled, threshold_value, threshold_days, last_run_at")
        .eq("org_id", activeOrg.id),
    ]);
    const fallo = notifRes.error ?? eventosRes.error ?? reglasRes.error;
    if (fallo) setError(mensajeDeError(fallo));
    const lista: Aviso[] = [
      ...(notifRes.data ?? []).map(n => ({
        id: n.id, origen: "notificacion" as const, titulo: n.title, mensaje: n.message ?? "",
        fecha: n.created_at, pendiente: !n.read, ruta: rutaDelAviso(n),
      })),
      ...(eventosRes.data ?? []).map(e => ({
        id: e.id, origen: "evento" as const, titulo: e.title, mensaje: e.message ?? "",
        fecha: e.created_at, pendiente: !e.acknowledged_at, ruta: null,
      })),
    ].sort((a, b) => b.fecha.localeCompare(a.fecha));
    setAvisos(lista);
    setReglas((reglasRes.data ?? []) as FilaRegla[]);
    setCargando(false);
  }, [activeOrg, user]);

  useEffect(() => { void cargar(); }, [cargar]);

  const marcarLeido = async (a: Aviso) => {
    const { error: e } = a.origen === "notificacion"
      ? await supabase.from("notifications").update({ read: true }).eq("id", a.id)
      : await supabase.from("alert_events").update({ acknowledged_at: new Date().toISOString(), acknowledged_by: user?.id }).eq("id", a.id);
    if (e) { toast.error(`No se pudo marcar como leído: ${mensajeDeError(e)}`); return; }
    setAvisos(prev => prev.map(x => x.id === a.id ? { ...x, pendiente: false } : x));
  };

  const pendientes = avisos.filter(a => a.pendiente).length;
  const porTipo = useMemo(() => new Map(reglas.map(r => [r.type, r])), [reglas]);
  const activas = reglas.filter(r => r.enabled).length;

  return (
    <div className="workspace-page space-y-5">
      <PageHeader
        icon={Bell}
        title="Alertas"
        description="Lo que Nerqia te avisó y las reglas que deciden cuándo avisarte."
      />

      {error && (
        <p className="rounded-[8px] border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          No pudimos leer todas las alertas: {error}
        </p>
      )}

      <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="avisos">Avisos{pendientes > 0 ? ` (${pendientes})` : ""}</TabsTrigger>
          <TabsTrigger value="reglas">Reglas ({activas} activas)</TabsTrigger>
          <TabsTrigger value="canales">Cómo te llegan</TabsTrigger>
        </TabsList>

        <TabsContent value="avisos" className="mt-4">
          {cargando ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Cargando</div>
          ) : avisos.length === 0 ? (
            <p className="rounded-xl border border-border/40 bg-card px-4 py-10 text-center text-sm text-muted-foreground">
              Todavía no hay avisos. Cuando una regla encuentre algo, aparece acá y en la campana.
            </p>
          ) : (
            <div className="divide-y divide-border/40 rounded-xl border border-border/40 bg-card">
              {avisos.map(a => (
                <div key={`${a.origen}:${a.id}`} className={`flex items-start gap-3 px-4 py-3 ${a.pendiente ? "bg-primary/5" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${a.pendiente ? "font-medium" : "text-muted-foreground"}`}>{a.titulo}</p>
                    {a.mensaje && <p className="mt-0.5 text-xs text-muted-foreground">{a.mensaje}</p>}
                    <p className="mt-1 text-[11px] text-muted-foreground/80">{cuando(a.fecha)}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {a.ruta && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { if (a.pendiente) void marcarLeido(a); navigate(a.ruta!); }}>
                        Ver
                      </Button>
                    )}
                    {a.pendiente && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void marcarLeido(a)}>
                        <Check className="mr-1 h-3 w-3" />Leído
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="reglas" className="mt-4">
          <div className="rounded-xl border border-border/40 bg-card px-4">
            <p className="flex items-center gap-2 border-b border-border/40 py-3 text-xs text-muted-foreground">
              <Settings className="h-3.5 w-3.5" />
              Se revisan todas las mañanas. Cada regla manda un solo resumen, que se actualiza mientras no lo leas.
              {!ajustes.canEdit && " Para cambiarlas necesitás permiso de Ajustes."}
            </p>
            {REGLAS_DE_ALERTA.map(def => (
              <Regla key={def.tipo} def={def} fila={porTipo.get(def.tipo)} puedeEditar={ajustes.canEdit}
                onGuardada={f => setReglas(prev => [...prev.filter(r => r.type !== f.type), f])} />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="canales" className="mt-4">
          <div className="max-w-xl space-y-3 rounded-xl border border-border/40 bg-card p-5 text-sm">
            <p className="flex items-start gap-2"><Bell className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span><strong>En Nerqia:</strong> cada aviso llega a la campana de arriba a la derecha y a la pestaña Avisos. Tocarlo te lleva a la pantalla donde se resuelve.</span>
            </p>
            <p className="flex items-start gap-2"><Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span><strong>En el celular:</strong> si activaste las notificaciones de Nerqia en tu teléfono, los avisos nuevos también te llegan ahí.</span>
            </p>
            <p className="text-xs text-muted-foreground">Los avisos son para el dueño y los administradores del negocio.</p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
