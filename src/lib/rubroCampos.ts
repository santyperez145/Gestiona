/**
 * Qué campos de la ficha de producto tienen sentido en cada rubro.
 *
 * Una ferretería no vende por género ni por mililitros: mostrarle esos campos
 * (herencia del primer cliente, una perfumería) hacía pensar que el sistema no
 * era para ella. El rubro sale de settings.industry_code; sin rubro o «otro»
 * se muestra lo genérico, y la ficha de un tipo de producto concreto (perfume,
 * vaper) sigue abriendo sus campos aunque el rubro diga otra cosa.
 */
const CON_GENERO = new Set(["indumentaria", "perfumes", "cosmetica", "deportes", "calzado", "accesorios"]);
const CON_CONTENIDO_ML = new Set(["perfumes", "cosmetica", "alimentos", "vapers", "bebidas", "gastronomia"]);

export type CamposDelRubro = { genero: boolean; contenidoMl: boolean };

export function camposDelRubro(
  industryCode: string | null | undefined,
  ficha: { perfume?: boolean; vaper?: boolean } = {},
): CamposDelRubro {
  const rubro = String(industryCode ?? "").trim();
  return {
    genero: CON_GENERO.has(rubro) || !!ficha.perfume,
    contenidoMl: CON_CONTENIDO_ML.has(rubro) || !!ficha.perfume || !!ficha.vaper,
  };
}
