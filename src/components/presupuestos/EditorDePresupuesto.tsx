import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ProductCombobox from "@/components/shared/ProductCombobox";
import { toast } from "sonner";
import { AlertTriangle, Loader2, PenLine, Plus, ScanBarcode, Trash2, User, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatARS, getProductsDB, getVariantsByUserDB } from "@/lib/supabaseStore";
import { usePriceList } from "@/hooks/usePriceList";
import { mensajeDeError } from "@/lib/cuentaCorriente";
import { terminoBusquedaCliente } from "@/components/pos/PosCustomerPicker";
import {
  aItemsGuardados, avisoDeStock, deItemsGuardados, nuevaClave, pasoParaCantidad, problemasDelPresupuesto,
  productoPorCodigo, totalDeRenglon, totalesDePresupuesto, type ItemGuardado, type RenglonPresupuesto,
} from "@/lib/presupuestos";

/**
 * Editor de presupuestos (rearmado 2026-10-14, pedido del dueño: «no toma los
 * productos, sólo carga manual»). Los renglones salen del catálogo —búsqueda
 * por nombre, marca, SKU o código, y el lector de códigos agrega directo—, con
 * variantes, unidades de medida, stock a la vista, la lista de precios del
 * cliente y descuento por renglón. Los ítems libres (flete, mano de obra)
 * quedan marcados como tales. Guarda con `guardar_presupuesto`: la base
 * recalcula los totales y numera.
 */

export interface PresupuestoEditable {
  id?: string;
  quote_number?: string;
  customer_id?: string | null;
  customer_name: string;
  customer_email?: string | null;
  customer_phone?: string | null;
  items: Array<Partial<ItemGuardado>>;
  discount_amount?: number | null;
  valid_until?: string | null;
  notes?: string | null;
}

type Producto = {
  id: string; name: string; brand?: string | null; sku?: string | null; barcode?: string | null; barcode_aliases?: string[] | null;
  sale_price_ars?: number | null; stock?: number | null; maneja_stock?: boolean | null; unidad_medida?: string | null; is_active?: boolean | null;
};
type Variante = { id: string; product_id: string; variant_name: string; stock?: number | null; price_override?: number | null; sku?: string | null };
type Cliente = { id: string | null; nombre: string; email: string; telefono: string; priceListId: string | null };
type Sugerencia = { id: string; name: string; email: string | null; phone: string | null; tax_id: string | null; price_list_id: string | null };

const PLANTILLAS = (orgId: string) => `gestiona_quote_templates_${orgId}`;
type Plantilla = { name: string; items: Array<Partial<ItemGuardado>>; notes?: string };

function validezPorDefecto() {
  const d = new Date();
  d.setDate(d.getDate() + 15);
  return d.toISOString().slice(0, 10);
}

const renglonVacio = (): RenglonPresupuesto => ({ clave: nuevaClave(), productId: null, variantId: null, description: "", qty: 1, unitPrice: 0, discountPct: 0 });

export default function EditorDePresupuesto({ open, onOpenChange, orgId, userId, modo, inicial, onGuardado }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  userId: string;
  modo: "nuevo" | "editar" | "duplicar";
  inicial: PresupuestoEditable | null;
  onGuardado: (fila: Record<string, unknown>, opciones: { enviarPorCorreo: boolean }) => void;
}) {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [variantes, setVariantes] = useState<Record<string, Variante[]>>({});
  const [cargandoCatalogo, setCargandoCatalogo] = useState(false);
  const [cliente, setCliente] = useState<Cliente>({ id: null, nombre: "", email: "", telefono: "", priceListId: null });
  const [renglones, setRenglones] = useState<RenglonPresupuesto[]>([renglonVacio()]);
  const [libres, setLibres] = useState<Set<string>>(new Set());
  const [descuento, setDescuento] = useState("0");
  const [validez, setValidez] = useState(validezPorDefecto());
  const [notas, setNotas] = useState("");
  const [enviar, setEnviar] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [nombrePlantilla, setNombrePlantilla] = useState<string | null>(null);
  const codigoRef = useRef<HTMLInputElement>(null);
  const { getPrice, meta: lista } = usePriceList(cliente.priceListId);

  // Al abrir: catálogo (copia compartida de la pestaña) y el presupuesto a editar.
  useEffect(() => {
    if (!open) return;
    let vigente = true;
    setCargandoCatalogo(true);
    Promise.all([getProductsDB(userId, orgId), getVariantsByUserDB(userId)])
      .then(([prods, vars]) => {
        if (!vigente) return;
        setProductos((prods as unknown as Producto[]).filter(p => p.is_active !== false));
        const mapa: Record<string, Variante[]> = {};
        for (const v of vars as unknown as Variante[]) (mapa[v.product_id] ??= []).push(v);
        setVariantes(mapa);
      })
      .catch(err => toast.error(mensajeDeError(err, "No se pudo cargar el catálogo")))
      .finally(() => { if (vigente) setCargandoCatalogo(false); });
    try { setPlantillas(JSON.parse(localStorage.getItem(PLANTILLAS(orgId)) || "[]")); } catch { setPlantillas([]); }

    const base = deItemsGuardados(inicial?.items);
    setRenglones(base.length ? base : [renglonVacio()]);
    setLibres(new Set(base.filter(r => !r.productId).map(r => r.clave)));
    setCliente({
      id: inicial?.customer_id ?? null, nombre: inicial?.customer_name ?? "",
      email: inicial?.customer_email ?? "", telefono: inicial?.customer_phone ?? "", priceListId: null,
    });
    setDescuento(String(inicial?.discount_amount ?? 0));
    setValidez(modo === "editar" && inicial?.valid_until ? inicial.valid_until : validezPorDefecto());
    setNotas(inicial?.notes ?? "");
    setEnviar(false);
    setCodigo("");
    // La lista de precios del cliente que ya venía elegido.
    if (inicial?.customer_id) {
      supabase.from("customers").select("price_list_id").eq("id", inicial.customer_id).maybeSingle()
        .then(({ data, error }) => {
          if (error) console.warn("[presupuesto] lista del cliente", error);
          if (vigente && data) setCliente(c => ({ ...c, priceListId: (data as { price_list_id: string | null }).price_list_id }));
        });
    }
    return () => { vigente = false; };
  }, [open, orgId, userId, modo, inicial]);

  const porId = useMemo(() => new Map(productos.map(p => [p.id, p])), [productos]);
  const precioDe = (p: Producto, variante: Variante | null, qty: number) => {
    const base = Number(variante?.price_override) > 0 ? Number(variante!.price_override) : Number(p.sale_price_ars) || 0;
    return getPrice({ id: p.id, sale_price_ars: base }, qty);
  };

  const cambiar = (clave: string, cambios: Partial<RenglonPresupuesto>) =>
    setRenglones(prev => prev.map(r => (r.clave === clave ? { ...r, ...cambios } : r)));

  const elegirProducto = (clave: string, p: Producto | null) => {
    if (!p) { cambiar(clave, { productId: null, variantId: null }); return; }
    const vars = variantes[p.id] ?? [];
    const variante = vars.length === 1 ? vars[0] : null;
    setRenglones(prev => prev.map(r => r.clave !== clave ? r : {
      ...r, productId: p.id, variantId: variante?.id ?? null,
      description: [p.name, variante?.variant_name].filter(Boolean).join(" · "),
      unitPrice: precioDe(p, variante, r.qty), sku: variante?.sku ?? p.sku ?? null, unidad: p.unidad_medida ?? null,
    }));
  };

  const elegirVariante = (clave: string, varianteId: string) => {
    setRenglones(prev => prev.map(r => {
      if (r.clave !== clave || !r.productId) return r;
      const p = porId.get(r.productId);
      const v = (variantes[r.productId] ?? []).find(x => x.id === varianteId) ?? null;
      if (!p) return r;
      return { ...r, variantId: v?.id ?? null, description: [p.name, v?.variant_name].filter(Boolean).join(" · "), unitPrice: precioDe(p, v, r.qty), sku: v?.sku ?? p.sku ?? null };
    }));
  };

  const agregarPorCodigo = () => {
    const p = productoPorCodigo(productos, codigo);
    if (!p) { toast.error(`No hay un producto con el código «${codigo.trim()}»`); return; }
    setRenglones(prev => {
      const existente = prev.find(r => r.productId === p.id && !r.variantId);
      if (existente) return prev.map(r => (r === existente ? { ...r, qty: Number(r.qty) + 1 } : r));
      const vars = variantes[p.id] ?? [];
      const nuevo: RenglonPresupuesto = {
        clave: nuevaClave(), productId: p.id, variantId: vars.length === 1 ? vars[0].id : null,
        description: [p.name, vars.length === 1 ? vars[0].variant_name : null].filter(Boolean).join(" · "),
        qty: 1, unitPrice: precioDe(p, vars.length === 1 ? vars[0] : null, 1), discountPct: 0, sku: p.sku ?? null, unidad: p.unidad_medida ?? null,
      };
      // Reemplaza el renglón vacío inicial en vez de dejarlo colgando.
      const sinVacios = prev.filter(r => r.productId || r.description.trim());
      return [...sinVacios, nuevo];
    });
    setCodigo("");
    codigoRef.current?.focus();
  };

  const recalcularConLista = () => {
    setRenglones(prev => prev.map(r => {
      const p = r.productId ? porId.get(r.productId) : undefined;
      if (!p) return r;
      const v = (variantes[p.id] ?? []).find(x => x.id === r.variantId) ?? null;
      return { ...r, unitPrice: precioDe(p, v, r.qty) };
    }));
    toast.success(lista ? `Precios de «${lista.name}» aplicados` : "Precios de lista aplicados");
  };

  const cargarPlantilla = (nombre: string) => {
    const tpl = plantillas.find(t => t.name === nombre);
    if (!tpl) return;
    const nuevos = deItemsGuardados(tpl.items);
    setRenglones(nuevos.length ? nuevos : [renglonVacio()]);
    setLibres(new Set(nuevos.filter(r => !r.productId).map(r => r.clave)));
    if (tpl.notes) setNotas(tpl.notes);
    toast.success(`Plantilla «${tpl.name}» cargada`);
  };

  const guardarPlantilla = () => {
    const nombre = (nombrePlantilla ?? "").trim();
    if (!nombre) { toast.error("Poné un nombre para la plantilla"); return; }
    if (aItemsGuardados(renglones).length === 0) { toast.error("Agregá ítems antes de guardar la plantilla"); return; }
    const tpl: Plantilla = { name: nombre, items: aItemsGuardados(renglones), notes: notas };
    const siguiente = [...plantillas.filter(t => t.name !== tpl.name), tpl];
    try {
      localStorage.setItem(PLANTILLAS(orgId), JSON.stringify(siguiente));
      setPlantillas(siguiente);
      setNombrePlantilla(null);
      toast.success(`Plantilla «${tpl.name}» guardada`);
    } catch {
      toast.error("No se pudo guardar la plantilla en este navegador");
    }
  };

  const descuentoNum = parseFloat(descuento.replace(",", ".")) || 0;
  const totales = totalesDePresupuesto(renglones, descuentoNum);

  const guardar = async () => {
    const problemas = problemasDelPresupuesto(cliente.nombre, renglones, descuentoNum);
    if (problemas.length) {
      toast.error(problemas[0], { description: problemas.length > 1 ? `y ${problemas.length - 1} más` : undefined });
      return;
    }
    setGuardando(true);
    try {
      const { data, error } = await supabase.rpc("guardar_presupuesto" as never, {
        p_org: orgId,
        p_id: modo === "editar" ? inicial?.id ?? null : null,
        p_datos: {
          customer_name: cliente.nombre.trim(), customer_id: cliente.id,
          customer_email: cliente.email.trim() || null, customer_phone: cliente.telefono.trim() || null,
          items: aItemsGuardados(renglones), discount_amount: descuentoNum,
          valid_until: validez || null, notes: notas.trim() || null,
        },
      } as never);
      if (error) throw error;
      const fila = data as unknown as Record<string, unknown>;
      toast.success(modo === "editar" ? `Presupuesto ${String(fila.quote_number ?? "")} actualizado` : `Presupuesto ${String(fila.quote_number ?? "")} creado`);
      onGuardado(fila, { enviarPorCorreo: enviar && !!cliente.email.trim() });
      onOpenChange(false);
    } catch (err) {
      toast.error(mensajeDeError(err, "No se pudo guardar el presupuesto"));
    } finally {
      setGuardando(false);
    }
  };

  const titulo = modo === "editar" ? `Editar ${inicial?.quote_number ?? "presupuesto"}` : modo === "duplicar" ? "Duplicar presupuesto" : "Nuevo presupuesto";

  return (
    <Dialog open={open} onOpenChange={v => { if (!guardando) onOpenChange(v); }}>
      <DialogContent className="max-w-4xl max-h-[94vh] overflow-y-auto" data-testid="editor-presupuesto">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            Elegí los productos del catálogo o escaneá su código. Los precios salen de la lista del cliente; podés ajustarlos por renglón.
          </DialogDescription>
        </DialogHeader>

        {/* ── Cliente ── */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cliente</h3>
          <BuscadorDeClientes orgId={orgId} cliente={cliente} onCambiar={setCliente} />
          <div className="grid gap-2 sm:grid-cols-2">
            <Input type="email" placeholder="Correo (opcional)" value={cliente.email} onChange={e => setCliente(c => ({ ...c, email: e.target.value }))} />
            <Input type="tel" placeholder="Teléfono / WhatsApp (opcional)" value={cliente.telefono} onChange={e => setCliente(c => ({ ...c, telefono: e.target.value }))} />
          </div>
          {lista && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
              <span>Lista de precios del cliente: <strong>{lista.name}</strong>. Se aplica a los productos que agregues.</span>
              {renglones.some(r => r.productId) && (
                <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={recalcularConLista}>Aplicarla a los ya cargados</Button>
              )}
            </div>
          )}
        </section>

        {/* ── Ítems ── */}
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ítems</h3>
            <div className="flex flex-wrap items-center gap-2">
              {plantillas.length > 0 && (
                <Select value="" onValueChange={cargarPlantilla}>
                  <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="Usar plantilla…" /></SelectTrigger>
                  <SelectContent>{plantillas.map(t => <SelectItem key={t.name} value={t.name}>{t.name}</SelectItem>)}</SelectContent>
                </Select>
              )}
              {nombrePlantilla === null ? (
                <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setNombrePlantilla("")}>Guardar como plantilla</Button>
              ) : (
                <div className="flex items-center gap-1">
                  <Input autoFocus value={nombrePlantilla} onChange={e => setNombrePlantilla(e.target.value)} placeholder="Nombre de la plantilla" className="h-8 w-44 text-xs"
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); guardarPlantilla(); } if (e.key === "Escape") setNombrePlantilla(null); }} />
                  <Button type="button" size="sm" className="h-8 text-xs" onClick={guardarPlantilla}>Guardar</Button>
                  <Button type="button" size="sm" variant="ghost" className="h-8 px-2" aria-label="Cancelar plantilla" onClick={() => setNombrePlantilla(null)}><X className="h-3.5 w-3.5" /></Button>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <ScanBarcode className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input ref={codigoRef} value={codigo} onChange={e => setCodigo(e.target.value)} className="pl-8" disabled={cargandoCatalogo}
                placeholder={cargandoCatalogo ? "Cargando catálogo…" : "Escaneá o escribí un código y Enter"}
                aria-label="Agregar por código"
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (codigo.trim()) agregarPorCodigo(); } }} />
            </div>
            {cargandoCatalogo && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>

          <div className="space-y-2">
            {renglones.map((r, i) => {
              const p = r.productId ? porId.get(r.productId) : undefined;
              const vars = r.productId ? variantes[r.productId] ?? [] : [];
              const v = vars.find(x => x.id === r.variantId);
              const esLibre = libres.has(r.clave);
              const aviso = p ? avisoDeStock(r.qty, v ? v.stock : p.stock, p.maneja_stock, p.unidad_medida) : null;
              return (
                <div key={r.clave} className="rounded-lg border border-border bg-muted/20 p-2.5 space-y-2" data-testid="renglon-presupuesto">
                  <div className="flex items-start gap-2">
                    <span className="mt-2.5 w-5 shrink-0 text-right text-xs text-muted-foreground">{i + 1}</span>
                    <div className="min-w-0 flex-1 space-y-2">
                      {esLibre ? (
                        <div className="flex items-center gap-2">
                          <Input value={r.description} onChange={e => cambiar(r.clave, { description: e.target.value })} placeholder="Descripción (flete, mano de obra…)" className="h-9" />
                          <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">Ítem libre</span>
                        </div>
                      ) : (
                        <ProductCombobox<Producto> products={productos} value={r.productId} disabled={cargandoCatalogo}
                          placeholder={cargandoCatalogo ? "Cargando catálogo…" : "Buscar por nombre, marca, SKU o código…"}
                          ariaLabel={`Producto del ítem ${i + 1}`}
                          describe={prod => [prod.sku, prod.maneja_stock === false ? null : `stock ${Number(prod.stock ?? 0).toLocaleString("es-AR")}`, formatARS(Number(prod.sale_price_ars) || 0)].filter(Boolean).join(" · ")}
                          onChange={(_id, prod) => elegirProducto(r.clave, prod)} className="h-9" />
                      )}
                      {vars.length > 1 && (
                        <Select value={r.variantId ?? ""} onValueChange={id => elegirVariante(r.clave, id)}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Elegí la variante…" /></SelectTrigger>
                          <SelectContent>{vars.map(x => <SelectItem key={x.id} value={x.id}>{x.variant_name}{x.stock !== null && x.stock !== undefined ? ` · stock ${x.stock}` : ""}</SelectItem>)}</SelectContent>
                        </Select>
                      )}
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_0.8fr_1fr]">
                        <label className="text-[11px] text-muted-foreground">Cantidad{p?.unidad_medida && p.unidad_medida !== "unidad" ? ` (${p.unidad_medida})` : ""}
                          <Input type="number" min="0" step={pasoParaCantidad(p?.unidad_medida)} inputMode="decimal" value={r.qty} className="h-8"
                            onChange={e => cambiar(r.clave, { qty: Number(e.target.value) })} />
                        </label>
                        <label className="text-[11px] text-muted-foreground">Precio unitario
                          <Input type="number" min="0" step="0.01" inputMode="decimal" value={r.unitPrice} className="h-8"
                            onChange={e => cambiar(r.clave, { unitPrice: Number(e.target.value) })} />
                        </label>
                        <label className="text-[11px] text-muted-foreground">Desc. %
                          <Input type="number" min="0" max="100" step="0.5" inputMode="decimal" value={r.discountPct} className="h-8"
                            onChange={e => cambiar(r.clave, { discountPct: Number(e.target.value) })} />
                        </label>
                        <div className="text-[11px] text-muted-foreground">Total
                          <div className="flex h-8 items-center justify-end font-semibold text-sm text-foreground">{formatARS(totalDeRenglon(r))}</div>
                        </div>
                      </div>
                      {aviso && (
                        <p className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400"><AlertTriangle className="h-3 w-3" />{aviso}: se puede presupuestar igual.</p>
                      )}
                    </div>
                    <button type="button" aria-label={`Quitar ítem ${i + 1}`} className="mt-1.5 rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setRenglones(prev => (prev.length > 1 ? prev.filter(x => x.clave !== r.clave) : [renglonVacio()]))}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setRenglones(prev => [...prev, renglonVacio()])}>
              <Plus className="mr-1 h-3.5 w-3.5" />Producto del catálogo
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={() => {
              const nuevo = renglonVacio();
              setRenglones(prev => [...prev, nuevo]);
              setLibres(prev => new Set(prev).add(nuevo.clave));
            }}>
              <PenLine className="mr-1 h-3.5 w-3.5" />Ítem libre
            </Button>
          </div>
        </section>

        {/* ── Totales, validez y notas ── */}
        <section className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground">Válido hasta
              <Input type="date" value={validez} onChange={e => setValidez(e.target.value)} className="h-9" />
            </label>
            <label className="block text-xs text-muted-foreground">Notas y condiciones
              <Textarea value={notas} onChange={e => setNotas(e.target.value)} rows={3} maxLength={2000} placeholder="Forma de pago, plazo de entrega, garantía…" />
            </label>
          </div>
          <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatARS(totales.subtotal)}</span></div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Descuento general</span>
              <Input type="number" min="0" step="0.01" inputMode="decimal" value={descuento} onChange={e => setDescuento(e.target.value)} className="h-8 w-32 text-right" aria-label="Descuento general en pesos" />
            </div>
            <div className="flex justify-between border-t border-border pt-1.5 text-base font-bold"><span>Total</span><span className="text-primary">{formatARS(totales.total)}</span></div>
            {cliente.email.trim() && modo !== "editar" && (
              <label className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                <Checkbox checked={enviar} onCheckedChange={v => setEnviar(v === true)} /> Enviarlo por correo al guardar
              </label>
            )}
          </div>
        </section>

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={guardando}>Cancelar</Button>
          <Button type="button" onClick={() => void guardar()} disabled={guardando || cargandoCatalogo} data-testid="guardar-presupuesto">
            {guardando ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Guardando…</> : modo === "editar" ? "Guardar cambios" : "Crear presupuesto"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Cliente de la lista (por nombre o CUIT/DNI) o un nombre suelto. */
function BuscadorDeClientes({ orgId, cliente, onCambiar }: { orgId: string; cliente: Cliente; onCambiar: (c: Cliente | ((c: Cliente) => Cliente)) => void }) {
  const [sugerencias, setSugerencias] = useState<Sugerencia[]>([]);
  const [abierto, setAbierto] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contenedor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cerrar = (e: MouseEvent) => { if (contenedor.current && !contenedor.current.contains(e.target as Node)) setAbierto(false); };
    document.addEventListener("mousedown", cerrar);
    return () => { document.removeEventListener("mousedown", cerrar); if (temporizador.current) clearTimeout(temporizador.current); };
  }, []);

  const buscar = (texto: string) => {
    if (temporizador.current) clearTimeout(temporizador.current);
    const termino = terminoBusquedaCliente(texto);
    if (termino.length < 2) { setSugerencias([]); setAbierto(false); return; }
    temporizador.current = setTimeout(async () => {
      const { data, error } = await supabase.from("customers")
        .select("id, name, email, phone, tax_id, price_list_id")
        .eq("org_id", orgId)
        .or(`name.ilike.%${termino}%,tax_id.ilike.%${termino}%`)
        .order("name").limit(8);
      if (error) { console.warn("[presupuesto] búsqueda de clientes", error); return; }
      setSugerencias((data ?? []) as Sugerencia[]);
      setAbierto(true);
    }, 200);
  };

  return (
    <div ref={contenedor} className="relative">
      <User className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={cliente.nombre} className="pl-8 pr-8" placeholder="Nombre, razón social o CUIT del cliente…" aria-label="Cliente"
        onChange={e => { const nombre = e.target.value; onCambiar(c => ({ ...c, id: null, priceListId: null, nombre })); buscar(nombre); }}
        onFocus={() => sugerencias.length > 0 && setAbierto(true)} />
      {cliente.id && (
        <button type="button" aria-label="Desvincular el cliente" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onClick={() => onCambiar(c => ({ ...c, id: null, priceListId: null }))}><X className="h-4 w-4" /></button>
      )}
      {cliente.id && <p className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400">Cliente de la lista: la caja lo carga al cobrar.</p>}
      {abierto && sugerencias.length > 0 && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-xl">
          {sugerencias.map(s => (
            <button key={s.id} type="button" className="w-full border-b border-border/50 px-3 py-2 text-left last:border-0 hover:bg-muted/50"
              onClick={() => {
                onCambiar(c => ({ id: s.id, nombre: s.name, email: s.email ?? c.email, telefono: s.phone ?? c.telefono, priceListId: s.price_list_id }));
                setAbierto(false);
              }}>
              <span className="text-sm font-medium">{s.name}</span>
              <span className="ml-2 text-xs text-muted-foreground">{[s.tax_id, s.email, s.phone].filter(Boolean).join(" · ")}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
