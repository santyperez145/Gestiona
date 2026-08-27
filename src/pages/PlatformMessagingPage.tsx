import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { mensajeDeEdgeFunction } from "@/lib/edgeErrors";
import { toast } from "sonner";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle, CheckCircle2, Loader2, Mail, MessageCircle, Send, ShieldAlert,
} from "lucide-react";

/**
 * Mensajería de la plataforma — de dónde sale el correo y el WhatsApp.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 *
 * ⚠️ El reporte fue «configuré Resend y no veo que funcione», y era exacto: el
 * remitente estaba hardcodeado en **nueve** funciones con nueve direcciones
 * distintas de un dominio inventado. Resend sólo entrega desde un dominio
 * verificado en la cuenta, así que si el verificado era otro, todas rechazaban
 * — y no había ningún lugar donde decirle cuál es.
 *
 * 📌 Y el rechazo **no lo veía nadie**: todos los envíos salen de crons, que
 * terminan en verde porque `invoke_edge_function` es asíncrono. Un canal que
 * falla en silencio es peor que uno que no existe, porque el dueño cree que sus
 * comercios reciben avisos, campañas y facturas.
 *
 * Por eso el botón de probar no dice «ok» o «error»: **muestra lo que contestó
 * el proveedor, textual**. Es la única información con la que se puede
 * arreglar.
 *
 * ⚠️ Acá no se carga ningún secreto. La clave de Resend y el token de WhatsApp
 * viven en el entorno de las Edge Functions, donde el navegador no llega. Lo
 * que se configura acá es lo que no es secreto y hoy está escrito a mano en
 * nueve archivos.
 */

interface Config {
  email_dominio: string | null;
  email_nombre: string | null;
  email_casillas: Record<string, string> | null;
  email_listo: boolean;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  smtp_from_email: string | null;
  smtp_configurado: boolean;
  whatsapp_proveedor: string | null;
  whatsapp_phone_number_id: string | null;
  whatsapp_numero_visible: string | null;
  whatsapp_listo: boolean;
}

interface Prueba {
  ok: boolean;
  etapa: string;
  remitente?: string;
  destino?: string;
  detalle: string;
}

/** Para qué se usa cada casilla, en palabras del negocio. */
const PROPOSITOS: { clave: string; label: string; ejemplo: string }[] = [
  { clave: "default",          label: "General",        ejemplo: "avisos de la cuenta, invitaciones al equipo" },
  { clave: "marketing",        label: "Campañas",       ejemplo: "las campañas que manda cada comercio" },
  { clave: "facturas",         label: "Facturas",       ejemplo: "comprobantes y recibos" },
  { clave: "pedidos",          label: "Compras",        ejemplo: "órdenes a proveedores" },
  { clave: "digest",           label: "Resúmenes",      ejemplo: "el resumen semanal de resultados" },
  { clave: "automatizaciones", label: "Automatizaciones", ejemplo: "lo que dispara una regla automática" },
  { clave: "admin",            label: "Sistema",        ejemplo: "notificaciones internas" },
];

export default function PlatformMessagingPage() {
  usePageTitle("Mensajería");
  const [cfg, setCfg] = useState<Config | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [probando, setProbando] = useState(false);
  const [prueba, setPrueba] = useState<Prueba | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    const { data, error } = await supabase.rpc("mensajeria_de_plataforma");
    if (error) {
      console.error("mensajeria_de_plataforma", error);
      toast.error("No pudimos leer la configuración");
    }
    setCfg((data as unknown as Config) ?? null);
    setCargando(false);
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  // El RPC recibe jsonb; el tipo generado es `Json`, que no acepta un
  // `Record<string, unknown>` genérico. El cast es en el borde, no en la lógica.
  const guardar = async (cambios: Record<string, unknown>) => {
    setGuardando(true);
    const { data, error } = await supabase.rpc("mensajeria_guardar", { p_cambios: cambios as never });
    setGuardando(false);
    if (error) {
      console.error("mensajeria_guardar", error);
      toast.error(error.message);
      return;
    }
    setCfg(data as unknown as Config);
    // Cambiar el dominio invalida la prueba anterior: lo que estaba probado era
    // el dominio viejo.
    setPrueba(null);
    toast.success("Guardado");
  };

  const probar = async () => {
    setProbando(true);
    setPrueba(null);
    const { data, error } = await supabase.functions.invoke("mensajeria-probar", { body: {} });
    setProbando(false);
    if (error) {
      const motivo = await mensajeDeEdgeFunction(error, data);
      console.error("mensajeria-probar", motivo || error);
      setPrueba({ ok: false, etapa: "envio", detalle: motivo || "No se pudo ejecutar la prueba" });
      return;
    }
    setPrueba(data as unknown as Prueba);
    await cargar();
  };

  const casillas = cfg?.email_casillas ?? {};

  return (
    <div className="workspace-page space-y-5">
      <PageHeader
        icon={Mail}
        title="Mensajería"
        description="De dónde salen los correos y los WhatsApp de la plataforma."
      />

      {cargando ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Cargando
        </div>
      ) : (
        <>
          {/* Los secretos no pasan por acá, y conviene decirlo donde se mira. */}
          <div className="flex items-start gap-2 rounded-[8px] border border-border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
            <ShieldAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              La clave de Resend y el token de WhatsApp son secretos y se cargan en Supabase,
              no en esta pantalla. Acá se configura lo que no es secreto: desde qué dominio y
              con qué número se manda.
            </span>
          </div>

          {/* ── Correo ─────────────────────────────────────────────────── */}
          <section className="rounded-[8px] border border-border/80 bg-card p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Mail className="w-4 h-4 text-muted-foreground" /> Correo
              </h2>
              <span className={`text-[11px] px-2 py-0.5 rounded border ${
                cfg?.email_listo
                  ? "bg-emerald-500/12 text-emerald-600 border-emerald-500/20"
                  : "bg-yellow-500/12 text-yellow-700 dark:text-yellow-400 border-yellow-500/20"
              }`}>
                {cfg?.email_listo ? "Probado" : "Sin probar"}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="dominio">Dominio verificado en Resend</Label>
                <Input
                  id="dominio" defaultValue={cfg?.email_dominio ?? ""}
                  placeholder="gestiona.app"
                  onBlur={e => {
                    const v = e.target.value.trim();
                    if (v !== (cfg?.email_dominio ?? "")) void guardar({ email_dominio: v });
                  }}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Tiene que ser exactamente el que figura verificado en tu cuenta de Resend.
                  Si no coincide, el proveedor rechaza todos los envíos.
                </p>
              </div>
              <div>
                <Label htmlFor="nombre">Nombre que ve quien recibe</Label>
                <Input
                  id="nombre" defaultValue={cfg?.email_nombre ?? ""}
                  placeholder="Gestiona"
                  onBlur={e => {
                    const v = e.target.value.trim();
                    if (v !== (cfg?.email_nombre ?? "")) void guardar({ email_nombre: v });
                  }}
                />
              </div>
            </div>

            <div>
              <p className="text-xs font-medium mb-2">Casilla por tipo de mensaje</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {PROPOSITOS.map(p => (
                  <div key={p.clave} className="flex items-center gap-2">
                    <div className="min-w-[104px]">
                      <span className="text-xs">{p.label}</span>
                      <p className="text-[10px] text-muted-foreground leading-tight">{p.ejemplo}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-1">
                      <Input
                        className="h-8 text-xs"
                        defaultValue={casillas[p.clave] ?? ""}
                        placeholder="noreply"
                        onBlur={e => {
                          const v = e.target.value.trim();
                          if (v === (casillas[p.clave] ?? "")) return;
                          void guardar({ email_casillas: { ...casillas, [p.clave]: v } });
                        }}
                      />
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                        @{cfg?.email_dominio || "—"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button size="sm" onClick={probar} disabled={probando || guardando}>
                {probando ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                          : <Send className="w-3.5 h-3.5 mr-1.5" />}
                Mandarme un correo de prueba
              </Button>
              <span className="text-[11px] text-muted-foreground">
                Va a tu propia casilla. Es la única forma de saber si funciona.
              </span>
            </div>

            {/* ── SMTP propio ─────────────────────────────────────────
                Existe porque Resend sólo entrega desde un dominio verificado, y
                verificar un dominio pide tocar el DNS. Sin eso no sale un solo
                mail — y hay avisos que ya dependen de que salgan.

                ⚠️ La contraseña NO se carga acá: va en Supabase como
                `SMTP_PASSWORD`. Esta pantalla la lee el staff desde el
                navegador, así que un secreto en un campo de acá es un secreto
                en una tabla que la UI consulta. */}
            <details className="rounded-[8px] border border-border bg-muted/10 p-3">
              <summary className="cursor-pointer text-xs font-medium">
                ¿Todavía no verificaste el dominio? Usá un servidor de correo propio
              </summary>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Si cargás esto, el correo sale por acá y no por Resend. Sirve con la
                casilla de tu hosting o con Gmail. La contraseña se carga en Supabase
                como <code>SMTP_PASSWORD</code>, no en esta pantalla.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="smtp_host">Servidor</Label>
                  <Input
                    id="smtp_host" defaultValue={cfg?.smtp_host ?? ""}
                    placeholder="smtp.gmail.com"
                    onBlur={e => {
                      const v = e.target.value.trim();
                      if (v !== (cfg?.smtp_host ?? "")) void guardar({ smtp_host: v });
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="smtp_port">Puerto</Label>
                  <Input
                    id="smtp_port" defaultValue={cfg?.smtp_port ?? ""}
                    placeholder="465"
                    onBlur={e => {
                      const v = e.target.value.trim();
                      if (v !== String(cfg?.smtp_port ?? "")) void guardar({ smtp_port: v });
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="smtp_user">Usuario</Label>
                  <Input
                    id="smtp_user" defaultValue={cfg?.smtp_user ?? ""}
                    placeholder="tucasilla@gmail.com"
                    onBlur={e => {
                      const v = e.target.value.trim();
                      if (v !== (cfg?.smtp_user ?? "")) void guardar({ smtp_user: v });
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="smtp_from">Casilla que aparece como remitente</Label>
                  <Input
                    id="smtp_from" defaultValue={cfg?.smtp_from_email ?? ""}
                    placeholder="tucasilla@gmail.com"
                    onBlur={e => {
                      const v = e.target.value.trim();
                      if (v !== (cfg?.smtp_from_email ?? "")) void guardar({ smtp_from_email: v });
                    }}
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Con Gmail tiene que ser la misma casilla del usuario: mandar desde
                    otra dirección hace que el servidor rechace o que caiga en spam.
                  </p>
                </div>
              </div>
            </details>

            {prueba && (
              /* La respuesta del proveedor, textual: es lo único que sirve para
                 arreglarlo. Traducirla a «hubo un error» sería volver al
                 problema. */
              <div className={`flex items-start gap-2 rounded-[8px] border px-3 py-2.5 text-sm ${
                prueba.ok
                  ? "border-emerald-500/25 bg-emerald-500/8"
                  : "border-destructive/25 bg-destructive/8"
              }`}>
                {prueba.ok
                  ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" />
                  : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-destructive" />}
                <div className="min-w-0">
                  {prueba.remitente && (
                    <p className="text-xs text-muted-foreground">Desde {prueba.remitente}</p>
                  )}
                  <p className="break-words">{prueba.detalle}</p>
                </div>
              </div>
            )}
          </section>

          {/* ── WhatsApp ───────────────────────────────────────────────── */}
          <section className="rounded-[8px] border border-border/80 bg-card p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <MessageCircle className="w-4 h-4 text-muted-foreground" /> WhatsApp
              </h2>
              <span className={`text-[11px] px-2 py-0.5 rounded border ${
                cfg?.whatsapp_listo
                  ? "bg-emerald-500/12 text-emerald-600 border-emerald-500/20"
                  : "bg-muted text-muted-foreground border-border"
              }`}>
                {cfg?.whatsapp_listo ? "Probado" : "Sin configurar"}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label>Proveedor</Label>
                <Select
                  value={cfg?.whatsapp_proveedor ?? "ninguno"}
                  onValueChange={v => void guardar({ whatsapp_proveedor: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="meta_cloud">WhatsApp Business (Meta)</SelectItem>
                    <SelectItem value="ninguno">Sin WhatsApp</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="pnid">Identificador del número</Label>
                <Input
                  id="pnid" defaultValue={cfg?.whatsapp_phone_number_id ?? ""}
                  placeholder="Lo da Meta al dar de alta el número"
                  onBlur={e => {
                    const v = e.target.value.trim();
                    if (v !== (cfg?.whatsapp_phone_number_id ?? "")) {
                      void guardar({ whatsapp_phone_number_id: v });
                    }
                  }}
                />
              </div>
              <div>
                <Label htmlFor="wnum">Número que ve el cliente</Label>
                <Input
                  id="wnum" defaultValue={cfg?.whatsapp_numero_visible ?? ""}
                  placeholder="+54 9 11 ..."
                  onBlur={e => {
                    const v = e.target.value.trim();
                    if (v !== (cfg?.whatsapp_numero_visible ?? "")) {
                      void guardar({ whatsapp_numero_visible: v });
                    }
                  }}
                />
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-[8px] border border-border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                El WhatsApp sale del número de la plataforma, no de un teléfono conectado por
                comercio. Un teléfono personal enlazado a un servicio no oficial se puede
                bloquear sin aviso y se lleva puestos los avisos de todos los comercios a la vez.
              </span>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
