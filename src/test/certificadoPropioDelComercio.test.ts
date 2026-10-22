import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, sep } from "node:path";

/**
 * Cada comercio factura con su propio certificado de ARCA (2026-10-22, ADR 007).
 *
 * Reemplaza a la guarda de 2026-08-27 («el comercio no sube su certificado»),
 * que protegía la delegación. Lo que se protege ahora:
 *
 *   · La clave privada se genera en el servidor (`afip-credentials`), nunca en
 *     el navegador, y se guarda cifrada.
 *   · Nerqia no pide nunca la clave fiscal del comercio.
 *   · Una sola pantalla del comercio habla con `afip-credentials`: el asistente
 *     de conexión.
 *   · La base cifra certificado, clave y pedido aunque alguien los escriba en
 *     claro.
 */

const ROOT = resolve(__dirname, "../..");
const leer = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const ASISTENTE = "src/components/afip/ConectarCertificadoPropio.tsx";

function superficieDelComercio(dir = "src"): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(resolve(ROOT, dir))) {
    const rel = join(dir, entrada);
    if (statSync(resolve(ROOT, rel)).isDirectory()) {
      if (entrada === "test") continue;
      salida.push(...superficieDelComercio(rel));
    } else if (/\.tsx?$/.test(entrada)) {
      const ruta = rel.split(sep).join("/");
      if (/Platform/i.test(ruta)) continue;
      salida.push(ruta);
    }
  }
  return salida;
}

describe("certificado propio del comercio", () => {
  const archivos = superficieDelComercio();

  it("el escaneo mira archivos de verdad", () => {
    expect(archivos.length).toBeGreaterThan(100);
  });

  it("el navegador nunca genera claves: el pedido se arma en el servidor", () => {
    const culpables = archivos.filter(r => /generateKey|privateKeyFromPem|createCertificationRequest/.test(leer(r)));
    expect(culpables).toEqual([]);
    const edge = leer("supabase/functions/afip-credentials/index.ts");
    expect(edge).toContain('case "generar_pedido"');
    expect(edge).toContain("pedido_clave: await cifrarSecreto(admin, clavePem)");
    expect(leer("supabase/functions/_shared/certificadoArca.ts")).toContain("crypto.subtle.generateKey");
  });

  it("nunca se pide la clave fiscal del comercio", () => {
    const culpables: string[] = [];
    for (const ruta of archivos) {
      leer(ruta).split("\n").forEach((linea, i) => {
        if (/clave ?fiscal/i.test(linea) && /<input|<Input|type="password"|placeholder=/.test(linea)) culpables.push(`${ruta}:${i + 1}`);
      });
    }
    expect(culpables).toEqual([]);
    expect(leer(ASISTENTE)).toContain("Nerqia nunca te pide la clave fiscal");
  });

  it("sólo el asistente de conexión habla con afip-credentials y lee PEM", () => {
    const llaman = archivos.filter(r => /"afip-credentials"/.test(leer(r)));
    expect(llaman).toEqual([ASISTENTE]);
    const conPem = archivos.filter(r => /BEGIN (CERTIFICATE|PRIVATE KEY)/.test(leer(r)));
    expect(conPem).toEqual([ASISTENTE]);
  });

  it("la base permite el certificado del comercio y lo guarda siempre cifrado", () => {
    const m = leer("supabase/migrations/20261022000100_certificado_propio_por_comercio.sql");
    expect(m).toContain("DROP CONSTRAINT IF EXISTS afip_credentials_sin_certificado_propio");
    expect(m).toContain("BEFORE INSERT OR UPDATE OF certificate, private_key, pedido_clave");
    for (const c of ["certificate", "private_key", "pedido_clave"]) {
      expect(m).toContain(`NEW.${c} := public.secret_encrypt(NEW.${c})`);
    }
    expect(m).toContain("REVOKE ALL ON FUNCTION public.afip_encrypt_credentials() FROM PUBLIC, anon, authenticated");
    expect(m).toContain("ALTER COLUMN modo SET DEFAULT 'propio'");
    // Ninguna migración posterior vuelve a prohibirlo sin decidirlo.
    const posteriores = readdirSync(resolve(ROOT, "supabase/migrations")).filter(f => f > "20261022000100");
    for (const f of posteriores) {
      expect(leer(`supabase/migrations/${f}`), f).not.toMatch(/ADD\s+CONSTRAINT\s+afip_credentials_sin_certificado_propio/i);
    }
  });

  it("el certificado sólo se activa si corresponde a la clave del pedido y al CUIT, y se prueba con ARCA", () => {
    const edge = leer("supabase/functions/afip-credentials/index.ts");
    expect(edge).toMatch(/leerCertificado\(certPem, clavePem, String\(fila\.cuit\)\)/);
    expect(edge).toContain('ambiente === "produccion" && esEmisorDeHomologacion(leido.emisor)');
    expect(edge).toMatch(/probarContraArca\(admin, orgId, ambiente, certPem, clavePem\)[\s\S]*if \(!seGuarda\) return/);
    // El candado del ticket es el mismo que usa afip-authorize para el modo propio.
    expect(edge).toContain("const clave = `afip:ta:${orgId}`;");
    expect(leer("supabase/functions/afip-authorize/index.ts")).toContain('const clave = `afip:ta:${cred.modo === "propio" ? orgId : "plataforma"}`;');
  });

  it("el formulario fiscal no recibe claves y respeta el ambiente del certificado", () => {
    const form = leer("src/components/afip/AfipConfigForm.tsx");
    for (const campo of ["cuit", "razonSocial", "puntoVenta", "domicilio"]) expect(form).toContain(campo);
    expect(form).not.toContain("privateKey");
    expect(form).toContain("disabled={ambienteFijo}");
  });
});
