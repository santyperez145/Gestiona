import { describe, expect, it } from "vitest";
import { alicuotaVigente, filtrarPadron, formatoDePadron, leerLineaPadron, leerPadronDeArchivo } from "@/lib/padronIibb";

// Líneas armadas con los diseños de registro oficiales (ARBA y AGIP).
const ARBA = "P;25102026;01112026;30112026;30712345671;C;S;N;3,50;12;";
const ARBA_RET = "R;25102026;01112026;30112026;30712345671;C;S;N;1,75;12;";
const ARBA_BAJA = "P;25102026;01112026;30112026;20123456786;D;B;N;0,00;00;";
const AGIP = "25102026;01112026;30112026;30712345671;D;S;N;2,00;1,50;00;00;ZZ DISTRIBUIDORA SA";

describe("padrones de Ingresos Brutos", () => {
  it("reconoce el formato por la primera línea", () => {
    expect(formatoDePadron(ARBA)).toBe("ARBA");
    expect(formatoDePadron(AGIP)).toBe("AGIP");
    expect(formatoDePadron("cualquier cosa")).toBeNull();
  });

  it("lee ARBA: sólo percepción, con vigencia y baja", () => {
    expect(leerLineaPadron(ARBA, "ARBA")).toEqual({ cuit: "30712345671", alicuota: 3.5, vigenciaDesde: "2026-11-01", vigenciaHasta: "2026-11-30", baja: false });
    expect(leerLineaPadron(ARBA_RET, "ARBA")).toBeNull();
    expect(leerLineaPadron(ARBA_BAJA, "ARBA")?.baja).toBe(true);
  });

  it("lee AGIP: la alícuota de percepción, no la de retención", () => {
    expect(leerLineaPadron(AGIP, "AGIP")).toEqual({ cuit: "30712345671", alicuota: 2, vigenciaDesde: "2026-11-01", vigenciaHasta: "2026-11-30", baja: false });
  });

  it("para retener lee el régimen R de ARBA y la alícuota de retención de AGIP", () => {
    expect(leerLineaPadron(ARBA_RET, "ARBA", "R")).toEqual({ cuit: "30712345671", alicuota: 1.75, vigenciaDesde: "2026-11-01", vigenciaHasta: "2026-11-30", baja: false });
    expect(leerLineaPadron(ARBA, "ARBA", "R")).toBeNull();
    expect(leerLineaPadron(AGIP, "AGIP", "R")?.alicuota).toBe(1.5);
  });

  it("se queda sólo con los clientes del comercio", () => {
    const r = filtrarPadron([ARBA, ARBA_BAJA, "P;roto", ""], new Set(["30712345671"]), "ARBA");
    expect([...r.encontrados.keys()]).toEqual(["30712345671"]);
    expect(r).toMatchObject({ leidas: 3, invalidas: 1 });
  });

  it("la alícuota vale sólo en su vigencia y nunca si es baja", () => {
    const r = leerLineaPadron(ARBA, "ARBA");
    expect(alicuotaVigente(r, "2026-11-15")).toBe(3.5);
    expect(alicuotaVigente(r, "2026-12-01")).toBeNull();
    expect(alicuotaVigente(leerLineaPadron(ARBA_BAJA, "ARBA"), "2026-11-15")).toBeNull();
  });

  it("lee un archivo por partes aunque una línea quede cortada entre dos", async () => {
    const texto = ["P;25102026;01112026;30112026;20000000001;C;S;N;1,00;01;", ARBA, ARBA_BAJA].join("\r\n");
    const avances: number[] = [];
    const r = await leerPadronDeArchivo(new Blob([texto.slice(0, 70), texto.slice(70)]), new Set(["30712345671", "20123456786"]), f => avances.push(f));
    expect(r.formato).toBe("ARBA");
    expect(r.encontrados.get("30712345671")?.alicuota).toBe(3.5);
    expect(r.encontrados.get("20123456786")?.baja).toBe(true);
    expect(r.leidas).toBe(3);
    expect(avances.at(-1)).toBe(1);
  });
});
