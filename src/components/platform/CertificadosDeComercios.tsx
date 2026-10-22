/**
 * Certificados de ARCA de los comercios, para el staff (2026-10-22, ADR 007).
 *
 * Cada comercio conecta su propio certificado. Soporte necesita ver, antes de
 * que el comercio escriba, quién lo tiene vencido, rechazado, por vencer o a
 * medio conectar. Lee `platform_afip_certificados` (sólo staff, sin secretos).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { isMissingRelation } from "@/lib/publicDataSource";
import { ESTADOS, ordenarPorUrgencia, type CertificadoDeComercio } from "@/lib/certificadosDeComercios";

const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("es-AR") : "—");

type Lectura = { estado: "cargando" } | { estado: "inactivo" } | { estado: "error" } | { estado: "listo"; filas: CertificadoDeComercio[] };

export default function CertificadosDeComercios() {
  const [lectura, setLectura] = useState<Lectura>({ estado: "cargando" });
  const [filtro, setFiltro] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLectura({ estado: "cargando" });
    const { data, error } = await supabase.from("platform_afip_certificados" as never)
      .select("org_id, organization_name, cuit, environment, modo, certificado_vence, certificado_verificado_motivo, pedido_creado_at, last_error, estado");
    if (error) {
      if (isMissingRelation(error)) { setLectura({ estado: "inactivo" }); return; }
      console.error("[ARCA Platform] certificados de comercios", { code: error.code });
      setLectura({ estado: "error" });
      return;
    }
    setLectura({ estado: "listo", filas: ordenarPorUrgencia((data ?? []) as unknown as CertificadoDeComercio[]) });
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const conteo = useMemo(() => {
    const m = new Map<string, number>();
    if (lectura.estado === "listo") for (const f of lectura.filas) m.set(f.estado, (m.get(f.estado) ?? 0) + 1);
    return m;
  }, [lectura]);

  return (
    <section aria-label="Certificados de los comercios" className="rounded-lg border border-border bg-card">
      <div className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div>
          <h2 className="font-semibold">Certificados de los comercios</h2>
          <p className="mt-1 text-xs text-muted-foreground">Cada comercio factura con su propio certificado. Primero lo urgente: vencidos, rechazados y por vencer.</p>
        </div>
        <Button size="icon" variant="ghost" onClick={() => void cargar()} disabled={lectura.estado === "cargando"} aria-label="Actualizar certificados de los comercios">
          <RefreshCw className={`h-4 w-4 ${lectura.estado === "cargando" ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {lectura.estado === "cargando" && <p role="status" className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Leyendo certificados…</p>}
      {lectura.estado === "inactivo" && <p className="p-4 text-sm text-muted-foreground">Disponible cuando se aplique la migración 20261022000200.</p>}
      {lectura.estado === "error" && (
        <div role="alert" className="flex items-center gap-3 p-4 text-sm text-destructive">
          No pudimos leer los certificados. Este error no significa que no haya problemas.
          <Button size="sm" variant="outline" onClick={() => void cargar()}>Reintentar</Button>
        </div>
      )}

      {lectura.estado === "listo" && (
        <>
          <div className="flex flex-wrap gap-2 p-4 pb-0">
            <Button size="sm" variant={filtro === null ? "default" : "outline"} onClick={() => setFiltro(null)}>Todos ({lectura.filas.length})</Button>
            {ESTADOS.filter(e => conteo.get(e.id)).map(e => (
              <Button key={e.id} size="sm" variant={filtro === e.id ? "default" : "outline"} onClick={() => setFiltro(e.id)}>
                {e.etiqueta} ({conteo.get(e.id)})
              </Button>
            ))}
          </div>
          {lectura.filas.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Ningún comercio cargó datos fiscales todavía.</p>
          ) : (
            <div className="overflow-x-auto p-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    {["Comercio", "CUIT", "Estado", "Vence", "Detalle"].map(h => <th key={h} className="py-1.5 pr-3 font-medium">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {lectura.filas.filter(f => !filtro || f.estado === filtro).map(f => {
                    const e = ESTADOS.find(x => x.id === f.estado);
                    return (
                      <tr key={f.org_id} className="border-b border-border/40">
                        <td className="py-1.5 pr-3">{f.organization_name ?? f.org_id}</td>
                        <td className="py-1.5 pr-3 font-mono">{f.cuit ?? "—"}</td>
                        <td className={`py-1.5 pr-3 font-medium ${e?.tono ?? ""}`}>{e?.etiqueta ?? f.estado}{f.environment === "homologacion" ? " · prueba" : ""}</td>
                        <td className="py-1.5 pr-3">{fecha(f.certificado_vence)}</td>
                        <td className="py-1.5 text-muted-foreground">{f.certificado_verificado_motivo || f.last_error || (f.estado === "pedido_pendiente" ? `Pedido del ${fecha(f.pedido_creado_at)}` : "")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
