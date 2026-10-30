import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { textoDePendientes } from "@/lib/libroPendientes";

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

  it("la pantalla del libro muestra los pendientes arriba del resultado", () => {
    expect(readFileSync("src/pages/LibroPage.tsx", "utf8")).toContain("<OperacionesSinAsentar orgId={orgId}");
  });
});
