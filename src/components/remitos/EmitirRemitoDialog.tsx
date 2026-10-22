/**
 * Emitir un remito de entrega, desde una venta o suelto (2026-10-22).
 *
 * Desde una venta muestra, renglón por renglón, lo vendido, lo ya entregado y
 * lo pendiente, y propone entregar todo lo pendiente: es el caso más común y
 * el comercio sólo corrige lo que no sale en este viaje. La base vuelve a
 * controlar el pendiente con la fila bloqueada; esto es para que el error no
 * llegue a pasar.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Loader2, MessageCircle, PackageCheck, Plus, Printer, Settings2, Trash2, Truck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { hoyAR } from "@/lib/fechaAR";
import { useEmisorDelRemito } from "@/hooks/useEmisorDelRemito";
import {
  ESTADOS_REMITO, UNIDADES, abrirVentanaDeRemito, avisoDelCai, cantidadLegible, datosParaEmitir, enlaceWhatsAppDelRemito,
  erroresDelRemito, estadoDeEntrega, imprimirEnVentana, leerCantidad, letraDelRemito, mensajeDeRemito, numeroDeRemito, pendientesDeEntrega,
  TEXTO_ESTADO_DE_ENTREGA, type FormularioRemito, type LineaVendida, type Remito, type RenglonDelFormulario, type Talonario,
} from "@/lib/remitos";
import { emitirRemito, esPasajero, leerRemitosDeVenta, leerTalonario } from "@/lib/remitosDatos";

export interface VentaParaRemito {
  saleTransactionId: string | null;
  codigo: string;
  clienteNombre: string | null;
  lineas: LineaVendida[];
}

type Carga =
  | { estado: "cargando" }
  | { estado: "inactivo" }
  | { estado: "error"; mensaje: string }
  | { estado: "listo"; talonario: Talonario | null; previos: Remito[] };

const formularioVacio = (cliente = ""): FormularioRemito => ({
  fecha: hoyAR(), clienteNombre: cliente, clienteCuit: "", clienteDomicilio: "", transportista: "",
  bultos: "", valorDeclarado: "", observaciones: "", renglones: [],
});

const renglonLibre = (): RenglonDelFormulario => ({ saleId: null, descripcion: "", cantidad: "", unidad: "un", pendiente: null });

export default function EmitirRemitoDialog({ open, onOpenChange, orgId, venta, puedeConfigurar = false, onEmitido }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string | null | undefined;
  /** Sin venta: remito suelto (muestras, préstamos, reposición a un cliente). */
  venta: VentaParaRemito | null;
  puedeConfigurar?: boolean;
  onEmitido?: (remito: Remito) => void;
}) {
  const [carga, setCarga] = useState<Carga>({ estado: "cargando" });
  const [form, setForm] = useState<FormularioRemito>(() => formularioVacio());
  const [intentado, setIntentado] = useState(false);
  const [emitiendo, setEmitiendo] = useState(false);
  const [emitido, setEmitido] = useState<Remito | null>(null);
  const [avisoDeRed, setAvisoDeRed] = useState(false);
  const emisor = useEmisorDelRemito(open);

  const cargar = useCallback(async () => {
    if (!orgId) return;
    setCarga({ estado: "cargando" });
    const saleIds = venta?.lineas.map(l => l.id) ?? [];
    const [tal, previos, cliente] = await Promise.all([
      leerTalonario(orgId),
      leerRemitosDeVenta(orgId, saleIds),
      saleIds.length ? leerClienteDeLaVenta(orgId, saleIds) : Promise.resolve(null),
    ]);
    if (tal.estado === "inactivo" || previos.estado === "inactivo") { setCarga({ estado: "inactivo" }); return; }
    if (tal.estado === "error") { setCarga({ estado: "error", mensaje: tal.mensaje }); return; }
    if (previos.estado === "error") { setCarga({ estado: "error", mensaje: previos.mensaje }); return; }

    const pendientes = venta ? pendientesDeEntrega(venta.lineas, previos.datos) : [];
    setForm({
      ...formularioVacio(cliente?.nombre || venta?.clienteNombre || ""),
      clienteCuit: cliente?.cuit ?? "",
      clienteDomicilio: cliente?.domicilio ?? "",
      renglones: venta
        ? pendientes.map(p => ({ saleId: p.saleId, descripcion: p.descripcion, cantidad: p.pendiente > 0 ? String(p.pendiente) : "", unidad: "un", pendiente: p.pendiente }))
        : [renglonLibre()],
    });
    setCarga({ estado: "listo", talonario: tal.datos, previos: previos.datos });
  }, [orgId, venta]);

  useEffect(() => {
    if (!open) return;
    setEmitido(null); setIntentado(false); setAvisoDeRed(false);
    void cargar();
  }, [open, cargar]);

  const pendientes = useMemo(
    () => (venta && carga.estado === "listo" ? pendientesDeEntrega(venta.lineas, carga.previos) : []),
    [venta, carga],
  );
  const estadoEntrega = venta ? estadoDeEntrega(pendientes) : null;
  const errores = erroresDelRemito(form);
  const talonario = carga.estado === "listo" ? carga.talonario : null;
  const letra = letraDelRemito(talonario, form.fecha);
  const proximo = numeroDeRemito(talonario?.punto_venta ?? 1, talonario?.proximo_numero ?? 1);
  const aviso = avisoDelCai(talonario, hoyAR());
  const unidadesAEntregar = form.renglones.reduce((s, r) => s + (leerCantidad(r.cantidad) || 0), 0);

  const cambiar = <K extends keyof FormularioRemito>(k: K, v: FormularioRemito[K]) => setForm(f => ({ ...f, [k]: v }));
  const cambiarRenglon = (i: number, cambios: Partial<RenglonDelFormulario>) =>
    setForm(f => ({ ...f, renglones: f.renglones.map((r, j) => (j === i ? { ...r, ...cambios } : r)) }));
  const todoLoPendiente = (entregar: boolean) =>
    setForm(f => ({ ...f, renglones: f.renglones.map(r => (r.saleId ? { ...r, cantidad: entregar && (r.pendiente ?? 0) > 0 ? String(r.pendiente) : "" } : r)) }));

  const emitir = async (imprimir: boolean) => {
    setIntentado(true);
    if (!orgId || errores.length > 0 || emitiendo) return;
    // La ventana se abre en el clic: después del await el navegador la bloquea.
    const ventana = imprimir ? abrirVentanaDeRemito() : null;
    if (imprimir && !ventana) toast.warning("Tu navegador bloqueó la ventana de impresión: el remito se emite igual y lo imprimís desde la lista.");
    setEmitiendo(true);
    const r = await emitirRemito(orgId, datosParaEmitir(form, { saleTransactionId: venta?.saleTransactionId ?? null }));
    setEmitiendo(false);
    if ("error" in r) {
      ventana?.close();
      if (esPasajero(r.error)) {
        // No se sabe si llegó: no se reintenta solo (daría dos números).
        setAvisoDeRed(true);
        void cargar();
        return;
      }
      toast.error(r.inactivo ? "Los remitos todavía no están activos en tu cuenta." : mensajeDeRemito(r.error, "emitir el remito"));
      return;
    }
    // La función devuelve la cabecera; los renglones son los que se mandaron
    // (la base los guardó tal cual o habría rechazado el remito entero).
    const remito: Remito = {
      ...r.datos,
      remito_items: form.renglones.filter(x => x.cantidad.trim() !== "").map(x => ({
        sale_id: x.saleId, product_id: null, descripcion: x.descripcion.trim(), cantidad: leerCantidad(x.cantidad), unidad: x.unidad,
      })),
    };
    if (ventana) imprimirEnVentana(ventana, remito, emisor);
    setEmitido(remito);
    onEmitido?.(remito);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="gap-0 p-0" data-testid="emitir-remito">
        {emitido ? (
          <Emitido remito={emitido} onCerrar={() => onOpenChange(false)} onImprimir={() => {
            const v = abrirVentanaDeRemito();
            if (!v) { toast.error("Permití las ventanas emergentes para imprimir el remito."); return; }
            imprimirEnVentana(v, emitido, emisor);
          }} whatsapp={enlaceWhatsAppDelRemito(emitido, emisor)} />
        ) : (
          <>
            <DialogHeader className="border-b border-border/60 px-6 pb-4 pt-6">
              <DialogTitle className="font-display flex items-center gap-2"><Truck className="h-5 w-5 text-primary" />Remito de entrega</DialogTitle>
              <DialogDescription>
                {venta
                  ? <>Venta <span className="font-mono">{venta.codigo}</span>{estadoEntrega ? <> · {TEXTO_ESTADO_DE_ENTREGA[estadoEntrega]}</> : null}</>
                  : "Para entregas que no salen de una venta: muestras, préstamos, reposiciones."}
              </DialogDescription>
            </DialogHeader>

            {carga.estado === "cargando" && (
              <p role="status" className="flex items-center gap-2 px-6 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Preparando el remito…</p>
            )}
            {carga.estado === "inactivo" && (
              <p className="px-6 py-10 text-sm text-muted-foreground">Los remitos todavía no están activos en tu cuenta. Se activan solos; no tenés que hacer nada.</p>
            )}
            {carga.estado === "error" && (
              <div role="alert" className="flex flex-wrap items-center gap-3 px-6 py-10 text-sm text-destructive">
                {carga.mensaje} No se puede emitir sin saber qué falta entregar.
                <Button size="sm" variant="outline" onClick={() => void cargar()}>Reintentar</Button>
              </div>
            )}

            {carga.estado === "listo" && (
              <div className="space-y-6 px-6 py-5">
                <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border/60 bg-muted/20 p-3">
                  <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border-2 border-foreground font-display text-2xl font-bold">{letra}</span>
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium">Remito {letra} · N.º <span className="font-mono">{proximo}</span></p>
                    <p className="text-xs text-muted-foreground">
                      {letra === "R"
                        ? "Con CAI vigente: ampara el traslado de la mercadería."
                        : "Sin CAI: sirve como constancia de entrega («documento no válido como factura»)."}
                    </p>
                  </div>
                  {puedeConfigurar && (
                    <Button asChild size="sm" variant="ghost" className="text-xs">
                      <Link to="/remitos?talonario=1" onClick={() => onOpenChange(false)}><Settings2 className="mr-1.5 h-3.5 w-3.5" />Talonario</Link>
                    </Button>
                  )}
                </div>
                {aviso && (
                  <p role={aviso.tono === "error" ? "alert" : "status"} className={`flex items-start gap-2 rounded-md p-2.5 text-xs ${aviso.tono === "error" ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-800 dark:text-amber-200"}`}>
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{aviso.texto}
                  </p>
                )}

                <section aria-labelledby="remito-que" className="space-y-3">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <h3 id="remito-que" className="text-sm font-semibold">1. Qué se entrega</h3>
                      <p className="text-xs text-muted-foreground">{venta ? "Dejá vacío lo que no sale en este viaje." : "Un renglón por artículo."}</p>
                    </div>
                    {venta && (
                      <div className="flex gap-1.5">
                        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => todoLoPendiente(true)}>Todo lo pendiente</Button>
                        <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => todoLoPendiente(false)}>Vaciar</Button>
                      </div>
                    )}
                  </div>
                  <ul className="divide-y divide-border/50 rounded-lg border border-border/60">
                    {form.renglones.map((r, i) => {
                      const p = r.saleId ? pendientes.find(x => x.saleId === r.saleId) : null;
                      const sinPendiente = p ? p.pendiente <= 0 : false;
                      return (
                        <li key={r.saleId ?? `libre-${i}`} className={`grid gap-3 p-3 sm:grid-cols-[1fr_auto] sm:items-center ${sinPendiente ? "opacity-60" : ""}`}>
                          <div className="min-w-0">
                            {r.saleId ? (
                              <>
                                <p className="truncate text-sm font-medium">{r.descripcion}</p>
                                {p && (
                                  <p className="text-xs text-muted-foreground">
                                    Vendido {cantidadLegible(p.vendido)}
                                    {p.devuelto > 0 && <> · devuelto {cantidadLegible(p.devuelto)}</>}
                                    {p.remitido > 0 && <> · entregado {cantidadLegible(p.remitido)}</>}
                                    {" · "}<span className={sinPendiente ? "" : "font-medium text-foreground"}>{sinPendiente ? "nada pendiente" : `pendiente ${cantidadLegible(p.pendiente)}`}</span>
                                  </p>
                                )}
                              </>
                            ) : (
                              <Input aria-label={`Descripción del renglón ${i + 1}`} placeholder="Qué se entrega (ej.: Caja de tornillos 6 mm)" value={r.descripcion}
                                onChange={e => cambiarRenglon(i, { descripcion: e.target.value })} maxLength={300} />
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <Input aria-label={`Cantidad a entregar de ${r.descripcion || `renglón ${i + 1}`}`} inputMode="decimal" className="h-9 w-24 text-right font-mono"
                              placeholder="0" value={r.cantidad} disabled={sinPendiente} onChange={e => cambiarRenglon(i, { cantidad: e.target.value })} />
                            <Select value={r.unidad} onValueChange={v => cambiarRenglon(i, { unidad: v })}>
                              <SelectTrigger aria-label="Unidad" className="h-9 w-[5.5rem]"><SelectValue /></SelectTrigger>
                              <SelectContent>{UNIDADES.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                            </Select>
                            {!r.saleId && form.renglones.length > 1 && (
                              <Button type="button" size="icon" variant="ghost" className="h-9 w-9" aria-label={`Quitar renglón ${i + 1}`}
                                onClick={() => setForm(f => ({ ...f, renglones: f.renglones.filter((_, j) => j !== i) }))}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setForm(f => ({ ...f, renglones: [...f.renglones, renglonLibre()] }))}>
                    <Plus className="mr-1.5 h-3.5 w-3.5" />{venta ? "Agregar algo que no está en la venta" : "Agregar renglón"}
                  </Button>
                  {carga.previos.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Entregas anteriores:</span>{" "}
                      {carga.previos.map(pr => (
                        <span key={pr.id} className="mr-2 inline-flex items-center gap-1 whitespace-nowrap">
                          <span className="font-mono">{pr.letra} {numeroDeRemito(pr.punto_venta, pr.numero)}</span>
                          <span className={pr.estado === "anulado" ? "line-through" : ""}>({ESTADOS_REMITO[pr.estado].label.toLowerCase()})</span>
                        </span>
                      ))}
                    </div>
                  )}
                </section>

                <section aria-labelledby="remito-quien" className="space-y-3">
                  <h3 id="remito-quien" className="text-sm font-semibold">2. A quién se entrega</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="remito-cliente">Nombre o razón social</Label>
                      <Input id="remito-cliente" value={form.clienteNombre} maxLength={200} onChange={e => cambiar("clienteNombre", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="remito-cuit">CUIT o DNI <span className="font-normal text-muted-foreground">(opcional)</span></Label>
                      <Input id="remito-cuit" inputMode="numeric" value={form.clienteCuit} maxLength={20} onChange={e => cambiar("clienteCuit", e.target.value)} />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="remito-domicilio">Domicilio de entrega</Label>
                      <Input id="remito-domicilio" value={form.clienteDomicilio} maxLength={300} placeholder="Calle, número, localidad" onChange={e => cambiar("clienteDomicilio", e.target.value)} />
                    </div>
                  </div>
                </section>

                <section aria-labelledby="remito-transporte" className="space-y-3">
                  <h3 id="remito-transporte" className="text-sm font-semibold">3. Transporte <span className="font-normal text-muted-foreground">(opcional)</span></h3>
                  <div className="grid gap-3 sm:grid-cols-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="remito-fecha">Fecha</Label>
                      <Input id="remito-fecha" type="date" value={form.fecha} onChange={e => cambiar("fecha", e.target.value || hoyAR())} />
                    </div>
                    <div className="space-y-1.5 sm:col-span-3">
                      <Label htmlFor="remito-transportista">Transportista</Label>
                      <Input id="remito-transportista" value={form.transportista} maxLength={200} placeholder="Propio, expreso, flete…" onChange={e => cambiar("transportista", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="remito-bultos">Bultos</Label>
                      <Input id="remito-bultos" inputMode="numeric" value={form.bultos} onChange={e => cambiar("bultos", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="remito-valor">Valor declarado</Label>
                      <Input id="remito-valor" inputMode="decimal" placeholder="$" value={form.valorDeclarado} onChange={e => cambiar("valorDeclarado", e.target.value)} />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="remito-obs">Observaciones</Label>
                      <Textarea id="remito-obs" rows={1} className="min-h-9" maxLength={1000} value={form.observaciones} onChange={e => cambiar("observaciones", e.target.value)} />
                    </div>
                  </div>
                </section>

                {avisoDeRed && (
                  <p role="alert" className="flex items-start gap-2 rounded-md bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    Se cortó la conexión y no sabemos si el remito llegó a emitirse. Ya actualizamos lo pendiente: revisá «Entregas anteriores» antes de volver a emitir.
                  </p>
                )}
                {intentado && errores.length > 0 && (
                  <ul role="alert" className="space-y-1 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                    {errores.map(e => <li key={e}>{e}</li>)}
                  </ul>
                )}
              </div>
            )}

            {carga.estado === "listo" && (
              <DialogFooter className="border-t border-border/60 bg-muted/10 px-6 py-4 sm:items-center">
                <p className="mr-auto hidden text-xs text-muted-foreground sm:block">
                  {unidadesAEntregar > 0 ? `${cantidadLegible(unidadesAEntregar)} en total` : "Sin cantidades cargadas"}
                </p>
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={emitiendo}>Cancelar</Button>
                <Button variant="outline" onClick={() => void emitir(false)} disabled={emitiendo}>Emitir</Button>
                <Button onClick={() => void emitir(true)} disabled={emitiendo}>
                  {emitiendo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
                  Emitir e imprimir
                </Button>
              </DialogFooter>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Emitido({ remito, onCerrar, onImprimir, whatsapp }: { remito: Remito; onCerrar: () => void; onImprimir: () => void; whatsapp: string }) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-10 text-center" role="status">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-600"><CheckCircle2 className="h-7 w-7" /></span>
      <div>
        <DialogTitle className="font-display text-xl">Remito {remito.letra} {numeroDeRemito(remito.punto_venta, remito.numero)} emitido</DialogTitle>
        <DialogDescription className="mt-1">
          Para {remito.cliente_nombre} · {remito.remito_items.length} {remito.remito_items.length === 1 ? "renglón" : "renglones"}. Cuando lo entreguen, marcalo como entregado en Remitos.
        </DialogDescription>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="outline" onClick={onImprimir}><Printer className="mr-2 h-4 w-4" />Imprimir</Button>
        <Button variant="outline" asChild><a href={whatsapp} target="_blank" rel="noopener noreferrer"><MessageCircle className="mr-2 h-4 w-4" />WhatsApp</a></Button>
        <Button variant="outline" asChild><Link to="/remitos" onClick={onCerrar}><PackageCheck className="mr-2 h-4 w-4" />Ver remitos</Link></Button>
        <Button onClick={onCerrar}>Listo</Button>
      </div>
    </div>
  );
}

/** Nombre, CUIT y domicilio del cliente de la venta, si la venta tiene cliente cargado. */
async function leerClienteDeLaVenta(orgId: string, saleIds: string[]): Promise<{ nombre: string; cuit: string | null; domicilio: string | null } | null> {
  const venta = await supabase.from("sales").select("customer_id").eq("org_id", orgId).in("id", saleIds).not("customer_id", "is", null).limit(1);
  const id = venta.data?.[0]?.customer_id;
  if (venta.error || !id) return null;
  const c = await supabase.from("customers").select("name, legal_name, tax_id, address, fiscal_address").eq("id", id).maybeSingle();
  if (c.error || !c.data) return null;
  return {
    nombre: c.data.legal_name?.trim() || c.data.name,
    cuit: c.data.tax_id?.replace(/\D/g, "") || null,
    domicilio: c.data.address?.trim() || c.data.fiscal_address?.trim() || null,
  };
}
