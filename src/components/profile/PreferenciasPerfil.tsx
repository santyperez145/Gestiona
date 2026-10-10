import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTheme } from "next-themes";
import { Bell, Loader2, Monitor, Moon, Palette, Sun } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { useOrg } from "@/lib/orgContext";
import { getCurrentSubscription, isPushSupported, subscribeToPush, unsubscribeFromPush } from "@/lib/pushNotifications";

/**
 * Lo que es de la persona y no del negocio.
 *
 * Las notificaciones push vivían en Ajustes › Mensajería, pero una suscripción
 * push es de **este dispositivo**: activarla en la caja no la activa en el
 * celular del dueño. Y al lado había seis llaves de «Notificaciones» que se
 * guardaban en el navegador y que nada leía — qué genera una alerta se decide
 * en /alertas, para toda la organización. Esas llaves se fueron.
 */

const TEMAS = [
  { valor: "light", etiqueta: "Claro", icono: Sun },
  { valor: "dark", etiqueta: "Oscuro", icono: Moon },
  { valor: "system", etiqueta: "Según el equipo", icono: Monitor },
] as const;

function Tarjeta({ titulo, icono: Icono, children }: { titulo: string; icono: typeof Sun; children: React.ReactNode }) {
  return (
    <section className="relative space-y-4 overflow-hidden rounded-[12px] border border-border/70 bg-card p-5 shadow-card" aria-label={titulo}>
      <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60 font-display flex items-center gap-2">
        <Icono className="w-3 h-3" /> {titulo}
      </p>
      {children}
    </section>
  );
}

export function AparienciaPerfil() {
  const { theme, setTheme } = useTheme();
  // next-themes recién conoce el tema guardado después de montar.
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  const actual = montado ? theme ?? "light" : null;

  return (
    <Tarjeta titulo="Apariencia" icono={Palette}>
      <div role="radiogroup" aria-label="Tema de la interfaz" className="grid grid-cols-3 gap-2">
        {TEMAS.map(({ valor, etiqueta, icono: Icono }) => {
          const elegido = actual === valor;
          return (
            <button
              key={valor}
              type="button"
              role="radio"
              aria-checked={elegido}
              onClick={() => setTheme(valor)}
              className={`flex flex-col items-center gap-1.5 rounded-[8px] border px-3 py-3 text-xs transition-colors ${
                elegido ? "border-primary bg-primary/10 text-foreground" : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
              }`}
            >
              <Icono className="h-4 w-4" />
              {etiqueta}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">Se guarda en este navegador. «Según el equipo» sigue el modo claro u oscuro del sistema.</p>
    </Tarjeta>
  );
}

export function NotificacionesPerfil() {
  const { activeOrg } = useOrg();
  const soportado = isPushSupported();
  const [activas, setActivas] = useState<boolean | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const permisoBloqueado = typeof Notification !== "undefined" && Notification.permission === "denied";

  const leerEstado = useCallback(async () => {
    if (!soportado) { setActivas(false); return; }
    try { setActivas(!!(await getCurrentSubscription())); } catch { setActivas(false); }
  }, [soportado]);

  useEffect(() => { void leerEstado(); }, [leerEstado]);

  const alternar = async () => {
    if (!activeOrg) { toast.error("Elegí una organización para recibir sus alertas."); return; }
    setTrabajando(true);
    try {
      if (activas) {
        await unsubscribeFromPush(activeOrg.id);
        setActivas(false);
        toast.success("Este dispositivo dejó de recibir alertas");
      } else if (await subscribeToPush(activeOrg.id)) {
        setActivas(true);
        toast.success("Este dispositivo va a recibir las alertas", { description: activeOrg.name });
      } else {
        toast.error("No se pudo activar", { description: "Revisá que el navegador tenga permiso para mostrar notificaciones." });
      }
    } catch (err: any) {
      toast.error("No se pudo cambiar", { description: err?.message });
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <Tarjeta titulo="Notificaciones en este dispositivo" icono={Bell}>
      {!soportado ? (
        <p className="text-[12px] text-muted-foreground">
          Este navegador no admite notificaciones push. En el celular, instalá Nerqia desde el menú del navegador («Agregar a pantalla de inicio»).
        </p>
      ) : (
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Alertas de {activeOrg?.name ?? "tu organización"}</p>
            <p className="text-[11px] text-muted-foreground">
              {permisoBloqueado
                ? "El navegador tiene bloqueadas las notificaciones de este sitio: habilitalas desde el candado de la barra de direcciones."
                : "Stock bajo, saldos vencidos, ventas grandes y el resto de las reglas activas, aunque la app esté cerrada."}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {(trabajando || activas === null) && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            <Switch
              checked={!!activas}
              onCheckedChange={() => void alternar()}
              disabled={trabajando || activas === null || permisoBloqueado}
              aria-label="Recibir alertas en este dispositivo"
            />
          </div>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Qué genera una alerta y con qué umbral se decide para toda la organización en{" "}
        <Link to="/alertas" className="underline underline-offset-2 hover:text-foreground">Alertas</Link>.
      </p>
    </Tarjeta>
  );
}
