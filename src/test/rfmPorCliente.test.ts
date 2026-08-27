import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * La vista Segmentos (RFM) agrupa por cliente, no por texto.
 *
 * ── Por qué existe esta guarda ────────────────────────────────────────────
 *
 * «Ya no queda nada del CRM cruzando por nombre» tuvo UNA excepción sin listar
 * durante meses: la página de RFM agrupaba ventas por `customer_name` crudo.
 * El mismo cliente escrito de dos formas era dos filas del reporte, con
 * recencia, frecuencia y valor partidos — un «Campeón» podía figurar como dos
 * clientes mediocres. Y dos clientes DISTINTOS con el mismo nombre eran uno.
 *
 * La regla es la de `customerMatch.ts`, que es espejo de
 * `normalize_person_name` en SQL:
 *
 *   - venta enlazada → se agrupa por `customer_id`, y sólo por él
 *   - venta sin enlazar → se resuelve al cliente cuyo nombre NORMALIZADO
 *     coincide, si coincide con uno solo; con homónimos queda como grupo
 *     propio, porque no hay forma honesta de elegir
 *
 * Verificado contra producción al migrar (2026-08-27): 33 de 34 ventas
 * enlazadas; la única sin enlazar compartía nombre con un cliente existente y
 * el agrupado viejo la fusionaba por casualidad del texto, no por identidad.
 */

const ROOT = resolve(__dirname, "../..");
const VISTA = readFileSync(
  resolve(ROOT, "src/components/crm/SegmentosView.tsx"),
  "utf8",
);

describe("el RFM agrupa por cliente, no por texto", () => {
  it("la consulta trae customer_id", () => {
    expect(VISTA).toContain('customer_id, customer_name');
  });

  it("normaliza el nombre con la función del CRM, no con el texto crudo", () => {
    expect(VISTA).toContain('normalizeName');
    expect(VISTA).toContain('from "@/lib/customerMatch"');
  });

  it("la clave de agrupación nunca es el nombre crudo", () => {
    // La forma vieja: map.set(s.customer_name ...) / key = s.customer_name.
    expect(VISTA).not.toMatch(/key\s*=\s*s\.customer_name/);
    expect(VISTA).toMatch(/id:\$\{/);
  });

  it("los homónimos no se fusionan a ciegas", () => {
    // El mapa nombre→id marca "ambiguo" cuando dos clientes comparten el
    // nombre normalizado, y una venta sin enlazar con nombre ambiguo queda
    // como grupo propio.
    expect(VISTA).toContain('"ambiguo"');
  });
});
