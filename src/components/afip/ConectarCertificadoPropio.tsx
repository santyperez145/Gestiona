/**
 * Conexión con ARCA por certificado propio del comercio (2026-10-22, ADR 007).
 *
 * El comercio genera el pedido acá, lo sube a ARCA con su clave fiscal, asocia
 * el certificado a Facturación Electrónica y sube el .crt. Nerqia lo prueba
 * contra ARCA y verifica el punto de venta. La clave privada se genera en el
 * servidor y no pasa nunca por el navegador. Nerqia no pide la clave fiscal.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Clock, Download, KeyRound, Loader2, RefreshCw, ShieldAlert, ShieldCheck, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { mensajeDeEdgeFunction } from "@/lib/edgeErrors";
import {
  ALIAS_ARCA, estadoCertificado, pasosEnArca, tipoDePuntoDeVenta, type ConexionConCertificado,
} from "@/lib/certificadoPropio";

export interface EstadoConexionPropia extends ConexionConCertificado {
  tipo_emisor?: string | null;
  punto_venta?: number | null;
  last_error?: string | null;
}

type Respuesta = { ok?: boolean; motivo?: string; error?: string; csr?: string; verificado?: boolean; paso?: string; puntos_habilitados?: number[] };

const fecha = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("es-AR") : "—");

function descargarPedido(csr: string, cuit: string | null | undefined, ambiente: string | null | undefined) {
  const url = URL.createObjectURL(new Blob([csr], { type: "application/pkcs10" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${ALIAS_ARCA}-${String(cuit ?? "").replace(/\D/g, "")}-${ambiente === "homologacion" ? "homo" : "prod"}.csr`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ConectarCertificadoPropio({ orgId, estado, canEdit, onCambio }: {
  orgId: string | null; estado: EstadoConexionPropia; canEdit: boolean; onCambio: () => void;
}) {
  const e = estadoCertificado(estado);
  const [ambiente, setAmbiente] = useState<"produccion" | "homologacion">(estado.environment === "homologacion" ? "homologacion" : "produccion");
  const [trabajando, setTrabajando] = useState<null | "pedido" | "cargar" | "probar" | "conexion" | "par">(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const vivo = useRef(true);
  useEffect(() => () => { vivo.current = false; }, []);

  const llamar = useCallback(async (funcion: "afip-credentials" | "afip-authorize", cuerpo: Record<string, unknown>): Promise<Respuesta> => {
    const { data, error } = await supabase.functions.invoke(funcion, { body: { org_id: orgId, ...cuerpo } });
    const r = (data ?? {}) as Respuesta;
    if (error || r.error) return { ok: false, motivo: await mensajeDeEdgeFunction(error, data) || r.error || "No se pudo completar. Reintentá." };
    return r;
  }, [orgId]);

  const verificarConexion = useCallback(async (silencioso = false) => {
    if (!orgId || !canEdit) return;
    setTrabajando("conexion");
    setAviso(null);
    try {
      const r = await llamar("afip-authorize", { action: "verificar_delegacion" });
      if (!vivo.current) return;
      if (r.ok) {
        toast.success(estado.environment === "homologacion"
          ? "Conexión de prueba verificada: ya podés emitir comprobantes de homologación."
          : "Listo: ARCA confirmó tu certificado y tu punto de venta. Ya podés facturar.");
      } else {
        const puntos = r.puntos_habilitados?.length ? ` Puntos de venta habilitados para Web Services: ${r.puntos_habilitados.join(", ")}.` : "";
        setAviso(`${r.motivo ?? "ARCA no confirmó la conexión."}${puntos}`);
        if (!silencioso) toast.error(r.motivo ?? "ARCA no confirmó la conexión");
      }
      onCambio();
    } finally {
      if (vivo.current) setTrabajando(null);
    }
  }, [orgId, canEdit, llamar, onCambio, estado.environment]);

  // Con el certificado recién aceptado, verificar el punto de venta no depende
  // del comercio: se hace sola una vez.
  const yaVerifico = useRef(false);
  useEffect(() => {
    if (e.fase !== "falta_verificar" || yaVerifico.current || !canEdit) return;
    yaVerifico.current = true;
    void verificarConexion(true);
  }, [e.fase, canEdit, verificarConexion]);

  const generarPedido = async () => {
    setTrabajando("pedido");
    setAviso(null);
    try {
      const r = await llamar("afip-credentials", { action: "generar_pedido", environment: ambiente });
      if (!vivo.current) return;
      if (!r.ok || !r.csr) { toast.error(r.motivo ?? "No se pudo generar el pedido"); return; }
      descargarPedido(r.csr, estado.cuit, ambiente);
      toast.success("Pedido generado y descargado. Seguí con el paso 2 en ARCA.");
      onCambio();
    } finally {
      if (vivo.current) setTrabajando(null);
    }
  };

  const leerArchivo = async (archivo: File | undefined, marca: string): Promise<string | null> => {
    if (!archivo) return null;
    const texto = await archivo.text().catch(() => "");
    if (!texto.includes(marca)) { toast.error(marca.includes("CERTIFICATE") ? "Ese archivo no es un certificado (.crt)." : "Ese archivo no es una clave privada."); return null; }
    return texto;
  };

  const despuesDeCargar = async (r: Respuesta) => {
    if (!r.ok) { toast.error(r.motivo ?? "ARCA no aceptó el certificado"); setAviso(r.motivo ?? null); return; }
    if (r.verificado) {
      toast.success("ARCA aceptó tu certificado. Verificando tu punto de venta…");
      onCambio();
      await verificarConexion(true);
    } else {
      toast.warning(r.motivo ?? "El certificado quedó guardado, pero falta un paso en ARCA.");
      setAviso(r.motivo ?? null);
      onCambio();
    }
  };

  const subirCertificado = async (archivo: File | undefined) => {
    const certificado = await leerArchivo(archivo, "BEGIN CERTIFICATE");
    if (!certificado) return;
    setTrabajando("cargar");
    try {
      const r = await llamar("afip-credentials", { action: "cargar_certificado", certificate: certificado });
      if (vivo.current) await despuesDeCargar(r);
    } finally {
      if (vivo.current) setTrabajando(null);
    }
  };

  const [par, setPar] = useState<{ cert?: string; clave?: string }>({});
  const subirPar = async () => {
    if (!par.cert || !par.clave) return;
    setTrabajando("par");
    try {
      const r = await llamar("afip-credentials", { action: "subir_par", certificate: par.cert, privateKey: par.clave });
      if (vivo.current) { setPar({}); await despuesDeCargar(r); }
    } finally {
      if (vivo.current) setTrabajando(null);
    }
  };

  const probarCertificado = async () => {
    setTrabajando("probar");
    setAviso(null);
    try {
      const r = await llamar("afip-credentials", { action: "verificar" });
      if (!vivo.current) return;
      if (r.ok) {
        toast.success("ARCA acepta tu certificado.");
        onCambio();
        if (!estado.delegacion_verificada) await verificarConexion(true);
      } else {
        setAviso(r.motivo ?? null);
        toast.error(r.motivo ?? "ARCA no aceptó el certificado");
        onCambio();
      }
    } finally {
      if (vivo.current) setTrabajando(null);
    }
  };

  if (e.fase === "sin_cuit") {
    return (
      <Card className="p-4 flex items-start gap-3 border-amber-500/40 bg-amber-500/5">
        <KeyRound className="w-4 h-4 mt-0.5 text-amber-600 shrink-0" />
        <div className="text-sm">
          <p className="font-medium">Primero, tus datos fiscales</p>
          <p className="text-xs text-muted-foreground mt-0.5">Cargá tu CUIT, razón social y punto de venta en <a href="#datos-fiscales" className="underline">Datos fiscales</a>. Con eso generás el pedido de certificado.</p>
        </div>
      </Card>
    );
  }

  const ocupado = trabajando !== null;
  const renovacion = e.fase === "vencido" || e.fase === "por_vencer" || (e.fase === "rechazado" && !!estado.certificado_vence);
  const ambienteDelPedido = estado.pedido_ambiente ?? ambiente;
  const pasos = pasosEnArca(ambienteDelPedido, renovacion);
  const mostrarAsistente = ["sin_certificado", "pedido_pendiente", "vencido", "rechazado", "por_vencer"].includes(e.fase);

  const encabezado = (() => {
    switch (e.fase) {
      case "listo": return { Icono: ShieldCheck, tono: "border-emerald-500/40 bg-emerald-500/5", icono: "text-emerald-600",
        titulo: "Facturás con tu propio certificado", texto: `CUIT ${estado.cuit} · vence el ${fecha(estado.certificado_vence)}${estado.environment === "homologacion" ? " · ambiente de prueba" : ""}.` };
      case "por_vencer": return { Icono: Clock, tono: "border-amber-500/40 bg-amber-500/5", icono: "text-amber-600",
        titulo: `Tu certificado vence en ${e.dias} días`, texto: `Vence el ${fecha(estado.certificado_vence)}. Renovalo ahora (3 minutos) para no cortar la facturación.` };
      case "vencido": return { Icono: ShieldAlert, tono: "border-destructive/40 bg-destructive/5", icono: "text-destructive",
        titulo: "Tu certificado venció", texto: "ARCA no autoriza facturas con él. Generá un pedido nuevo y renovalo en ARCA." };
      case "rechazado": return { Icono: ShieldAlert, tono: "border-destructive/40 bg-destructive/5", icono: "text-destructive",
        titulo: "ARCA rechazó tu certificado", texto: e.motivo ?? "Generá un pedido nuevo y volvé a crear el certificado." };
      case "falta_asociar": return { Icono: Clock, tono: "border-amber-500/40 bg-amber-500/5", icono: "text-amber-600",
        titulo: "Falta un paso en ARCA", texto: e.motivo ?? `Asociá el alias ${ALIAS_ARCA} a Facturación Electrónica.` };
      case "falta_verificar": return { Icono: Clock, tono: "border-blue-500/35 bg-blue-500/5", icono: "text-blue-600",
        titulo: "Certificado activo: falta verificar tu punto de venta", texto: `ARCA aceptó tu certificado. Ahora se comprueba que el punto de venta ${estado.punto_venta ?? ""} esté habilitado para Web Services.` };
      case "pedido_pendiente": return { Icono: KeyRound, tono: "border-border", icono: "text-primary",
        titulo: "Conectá ARCA con tu certificado", texto: `Pedido generado el ${fecha(estado.pedido_creado_at)}. Seguí los pasos en ARCA y subí el certificado.` };
      default: return { Icono: KeyRound, tono: "border-border", icono: "text-primary",
        titulo: "Conectá ARCA con tu certificado", texto: "Facturás con tu propio CUIT y tu certificado. Nerqia nunca te pide la clave fiscal." };
    }
  })();
  const { Icono } = encabezado;

  return (
    <Card className={`p-4 space-y-4 ${encabezado.tono}`}>
      <div className="flex items-start gap-3">
        <Icono className={`w-5 h-5 mt-0.5 shrink-0 ${encabezado.icono}`} />
        <div className="flex-1 text-sm">
          <p className="font-medium">{encabezado.titulo}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{encabezado.texto}</p>
          {estado.last_error && e.fase === "falta_verificar" && <p className="mt-2 text-[11px] text-muted-foreground">ARCA informó: {estado.last_error}</p>}
          {aviso && <p role="alert" className="mt-2 rounded-md border border-amber-500/30 bg-background/60 p-2 text-xs">{aviso}</p>}
        </div>
        {(e.fase === "listo" || e.fase === "por_vencer") && canEdit && (
          <Button size="sm" variant="outline" disabled={ocupado} onClick={() => void probarCertificado()}>
            {trabajando === "probar" ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}Probar con ARCA
          </Button>
        )}
      </div>

      {e.fase === "falta_asociar" && (
        <div className="space-y-2 text-sm">
          <ol className="list-decimal pl-5 space-y-1 text-xs">{pasos[pasos.length - 1].detalle.map(d => <li key={d}>{d}</li>)}</ol>
          <Button size="sm" disabled={!canEdit || ocupado} onClick={() => void probarCertificado()}>
            {trabajando === "probar" && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}Ya lo asocié · probar de nuevo
          </Button>
        </div>
      )}

      {e.fase === "falta_verificar" && (
        <Button size="sm" disabled={!canEdit || ocupado} onClick={() => void verificarConexion()}>
          {trabajando === "conexion" && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}Verificar con ARCA
        </Button>
      )}

      {mostrarAsistente && (
        <details open={e.fase !== "por_vencer"} className="text-sm">
          <summary className="cursor-pointer font-medium">{renovacion ? "Renovar el certificado" : "Paso a paso"}</summary>
          <ol className="mt-3 list-decimal space-y-4 pl-5">
            <li className="space-y-2">
              <p className="font-medium">Generá el pedido de certificado</p>
              <p className="text-xs text-muted-foreground">Nerqia lo arma con tu CUIT. La clave privada se crea en nuestro servidor, cifrada, y no se descarga nunca.</p>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={ambiente} onValueChange={v => setAmbiente(v as "produccion" | "homologacion")}>
                  <SelectTrigger className="h-8 w-56 text-xs" aria-label="Ambiente del certificado"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="produccion">Producción (facturas reales)</SelectItem>
                    <SelectItem value="homologacion">Homologación (pruebas)</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" disabled={!canEdit || ocupado} onClick={() => void generarPedido()}>
                  {trabajando === "pedido" && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                  {estado.pedido_pendiente ? "Generar otro pedido" : "Generar pedido"}
                </Button>
                {estado.pedido_pendiente && estado.pedido_csr && (
                  <Button size="sm" variant="outline" onClick={() => descargarPedido(estado.pedido_csr!, estado.cuit, estado.pedido_ambiente)}>
                    <Download className="w-3.5 h-3.5 mr-1.5" />Descargar pedido (.csr)
                  </Button>
                )}
              </div>
            </li>
            {pasos.map(p => (
              <li key={p.titulo} className="space-y-1">
                <p className="font-medium">{p.titulo}</p>
                <ul className="list-disc pl-5 space-y-1 text-xs text-muted-foreground">{p.detalle.map(d => <li key={d}>{d}</li>)}</ul>
              </li>
            ))}
            {!renovacion && (
              <li className="space-y-1">
                <p className="font-medium">Creá el punto de venta</p>
                <p className="text-xs text-muted-foreground">
                  En «Administración de puntos de venta y domicilios» creá uno {tipoDePuntoDeVenta(estado.tipo_emisor)} y cargá ese número en <a href="#datos-fiscales" className="underline">Datos fiscales</a>
                  {estado.punto_venta ? ` (hoy: ${estado.punto_venta})` : ""}.
                </p>
              </li>
            )}
            <li className="space-y-2">
              <p className="font-medium">Subí el certificado</p>
              <p className="text-xs text-muted-foreground">El .crt que descargaste de ARCA. Nerqia lo prueba con ARCA antes de usarlo.</p>
              <label className={`inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs ${!estado.pedido_pendiente || ocupado || !canEdit ? "pointer-events-none opacity-50" : "hover:bg-muted"}`}>
                {trabajando === "cargar" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                Subir certificado (.crt)
                <input type="file" accept=".crt,.pem,.cer" className="sr-only" disabled={!estado.pedido_pendiente || ocupado || !canEdit}
                  onChange={ev => { void subirCertificado(ev.target.files?.[0]); ev.target.value = ""; }} />
              </label>
              {!estado.pedido_pendiente && <p className="text-xs text-muted-foreground">Primero generá el pedido del paso 1.</p>}
            </li>
          </ol>

          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-muted-foreground">Ya tengo certificado y clave privada</summary>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-1.5 hover:bg-muted">
                {par.cert ? <Check className="h-3 w-3 text-emerald-600" /> : <Upload className="h-3 w-3" />}Certificado (.crt)
                <input type="file" accept=".crt,.pem,.cer" className="sr-only" disabled={!canEdit}
                  onChange={async ev => { const t = await leerArchivo(ev.target.files?.[0], "BEGIN CERTIFICATE"); if (t) setPar(p => ({ ...p, cert: t })); ev.target.value = ""; }} />
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-1.5 hover:bg-muted">
                {par.clave ? <Check className="h-3 w-3 text-emerald-600" /> : <Upload className="h-3 w-3" />}Clave privada (.key)
                <input type="file" accept=".key,.pem" className="sr-only" disabled={!canEdit}
                  onChange={async ev => { const t = await leerArchivo(ev.target.files?.[0], "PRIVATE KEY"); if (t) setPar(p => ({ ...p, clave: t })); ev.target.value = ""; }} />
              </label>
              <Button size="sm" variant="outline" disabled={!canEdit || ocupado || !par.cert || !par.clave} onClick={() => void subirPar()}>
                {trabajando === "par" && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}Cargar y probar
              </Button>
            </div>
          </details>
        </details>
      )}
    </Card>
  );
}
