import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chequeos, cuerpoDelAviso, decidirAviso, leerResultado, TITULO_AVISO, UN_DIA_MS } from "../../scripts/estado-produccion.mjs";

describe("control del estado de producción", () => {
  it("prueba Auth y REST de Supabase y el sitio", () => {
    expect(chequeos("https://abc.supabase.co/").map((c: { url: string }) => c.url)).toEqual([
      "https://abc.supabase.co/auth/v1/health", "https://abc.supabase.co/rest/v1/", "https://nerqia.app/estado",
    ]);
  });

  it("reconoce la base apagada por facturación y no confunde un 401 de REST con una caída", () => {
    expect(leerResultado("Supabase Auth", { error: "fetch failed: ENOTFOUND" })).toMatchObject({ ok: false, detalle: expect.stringMatching(/facturación/) });
    expect(leerResultado("Supabase Auth", { status: 540, cuerpo: "" })).toMatchObject({ ok: false, detalle: expect.stringMatching(/pausado/) });
    expect(leerResultado("Supabase REST", { status: 400, cuerpo: '{"message":"Tenant or user not found"}' })).toMatchObject({ ok: false });
    expect(leerResultado("Supabase REST", { status: 401, cuerpo: "" }).ok).toBe(true);
    expect(leerResultado("Supabase Auth", { status: 200, cuerpo: '{"name":"GoTrue"}' }).ok).toBe(true);
    expect(leerResultado("Sitio", { status: 502, cuerpo: "" }).ok).toBe(false);
  });

  it("el aviso dice qué falló y qué revisar primero", () => {
    const cuerpo = cuerpoDelAviso([{ nombre: "Supabase Auth", ok: false, detalle: "sin respuesta" }, { nombre: "Sitio", ok: true, detalle: "HTTP 200" }], "2026-10-23 12:00 UTC");
    expect(cuerpo).toContain("❌ **Supabase Auth**");
    expect(cuerpo).toContain("factura de Supabase");
    expect(TITULO_AVISO).toMatch(/Producción caída/);
  });

  it("falla y avisa una vez al caerse; después comenta como mucho una vez por día", () => {
    const ahora = Date.parse("2026-10-23T12:00:00Z");
    expect(decidirAviso({ caido: true, abierto: false, ahora })).toEqual({ accion: "abrir", fallar: true });
    expect(decidirAviso({ caido: true, abierto: true, ultimaActividad: new Date(ahora - 6 * 3600_000).toISOString(), ahora })).toEqual({ accion: "nada", fallar: false });
    expect(decidirAviso({ caido: true, abierto: true, ultimaActividad: new Date(ahora - UN_DIA_MS).toISOString(), ahora })).toEqual({ accion: "comentar", fallar: false });
    expect(decidirAviso({ caido: false, abierto: true, ahora })).toEqual({ accion: "cerrar", fallar: false });
    expect(decidirAviso({ caido: false, abierto: false, ahora })).toEqual({ accion: "nada", fallar: false });
  });

  it("el CI saltea el E2E contra producción sólo con la caída ya avisada", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(ci).toContain("run: node scripts/estado-produccion.mjs --para-ci");
    expect(ci).toContain("if: steps.produccion.outputs.caida != 'true'");
  });

  it("corre cada 6 horas con permiso sólo para abrir el aviso", () => {
    const wf = readFileSync(".github/workflows/estado-produccion.yml", "utf8");
    expect(wf).toContain('cron: "17 */6 * * *"');
    expect(wf).toContain("issues: write");
    expect(wf).toContain("contents: read");
    expect(wf).not.toMatch(/SERVICE_ROLE|ACCESS_TOKEN/);
  });
});
