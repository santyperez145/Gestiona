import { Link } from "react-router-dom";
import { Boxes, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { formatARS } from "@/lib/supabaseStore";
import {
  DEFAULTS_RECOMENDADOR,
  erroresInventarioIA,
  loteOptimoDeEjemplo,
  type InventarioIAForm,
} from "@/lib/inventarioIA";

/**
 * Ajustes que el sistema ya consumía y ninguna pantalla dejaba cargar.
 *
 *   `costo_por_pedido` y `costo_almacenamiento_anual_pct` — `run_abc_analysis`
 *   calcula con ellos el lote óptimo (Wilson). Sin los dos, el EOQ queda NULL
 *   a propósito y Planificación mostraba un «—» sin explicar por qué.
 *
 *   `stock_dormido_days`, `max_overstock_units`, `max_ai_discount_percent` y
 *   `ai_tone` — los lee `ai-offer-recommender`. Vacío = el valor por defecto
 *   de esa función, que se muestra como placeholder para que no sea un misterio.
 *
 * Los valores viven en el borrador de la página y se guardan con la barra.
 */

function Campo({ label, ayuda, error, children }: { label: string; ayuda: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm text-muted-foreground">{label}</label>
      <div className="mt-1">{children}</div>
      <p className={`text-[11px] mt-1 ${error ? "text-destructive" : "text-muted-foreground"}`}>{error || ayuda}</p>
    </div>
  );
}

export default function InventarioIASettings({ form, onChange }: {
  form: InventarioIAForm;
  onChange: (cambio: Partial<InventarioIAForm>) => void;
}) {
  const errores = erroresInventarioIA(form);
  const errorDe = (nombre: string) => errores.find(e => e.startsWith(nombre));
  const aNumero = (v: string) => Number(v.trim().replace(",", "."));
  const lote = loteOptimoDeEjemplo(aNumero(form.costoPorPedido), aNumero(form.costoAlmacenamientoPct));
  const unoSolo = !form.costoPorPedido.trim() !== !form.costoAlmacenamientoPct.trim();

  return (
    <div className="space-y-4 md:space-y-6">
      <section className="bg-card border border-border/60 rounded-[10px] p-4 md:p-6 space-y-4" aria-labelledby="ajustes-lote-optimo">
        <div>
          <h2 id="ajustes-lote-optimo" className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2">
            <Boxes className="w-4 h-4 text-primary" />Lote óptimo de compra
          </h2>
          <p className="text-[12px] text-muted-foreground mt-1">
            Con estos dos datos, <Link to="/planificacion?vista=reposicion" className="underline underline-offset-2 hover:text-foreground">Planificación</Link> te
            dice cuánto comprar de cada producto por vez: ni tan poco que vivas haciendo pedidos, ni tanto que la plata quede parada en el depósito.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Campo label="Costo de hacer un pedido ($)" error={errorDe("Costo por pedido")}
            ayuda="Lo que te cuesta cada compra aparte de la mercadería: flete, trámite, tiempo.">
            <Input inputMode="decimal" value={form.costoPorPedido} onChange={e => onChange({ costoPorPedido: e.target.value })}
              placeholder="Ej: 15000" className="bg-muted border-border" aria-invalid={!!errorDe("Costo por pedido")} />
          </Campo>
          <Campo label="Costo anual de tener stock (%)" error={errorDe("Costo de almacenamiento")}
            ayuda="Cuánto te cuesta por año tener un producto guardado, como % de su costo. Entre 15 y 30 es lo habitual.">
            <Input inputMode="decimal" value={form.costoAlmacenamientoPct} onChange={e => onChange({ costoAlmacenamientoPct: e.target.value })}
              placeholder="Ej: 20" className="bg-muted border-border" aria-invalid={!!errorDe("Costo de almacenamiento")} />
          </Campo>
        </div>
        <div className="rounded-lg border border-border/60 bg-muted/40 p-3 text-[12px]" aria-live="polite">
          {lote !== null ? (
            <>Ejemplo: un producto que cuesta {formatARS(1000)} y vendés 100 por mes → conviene comprar <strong className="text-foreground">{lote} unidades</strong> por pedido.</>
          ) : unoSolo ? (
            <span className="text-amber-500">Faltan los dos datos: con uno solo el lote óptimo no se puede calcular y queda vacío.</span>
          ) : (
            <span className="text-muted-foreground">Sin estos datos el lote óptimo queda vacío. No se inventa: un número supuesto termina usándose para comprar.</span>
          )}
        </div>
      </section>

      <section className="bg-card border border-border/60 rounded-[10px] p-4 md:p-6 space-y-4" aria-labelledby="ajustes-ofertas-ia">
        <div>
          <h2 id="ajustes-ofertas-ia" className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />Ofertas sugeridas por IA
          </h2>
          <p className="text-[12px] text-muted-foreground mt-1">
            Los límites que respeta el <Link to="/marketing" className="underline underline-offset-2 hover:text-foreground">recomendador de ofertas</Link> cuando
            te propone liquidar stock. Vacío usa el valor que figura de ejemplo.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Campo label="Stock dormido después de (días)" error={errorDe("Días para considerar")}
            ayuda="Sin ventas en ese tiempo, el producto es candidato a oferta.">
            <Input inputMode="numeric" value={form.stockDormidoDias} onChange={e => onChange({ stockDormidoDias: e.target.value })}
              placeholder={String(DEFAULTS_RECOMENDADOR.stockDormidoDias)} className="bg-muted border-border" />
          </Campo>
          <Campo label="Sobrestock desde (unidades)" error={errorDe("Unidades de sobrestock")}
            ayuda="Más de esta cantidad parada también dispara una sugerencia.">
            <Input inputMode="numeric" value={form.maxSobrestock} onChange={e => onChange({ maxSobrestock: e.target.value })}
              placeholder={String(DEFAULTS_RECOMENDADOR.maxSobrestock)} className="bg-muted border-border" />
          </Campo>
          <Campo label="Descuento máximo (%)" error={errorDe("Descuento máximo")}
            ayuda="La IA nunca propone más que esto, aunque el margen lo permita.">
            <Input inputMode="decimal" value={form.maxDescuentoIa} onChange={e => onChange({ maxDescuentoIa: e.target.value })}
              placeholder={String(DEFAULTS_RECOMENDADOR.maxDescuentoIa)} className="bg-muted border-border" />
          </Campo>
        </div>
        <Campo label="Tono de los textos" error={errorDe("Tono de la IA")}
          ayuda="Cómo querés que escriba los mensajes y publicaciones que sugiere.">
          <Input value={form.tonoIa} onChange={e => onChange({ tonoIa: e.target.value })} maxLength={140}
            placeholder={DEFAULTS_RECOMENDADOR.tono} className="bg-muted border-border" />
        </Campo>
      </section>
    </div>
  );
}
