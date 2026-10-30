import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALICUOTAS_ARCA, sinAlicuotaEn, textoDePendientes } from "@/lib/libroPendientes";

describe("el asiento de venta separa el IVA del responsable inscripto", () => {
  const sql = readFileSync("supabase/migrations/20261030001100_iva_en_el_asiento_de_venta.sql", "utf8");

  it("sólo el responsable inscripto discrimina; sin alícuota no se adivina", () => {
    expect(sql).toContain("IF v_emisor IN ('monotributo', 'exento') THEN");
    expect(sql).toContain("v_neto := ROUND(v_total / (1 + v_s.fiscal_tax_rate / 100), 2);");
    expect(sql).toContain("'cuenta', '2.1.02', 'haber', v_iva,");
    expect(sql).toContain("no tiene alicuota de IVA registrada");
  });

  it("asentar pendientes es de dueño o administrador y va de a 500", () => {
    expect(sql).toContain("public.has_org_role(p_org, auth.uid(), ARRAY['owner', 'admin'])");
    expect(sql).toContain("LIMIT 500");
  });

  it("le cuenta al comercio qué se asentó y por qué no lo demás", () => {
    expect(textoDePendientes({ asentadas: 40, fallidas: 0, quedan: 0, motivos: {} }).titulo).toBe("Se asentaron 40 operaciones en el libro");
    const t = textoDePendientes({ asentadas: 3, fallidas: 2, quedan: 2, motivos: { "La venta … no tiene alicuota de IVA registrada: no se puede separar el IVA": 2 } });
    expect(t.titulo).toBe("Se asentaron 3 operaciones; 2 no se pudieron");
    expect(t.detalle).toBe("2 no tienen alícuota de IVA registrada (ventas viejas): hay que asentarlas a mano con el contador");
    expect(textoDePendientes({ asentadas: 500, fallidas: 0, quedan: 120, motivos: {} }).detalle).toBe("Quedan 120 más: volvé a tocar «Asentar ahora».");
  });

  it("las ventas viejas sin alícuota las decide el dueño, con una de ARCA, y quedan marcadas", () => {
    const viejas = readFileSync("supabase/migrations/20261030001300_ventas_viejas_sin_alicuota.sql", "utf8");
    expect(viejas).toContain("public.has_org_role(p_org, auth.uid(), ARRAY['owner'])");
    expect(viejas).toContain("p_alicuota NOT IN (0, 2.5, 5, 10.5, 21, 27)");
    expect(viejas).toContain("'alicuota_supuesta', v_supuesta");
    // La de siempre no supone nada.
    expect(viejas).toContain("RETURN public.ledger_asentar_venta_con_alicuota(p_sale_id, NULL);");
    expect(sinAlicuotaEn({ motivos: { "La venta … no tiene alicuota de IVA registrada": 7, "otra cosa": 2 } })).toBe(7);
    expect(sinAlicuotaEn(null)).toBe(0);
    expect(ALICUOTAS_ARCA[0]).toBe(21);
  });

  it("la pantalla del libro muestra los pendientes arriba del resultado", () => {
    expect(readFileSync("src/pages/LibroPage.tsx", "utf8")).toContain("<OperacionesSinAsentar orgId={orgId}");
  });
});
