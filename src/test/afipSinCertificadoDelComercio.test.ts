import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, sep } from "node:path";

/**
 * El comercio no sube certificados de AFIP. Nunca.
 *
 * ── Por qué ───────────────────────────────────────────────────────────────
 *
 * CLAUDE.md lo tiene escrito desde hace meses: «AFIP se conecta por delegación,
 * no subiendo certificados. Un comercio que tiene que generar una clave con
 * openssl, armar un CSR y subirlo a WSASS abandona ahí».
 *
 * ⚠️ Y aun así, hasta el 2026-08-27 la pantalla de configuración fiscal pedía
 * pegar el certificado (.crt) y la clave privada (.key) en PEM, con un
 * instructivo de cuatro pasos que arrancaba en «solicitá el certificado en
 * Clave Fiscal». La regla estaba escrita y la pantalla hacía lo contrario.
 *
 * El mecanismo que funciona es el de Tiendanube: el comercio pone razón social,
 * CUIT y punto de venta —los únicos datos que la plataforma no puede averiguar
 * sola, y que van impresos en la factura— y la conexión se resuelve del lado de
 * la plataforma. El certificado es de la plataforma; el comercio sólo delega el
 * servicio wsfe desde el Administrador de Relaciones, que ya sabe usar.
 *
 * 📌 Esta guarda mira la superficie del COMERCIO. `/platform/afip` sí administra
 * el certificado: ahí es donde corresponde.
 */

const ROOT = resolve(__dirname, "../..");
const leer = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/** Todo el código de la superficie del comercio: sin platform, sin tests. */
function superficieDelComercio(dir = "src"): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(resolve(ROOT, dir))) {
    const rel = join(dir, entrada);
    if (statSync(resolve(ROOT, rel)).isDirectory()) {
      if (entrada === "test") continue;
      salida.push(...superficieDelComercio(rel));
    } else if (/\.tsx?$/.test(entrada)) {
      const ruta = rel.split(sep).join("/");
      // Las pantallas de plataforma sí administran el certificado.
      if (/Platform/i.test(ruta)) continue;
      salida.push(ruta);
    }
  }
  return salida;
}

describe("el comercio no sube su certificado de AFIP", () => {
  const archivos = superficieDelComercio();

  it("el escaneo mira archivos de verdad", () => {
    expect(archivos.length).toBeGreaterThan(100);
  });

  it("ninguna pantalla del comercio pide un PEM", () => {
    const culpables: string[] = [];
    for (const ruta of archivos) {
      const texto = leer(ruta);
      texto.split("\n").forEach((linea, i) => {
        // El marcador del formato PEM en un campo de entrada.
        if (/BEGIN (CERTIFICATE|PRIVATE KEY)/.test(linea)
            && !linea.trimStart().startsWith("//")
            && !linea.trimStart().startsWith("*")) {
          culpables.push(`${ruta}:${i + 1}`);
        }
      });
    }
    expect(culpables, [
      "Una pantalla del comercio volvió a pedir un certificado en PEM.",
      "El certificado es de la plataforma: el comercio delega el servicio wsfe",
      "desde el Administrador de Relaciones de ARCA y no sube ningún archivo.",
      "",
      ...culpables,
    ].join("\n")).toEqual([]);
  });

  it("ninguna pantalla del comercio llama a afip-credentials", () => {
    // Esa Edge Function escribe el certificado con service_role. Sólo la
    // superficie de plataforma tiene por qué invocarla.
    const culpables = archivos.filter(r => leer(r).includes('invoke("afip-credentials"'));

    expect(culpables, [
      "Una pantalla del comercio volvió a mandar credenciales de AFIP.",
      "",
      ...culpables,
    ].join("\n")).toEqual([]);
  });

  it("la base impide guardar un certificado en la fila del comercio", () => {
    // ⚠️ Sacar el formulario no alcanza: la Edge Function `afip-credentials`
    // sigue deployada y podría reinstalar un certificado por comercio. La
    // barrera de verdad es la constraint, no la pantalla.
    //
    // Se mira la ÚLTIMA migración que la nombra: si una futura la dropea sin
    // volver a crearla, esto falla.
    const dir = resolve(ROOT, "supabase/migrations");
    const archivos = readdirSync(dir).filter(f => f.endsWith(".sql")).sort();

    let ultima: { archivo: string; texto: string } | null = null;
    for (let i = archivos.length - 1; i >= 0; i--) {
      const texto = readFileSync(resolve(dir, archivos[i]), "utf8");
      if (texto.includes("afip_credentials_sin_certificado_propio")) {
        ultima = { archivo: archivos[i], texto };
        break;
      }
    }
    expect(ultima, "ninguna migración crea la constraint").not.toBeNull();
    expect(
      ultima!.texto,
      `${ultima!.archivo}: la constraint quedó dropeada sin volver a crearse`,
    ).toMatch(/ADD\s+CONSTRAINT\s+afip_credentials_sin_certificado_propio[\s\S]{0,200}?CHECK\s*\(\s*certificate\s+IS\s+NULL/i);
  });

  it("el formulario fiscal pide sólo lo que el comercio conoce", () => {
    const form = leer("src/components/afip/AfipConfigForm.tsx");
    // Lo que va impreso en la factura y la plataforma no puede averiguar.
    for (const campo of ["cuit", "razonSocial", "puntoVenta", "domicilio"]) {
      expect(form, `falta el campo ${campo}`).toContain(campo);
    }
    // Y nada de claves.
    expect(form).not.toContain("privateKey");
    expect(form).not.toContain("setCertificate");
  });
});
