/**
 * Cotizador de envío en la ficha (PDP).
 *
 * Shopify/Tiendanube muestran costo tras ubicación antes del checkout.
 * Autoridad: `quote_store_shipping`. No inventa tarifas.
 */
import { useEffect, useState } from "react";
import { Truck, Loader2 } from "lucide-react";
import { AR_PROVINCES } from "@/lib/shippingCalc";
import { etiquetaProvinciaCheckout } from "@/lib/storeShippingCoverage";
import { quoteStoreShipping } from "@/lib/publicDataSource";
import {
  guardarProvinciaCarrito,
  leerProvinciaCarrito,
  resumenEnvioCarrito,
} from "@/lib/storeCartProvince";

type Props = {
  slug: string;
  productId: string;
  variantId?: string | null;
  quantity: number;
  shippingMode: string | null | undefined;
  shippingProvinces: string[] | null | undefined;
  pickupEnabled: boolean;
  fmt: (n: number) => string;
};

export default function StoreShippingQuote({
  slug,
  productId,
  variantId,
  quantity,
  shippingMode,
  shippingProvinces,
  pickupEnabled,
  fmt,
}: Props) {
  const zones = String(shippingMode ?? "").toLowerCase() === "zones";
  const [provincia, setProvincia] = useState("");
  const [cotizando, setCotizando] = useState(false);
  const [resumen, setResumen] = useState<{ amount: number; subtitle: string } | null>(null);
  const [sinOpciones, setSinOpciones] = useState(false);

  useEffect(() => {
    setProvincia(leerProvinciaCarrito(slug));
  }, [slug]);

  useEffect(() => {
    if (!zones || !provincia || !productId) {
      setResumen(null);
      setSinOpciones(false);
      setCotizando(false);
      return;
    }
    let cancelado = false;
    setCotizando(true);
    setSinOpciones(false);
    quoteStoreShipping({
      slug,
      province: provincia,
      postalCode: null,
      items: [{
        product_id: productId,
        quantity: Math.max(1, quantity),
        ...(variantId ? { variant_id: variantId } : {}),
      }],
    }).then((rows) => {
      if (cancelado) return;
      setCotizando(false);
      if (!rows) {
        setResumen(null);
        return;
      }
      const mapped = rows.map((r) => ({
        carrier: String((r as { carrier?: string }).carrier ?? ""),
        price: Number((r as { price?: number }).price) || 0,
        is_free: !!(r as { is_free?: boolean }).is_free,
        label: String((r as { label?: string }).label ?? ""),
      }));
      const r = resumenEnvioCarrito(mapped);
      setResumen(r);
      setSinOpciones(!r);
    }, () => {
      if (cancelado) return;
      setCotizando(false);
      setResumen(null);
    });
    return () => { cancelado = true; };
  }, [zones, slug, provincia, productId, variantId, quantity]);

  if (!zones) return null;

  return (
    <div
      className="mt-4 p-3 border space-y-2"
      style={{
        borderColor: "hsl(var(--st-border))",
        borderRadius: "var(--st-radius)",
      }}
    >
      <p className="text-sm font-medium inline-flex items-center gap-1.5">
        <Truck className="w-4 h-4" style={{ color: "hsl(var(--st-muted))" }} />
        Envío a tu provincia
      </p>
      <label className="block text-xs space-y-1" style={{ color: "hsl(var(--st-muted))" }}>
        <span className="sr-only">Provincia</span>
        <select
          value={provincia}
          onChange={(e) => {
            const code = e.target.value;
            setProvincia(code);
            guardarProvinciaCarrito(slug, code);
          }}
          className="w-full min-h-11 px-2 text-sm"
          style={{
            borderRadius: "var(--st-radius)",
            border: "1px solid hsl(var(--st-border))",
            background: "hsl(var(--st-bg))",
            color: "hsl(var(--st-fg))",
          }}
          aria-label="Provincia para cotizar el envío"
        >
          <option value="">Elegí tu provincia</option>
          {AR_PROVINCES.map((p) => (
            <option key={p.code} value={p.code}>
              {etiquetaProvinciaCheckout(p.code, p.name, shippingProvinces)}
            </option>
          ))}
        </select>
      </label>
      {cotizando && (
        <p className="text-xs inline-flex items-center gap-1.5" style={{ color: "hsl(var(--st-muted))" }}>
          <Loader2 className="w-3 h-3 animate-spin" /> Cotizando…
        </p>
      )}
      {!cotizando && provincia && resumen && (
        <p className="text-sm">
          <strong>{resumen.amount === 0 ? "Gratis" : fmt(resumen.amount)}</strong>
          <span className="ml-1.5" style={{ color: "hsl(var(--st-muted))" }}>
            · {resumen.subtitle}
          </span>
        </p>
      )}
      {!cotizando && provincia && sinOpciones && (
        <p className="text-xs" style={{ color: "hsl(var(--st-muted))" }}>
          {pickupEnabled
            ? "A domicilio no llega a esa provincia. Podés retirar en tienda."
            : "Todavía no hacemos envíos a esa provincia."}
        </p>
      )}
      {!cotizando && !provincia && (
        <p className="text-xs" style={{ color: "hsl(var(--st-muted))" }}>
          Elegí tu provincia para ver el costo antes de comprar.
        </p>
      )}
    </div>
  );
}
