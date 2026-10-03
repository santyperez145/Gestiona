/**
 * C14b — cómo el comercio conecta AFIP, sin tocar un certificado.
 *
 * ── Cómo lo hacen los que ya funcionan ───────────────────────────────────
 *
 * MercadoLibre y Tiendanube no te piden que generes una clave privada con
 * openssl, armes un CSR y lo subas a WSASS. Te dicen exactamente qué tocar y
 * después **verifican que haya quedado bien**.
 *
 * Este componente hace lo mismo con el modelo que ya está en la base (C14):
 * el certificado vive en la plataforma y el comercio **delega el servicio
 * `wsfe`** al CUIT de la plataforma desde el Administrador de Relaciones de
 * ARCA. Eso es un trámite de tres clics en un sitio que el comercio ya usa.
 *
 * ── Las dos decisiones ───────────────────────────────────────────────────
 *
 * **Cada estado dice de quién es el problema.** "Falta que delegues" y "falta
 * que la plataforma cargue su certificado" son de responsables distintos.
 * Mostrar un genérico "AFIP no configurado" manda al comercio a un trámite que
 * a veces no le toca — y eso quema la confianza en el panel.
 *
 * **El comercio solicita; Platform confirma.** La designación a un tercero no
 * queda operativa hasta que Nerqia la acepta y asocia su computador fiscal.
 * Ningún botón del comercio puede autodeclarar el circuito como verificado.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { mensajeDeEdgeFunction } from "@/lib/edgeErrors";
import {
  ShieldCheck, Copy, ExternalLink, Loader2, AlertTriangle, Check, Clock,
} from "lucide-react";

export type MotivoAfip =
  | "falta_datos_fiscales"
  | "falta_certificado_propio"
  | "falta_plataforma"
  | "falta_ambiente"
  /**
   * El CUIT del comercio ES el de la plataforma: el certificado ya pertenece a
   * ese CUIT y ARCA acepta la llamada sin ninguna delegación. Pedirle el
   * trámite sería pedirle que se delegue un servicio a sí mismo — un trámite
   * que no se puede hacer, así que la pantalla se quedaría pidiéndolo para
   * siempre.
   */
  | "sin_delegacion_necesaria"
  | "falta_delegar"
  | "esperando_plataforma"
  | "requiere_correccion"
  | "listo";

interface Props {
  orgId: string | null;
  motivo: MotivoAfip | null;
  plataformaCuit: string | null;
  plataformaRazonSocial: string | null;
  cuitDelComercio: string | null;
  ambiente: string | null;
  ultimoDiagnostico?: string | null;
  canVerify: boolean;
  /** Para reconsultar el estado después de verificar. */
  onVerificado: () => void;
}

/** El CUIT como lo pide el formulario de ARCA. */
function formatearCuit(cuit: string | null): string {
  const d = (cuit ?? "").replace(/\D/g, "");
  if (d.length !== 11) return cuit ?? "—";
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
}

export default function ConectarAfip({
  orgId, motivo, plataformaCuit, plataformaRazonSocial, cuitDelComercio, ambiente,
  ultimoDiagnostico, onVerificado, canVerify,
}: Props) {
  const [verificando, setVerificando] = useState(false);
  const [solicitando, setSolicitando] = useState(false);
  const [ultimoError, setUltimoError] = useState<string | null>(null);
  const scope = JSON.stringify([orgId, cuitDelComercio, ambiente]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const requestId = useRef(0);
  const lifecycle = useRef({ active: true }).current;
  useEffect(() => { lifecycle.active = true; return () => { lifecycle.active = false; }; }, [lifecycle]);

  const copiar = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success("CUIT copiado");
    } catch {
      // Sin portapapeles —contexto no seguro, permiso denegado— el CUIT está
      // igual en pantalla para copiarlo a mano. No es un error que valga un
      // mensaje rojo.
      toast.info("Copialo a mano: " + texto);
    }
  };

  const verificar = useCallback(async (silencioso = false) => {
    if (!orgId || !canVerify) return;
    const startedScope = scope;
    const id = ++requestId.current;
    setVerificando(true);
    setUltimoError(null);
    // La verificación la hace el backend contra ARCA: pide un Ticket de Acceso
    // con el certificado de la plataforma y consulta el último comprobante
    // autorizado con el CUIT del comercio. Si ARCA responde, la delegación
    // existe; si no, dice exactamente qué contestó.
    try {
    const { data, error } = await supabase.functions.invoke("afip-authorize", {
      body: { action: "verificar_delegacion", org_id: orgId },
    });
    if (!lifecycle.active || currentScope.current !== startedScope || requestId.current !== id) return;

    const r = data as { ok?: boolean } | null;
    if (r?.ok) {
      toast.success(ambiente === "homologacion"
        ? "Conexión de prueba verificada. Los comprobantes no tienen valor fiscal."
        : "Conexión con ARCA verificada. Cada comprobante necesita su CAE.");
      onVerificado();
      return;
    }

    // ⚠️ Antes, un fallo con status ≥ 400 mostraba `error.message`, que en
    // `functions.invoke` es SIEMPRE «Edge Function returned a non-2xx status
    // code». El motivo real de ARCA viaja en el cuerpo y quedaba invisible.
    const detalle = await mensajeDeEdgeFunction(error, data);
    if (!lifecycle.active || currentScope.current !== startedScope || requestId.current !== id) return;
    console.error("[ARCA] verification failed", { code: (data as { code?: string } | null)?.code || "request_failed" });
    setUltimoError(detalle);
    // En la verificación automática no se tira un toast rojo: el comercio no
    // apretó nada. El motivo queda en la tarjeta, que es donde lo va a mirar.
    if (!silencioso) toast.error(detalle || "ARCA todavía no reconoce la conexión");
    } catch {
      if (!lifecycle.active || currentScope.current !== startedScope || requestId.current !== id) return;
      console.error("[ARCA] verification request failed");
      setUltimoError("No pudimos consultar ARCA. Tus datos se conservan; reintentá en unos minutos.");
    } finally {
      if (lifecycle.active && currentScope.current === startedScope && requestId.current === id) setVerificando(false);
    }
  }, [orgId, onVerificado, canVerify, scope, lifecycle, ambiente]);

  /**
   * Verificación automática — el paso que la app puede hacer sola.
   *
   * Sólo cuando **no hay trámite pendiente**: con el CUIT de la plataforma,
   * ARCA ya acepta la llamada y lo único que falta es preguntarle. Pedirle al
   * comercio que apriete un botón para confirmar algo que no depende de él es
   * exactamente el paso que Tiendanube no te hace dar.
   *
   * ⚠️ En `falta_delegar` NO se auto-verifica: ahí el trámite sí depende del
   * comercio, y consultar antes de que lo haga sólo gasta un Ticket de Acceso
   * —que ARCA no renueva por ~12 h— para obtener un «no» previsible.
   */
  const yaIntento = useRef(false);
  useEffect(() => {
    yaIntento.current = false;
    setVerificando(false);
    setSolicitando(false);
    setUltimoError(null);
  }, [scope]);
  useEffect(() => {
    if (motivo !== "sin_delegacion_necesaria" || !orgId || !canVerify || yaIntento.current) return;
    yaIntento.current = true;
    void verificar(true);
  }, [motivo, orgId, verificar, canVerify]);

  const solicitarActivacion = async () => {
    if (!orgId || !canVerify || solicitando) return;
    const startedScope = scope;
    const id = ++requestId.current;
    setSolicitando(true);
    setUltimoError(null);
    try {
      const { data, error } = await supabase.rpc("afip_solicitar_revision_delegacion", { p_org: orgId });
      if (!lifecycle.active || currentScope.current !== startedScope || requestId.current !== id) return;
      if (error || !(data as { ok?: boolean } | null)?.ok) {
        console.error("[ARCA] activation request failed", { code: error?.code || "request_failed" });
        setUltimoError("No pudimos confirmar la solicitud. Tus datos se conservan; actualizá el estado o reintentá en unos minutos.");
        return;
      }
      toast.success("Solicitud enviada. Nerqia va a aceptar la designación y verificarla con ARCA.");
      onVerificado();
    } catch {
      if (!lifecycle.active || currentScope.current !== startedScope || requestId.current !== id) return;
      console.error("[ARCA] activation request unavailable");
      setUltimoError("No pudimos consultar el servicio. Tus datos se conservan; reintentá en unos minutos.");
    } finally {
      if (lifecycle.active && currentScope.current === startedScope && requestId.current === id) setSolicitando(false);
    }
  };

  if (motivo === "listo") {
    return (
      <Card className="p-4 flex items-start gap-3">
        <Check className="w-4 h-4 mt-0.5 text-green-600 shrink-0" />
        <div className="text-sm">
          <p className="font-medium">ARCA conectado</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Facturás con tu CUIT {formatearCuit(cuitDelComercio)}
            {ambiente === "homologacion" && " en ambiente de prueba (homologación)"}.
            No hay ningún certificado tuyo guardado acá.
          </p>
        </div>
      </Card>
    );
  }

  /**
   * No hay trámite: el CUIT del comercio es el de la plataforma.
   *
   * Se verifica solo al entrar. Lo único que puede fallar acá es ARCA, así que
   * la tarjeta muestra lo que contestó en vez de pedir un trámite imposible.
   */
  if (motivo === "sin_delegacion_necesaria") {
    return (
      <Card className="p-4 flex items-start gap-3">
        {verificando
          ? <Loader2 className="w-4 h-4 mt-0.5 animate-spin text-primary shrink-0" />
          : ultimoError
            ? <Clock className="w-4 h-4 mt-0.5 text-amber-600 shrink-0" />
            : <ShieldCheck className="w-4 h-4 mt-0.5 text-primary shrink-0" />}
        <div className="text-sm min-w-0 flex-1">
          <p className="font-medium">
            {verificando ? "Confirmando con ARCA…" : "No tenés que hacer ningún trámite"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Tu CUIT {formatearCuit(cuitDelComercio)} es el mismo con el que está
            emitido el certificado, así que no hay nada que delegar en el
            Administrador de Relaciones. Sólo falta que ARCA lo confirme, y eso
            lo hace la app sola.
          </p>
          {ultimoError && !verificando && (
            <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2">
              <p className="text-[11px] text-muted-foreground break-words">{ultimoError}</p>
            </div>
          )}
          {!verificando && (
            <Button size="sm" variant="outline" className="mt-2"
                    onClick={() => verificar()} disabled={!orgId || !canVerify}>
              Reintentar ahora
            </Button>
          )}
        </div>
      </Card>
    );
  }

  // Este caso no lo puede resolver el comercio, y decirle "configurá AFIP"
  // sería mandarlo a un trámite que no le toca.
  if (motivo === "falta_plataforma" || motivo === "falta_ambiente") {
    return (
      <Card className="p-4 flex items-start gap-3 border-amber-500/40 bg-amber-500/5">
        <Clock className="w-4 h-4 mt-0.5 text-amber-600 shrink-0" />
        <div className="text-sm">
          <p className="font-medium">{motivo === "falta_ambiente" ? "Revisá el ambiente fiscal" : "Certificado pendiente de Nerqia"}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {motivo === "falta_ambiente"
              ? "El ambiente fiscal y el certificado disponible no coinciden. Revisá la elección en los datos fiscales o solicitá a soporte que habilite el ambiente necesario. La conexión no cambia de ambiente por su cuenta."
              : "Nerqia debe habilitar el certificado de ARCA. Tus datos fiscales se conservan; no generes ni subas claves privadas."}
          </p>
        </div>
      </Card>
    );
  }

  if (motivo === "falta_datos_fiscales") {
    return (
      <Card className="p-4 flex items-start gap-3 border-amber-500/40 bg-amber-500/5">
        <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-600 shrink-0" />
        <div className="text-sm">
          <p className="font-medium">Cargá tus datos fiscales primero</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            CUIT, razón social y punto de venta. Sin eso no se puede delegar
            nada, porque ARCA no sabría a nombre de quién facturar.
          </p>
        </div>
      </Card>
    );
  }

  if (motivo === "esperando_plataforma") {
    return (
      <Card className="p-4 flex items-start gap-3 border-blue-500/35 bg-blue-500/5">
        <Clock className="w-4 h-4 mt-0.5 text-blue-600 shrink-0" />
        <div className="text-sm">
          <p className="font-medium">Activación solicitada a Nerqia</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ya recibimos tu aviso. El equipo debe aceptar la designación en ARCA,
            asociar el computador fiscal y comprobar el acceso con tu CUIT. No
            tenés que subir certificados ni repetir la solicitud.
          </p>
        </div>
      </Card>
    );
  }

  if (motivo === "requiere_correccion") {
    return (
      <Card className="p-4 space-y-3 border-amber-500/40 bg-amber-500/5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-600 shrink-0" />
          <div className="text-sm">
            <p className="font-medium">ARCA todavía no aceptó la conexión</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Revisá que hayas designado Facturación Electrónica (wsfe) al CUIT
              {plataformaCuit ? ` ${formatearCuit(plataformaCuit)}` : " de Nerqia"}
              y que el punto de venta sea para Web Services. Después volvé a solicitarla.
            </p>
            {ultimoDiagnostico && (
              <p className="mt-2 rounded-md border border-amber-500/20 bg-background/60 p-2 text-[11px] text-muted-foreground">
                ARCA informó: {ultimoDiagnostico}
              </p>
            )}
          </div>
        </div>
        <Button size="sm" onClick={() => void solicitarActivacion()} disabled={!canVerify || solicitando || !orgId}>
          {solicitando && <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />}
          Volver a solicitar revisión
        </Button>
        {ultimoError && <p role="alert" className="text-sm text-destructive break-words">{ultimoError}</p>}
      </Card>
    );
  }

  // falta_delegar — el caso principal: hay que guiarlo.
  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-sm">Delegá el servicio y pedí la activación</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            No vas a subir ningún certificado ni clave privada. Le das permiso a
            nuestro CUIT para emitir facturas <strong>a tu nombre</strong>, y lo
            podés revocar cuando quieras desde el mismo lugar.
          </p>
        </div>
      </div>

      <div className="rounded-lg border bg-muted/40 p-3">
        <p className="text-xs text-muted-foreground">Delegá a este CUIT</p>
        <div className="flex items-center gap-2 mt-1">
          <code className="text-base font-semibold tabular-nums">
            {formatearCuit(plataformaCuit)}
          </code>
          {plataformaCuit && (
            <Button size="sm" variant="ghost" aria-label="Copiar CUIT de Nerqia" title="Copiar CUIT de Nerqia" onClick={() => copiar(formatearCuit(plataformaCuit))}>
              <Copy className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
        {plataformaRazonSocial && (
          <p className="text-[11px] text-muted-foreground mt-0.5">{plataformaRazonSocial}</p>
        )}
      </div>

      <ol className="space-y-3 text-sm">
        <Paso n={1} titulo="Entrá al Administrador de Relaciones de ARCA">
          Con tu clave fiscal, en <strong>arca.gob.ar</strong> →
          {" "}<em>Administrador de Relaciones de Clave Fiscal</em>. Elegí tu
          CUIT como representado.
        </Paso>
        <Paso n={2} titulo="Agregá el servicio de Facturación Electrónica">
          <em>Nueva Relación</em> → Buscar → <strong>AFIP</strong> →
          {" "}<em>WebServices</em> → <strong>Facturación Electrónica (wsfe)</strong>.
        </Paso>
        <Paso n={3} titulo="Ponés nuestro CUIT como representante">
          En <em>Representante</em>, pegá el CUIT de arriba y confirmá. Eso nos
          habilita a emitir con tu CUIT, nada más.
        </Paso>
      </ol>
      <p className="text-xs text-muted-foreground">
        En producción, habilitá un punto de venta para Factura electrónica por Web Services
        en Administración de puntos de venta y domicilios. Debe ser distinto al de
        otros sistemas de emisión. En homologación, las autorizaciones de prueba
        se gestionan por WSASS: delegar en producción no habilita ese ambiente.
      </p>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button asChild variant="outline" size="sm">
          <a href="https://auth.afip.gob.ar/contribuyente_/login.xhtml"
             target="_blank" rel="noopener noreferrer">
            Abrir ARCA <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
          </a>
        </Button>
        <Button size="sm" onClick={() => void solicitarActivacion()} disabled={!canVerify || solicitando || !plataformaCuit || !orgId}>
          {solicitando ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : null}
          Ya delegué · solicitar activación
        </Button>
        {ambiente === "homologacion" && (
          <Badge variant="outline" className="text-[10px]">ambiente de prueba</Badge>
        )}
      </div>
      {ultimoError && <p role="alert" className="text-sm text-destructive break-words">{ultimoError}</p>}

      <p className="text-[11px] text-muted-foreground">
        La solicitud no marca la conexión como lista. Nerqia debe aceptar tu
        designación, asociar su computador fiscal y recién entonces verificar
        el acceso de sólo lectura contra ARCA.
      </p>
    </Card>
  );
}

function Paso({ n, titulo, children }: {
  n: number; titulo: string; children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary grid place-items-center text-[11px] font-semibold">
        {n}
      </span>
      <div>
        <p className="font-medium text-[13px]">{titulo}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{children}</p>
      </div>
    </li>
  );
}
