import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("libro de ventas correcto para el contador", () => {
  const saldo = readFileSync("supabase/migrations/20261030000800_saldo_a_favor_no_es_caja.sql", "utf8");
  const libro = readFileSync("supabase/migrations/20261030000900_libro_de_ventas_correcto.sql", "utf8");
  const duplicadas = readFileSync("supabase/migrations/20261030001000_ventas_online_duplicadas.sql", "utf8");

  it("pagar con saldo a favor o a cuenta no entra a Caja ni a Mercado Pago", () => {
    expect(saldo).toContain("WHEN 'saldo_a_favor'    THEN '1.2.01'");
    expect(libro).toContain("WHEN 'saldo_a_favor'    THEN '1.2.01'");
    expect(libro).toContain("WHEN 'cuenta_corriente' THEN '1.2.01'");
  });

  it("tarjetas y transferencias van a Banco; Mercado Pago y su QR, a liquidar", () => {
    for (const medio of ["debito", "tarjeta", "credito", "modo", "transferencia", "deposito"]) {
      expect(libro).toMatch(new RegExp(`WHEN '${medio}'\\s+THEN '1\\.1\\.02'`));
    }
    for (const medio of ["mercado_pago", "mercadopago", "gestiona_pay", "qr"]) {
      expect(libro).toMatch(new RegExp(`WHEN '${medio}'\\s+THEN '1\\.1\\.03'`));
    }
  });

  it("el cobro dividido se reparte y el pedido online se asienta una sola vez", () => {
    expect(libro).toContain("jsonb_array_length(v_s.split_payments) > 0");
    expect(libro).toContain("IF NEW.ecommerce_order_id IS NOT NULL THEN");
    expect(libro).toContain("AND NOT (s.ecommerce_order_id IS NOT NULL AND EXISTS (");
  });

  it("la corrección de lo ya asentado la decide el dueño y respeta la fecha original", () => {
    expect(duplicadas).toContain("public.has_org_role(p_org, auth.uid(), ARRAY['owner'])");
    expect(duplicadas).toContain("VALUES (p_org, v_numero, v_e.fecha,");
    expect(readFileSync("src/pages/LibroPage.tsx", "utf8")).toContain("<VentasOnlineDuplicadas orgId={orgId}");
  });
});
