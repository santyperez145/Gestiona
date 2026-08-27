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
 * **No hay botón de "ya delegué".** La única prueba de que la delegación
 * funciona es que ARCA acepte una emisión. Un checkbox de autodeclaración haría
 * que el panel diga "listo" y la primera factura falle, que es peor que decir
 * "todavía no".
 */
import { useState } from "react";
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
  | "falta_delegar"
  | "listo";

interface Props {
  orgId: string | null;
  motivo: MotivoAfip | null;
  plataformaCuit: string | null;
  plataformaRazonSocial: string | null;
  cuitDelComercio: string | null;
  ambiente: string | null;
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
  onVerificado,
}: Props) {
  const [verificando, setVerificando] = useState(false);

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

  const verificar = async () => {
    setVerificando(true);
    // La verificación la hace el backend contra ARCA: pide un Ticket de Acceso
    // con el certificado de la plataforma y consulta el último comprobante
    // autorizado con el CUIT del comercio. Si ARCA responde, la delegación
    // existe; si no, dice exactamente qué contestó.
    const { data, error } = await supabase.functions.invoke("afip-authorize", {
      body: { action: "verificar_delegacion", org_id: orgId },
    });
    setVerificando(false);

    const r = data as { ok?: boolean } | null;
    if (r?.ok) {
      toast.success("Delegación verificada. Ya podés emitir facturas.");
      onVerificado();
      return;
    }

    // ⚠️ Antes, un fallo con status ≥ 400 mostraba `error.message`, que en
    // `functions.invoke` es SIEMPRE «Edge Function returned a non-2xx status
    // code». El motivo real de ARCA viaja en el cuerpo y quedaba invisible.
    const detalle = await mensajeDeEdgeFunction(error, data);
    console.error("[afip] verificar_delegacion falló:", detalle, { data, error });
    toast.error(detalle || "ARCA todavía no reconoce la delegación");
  };

  if (motivo === "listo") {
    return (
      <Card className="p-4 flex items-start gap-3">
        <Check className="w-4 h-4 mt-0.5 text-green-600 shrink-0" />
        <div className="text-sm">
          <p className="font-medium">AFIP conectado</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Facturás con tu CUIT {formatearCuit(cuitDelComercio)}
            {ambiente === "homologacion" && " en ambiente de prueba (homologación)"}.
            No hay ningún certificado tuyo guardado acá.
          </p>
        </div>
      </Card>
    );
  }

  // Este caso no lo puede resolver el comercio, y decirle "configurá AFIP"
  // sería mandarlo a un trámite que no le toca.
  if (motivo === "falta_plataforma") {
    return (
      <Card className="p-4 flex items-start gap-3 border-amber-500/40 bg-amber-500/5">
        <Clock className="w-4 h-4 mt-0.5 text-amber-600 shrink-0" />
        <div className="text-sm">
          <p className="font-medium">Todavía no podés facturar, y no es algo tuyo</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Falta que la plataforma cargue su certificado de ARCA. Tus datos
            fiscales ya están guardados; cuando esté listo, vas a poder delegar
            el servicio y emitir. No hay nada que puedas hacer de tu lado.
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

  // falta_delegar — el caso principal: hay que guiarlo.
  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-sm">Conectá AFIP en 3 pasos</p>
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
            <Button size="sm" variant="ghost" onClick={() => copiar(formatearCuit(plataformaCuit))}>
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

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button asChild variant="outline" size="sm">
          <a href="https://auth.afip.gob.ar/contribuyente_/login.xhtml"
             target="_blank" rel="noopener noreferrer">
            Abrir ARCA <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
          </a>
        </Button>
        <Button size="sm" onClick={verificar} disabled={verificando || !plataformaCuit || !orgId}>
          {verificando ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : null}
          Ya lo hice, verificar
        </Button>
        {ambiente === "homologacion" && (
          <Badge variant="outline" className="text-[10px]">ambiente de prueba</Badge>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        El botón no marca nada por sí solo: le pregunta a ARCA. Si todavía no
        procesó la delegación —a veces demora unos minutos— te lo va a decir en
        vez de dar por buena una conexión que no funciona.
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
