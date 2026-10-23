/**
 * Consulta de CUIT en la página de ARCA (2026-10-22): dice si el padrón
 * responde, deja probarlo con un CUIT y explica qué asociar en ARCA cuando
 * no. Es el destino de «Cómo habilitarla» en `EstadoDelPadron`. La consulta
 * automática al escribir un CUIT vive en `usePadronAutomatico`.
 */
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Search, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { consultarPadron, domicilioPadron, type ResultadoPadron } from "@/lib/arcaPadron";
import { CONDICIONES_IVA, formatearCuit, validarCuit } from "@/lib/fiscalIdentity";

const PASOS_PADRON = [
  "Entrá a arca.gob.ar con tu clave fiscal.",
  "Abrí «Administrador de Relaciones de Clave Fiscal» y tocá «Nueva relación».",
  "Elegí «ARCA» → «WebServices» → «Consulta de Constancia de Inscripción» (ws_sr_constancia_inscripcion).",
  "En «Representante», elegí el mismo certificado (computador fiscal) con el que facturás desde Nerqia y confirmá.",
  "Volvé acá y tocá «Probar consulta».",
];

export default function ConsultaDeCuit({ orgId, cuitPropio, modo }: { orgId: string | null; cuitPropio: string | null; modo: string | null }) {
  const [cuit, setCuit] = useState(cuitPropio ? formatearCuit(cuitPropio) : "");
  const [probando, setProbando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoPadron | null>(null);
  useEffect(() => { if (cuitPropio) setCuit(c => c || formatearCuit(cuitPropio)); }, [cuitPropio]);

  const digitos = cuit.replace(/\D/g, "");
  const valido = validarCuit(digitos);
  const propio = modo === "propio";

  const probar = async () => {
    if (!orgId || !valido) return;
    setProbando(true);
    setResultado(null);
    setResultado(await consultarPadron(orgId, digitos));
    setProbando(false);
  };

  const fallo = resultado && "error" in resultado ? resultado : null;
  const persona = resultado && !("error" in resultado) ? resultado.persona : null;
  const faltaHabilitar = fallo?.code === "sin_credencial" || fallo?.code === "servicio_no_asociado";

  return (
    <section id="consulta-cuit" aria-labelledby="consulta-cuit-titulo" className="scroll-mt-20 rounded-xl border border-border/40 bg-card p-4">
      <h3 id="consulta-cuit-titulo" className="flex items-center gap-2 text-sm font-semibold"><Search className="h-4 w-4" aria-hidden />Consulta de CUIT (padrón de ARCA)</h3>
      <p className="text-xs text-muted-foreground">
        Al escribir un CUIT en clientes, facturas, el punto de venta, proveedores, compras o retenciones, Nerqia trae de ARCA
        la razón social, la condición frente al IVA y el domicilio. Nunca te pedimos la clave fiscal.
      </p>

      <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={ev => { ev.preventDefault(); void probar(); }}>
        <div className="w-48">
          <Label htmlFor="consulta-cuit-input" className="text-xs">CUIT a consultar</Label>
          <Input id="consulta-cuit-input" inputMode="numeric" className="font-mono" placeholder="20-12345678-9" value={cuit}
            aria-invalid={digitos.length === 11 && !valido} onChange={ev => { setCuit(ev.target.value); setResultado(null); }} />
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={!orgId || !valido || probando}>
          {probando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Search className="mr-2 h-4 w-4" aria-hidden />}Probar consulta
        </Button>
      </form>
      {digitos.length === 11 && !valido && <p role="alert" className="mt-1 text-[11px] text-destructive">Ese CUIT no es válido: revisá los dígitos.</p>}

      {persona && (
        <div role="status" className="mt-3 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.05] p-3 text-xs">
          <p className="flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />La consulta funciona</p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-muted-foreground">
            <dt>Razón social</dt><dd className="text-foreground">{persona.nombre}</dd>
            <dt>Condición</dt><dd className="text-foreground">{CONDICIONES_IVA[persona.condicionIva as keyof typeof CONDICIONES_IVA]?.label ?? persona.condicionIva}{persona.categoriaMonotributo ? ` (categoría ${persona.categoriaMonotributo})` : ""}</dd>
            {domicilioPadron(persona) && <><dt>Domicilio</dt><dd className="text-foreground">{domicilioPadron(persona)}</dd></>}
            {persona.estadoClave && <><dt>Clave fiscal</dt><dd className={persona.estadoClave.toUpperCase() === "ACTIVO" ? "text-foreground" : "text-amber-700 dark:text-amber-300"}>{persona.estadoClave.toLowerCase()}</dd></>}
          </dl>
        </div>
      )}

      {fallo && (
        <div role="status" className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.05] p-3 text-xs text-amber-800 dark:text-amber-200">
          <p className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {faltaHabilitar ? "La consulta todavía no está habilitada para tu certificado." : fallo.error}
          </p>
        </div>
      )}

      {propio ? (
        <details className="mt-3 text-xs" open={faltaHabilitar}>
          <summary className="cursor-pointer font-medium">Cómo habilitarla (una sola vez, 2 minutos)</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
            {PASOS_PADRON.map(p => <li key={p}>{p}</li>)}
          </ol>
        </details>
      ) : (
        <p className="mt-3 text-[11px] text-muted-foreground">
          {faltaHabilitar
            ? "Facturás con el certificado de Nerqia, así que la consulta la habilita Nerqia, no vos. Mientras tanto, los datos se cargan a mano."
            : "Facturás con el certificado de Nerqia: la consulta usa ese certificado y no tenés que asociar nada."}
        </p>
      )}
    </section>
  );
}
