import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { estadoDeCotizacion } from "@/lib/cotizacionTienda";

describe("pedir cotización desde la tienda", () => {
  const sql = readFileSync("supabase/migrations/20261030000700_cotizacion_desde_tienda.sql", "utf8");

  it("sólo con sesión, productos publicados y tope de pedidos abiertos", () => {
    expect(sql).toContain("RAISE EXCEPTION 'Ingresá con tu cuenta para pedir una cotización' USING ERRCODE = '42501';");
    expect(sql).toContain("AND COALESCE(publication.visibility, 'published') = 'published';");
    expect(sql).toContain("AND q.status = 'draft' AND q.created_at > now() - interval '1 day') >= 5 THEN");
  });

  it("el comprador sólo ve lo suyo, y el importe y el link cuando el comercio respondió", () => {
    expect(sql).toContain("AND q.origen = 'tienda' AND q.solicitado_por = auth.uid() AND auth.uid() IS NOT NULL");
    expect(sql).toContain("WHERE l.quote_id = q.id AND l.status = 'pending' AND q.status IN ('sent', 'accepted')");
    expect(sql).toContain("'total', CASE WHEN q.status IN ('sent', 'accepted') OR q.converted_at IS NOT NULL THEN q.total END,");
  });

  it("sólo las tiendas con venta mayorista reciben pedidos", () => {
    expect(sql).toContain("IF v_store.mayorista_modo = 'off' THEN");
  });

  it("cada estado se lee para el comprador", () => {
    expect(estadoDeCotizacion("pendiente").texto).toBe("Esperando respuesta de la tienda");
    expect(estadoDeCotizacion("vencida").texto).toBe("Vencida: pedí una nueva");
    expect(estadoDeCotizacion("otro").texto).toBe("otro");
  });

  it("el carrito ofrece pedirla y Mi cuenta la muestra", () => {
    expect(readFileSync("src/storefront/StoreCart.tsx", "utf8")).toContain("<PedirCotizacion />");
    expect(readFileSync("src/storefront/StoreAccount.tsx", "utf8")).toContain("<MisCotizaciones slug={store.slug} sesion={customer.id} />");
  });
});
