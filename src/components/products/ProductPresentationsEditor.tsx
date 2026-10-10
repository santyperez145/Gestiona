import { useEffect, useState } from "react";
import { Boxes, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatARS } from "@/lib/supabaseStore";
import { isMissingColumn, type PgError } from "@/lib/publicDataSource";
import {
  errorPrecioPresentacion,
  errorPresentacion,
  etiquetaPresentacion,
  precioUnitarioDeCaja,
  type ProductPresentation,
} from "@/lib/productPresentations";

const CON_PRECIO = "id, product_id, name, factor, barcode, price_ars";
const SIN_PRECIO = "id, product_id, name, factor, barcode";

/**
 * Cajas y bultos del producto. Se guardan al momento (no esperan al botón del
 * formulario) porque son filas propias, como las variantes.
 *
 * Una caja puede tener precio propio: el mayorista que vende la caja de 12 más
 * barata que 12 sueltas. Quién cobra ese precio lo decide la base al vender;
 * acá se muestra cuánto queda por unidad para que no haya sorpresas.
 */
export default function ProductPresentationsEditor({ orgId, productId, unidad, canEdit, precioSuelto }: {
  orgId: string;
  productId: string;
  unidad: string;
  canEdit: boolean;
  /** Precio de venta por unidad, para comparar con el de la caja. */
  precioSuelto?: number;
}) {
  const [items, setItems] = useState<ProductPresentation[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState(false);
  // `price_ars` llega con 20261009001500, que se aplica a mano: hasta
  // entonces el campo de precio no se ofrece y todo sigue como antes.
  const [admitePrecio, setAdmitePrecio] = useState(true);
  const [nombre, setNombre] = useState("");
  const [factor, setFactor] = useState("");
  const [codigo, setCodigo] = useState("");
  const [precio, setPrecio] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    setErrorCarga(false);
    (async () => {
      const consultar = (columnas: string) => supabase.from("product_presentations").select(columnas)
        .eq("org_id", orgId).eq("product_id", productId).order("factor");
      let { data, error } = await consultar(CON_PRECIO);
      if (error && isMissingColumn(error as PgError)) {
        console.warn("[presentaciones] price_ars no existe todavía: aplicá 20261009001500.");
        if (vigente) setAdmitePrecio(false);
        ({ data, error } = await consultar(SIN_PRECIO));
      }
      if (!vigente) return;
      if (error) {
        console.error("[presentaciones]", error);
        setErrorCarga(true);
      }
      setItems((data ?? []) as unknown as ProductPresentation[]);
      setCargando(false);
    })();
    return () => { vigente = false; };
  }, [orgId, productId, recarga]);

  const agregar = async () => {
    const valor = Number(factor.replace(",", "."));
    const error = errorPresentacion(nombre, valor, unidad) ?? (admitePrecio ? errorPrecioPresentacion(precio) : null);
    if (error) { toast.error(error); return; }
    const precioCaja = precio.trim() ? Number(precio.trim().replace(",", ".")) : null;
    setGuardando(true);
    const fila: Record<string, unknown> = { org_id: orgId, product_id: productId, name: nombre.trim(), factor: valor, barcode: codigo.trim() || null };
    if (admitePrecio) fila.price_ars = precioCaja;
    const { data, error: dbError } = await supabase.from("product_presentations")
      .insert(fila as never)
      .select(admitePrecio ? CON_PRECIO : SIN_PRECIO).single();
    setGuardando(false);
    if (dbError) {
      toast.error(dbError.code === "23505" ? "Ese código ya es de otra presentación" : dbError.message);
      return;
    }
    setItems(prev => [...prev, data as unknown as ProductPresentation].sort((a, b) => a.factor - b.factor));
    setNombre(""); setFactor(""); setCodigo(""); setPrecio("");
  };

  const cambiarPrecio = async (p: ProductPresentation, texto: string) => {
    const error = errorPrecioPresentacion(texto);
    if (error) { toast.error(error); return; }
    const nuevo = texto.trim() ? Number(texto.trim().replace(",", ".")) : null;
    if ((p.price_ars ?? null) === nuevo) return;
    const { error: dbError } = await supabase.from("product_presentations").update({ price_ars: nuevo } as never).eq("id", p.id);
    if (dbError) { toast.error(dbError.message); return; }
    setItems(prev => prev.map(x => x.id === p.id ? { ...x, price_ars: nuevo } : x));
    toast.success(nuevo === null ? `${p.name}: vuelve a cobrarse por unidad` : `${p.name}: ${formatARS(nuevo)} la caja`);
  };

  const quitar = async (id: string) => {
    const { error } = await supabase.from("product_presentations").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setItems(prev => prev.filter(p => p.id !== id));
  };

  /** "$800 c/u · 20% menos que suelto", o un aviso si la caja no conviene. */
  const lecturaDePrecio = (p: Pick<ProductPresentation, "factor" | "price_ars">) => {
    const unitario = precioUnitarioDeCaja(p);
    if (unitario === null) return null;
    if (!precioSuelto || precioSuelto <= 0) return `${formatARS(unitario)} por ${unidad === "unidad" ? "unidad" : unidad}`;
    if (unitario >= precioSuelto) {
      return `${formatARS(unitario)} c/u: no es más barato que el suelto (${formatARS(precioSuelto)}), así que se cobra el suelto`;
    }
    const ahorro = Math.round((1 - unitario / precioSuelto) * 100);
    return `${formatARS(unitario)} c/u · ${ahorro}% menos que suelto`;
  };

  const factorNuevo = Number(factor.replace(",", "."));
  const lecturaNueva = admitePrecio && precio.trim() && factorNuevo > 0
    ? lecturaDePrecio({ factor: factorNuevo, price_ars: Number(precio.replace(",", ".")) })
    : null;

  return <div className="space-y-2 rounded-[10px] border border-border/60 p-3">
    <p className="flex items-center gap-2 text-sm font-medium"><Boxes className="h-4 w-4" />Presentaciones (caja, bulto, pack)</p>
    <p className="text-[11px] text-muted-foreground">
      Escanear el código de la caja suma esa cantidad de unidades. El stock sigue siendo por unidad.
      {admitePrecio && " Si le ponés precio a la caja, se cobra ese precio cuando se lleva al menos una caja entera."}
    </p>
    {cargando ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : errorCarga ? (
      <div className="flex items-center gap-2 text-xs text-destructive">
        No se pudieron leer las presentaciones.
        <button type="button" className="underline" onClick={() => setRecarga(n => n + 1)}>Reintentar</button>
      </div>
    ) : <ul className="space-y-2">
      {items.map(p => {
        const lectura = lecturaDePrecio(p);
        return <li key={p.id} className="space-y-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{etiquetaPresentacion(p, unidad)}</span>
            {p.barcode && <span className="font-mono text-xs text-muted-foreground">{p.barcode}</span>}
            {admitePrecio && (canEdit ? (
              <Input
                defaultValue={p.price_ars != null ? String(p.price_ars) : ""}
                onBlur={e => void cambiarPrecio(p, e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                inputMode="decimal" placeholder="Precio caja"
                aria-label={`Precio de ${p.name}`}
                className="h-8 w-28 bg-muted border-border text-right text-sm"
              />
            ) : p.price_ars != null && <span className="text-sm font-medium">{formatARS(Number(p.price_ars))}</span>)}
            {canEdit && <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`Quitar ${p.name}`} onClick={() => void quitar(p.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>}
          </div>
          {lectura && <p className="text-[11px] text-muted-foreground pl-0.5">{lectura}</p>}
        </li>;
      })}
      {!items.length && <li className="text-xs text-muted-foreground">Sin presentaciones.</li>}
    </ul>}
    {canEdit && <>
      <div className={`grid grid-cols-1 gap-2 ${admitePrecio ? "sm:grid-cols-[1fr_5rem_1fr_7rem_auto]" : "sm:grid-cols-[1fr_6rem_1fr_auto]"}`}>
        <Input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Caja x12" aria-label="Nombre de la presentación" className="bg-muted border-border text-sm" />
        <Input value={factor} onChange={e => setFactor(e.target.value)} inputMode="decimal" placeholder={unidad === "unidad" ? "12" : "4,5"} aria-label="Cantidad que contiene" className="bg-muted border-border text-sm" />
        <Input value={codigo} onChange={e => setCodigo(e.target.value)} placeholder="Código de la caja" aria-label="Código de barras de la presentación" className="bg-muted border-border font-mono text-sm" />
        {admitePrecio && <Input value={precio} onChange={e => setPrecio(e.target.value)} inputMode="decimal" placeholder="Precio (opc.)" aria-label="Precio de la caja completa" className="bg-muted border-border text-sm" />}
        <Button type="button" variant="outline" disabled={guardando} onClick={() => void agregar()}>
          {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}<span className="ml-1">Agregar</span>
        </Button>
      </div>
      {lecturaNueva && <p className="text-[11px] text-muted-foreground">{lecturaNueva}</p>}
    </>}
  </div>;
}
