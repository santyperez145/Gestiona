import { describe, expect, it } from "vitest";
import {
  annualSaving,
  limitesDelPlan,
  planAI,
  planPrice,
  planQuantity,
  type PlanOffer,
} from "@/lib/planOffer";
import { validatePlanUpdates } from "../../supabase/functions/_shared/planUpdates";

const plan: PlanOffer = {
  name: "Starter",
  code: "starter",
  price_ars_monthly: 19900,
  price_ars_yearly: 179100,
  max_products: null,
  max_users: null,
  max_sales_per_month: null,
  ai_enabled: true,
  ai_monthly_credits: 300,
};
describe("Oferta de planes desde datos reales", () => {
  it("distingue gratis de un importe ausente", () => {
    expect(planPrice({ ...plan, price_ars_monthly: null })).toBeNull();
    expect(planPrice({ ...plan, price_ars_monthly: 0 })).toBe(0);
    expect(planPrice({ ...plan, price_ars_yearly: null }, true)).toBeNull();
  });
  it.each([NaN, Infinity, -1])(
    "no publica el precio inválido %s como gratis",
    (price) => {
      expect(planPrice({ ...plan, price_ars_monthly: price })).toBeNull();
    },
  );
  it("calcula el ahorro desde ambos importes, sin fijar una promoción en el texto", () => {
    expect(annualSaving(plan)).toBe(25);
    expect(annualSaving({ ...plan, price_ars_yearly: 199000 })).toBe(17);
    expect(annualSaving({ ...plan, price_ars_yearly: null })).toBeNull();
    expect(annualSaving({ ...plan, price_ars_monthly: 0 })).toBeNull();
  });
  it("no confunde cero con sin límite", () => {
    expect(planQuantity(0)).toBe("0");
    expect(planQuantity(null)).toBe("Sin límite de plan");
    expect(limitesDelPlan({ ...plan, max_products: 0 })).toContain(
      "Hasta 0 productos",
    );
  });
  it("diferencia cupo de IA desconocido, agotado y sin tope", () => {
    expect(planAI(plan)).toBe("300 acciones/mes");
    expect(planAI({ ...plan, ai_monthly_credits: 0 })).toBe("0 acciones/mes");
    expect(planAI({ ...plan, ai_monthly_credits: undefined })).toBe(
      "Consultar cupo",
    );
    expect(planAI({ ...plan, ai_monthly_credits: null })).toBe(
      "Sin tope mensual",
    );
    expect(planAI({ ...plan, code: "trial" })).toContain(
      "durante la prueba de 14 días",
    );
    expect(planAI({ ...plan, ai_enabled: false })).toBe("No incluida");
  });
  it("genera límites sin duplicar promesas comerciales", () => {
    expect(limitesDelPlan(plan)).toEqual([
      "Productos ilimitados",
      "Ventas ilimitadas",
      "Usuarios ilimitados",
      "300 acciones/mes",
    ]);
  });
});
describe("Validación de Platform antes de escribir el plan", () => {
  const allowed = [
    "name",
    "description",
    "price_ars_monthly",
    "price_ars_yearly",
    "max_products",
    "ai_monthly_credits",
    "ai_enabled",
    "features",
  ];
  it("permite precios ausentes y cupos ilimitados explícitos", () => {
    expect(
      validatePlanUpdates(
        {
          price_ars_yearly: null,
          ai_monthly_credits: null,
          price_ars_monthly: 0,
        },
        allowed,
      ),
    ).toEqual({
      price_ars_yearly: null,
      ai_monthly_credits: null,
      price_ars_monthly: 0,
    });
  });
  it.each([-1, NaN, Infinity, "100", true, 1e13])(
    "rechaza el precio inválido %s",
    (value) => {
      expect(() =>
        validatePlanUpdates({ price_ars_monthly: value }, allowed),
      ).toThrow();
    },
  );
  it.each([-1, 0.5, "300", 2147483648])(
    "rechaza el cupo inválido %s",
    (value) => {
      expect(() =>
        validatePlanUpdates({ ai_monthly_credits: value }, allowed),
      ).toThrow();
    },
  );
  it("no habilita una funcionalidad con strings y no cambia identidades", () => {
    expect(() =>
      validatePlanUpdates({ ai_enabled: "false" }, allowed),
    ).toThrow();
    expect(
      validatePlanUpdates({ code: "business", name: " Pro " }, allowed),
    ).toEqual({ name: "Pro" });
  });
  it("valida y deduplica textos comerciales", () => {
    expect(
      validatePlanUpdates(
        { features: ["Servicio", " Servicio ", ""] },
        allowed,
      ),
    ).toEqual({ features: ["Servicio"] });
    expect(() => validatePlanUpdates({ features: [3] }, allowed)).toThrow();
    expect(() =>
      validatePlanUpdates({ features: Array(21).fill("Promesa") }, allowed),
    ).toThrow();
  });
  it.each([null, [], {}, "plan"])(
    "rechaza una edición vacía o mal formada",
    (value) => {
      expect(() => validatePlanUpdates(value, allowed)).toThrow();
    },
  );
});
