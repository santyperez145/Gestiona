/**
 * Diálogos de un remito ya emitido: marcar entregado, anular, ver el detalle
 * y configurar el talonario. Todo pasa por las funciones de la base; acá sólo
 * se valida lo que se puede validar antes de mandar.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Ban, CheckCircle2, Loader2, MessageCircle, Printer, Receipt } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { fechaFiscalArgentina } from "@/lib/arcaInvoice";
import { formatearCuit, validarDni } from "@/lib/fiscalIdentity";
import {
  ESTADOS_REMITO, cantidadLegible, enlaceWhatsAppDelRemito, erroresDelTalonario, mensajeDeRemito, numeroDeRemito,
  type EmisorDelRemito, type Remito, type Talonario,
} from "@/lib/remitos";
import { anularRemito, configurarTalonario, marcarEntregado } from "@/lib/remitosDatos";

const ars = (n: number) => n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
const fechaHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "—");

const TONO: Record<Remito["estado"], string> = {
  emitido: "bg-blue-500/10 text-blue-700 dark:text-blue-300 ring-blue-500/20",
  entregado: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20",
  anulado: "bg-muted text-muted-foreground ring-border",
};

export function EstadoDelRemito({ estado }: { estado: Remito["estado"] }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${TONO[estado]}`}>{ESTADOS_REMITO[estado].label}</span>;
}

export function LetraDelRemito({ letra, chica = false }: { letra: "R" | "X"; chica?: boolean }) {
  return (
    <span role="img" aria-label={`Remito ${letra}`} className={`inline-flex shrink-0 items-center justify-center rounded border-[1.5px] border-foreground/80 font-display font-bold ${chica ? "h-6 w-6 text-xs" : "h-9 w-9 text-lg"}`}>
      {letra}
    </span>
  );
}

// ── Entregado ──────────────────────────────────────────────────────────────

export function EntregarRemitoDialog({ remito, onCerrar, onListo }: { remito: Remito | null; onCerrar: () => void; onListo: () => void }) {
  const [nombre, setNombre] = useState("");
  const [dni, setDni] = useState("");
  const [enviando, setEnviando] = useState(false);
  useEffect(() => { if (remito) { setNombre(""); setDni(""); } }, [remito]);
  const dniInvalido = dni.trim() !== "" && !validarDni(dni);

  const confirmar = async () => {
    if (!remito || !nombre.trim() || dniInvalido) return;
    setEnviando(true);
    const r = await marcarEntregado(remito.id, nombre.trim(), dni.replace(/\D/g, ""));
    setEnviando(false);
    if ("error" in r) { toast.error(mensajeDeRemito(r.error, "marcarlo como entregado")); return; }
    toast.success(`Remito ${numeroDeRemito(remito.punto_venta, remito.numero)} entregado`);
    onListo();
  };

  return (
    <Dialog open={Boolean(remito)} onOpenChange={o => { if (!o) onCerrar(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Marcar como entregado</DialogTitle>
          <DialogDescription>
            {remito && <>Remito {remito.letra} {numeroDeRemito(remito.punto_venta, remito.numero)} para {remito.cliente_nombre}. Anotá quién lo recibió, como figura en la firma del papel.</>}
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-3 sm:grid-cols-[1fr_10rem]" onSubmit={e => { e.preventDefault(); void confirmar(); }}>
          <div className="space-y-1.5">
            <Label htmlFor="recibio-nombre">Recibió</Label>
            <Input id="recibio-nombre" autoFocus value={nombre} maxLength={200} placeholder="Nombre y apellido" onChange={e => setNombre(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="recibio-dni">DNI <span className="font-normal text-muted-foreground">(opcional)</span></Label>
            <Input id="recibio-dni" inputMode="numeric" value={dni} maxLength={12} aria-invalid={dniInvalido} onChange={e => setDni(e.target.value)} />
          </div>
          {dniInvalido && <p role="alert" className="text-xs text-destructive sm:col-span-2">El DNI tiene 7 u 8 dígitos.</p>}
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={onCerrar}>Cancelar</Button>
            <Button type="submit" disabled={!nombre.trim() || dniInvalido || enviando}>
              {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}Confirmar entrega
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Anular ─────────────────────────────────────────────────────────────────

export function AnularRemitoDialog({ remito, onCerrar, onListo }: { remito: Remito | null; onCerrar: () => void; onListo: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  useEffect(() => { if (remito) setMotivo(""); }, [remito]);

  const confirmar = async () => {
    if (!remito || !motivo.trim()) return;
    setEnviando(true);
    const r = await anularRemito(remito.id, motivo.trim());
    setEnviando(false);
    if ("error" in r) { toast.error(mensajeDeRemito(r.error, "anular el remito")); return; }
    toast.success(`Remito ${numeroDeRemito(remito.punto_venta, remito.numero)} anulado`);
    onListo();
  };

  return (
    <Dialog open={Boolean(remito)} onOpenChange={o => { if (!o) onCerrar(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Anular remito {remito ? numeroDeRemito(remito.punto_venta, remito.numero) : ""}</DialogTitle>
          <DialogDescription>
            El número no se vuelve a usar. Lo que este remito entregaba vuelve a quedar pendiente en la venta. Si el papel ya salió, marcalo como anulado también.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={e => { e.preventDefault(); void confirmar(); }}>
          <div className="space-y-1.5">
            <Label htmlFor="anular-motivo">Motivo</Label>
            <Textarea id="anular-motivo" autoFocus rows={3} maxLength={500} value={motivo} placeholder="Ej.: se cargó una cantidad equivocada" onChange={e => setMotivo(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCerrar}>Volver</Button>
            <Button type="submit" variant="destructive" disabled={!motivo.trim() || enviando}>
              {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Ban className="mr-2 h-4 w-4" />}Anular remito
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Talonario ──────────────────────────────────────────────────────────────

export function TalonarioDialog({ open, orgId, talonario, ultimoPorPuntoDeVenta, onCerrar, onListo }: {
  open: boolean; orgId: string | null | undefined; talonario: Talonario | null;
  /** Último número emitido por punto de venta, para no dejar retroceder la numeración. */
  ultimoPorPuntoDeVenta: Map<number, number>;
  onCerrar: () => void; onListo: () => void;
}) {
  const [f, setF] = useState({ puntoVenta: "1", cai: "", caiVence: "", proximoNumero: "" });
  const [enviando, setEnviando] = useState(false);
  const [intentado, setIntentado] = useState(false);
  useEffect(() => {
    if (!open) return;
    setIntentado(false);
    setF({ puntoVenta: String(talonario?.punto_venta ?? 1), cai: talonario?.cai ?? "", caiVence: talonario?.cai_vence ?? "", proximoNumero: "" });
  }, [open, talonario]);
  const minimo = (ultimoPorPuntoDeVenta.get(Number(f.puntoVenta)) ?? 0) + 1;
  const errores = erroresDelTalonario(f, minimo);
  const mismoPv = talonario && Number(f.puntoVenta) === talonario.punto_venta;
  const siguiente = f.proximoNumero.trim() ? Number(f.proximoNumero) : mismoPv ? talonario!.proximo_numero : minimo;

  const guardar = async () => {
    setIntentado(true);
    if (!orgId || errores.length) return;
    setEnviando(true);
    const cai = f.cai.replace(/\D/g, "");
    const r = await configurarTalonario(orgId, {
      puntoVenta: Number(f.puntoVenta), cai: cai || null, caiVence: cai ? f.caiVence : null,
      proximoNumero: f.proximoNumero.trim() ? Number(f.proximoNumero) : null,
    });
    setEnviando(false);
    if ("error" in r) { toast.error(r.inactivo ? "Los remitos todavía no están activos en tu cuenta." : mensajeDeRemito(r.error, "guardar el talonario")); return; }
    toast.success("Talonario guardado");
    onListo();
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onCerrar(); }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle className="font-display">Talonario de remitos</DialogTitle>
          <DialogDescription>
            Si ARCA te autorizó un talonario de remitos (CAI), cargalo y los remitos salen «R», que amparan el traslado. Sin CAI salen «X»: valen como constancia de entrega.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); void guardar(); }}>
          <div className="space-y-1.5">
            <Label htmlFor="tal-pv">Punto de venta</Label>
            <Input id="tal-pv" inputMode="numeric" value={f.puntoVenta} onChange={e => setF(x => ({ ...x, puntoVenta: e.target.value.replace(/\D/g, "").slice(0, 5) }))} />
            <p className="text-[11px] text-muted-foreground">El del talonario de remitos; puede ser distinto al de facturas.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tal-proximo">Próximo número <span className="font-normal text-muted-foreground">(opcional)</span></Label>
            <Input id="tal-proximo" inputMode="numeric" placeholder={String(siguiente)} value={f.proximoNumero} onChange={e => setF(x => ({ ...x, proximoNumero: e.target.value.replace(/\D/g, "").slice(0, 8) }))} />
            <p className="text-[11px] text-muted-foreground">Para seguir un talonario en papel. Vacío: sigue la numeración.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tal-cai">CAI <span className="font-normal text-muted-foreground">(14 dígitos)</span></Label>
            <Input id="tal-cai" inputMode="numeric" className="font-mono" value={f.cai} onChange={e => setF(x => ({ ...x, cai: e.target.value.replace(/\D/g, "").slice(0, 14) }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tal-vence">Vencimiento del CAI</Label>
            <Input id="tal-vence" type="date" value={f.caiVence} onChange={e => setF(x => ({ ...x, caiVence: e.target.value }))} />
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-sm sm:col-span-2">
            El próximo remito sale <strong>{f.cai.length === 14 && f.caiVence ? "R" : "X"} N.º <span className="font-mono">{numeroDeRemito(Number(f.puntoVenta) || 1, siguiente || 1)}</span></strong>.
          </div>
          {intentado && errores.length > 0 && (
            <ul role="alert" className="space-y-1 rounded-md bg-destructive/10 p-3 text-sm text-destructive sm:col-span-2">{errores.map(e => <li key={e}>{e}</li>)}</ul>
          )}
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={onCerrar}>Cancelar</Button>
            <Button type="submit" disabled={enviando}>{enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar talonario</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Detalle ────────────────────────────────────────────────────────────────

export function DetalleDelRemito({ remito, emisor, puedeEntregar, puedeAnular, onCerrar, onImprimir, onEntregar, onAnular }: {
  remito: Remito | null; emisor: EmisorDelRemito; puedeEntregar: boolean; puedeAnular: boolean;
  onCerrar: () => void; onImprimir: (r: Remito) => void; onEntregar: (r: Remito) => void; onAnular: (r: Remito) => void;
}) {
  const ventaId = remito?.remito_items.find(it => it.sale_id)?.sale_id ?? null;
  return (
    <Sheet open={Boolean(remito)} onOpenChange={o => { if (!o) onCerrar(); }}>
      <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-xl" data-testid="detalle-remito">
        {remito && (
          <>
            <SheetHeader className="border-b border-border/60 px-6 pb-4 pt-6 pr-12">
              <div className="flex items-center gap-3">
                <LetraDelRemito letra={remito.letra} />
                <div className="min-w-0">
                  <SheetTitle className="font-display">Remito {numeroDeRemito(remito.punto_venta, remito.numero)}</SheetTitle>
                  <SheetDescription>{fechaFiscalArgentina(remito.fecha)} · {remito.cliente_nombre}</SheetDescription>
                </div>
                <span className="ml-auto"><EstadoDelRemito estado={remito.estado} /></span>
              </div>
            </SheetHeader>
            <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5 text-sm">
              <Bloque titulo="Destinatario">
                <Dato k="Nombre" v={remito.cliente_nombre} />
                <Dato k={remito.cliente_cuit?.length === 11 ? "CUIT" : "Documento"} v={remito.cliente_cuit ? formatearCuit(remito.cliente_cuit) : "—"} />
                <Dato k="Domicilio de entrega" v={remito.cliente_domicilio || "—"} />
              </Bloque>
              <Bloque titulo={`Qué se entregó (${remito.remito_items.length})`}>
                <ul className="divide-y divide-border/50 rounded-lg border border-border/60">
                  {remito.remito_items.map((it, i) => (
                    <li key={it.id ?? i} className="flex items-baseline gap-3 px-3 py-2">
                      <span className="w-20 shrink-0 text-right font-mono tabular-nums">{cantidadLegible(it.cantidad)} <span className="text-xs text-muted-foreground">{it.unidad}</span></span>
                      <span className="min-w-0 flex-1">{it.descripcion}</span>
                    </li>
                  ))}
                </ul>
              </Bloque>
              {(remito.transportista || remito.bultos || remito.valor_declarado !== null || remito.observaciones) && (
                <Bloque titulo="Transporte">
                  {remito.transportista && <Dato k="Transportista" v={remito.transportista} />}
                  {remito.bultos && <Dato k="Bultos" v={String(remito.bultos)} />}
                  {remito.valor_declarado !== null && <Dato k="Valor declarado" v={ars(remito.valor_declarado)} />}
                  {remito.observaciones && <Dato k="Observaciones" v={remito.observaciones} />}
                </Bloque>
              )}
              <Bloque titulo="Seguimiento">
                <ol className="space-y-2 border-l border-border/70 pl-4">
                  <Hito titulo="Emitido" detalle={fechaHora(remito.created_at)} />
                  {remito.estado === "entregado" && <Hito titulo="Entregado" detalle={`${fechaHora(remito.entregado_at)} · recibió ${remito.recibio_nombre}${remito.recibio_dni ? ` (DNI ${remito.recibio_dni})` : ""}`} ok />}
                  {remito.estado === "anulado" && <Hito titulo="Anulado" detalle={`${fechaHora(remito.anulado_at)} · ${remito.anulado_motivo ?? ""}`} />}
                  {remito.estado === "emitido" && <Hito titulo="Falta confirmar la entrega" detalle="Cuando vuelva el duplicado firmado, marcalo como entregado." pendiente />}
                </ol>
              </Bloque>
              {remito.letra === "R" && <p className="text-xs text-muted-foreground">CAI {remito.cai} · vence {fechaFiscalArgentina(remito.cai_vence)}</p>}
              {ventaId && (
                <Link to={`/ventas?sale=${ventaId}`} className="inline-flex items-center gap-1.5 text-xs font-medium text-primary underline-offset-2 hover:underline">
                  <Receipt className="h-3.5 w-3.5" />Ver la venta
                </Link>
              )}
            </div>
            <div className="flex flex-wrap gap-2 border-t border-border/60 bg-popover px-6 py-4 sm:justify-end">
              {puedeAnular && remito.estado !== "anulado" && (
                <Button variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive sm:mr-auto" onClick={() => onAnular(remito)}>
                  <Ban className="mr-2 h-4 w-4" />Anular
                </Button>
              )}
              <Button variant="outline" asChild><a href={enlaceWhatsAppDelRemito(remito, emisor)} target="_blank" rel="noopener noreferrer"><MessageCircle className="mr-2 h-4 w-4" />WhatsApp</a></Button>
              <Button variant="outline" onClick={() => onImprimir(remito)}><Printer className="mr-2 h-4 w-4" />Imprimir</Button>
              {puedeEntregar && remito.estado === "emitido" && (
                <Button onClick={() => onEntregar(remito)}><CheckCircle2 className="mr-2 h-4 w-4" />Marcar entregado</Button>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Bloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h3>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function Dato({ k, v }: { k: string; v: string }) {
  return <div className="flex gap-3"><span className="w-36 shrink-0 text-muted-foreground">{k}</span><span className="min-w-0 break-words">{v}</span></div>;
}

function Hito({ titulo, detalle, ok = false, pendiente = false }: { titulo: string; detalle: string; ok?: boolean; pendiente?: boolean }) {
  return (
    <li className="relative">
      <span aria-hidden className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-background ${ok ? "bg-emerald-500" : pendiente ? "bg-amber-400" : "bg-primary"}`} />
      <p className="font-medium">{titulo}</p>
      <p className="text-xs text-muted-foreground">{detalle}</p>
    </li>
  );
}
