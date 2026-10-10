import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PRODUCTOS_NERQIA, describirUso, normalizarUso, parsearMontoMensual, productoEnUso, resumirAhorro,
} from "@/lib/loQueReemplaza";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261010001800_lo_que_reemplaza_nerqia.sql"), "utf8");
const panel = readFileSync(resolve(process.cwd(), "src/components/plan/LoQueReemplazaNerqia.tsx"), "utf8");
const page = readFileSync(resolve(process.cwd(), "src/pages/MiPlanPage.tsx"), "utf8");

describe("lo que reemplaza Nerqia (E5)", () => {
  it("cubre los seis productos de la tesis, uno por trabajo", () => {
    expect(PRODUCTOS_NERQIA.map(p => p.id)).toEqual(["commerce", "business", "finance", "creators", "profit", "growth"]);
    for (const p of PRODUCTOS_NERQIA) expect(migration).toContain(`'producto', '${p.id}'`);
  });

  it("describe el uso medido con plurales correctos", () => {
    const uso = { producto: "business" as const, dias: 30, senales: { ventas: 3, facturas: 1, compras: 0 } };
    expect(productoEnUso(uso)).toBe(true);
    expect(describirUso(uso)).toBe("3 ventas · 1 factura en 30 días");
    expect(describirUso({ producto: "creators", dias: 90, senales: { campanias: 2, canjes: 0 } })).toBe("2 campañas en 90 días");
    expect(describirUso({ producto: "growth", dias: 30, senales: { campanias_email: 0 } })).toBe("Sin uso en 30 días");
    expect(describirUso(undefined)).toBe("Sin uso en 30 días");
  });

  it("normaliza la respuesta de la base sin aceptar basura", () => {
    const uso = normalizarUso({
      medido_at: "2026-10-10",
      productos: [
        { producto: "business", dias: 30, senales: { ventas: "4", facturas: -1, compras: "x" } },
        { producto: "otro", dias: 30, senales: { ventas: 9 } },
      ],
      herramientas: [
        { producto: "commerce", herramienta: "Tiendanube", monto_mensual_ars: "25000.00" },
        { producto: "finance", herramienta: null, monto_mensual_ars: "nope" },
      ],
    });
    expect(uso.productos).toHaveLength(1);
    expect(uso.productos[0].senales).toEqual({ ventas: 4, facturas: 0, compras: 0 });
    expect(uso.herramientas).toEqual([{ producto: "commerce", herramienta: "Tiendanube", monto_mensual_ars: 25000 }]);
    expect(normalizarUso(null)).toEqual({ medido_at: "", productos: [], herramientas: [] });
  });

  it("lee montos como los escribe un comercio argentino", () => {
    expect(parsearMontoMensual("25.000")).toBe(25000);
    expect(parsearMontoMensual("$ 25.000,50")).toBe(25000.5);
    expect(parsearMontoMensual("18000")).toBe(18000);
    expect(parsearMontoMensual("")).toBeNull();
    expect(parsearMontoMensual("  ")).toBeNull();
    expect(parsearMontoMensual("-5")).toBeNaN();
    expect(parsearMontoMensual("25.00")).toBeNaN();
    expect(parsearMontoMensual("abc")).toBeNaN();
  });

  it("el ahorro sale sólo de lo que cargó el comercio", () => {
    expect(resumirAhorro([], 19900)).toEqual({ pagaHoy: 0, productosCargados: 0, ahorroMensual: null });
    const h = [
      { producto: "commerce" as const, herramienta: "Tiendanube", monto_mensual_ars: 25000 },
      { producto: "finance" as const, herramienta: null, monto_mensual_ars: 18000 },
      { producto: "growth" as const, herramienta: null, monto_mensual_ars: 0 },
    ];
    expect(resumirAhorro(h, 19900)).toEqual({ pagaHoy: 43000, productosCargados: 2, ahorroMensual: 23100 });
    expect(resumirAhorro(h.slice(1, 2), 19900).ahorroMensual).toBe(-1900);
    expect(resumirAhorro(h, null).ahorroMensual).toBeNull();
  });

  it("la base decide quién lee y quién escribe", () => {
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("REVOKE INSERT, UPDATE, DELETE ON public.herramientas_reemplazadas FROM authenticated");
    expect(migration).toContain("public.has_org_role(p_org, v_actor, ARRAY['owner', 'admin'])");
    expect(migration).toContain("NOT public.is_org_member(p_org, auth.uid())");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.uso_de_nerqia(uuid) FROM PUBLIC, anon");
  });

  it("Mi plan lo muestra y compara contra el plan más barato con precio", () => {
    expect(page).toContain("<LoQueReemplazaNerqia");
    expect(page).toContain("planDeComparacion");
    expect(panel).toContain('"uso_de_nerqia"');
    expect(panel).toContain('"guardar_herramienta_reemplazada"');
    expect(panel).not.toMatch(/<select[\s>]/);
  });
});
