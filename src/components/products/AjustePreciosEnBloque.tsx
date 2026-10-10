import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { formatARS, formatUSD } from "@/lib/supabaseStore";
import { plural } from "@/lib/plural";
import {
  type AjusteEnBloque,
  type QueAjustar,
  type ResultadoAjuste,
  QUE_AJUSTAR,
  REDONDEOS,
  errorDelAjuste,
} from "@/lib/ajustePreciosEnBloque";

const TODAS = "__todas";

interface Props {
  orgId: string;
  categorias: { slug: string; label: string }[];
  marcas: string[];
  proveedores: { id: string; name: string }[];
  onDone: () => void;
}

/**
 * «El proveedor aumentó 8%»: el trabajo semanal de un comercio con catálogo
 * grande (docs/TESIS.md, E1). Todo pasa en la base en una transacción; primero
 * se ve qué cambia y recién después se aplica.
 */
export default function AjustePreciosEnBloque({ orgId, categorias, marcas, proveedores, onDone }: Props) {
  const [que, setQue] = useState<QueAjustar>("costo_y_precio");
  const [porcentaje, setPorcentaje] = useState("");
  const [categoria, setCategoria] = useState(TODAS);
  const [marca, setMarca] = useState(TODAS);
  const [proveedor, setProveedor] = useState(TODAS);
  const [redondeo, setRedondeo] = useState("10");
  const [vista, setVista] = useState<ResultadoAjuste | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const pedido: AjusteEnBloque = useMemo(() => ({
    porcentaje: Number(porcentaje.replace(",", ".")),
    que,
    categoria: categoria === TODAS ? null : categoria,
    marca: marca === TODAS ? null : marca,
    proveedor: proveedor === TODAS ? null : proveedor,
    redondeo: Number(redondeo),
  }), [porcentaje, que, categoria, marca, proveedor, redondeo]);
  const error = errorDelAjuste(pedido);

  // Cualquier cambio en el pedido invalida la vista previa.
  const cambiar = <T,>(set: (v: T) => void) => (v: T) => { set(v); setVista(null); };

  const correr = async (aplicar: boolean) => {
    if (error) { toast.error(error); return; }
    setOcupado(true);
    const { data, error: rpcError } = await supabase.rpc("ajustar_precios_en_bloque" as never, {
      p_org: orgId,
      p_porcentaje: pedido.porcentaje,
      p_que: pedido.que,
      p_categoria: pedido.categoria,
      p_marca: pedido.marca,
      p_proveedor: pedido.proveedor,
      p_redondeo: pedido.redondeo,
      p_aplicar: aplicar,
    } as never);
    setOcupado(false);
    if (rpcError) {
      console.error("[ajuste en bloque]", rpcError);
      toast.error(rpcError.message || "No se pudo calcular el ajuste");
      return;
    }
    const r = data as unknown as ResultadoAjuste;
    if (!aplicar) { setVista(r); return; }
    toast.success(`${plural(r.afectados, "producto")} actualizados (${pedido.porcentaje > 0 ? "+" : ""}${pedido.porcentaje}%)`);
    onDone();
  };

  const monto = (n: number | null, moneda: string) =>
    n == null ? "—" : moneda === "USD" ? `US${formatUSD(n)}` : formatARS(n);

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm text-muted-foreground">Qué cambia</label>
        <Select value={que} onValueChange={cambiar((v: string) => setQue(v as QueAjustar))}>
          <SelectTrigger aria-label="Qué cambia" className="bg-muted border-border"><SelectValue /></SelectTrigger>
          <SelectContent>
            {QUE_AJUSTAR.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="text-sm text-muted-foreground">Proveedor</label>
          <Select value={proveedor} onValueChange={cambiar(setProveedor)}>
            <SelectTrigger aria-label="Proveedor" className="bg-muted border-border"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODAS}>Todos</SelectItem>
              {proveedores.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-sm text-muted-foreground">Marca</label>
          <Select value={marca} onValueChange={cambiar(setMarca)}>
            <SelectTrigger aria-label="Marca" className="bg-muted border-border"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODAS}>Todas</SelectItem>
              {marcas.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-sm text-muted-foreground">Categoría</label>
          <Select value={categoria} onValueChange={cambiar(setCategoria)}>
            <SelectTrigger aria-label="Categoría" className="bg-muted border-border"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODAS}>Todas</SelectItem>
              {categorias.map(c => <SelectItem key={c.slug} value={c.slug}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-sm text-muted-foreground">Porcentaje (+ sube, − baja)</label>
          <Input aria-label="Porcentaje" inputMode="decimal" value={porcentaje} onChange={e => cambiar(setPorcentaje)(e.target.value)} placeholder="Ej: 8 o -5" className="bg-muted border-border" />
        </div>
        <div>
          <label className="text-sm text-muted-foreground">Redondear precios a</label>
          <Select value={redondeo} onValueChange={cambiar(setRedondeo)}>
            <SelectTrigger aria-label="Redondear precios a" className="bg-muted border-border"><SelectValue /></SelectTrigger>
            <SelectContent>
              {REDONDEOS.map(r => <SelectItem key={r.value} value={String(r.value)}>{r.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {vista && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <p className="font-semibold">
            {vista.afectados === 0 ? "Ningún producto coincide con ese filtro." : `Cambian ${plural(vista.afectados, "producto")}.${vista.afectados > vista.muestra.length ? ` Primeros ${vista.muestra.length}:` : ""}`}
          </p>
          {vista.muestra.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {vista.muestra.map(m => (
                <li key={m.id} className="border-t border-border/50 pt-1 first:border-0 first:pt-0">
                  <span className="block truncate text-foreground" title={m.nombre}>{m.nombre}</span>
                  <span className="block tabular-nums">
                    {que !== "costo" && <>Precio {formatARS(m.precio_antes ?? 0)} → <span className="text-foreground">{formatARS(m.precio_despues ?? 0)}</span></>}
                    {que === "costo_y_precio" && " · "}
                    {que !== "precio" && <>Costo {monto(m.costo_antes, m.moneda)} → <span className="text-foreground">{monto(m.costo_despues, m.moneda)}</span></>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && porcentaje !== "" && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" disabled={ocupado || !!error} onClick={() => correr(false)}>
          Ver qué cambia
        </Button>
        <Button className="flex-1" disabled={ocupado || !vista || vista.afectados === 0} onClick={() => correr(true)}>
          {ocupado ? "Aplicando…" : vista && vista.afectados > 0 ? `Aplicar a ${plural(vista.afectados, "producto")}` : "Aplicar"}
        </Button>
      </div>
    </div>
  );
}
