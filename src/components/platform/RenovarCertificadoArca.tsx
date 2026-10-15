/**
 * Certificado de ARCA de la plataforma: prueba real y renovación guiada
 * (2026-10-15).
 *
 * El certificado guardado como «producción» lo había emitido «Computadores
 * Test» (homologación) y WSAA producción lo rechazaba: ningún comercio podía
 * facturar. La pantalla no lo sabía porque sólo miraba que hubiera algo
 * cargado. Ahora:
 *   · muestra la última prueba real contra ARCA y permite repetirla;
 *   · genera el pedido de certificado (CSR) en el servidor: la clave privada
 *     no pasa por la computadora de nadie;
 *   · recibe sólo el .crt, lo prueba contra ARCA y recién entonces lo activa.
 */
import { useState } from "react";
import { Loader2, ShieldCheck, ShieldAlert, Download, Upload, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { dondeSubirElPedido, type AmbienteArca } from "@/lib/renovarCertificadoArca";
import { mensajeDeError } from "@/lib/cuentaCorriente";
import { fechaLocal } from "@/lib/fechaAR";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface EstadoCertificado {
  cuit?: string | null;
  environment?: string | null;
  certificado_emisor?: string | null;
  verificado_ok?: boolean | null;
  verificado_motivo?: string | null;
  verificado_at?: string | null;
  certificate_expires_at?: string | null;
  pedido_pendiente?: boolean | null;
  pedido_csr?: string | null;
  pedido_ambiente?: string | null;
  pedido_creado_at?: string | null;
}

type Respuesta = { ok?: boolean; motivo?: string; csr?: string; certificado_vence?: string; emisor?: string };

async function llamar(cuerpo: Record<string, unknown>): Promise<Respuesta> {
  const { data, error } = await supabase.functions.invoke("afip-platform-cert", { body: cuerpo });
  if (error) throw error;
  return (data ?? {}) as Respuesta;
}

const fecha = (iso?: string | null) => (iso ? fechaLocal(iso).toLocaleDateString("es-AR") : "—");

/** ¿Es un certificado de homologación cargado como producción? */
export function esCertificadoDePrueba(estado: EstadoCertificado | null): boolean {
  return estado?.environment === "produccion" && /test/i.test(estado?.certificado_emisor ?? "");
}

export default function RenovarCertificadoArca({ estado, onCambio }: { estado: EstadoCertificado | null; onCambio: () => void }) {
  const [ambiente, setAmbiente] = useState<AmbienteArca>("produccion");
  const [trabajando, setTrabajando] = useState<null | "probar" | "pedido" | "cargar">(null);

  const ejecutar = async (que: "probar" | "pedido" | "cargar", cuerpo: Record<string, unknown>, exito: string) => {
    setTrabajando(que);
    try {
      const r = await llamar(cuerpo);
      if (r.ok) toast.success(exito);
      else toast.error(r.motivo ?? "ARCA no respondió lo esperado");
      onCambio();
      return r;
    } catch (e) {
      toast.error(`No se pudo completar: ${mensajeDeError(e)}`);
      return null;
    } finally {
      setTrabajando(null);
    }
  };

  const descargarPedido = () => {
    if (!estado?.pedido_csr) return;
    const blob = new Blob([estado.pedido_csr], { type: "application/pkcs10" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `nerqia-${estado.pedido_ambiente === "homologacion" ? "homo" : "prod"}.csr`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const subirCertificado = async (archivo: File | undefined) => {
    if (!archivo) return;
    const texto = await archivo.text().catch(() => "");
    if (!texto.includes("BEGIN CERTIFICATE")) { toast.error("Ese archivo no es un certificado (.crt)"); return; }
    await ejecutar("cargar", { action: "cargar_certificado", certificate: texto }, "ARCA aceptó el certificado: quedó activo");
  };

  const prueba = esCertificadoDePrueba(estado);
  const ok = estado?.verificado_ok === true;

  return (
    <section className="space-y-4 rounded-lg border border-border p-4 text-sm">
      <div className={`flex items-start gap-3 rounded-md p-3 ${ok ? "bg-emerald-500/10" : "bg-destructive/10"}`}>
        {ok ? <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /> : <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />}
        <div className="flex-1 space-y-1">
          <p className="font-medium">
            {estado?.verificado_at == null ? "El certificado todavía no se probó contra ARCA"
              : ok ? "ARCA acepta el certificado" : "ARCA rechaza el certificado: ningún comercio puede facturar"}
          </p>
          {prueba && (
            <p>Es un certificado de <strong>homologación</strong> (lo emitió «{estado?.certificado_emisor}») cargado como producción. Hace falta uno de producción: seguí los pasos de abajo.</p>
          )}
          {!ok && estado?.verificado_motivo && !prueba && <p>{estado.verificado_motivo}</p>}
          <p className="text-xs text-muted-foreground">
            Última prueba: {fecha(estado?.verificado_at)} · Vence: {fecha(estado?.certificate_expires_at)}
            {estado?.certificado_emisor ? ` · Emisor: ${estado.certificado_emisor}` : ""}
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={trabajando !== null}
          onClick={() => void ejecutar("probar", { action: "verificar" }, "Prueba hecha: ARCA aceptó el certificado")}>
          {trabajando === "probar" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
          Probar con ARCA
        </Button>
      </div>

      <details open={!ok}>
        <summary className="cursor-pointer font-medium">Obtener un certificado nuevo, paso a paso</summary>
        <ol className="mt-3 list-decimal space-y-4 pl-5">
          <li className="space-y-2">
            <p>Nerqia genera el pedido de certificado (CSR). La clave privada se crea en el servidor, queda cifrada y no la descarga nadie.</p>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={ambiente} onValueChange={v => setAmbiente(v as AmbienteArca)}>
                <SelectTrigger className="h-8 w-56 text-xs" aria-label="Ambiente del certificado"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="produccion">Producción (facturas reales)</SelectItem>
                  <SelectItem value="homologacion">Homologación (pruebas)</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" disabled={trabajando !== null}
                onClick={() => void ejecutar("pedido", { action: "generar_pedido", environment: ambiente }, "Pedido generado: descargalo y subilo a ARCA")}>
                {trabajando === "pedido" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                {estado?.pedido_pendiente ? "Generar otro pedido" : "Generar pedido"}
              </Button>
              {estado?.pedido_pendiente && estado.pedido_csr && (
                <Button size="sm" variant="outline" onClick={descargarPedido}>
                  <Download className="mr-1 h-3 w-3" />Descargar pedido (.csr)
                </Button>
              )}
            </div>
            {estado?.pedido_pendiente && (
              <p className="text-xs text-muted-foreground">
                Pedido de {estado.pedido_ambiente === "homologacion" ? "homologación" : "producción"} generado el {fecha(estado.pedido_creado_at)}. Generar otro reemplaza a este.
              </p>
            )}
          </li>
          <li>{dondeSubirElPedido((estado?.pedido_ambiente as AmbienteArca) ?? ambiente)} Usá el alias <code>nerqia</code> y el CUIT {estado?.cuit ?? "de la plataforma"}.</li>
          <li className="space-y-2">
            <p>Subí acá el certificado (.crt) que te dio ARCA. Nerqia lo prueba con ARCA y recién si lo acepta reemplaza al actual; si no, no cambia nada.</p>
            <label className={`inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs ${!estado?.pedido_pendiente || trabajando ? "pointer-events-none opacity-50" : "hover:bg-muted"}`}>
              {trabajando === "cargar" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
              Subir certificado (.crt)
              <input type="file" accept=".crt,.pem,.cer" className="sr-only" disabled={!estado?.pedido_pendiente || trabajando !== null}
                onChange={e => { void subirCertificado(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            {!estado?.pedido_pendiente && <p className="text-xs text-muted-foreground">Primero generá el pedido del paso 1.</p>}
          </li>
          <li>
            En ARCA, «Administrador de Relaciones de Clave Fiscal» del CUIT {estado?.cuit ?? "de la plataforma"} → Nueva relación → AFIP → WebServices → Facturación Electrónica, y como representante el computador fiscal <code>nerqia</code>. Sin esa relación el certificado autentica pero no puede facturar.
          </li>
        </ol>
      </details>
    </section>
  );
}
