/**
 * Preventa de un producto (2026-10-30, migración 20261030001900): hasta
 * cuántas unidades se venden sin stock hasta que llegue la mercadería. La
 * fecha de llegada es el «Próximo ingreso» de este mismo formulario: un solo
 * dato. Se guarda aparte del formulario (como el SEO): sin la migración
 * aplicada, la sección no se muestra.
 */
import { useEffect, useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { hoyAR } from "@/lib/fechaAR";
import { fechaDeLlegada } from "@/lib/preventa";

interface Props {
  productId: string;
  /** «Próximo ingreso» del formulario, AAAA-MM-DD o vacío. */
  proximoIngreso: string;
}

export default function ProductPreventaSection({ productId, proximoIngreso }: Props) {
  const [disponible, setDisponible] = useState(true);
  const [cargado, setCargado] = useState(false);
  const [cupo, setCupo] = useState("");
  const [guardado, setGuardado] = useState(0);
  const [stock, setStock] = useState(0);
  const [conVariantes, setConVariantes] = useState(false);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    void Promise.all([
      supabase.from("products").select("*").eq("id", productId).maybeSingle(),
      supabase.from("product_variants").select("*").eq("product_id", productId),
    ]).then(([producto, variantes]) => {
      if (!vivo) return;
      if (producto.error) {
        console.error("[preventa] no se pudo leer el producto", producto.error);
        toast.error("No se pudo leer la preventa del producto");
        return;
      }
      const fila = producto.data as { preventa_cupo?: unknown; stock?: unknown } | null;
      // Sin la columna, la base todavía no tiene la preventa: no se ofrece.
      if (!fila || !("preventa_cupo" in fila)) { setDisponible(false); return; }
      const actual = Number(fila.preventa_cupo) || 0;
      setGuardado(actual);
      setCupo(actual > 0 ? String(actual) : "");
      setStock(Number(fila.stock) || 0);
      if (variantes.error) console.error("[preventa] no se pudieron leer las variantes", variantes.error);
      setConVariantes(((variantes.data ?? []) as Array<{ active?: boolean | null }>).some(v => v.active !== false));
      setCargado(true);
    });
    return () => { vivo = false; };
  }, [productId]);

  const guardar = async () => {
    const valor = cupo.trim() === "" ? 0 : Number(cupo.replace(",", "."));
    if (!Number.isFinite(valor) || valor < 0) {
      toast.error("Las unidades en preventa tienen que ser un número");
      return;
    }
    setGuardando(true);
    const { error } = await supabase.from("products").update({ preventa_cupo: valor } as never).eq("id", productId);
    setGuardando(false);
    if (error) {
      console.error("[preventa] guardar", error);
      toast.error(error.message || "No se pudo guardar la preventa");
      return;
    }
    setGuardado(valor);
    toast.success(valor > 0 ? "Preventa guardada" : "El producto ya no se vende en preventa");
  };

  if (!disponible || !cargado) return null;

  const hoy = hoyAR();
  const fechaVigente = Boolean(proximoIngreso) && proximoIngreso >= hoy;
  const debidas = stock < 0 ? -stock : 0;
  let estado: string;
  if (conVariantes) estado = "La preventa es para productos sin variantes.";
  else if (!proximoIngreso) estado = "Cargá el «Próximo ingreso»: es la fecha de llegada que ve el comprador. Sin fecha no se vende sin stock.";
  else if (!fechaVigente) estado = "El próximo ingreso ya pasó: la preventa no está activa. Si la mercadería se atrasó, corré la fecha.";
  else if (guardado > 0) estado = `En preventa: se venden hasta ${guardado} unidades sin stock, que llegan aprox. el ${fechaDeLlegada(proximoIngreso)}.`;
  else estado = "Sin preventa: cuando el stock llega a cero, la tienda no lo vende.";

  return (
    <div className="space-y-2" data-testid="product-preventa-section">
      <label className="text-sm text-muted-foreground flex items-center gap-1">
        <CalendarClock className="w-3 h-3" />Preventa
      </label>
      <p className="text-[11px] text-muted-foreground/80">{estado}</p>
      {debidas > 0 && (
        <p className="text-[11px] font-medium">Vendidas en preventa sin entregar: {debidas}.</p>
      )}
      {!conVariantes && (
        <div className="flex items-center gap-2">
          <Input
            inputMode="decimal"
            value={cupo}
            onChange={e => setCupo(e.target.value)}
            placeholder="Unidades sin stock (vacío: sin preventa)"
            aria-label="Unidades en preventa"
            className="bg-muted border-border text-sm"
          />
          <Button type="button" variant="outline" className="min-h-11 shrink-0 gap-1.5" disabled={guardando} onClick={() => void guardar()}>
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />}Guardar
          </Button>
        </div>
      )}
    </div>
  );
}
