/**
 * Factura de exportación «E» en la factura manual (2026-10-22): al activarla
 * el comprobante es tipo 19, sin IVA, y se cargan los datos que pide WSFEX
 * (tipo de exportación, país, cliente del exterior, Incoterm, idioma, forma
 * y fecha de pago, permiso de embarque). Las listas de países e Incoterms
 * son las que publica ARCA (`arca_parametros_fex`); ver `arca-fex`.
 */
import { useCallback, useEffect, useState } from "react";
import { Globe2, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { exportacionInicial, type DetalleFiscal, type ExportacionForm } from "@/lib/detalleFiscal";
import { mensajeDeEdgeFunction } from "@/lib/edgeErrors";
import { isMissingRelation } from "@/lib/publicDataSource";

type Item = { codigo: string; descripcion: string };
type Listas = { paises: Item[]; incoterms: Item[]; cuit_paises: Item[] };

/** Incoterms 2020, por si todavía no se trajo la lista de ARCA. */
const INCOTERMS_BASE = ["EXW", "FCA", "CPT", "CIP", "DAP", "DPU", "DDP", "FAS", "FOB", "CFR", "CIF"].map(c => ({ codigo: c, descripcion: c }));

/** «220 — PARAGUAY» o «220» → «220». */
const codigoDe = (texto: string) => (texto.match(/^\s*(\d{1,3})\b/) ?? [])[1] ?? "";

export default function FacturaDeExportacion({ valor, onChange, orgId, ambiente, puedeActualizar }: {
  valor: DetalleFiscal; onChange: (d: DetalleFiscal) => void; orgId?: string | null; ambiente: string | null; puedeActualizar: boolean;
}) {
  const [listas, setListas] = useState<Listas | null>(null);
  const [actualizando, setActualizando] = useState(false);
  const [paisTexto, setPaisTexto] = useState("");
  const e = valor.exportacion;
  const activa = Boolean(e);

  const leer = useCallback(async () => {
    if (!ambiente) return;
    const { data, error } = await supabase.from("arca_parametros_fex").select("tipo, datos").eq("environment", ambiente);
    if (error) { if (!isMissingRelation(error)) console.error("arca_parametros_fex", error); setListas({ paises: [], incoterms: [], cuit_paises: [] }); return; }
    const de = (tipo: string) => ((data ?? []).find(f => f.tipo === tipo)?.datos ?? []) as Item[];
    setListas({ paises: de("paises"), incoterms: de("incoterms"), cuit_paises: de("cuit_paises") });
  }, [ambiente]);

  useEffect(() => { if (activa && !listas) void leer(); }, [activa, listas, leer]);

  const nombrePais = (codigo: string) => listas?.paises.find(p => p.codigo === codigo)?.descripcion;
  useEffect(() => {
    if (!e) return;
    const nombre = nombrePais(e.paisDestino);
    if (e.paisDestino && nombre && codigoDe(paisTexto) !== e.paisDestino) setPaisTexto(`${e.paisDestino} — ${nombre}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listas, e?.paisDestino]);

  const cambiar = (parcial: Partial<ExportacionForm>) => onChange({ ...valor, exportacion: { ...(e ?? exportacionInicial()), ...parcial } });

  const actualizar = async () => {
    if (!orgId) return;
    setActualizando(true);
    const { data, error } = await supabase.functions.invoke("arca-fex", { body: { action: "parametros", org_id: orgId } });
    setActualizando(false);
    const mensaje = await mensajeDeEdgeFunction(error, data);
    if (mensaje) { toast.error(mensaje); return; }
    toast.success("Listas de ARCA actualizadas");
    void leer();
  };

  const incoterms = listas?.incoterms.length ? listas.incoterms : INCOTERMS_BASE;
  const sinListas = Boolean(listas) && !listas!.paises.length;

  return (
    <section aria-labelledby="factura-e" className="rounded-[8px] border border-border/60 p-3 space-y-3">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={activa}
          onChange={ev => onChange({ ...valor, exportacion: ev.target.checked ? exportacionInicial() : null, fce: ev.target.checked ? false : valor.fce })} />
        <span>
          <span id="factura-e" className="font-medium flex items-center gap-1.5"><Globe2 className="h-4 w-4 text-primary" aria-hidden />Factura de exportación (E)</span>
          <span className="block text-xs text-muted-foreground">Para un cliente del exterior: sin IVA, en el punto de venta de exportación.</span>
        </span>
      </label>

      {e && (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="fe-tipo" className="text-xs">Qué exportás</Label>
            <Select value={e.tipoExpo} onValueChange={v => cambiar({ tipoExpo: v as ExportacionForm["tipoExpo"] })}>
              <SelectTrigger id="fe-tipo"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Bienes (exportación definitiva)</SelectItem>
                <SelectItem value="2">Servicios</SelectItem>
                <SelectItem value="4">Otros</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="fe-pais" className="text-xs">País de destino</Label>
            <Input id="fe-pais" list="fe-paises" value={paisTexto} placeholder={sinListas ? "Código de ARCA (ej. 220)" : "Escribí el país"}
              onChange={ev => { setPaisTexto(ev.target.value); cambiar({ paisDestino: codigoDe(ev.target.value) }); }} />
            <datalist id="fe-paises">{(listas?.paises ?? []).map(p => <option key={p.codigo} value={`${p.codigo} — ${p.descripcion}`} />)}</datalist>
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="fe-domicilio" className="text-xs">Domicilio del cliente</Label>
            <Input id="fe-domicilio" maxLength={300} value={e.domicilio} onChange={ev => cambiar({ domicilio: ev.target.value })} />
          </div>
          <div>
            <Label htmlFor="fe-idimp" className="text-xs">Identificación tributaria del cliente</Label>
            <Input id="fe-idimp" maxLength={50} value={e.idImpositivo} placeholder="Tax ID, RUC, VAT…" onChange={ev => cambiar({ idImpositivo: ev.target.value })} />
          </div>
          <div>
            <Label htmlFor="fe-cuitpais" className="text-xs">CUIT del país <span className="font-normal text-muted-foreground">(si no tiene identificación)</span></Label>
            {listas?.cuit_paises.length ? (
              <Select value={e.cuitPais || "ninguna"} onValueChange={v => cambiar({ cuitPais: v === "ninguna" ? "" : v })}>
                <SelectTrigger id="fe-cuitpais"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ninguna">No corresponde</SelectItem>
                  {listas.cuit_paises.map(c => <SelectItem key={c.codigo} value={c.codigo}>{c.descripcion} · {c.codigo}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <Input id="fe-cuitpais" inputMode="numeric" maxLength={13} value={e.cuitPais} onChange={ev => cambiar({ cuitPais: ev.target.value.replace(/[^\d-]/g, "") })} />
            )}
          </div>
          <div>
            <Label htmlFor="fe-pago" className="text-xs">Forma de pago</Label>
            <Input id="fe-pago" maxLength={50} value={e.formaPago} placeholder="Transferencia 30 días" onChange={ev => cambiar({ formaPago: ev.target.value })} />
          </div>
          <div>
            <Label htmlFor="fe-idioma" className="text-xs">Idioma del comprobante</Label>
            <Select value={e.idioma} onValueChange={v => cambiar({ idioma: v as ExportacionForm["idioma"] })}>
              <SelectTrigger id="fe-idioma"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Español</SelectItem>
                <SelectItem value="2">Inglés</SelectItem>
                <SelectItem value="3">Portugués</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="fe-incoterm" className="text-xs">Incoterm {e.tipoExpo !== "1" && <span className="font-normal text-muted-foreground">(opcional)</span>}</Label>
            <Select value={e.incoterms || "ninguno"} onValueChange={v => cambiar({ incoterms: v === "ninguno" ? "" : v })}>
              <SelectTrigger id="fe-incoterm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {e.tipoExpo !== "1" && <SelectItem value="ninguno">Sin Incoterm</SelectItem>}
                {incoterms.map(i => <SelectItem key={i.codigo} value={i.codigo}>{i.codigo}{i.descripcion !== i.codigo ? ` · ${i.descripcion}` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="fe-incoterm-ds" className="text-xs">Detalle del Incoterm <span className="font-normal text-muted-foreground">(opcional)</span></Label>
            <Input id="fe-incoterm-ds" maxLength={20} value={e.incotermsDs} placeholder="Puerto de Buenos Aires" onChange={ev => cambiar({ incotermsDs: ev.target.value })} />
          </div>

          {e.tipoExpo === "1" ? (
            <div className="md:col-span-2 space-y-2">
              <fieldset className="flex flex-wrap items-center gap-4 text-sm">
                <legend className="text-xs font-medium mb-1">¿Ya tenés el permiso de embarque?</legend>
                {(["N", "S"] as const).map(v => (
                  <label key={v} className="flex items-center gap-1.5">
                    <input type="radio" name="fe-permiso" className="accent-primary" checked={e.permisoExistente === v}
                      onChange={() => cambiar({ permisoExistente: v, permisos: v === "S" && !e.permisos.length ? [{ id: "", destino: e.paisDestino }] : e.permisos })} />
                    {v === "S" ? "Sí" : "Todavía no"}
                  </label>
                ))}
              </fieldset>
              {e.permisoExistente === "S" && (
                <div className="space-y-2">
                  {e.permisos.map((p, i) => (
                    <div key={i} className="grid grid-cols-[1fr_8rem_auto] items-end gap-2">
                      <div>
                        <Label htmlFor={`fe-permiso-${i}`} className="text-xs">Permiso de embarque</Label>
                        <Input id={`fe-permiso-${i}`} maxLength={16} className="font-mono uppercase" placeholder="26001EC01000123A" value={p.id}
                          onChange={ev => cambiar({ permisos: e.permisos.map((x, j) => (j === i ? { ...x, id: ev.target.value.toUpperCase() } : x)) })} />
                      </div>
                      <div>
                        <Label htmlFor={`fe-permiso-pais-${i}`} className="text-xs">País (código)</Label>
                        <Input id={`fe-permiso-pais-${i}`} inputMode="numeric" maxLength={3} value={p.destino}
                          onChange={ev => cambiar({ permisos: e.permisos.map((x, j) => (j === i ? { ...x, destino: ev.target.value.replace(/\D/g, "") } : x)) })} />
                      </div>
                      <Button type="button" size="icon" variant="ghost" aria-label={`Quitar el permiso ${i + 1}`}
                        onClick={() => cambiar({ permisos: e.permisos.filter((_, j) => j !== i) })}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                  <Button type="button" size="sm" variant="outline" onClick={() => cambiar({ permisos: [...e.permisos, { id: "", destino: e.paisDestino }] })}>
                    <Plus className="mr-1.5 h-3.5 w-3.5" />Otro permiso
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div>
              <Label htmlFor="fe-fecha-pago" className="text-xs">Fecha de pago</Label>
              <Input id="fe-fecha-pago" type="date" value={e.fechaPago} onChange={ev => cambiar({ fechaPago: ev.target.value })} />
            </div>
          )}

          <div className="md:col-span-2">
            <Label htmlFor="fe-obs" className="text-xs">Observaciones comerciales <span className="font-normal text-muted-foreground">(opcional)</span></Label>
            <Textarea id="fe-obs" rows={2} maxLength={4000} value={e.observaciones} onChange={ev => cambiar({ observaciones: ev.target.value })} />
          </div>

          {sinListas && (
            <div className="md:col-span-2 flex flex-wrap items-center gap-2 rounded-md bg-muted/30 p-2 text-xs text-muted-foreground">
              Todavía no se trajeron de ARCA las listas de países e Incoterms.
              {puedeActualizar && (
                <Button type="button" size="sm" variant="outline" disabled={actualizando} onClick={() => void actualizar()}>
                  {actualizando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}Traer de ARCA
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
