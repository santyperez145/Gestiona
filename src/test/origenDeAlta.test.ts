import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CLAVE_ORIGEN, capturarPrimerContacto, leerContacto, origenParaAlta } from "@/lib/origenDeAlta";

const ahora = new Date("2026-10-10T12:00:00Z");
const memoria = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
};

describe("origen de cada alta (TESIS §6, E4)", () => {
  it("lee ref, utm, sitio de origen y página de entrada", () => {
    expect(leerContacto("https://nerqia.com/precios?ref=Ferreteria-Famatina&utm_source=ig&utm_campaign=otono", "https://l.instagram.com/x", ahora)).toEqual({
      ref: "ferreteria-famatina", utm_source: "ig", utm_campaign: "otono", sitio_origen: "l.instagram.com",
      pagina_entrada: "/precios", primer_contacto_at: "2026-10-10T12:00:00.000Z",
    });
  });

  it("sin señales o con navegación interna no guarda nada", () => {
    expect(leerContacto("https://nerqia.com/", "", ahora)).toBeNull();
    expect(leerContacto("https://nerqia.com/precios", "https://nerqia.com/", ahora)).toBeNull();
    expect(leerContacto("no es url", "", ahora)).toBeNull();
  });

  it("recorta y limpia lo que viene de la URL", () => {
    const o = leerContacto(`https://nerqia.com/?ref=${"a".repeat(200)}%00&utm_source=%20%20`, "", ahora);
    expect(o?.ref).toHaveLength(80);
    expect(o).not.toHaveProperty("utm_source");
  });

  it("guarda el primer contacto y no lo pisa", () => {
    const a = memoria();
    capturarPrimerContacto("https://nerqia.com/?ref=primero", "", a, ahora);
    capturarPrimerContacto("https://nerqia.com/?ref=segundo", "", a, ahora);
    expect(origenParaAlta(a)?.ref).toBe("primero");
    expect(JSON.parse(a.m.get(CLAVE_ORIGEN)!).ref).toBe("primero");
  });

  it("sin almacenamiento o con datos rotos el alta sigue", () => {
    expect(() => capturarPrimerContacto("https://nerqia.com/?ref=x", "", null)).not.toThrow();
    const roto = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("bloqueado"); } };
    expect(() => capturarPrimerContacto("https://nerqia.com/?ref=x", "", roto)).not.toThrow();
    expect(origenParaAlta(roto)).toBeNull();
    const malo = memoria(); malo.setItem(CLAVE_ORIGEN, "{no json");
    expect(origenParaAlta(malo)).toBeNull();
    expect(origenParaAlta(null)).toBeNull();
  });

  it("sólo el alta de comercio lleva el origen y la base nunca frena el alta", () => {
    const auth = readFileSync(resolve(process.cwd(), "src/lib/auth.tsx"), "utf8");
    const main = readFileSync(resolve(process.cwd(), "src/main.tsx"), "utf8");
    const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261010002200_origen_de_alta.sql"), "utf8");
    expect(auth).toContain("const origen = accountType ? null : await import('@/lib/origenDeAlta')");
    expect(auth).not.toMatch(/^import .*origenDeAlta/m);
    expect(main).toContain("const contactoUrl = window.location.href;");
    expect(main).toContain("capturarPrimerContacto(contactoUrl, contactoReferrer, almacenLocal())");
    expect(main).not.toMatch(/^import .*origenDeAlta/m);
    expect(migration).toContain("RAISE WARNING 'origen_de_alta: % (%)', SQLERRM, SQLSTATE;");
    expect(migration).toContain("IF v_coincidencias <> 1 THEN");
    expect(migration).toContain("REVOKE INSERT, UPDATE, DELETE ON public.origen_de_alta FROM authenticated;");
  });
});

describe("sello «Hecha con Nerqia» (TESIS §5)", () => {
  it("lleva el ref del comercio y marca el canal", async () => {
    const { enlaceSelloNerqia, leerContacto } = await import("@/lib/origenDeAlta");
    const url = enlaceSelloNerqia(" Ferreteria-Famatina ", "https://nerqia.app");
    expect(url).toBe("https://nerqia.app/?ref=ferreteria-famatina&utm_source=tienda&utm_medium=sello");
    expect(leerContacto(url, "https://ferreteria-famatina.nerqia.app/", ahora)).toMatchObject({
      ref: "ferreteria-famatina", utm_source: "tienda", utm_medium: "sello", sitio_origen: "ferreteria-famatina.nerqia.app",
    });
  });

  it("la tienda lo pide a la base y lo pone junto al copyright", () => {
    const layout = readFileSync(resolve(process.cwd(), "src/storefront/StoreLayout.tsx"), "utf8");
    const sello = readFileSync(resolve(process.cwd(), "src/storefront/SelloNerqia.tsx"), "utf8");
    const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261010002300_sello_hecha_con_nerqia.sql"), "utf8");
    expect(layout).toContain("<SelloNerqia slug={store?.slug} />");
    expect(sello).toContain('"marca_nerqia_de_tienda"');
    expect(migration).toContain("public.org_entitlements(v_org)->>'branding'");
    expect(migration).toContain("v_marca_propia := true;");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.marca_nerqia_de_tienda(text) TO anon, authenticated;");
  });
});
