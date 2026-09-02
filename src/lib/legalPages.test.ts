import { describe, it, expect } from "vitest";
import {
  datosFaltantes, esPlantillaSinCompletar, formatearCuit,
  politicaDePrivacidad, terminosYCondiciones, paginasLegalesPendientes, estadoPublicacionLegal,
  semillaLegalDelComercio,
  type DatosDelComercio,
} from "./legalPages";

const D: DatosDelComercio = {
  nombreTienda: "Exentry Imports",
  razonSocial: "Ejemplo S.R.L.",
  cuit: "30712345678",
  domicilio: "Av. Siempreviva 742, CABA",
  emailContacto: "hola@ejemplo.com",
};

describe("semillaLegalDelComercio", () => {
  it("toma el emisor de AFIP, no el nombre de fantasía como razón social", () => {
    const d = semillaLegalDelComercio({
      emisor: { cuit: "20446484436", razon_social: "Pérez Santiago", domicilio: "Alsina 123" },
      tienda: { name: "Exentry Imports", notification_email: "ventas@exentry.com" },
      nombreFantasia: "Exentry Imports",
    });
    expect(d.razonSocial).toBe("Pérez Santiago");
    expect(d.cuit).toBe("20446484436");
    expect(d.domicilio).toBe("Alsina 123");
    expect(d.emailContacto).toBe("ventas@exentry.com");
    expect(d.nombreTienda).toBe("Exentry Imports");
  });

  it("un workspace sin AFIP no se convierte en razón social", () => {
    const d = semillaLegalDelComercio({
      emisor: null,
      tienda: null,
      nombreFantasia: "pruebas",
    });
    expect(d.razonSocial).toBe("");
    expect(d.cuit).toBe("");
    expect(d.domicilio).toBe("");
    expect(d.emailContacto).toBe("");
    expect(d.nombreTienda).toBe("pruebas");
    expect(datosFaltantes(d)).toEqual(["razonSocial", "cuit", "domicilio", "emailContacto"]);
  });

  it("no inventa «nuestra tienda» ni un email de login", () => {
    const d = semillaLegalDelComercio({});
    expect(d.nombreTienda).toBe("");
    expect(d.nombreTienda.toLowerCase()).not.toContain("tienda");
    expect(d.emailContacto).toBe("");
  });

  it("el email de avisos de la tienda sí es un contacto, el de AFIP no se adivina", () => {
    const d = semillaLegalDelComercio({
      emisor: { cuit: "20446484436", razon_social: "Exentry Imports", domicilio: null },
      tienda: { name: "Exentry Imports", notification_email: null },
    });
    expect(d.razonSocial).toBe("Exentry Imports");
    expect(d.domicilio).toBe("");
    expect(d.emailContacto).toBe("");
    expect(datosFaltantes(d)).toEqual(["domicilio", "emailContacto"]);
  });
});

describe("datosFaltantes", () => {
  it("no falta nada cuando están los cuatro", () => {
    expect(datosFaltantes(D)).toEqual([]);
  });

  it("un campo en blanco cuenta como faltante", () => {
    expect(datosFaltantes({ ...D, cuit: "   " })).toEqual(["cuit"]);
  });

  it("los lista todos, para pedirlos de una vez", () => {
    expect(datosFaltantes({ nombreTienda: "X" })).toEqual([
      "razonSocial", "cuit", "domicilio", "emailContacto",
    ]);
  });
});

describe("esPlantillaSinCompletar", () => {
  // Es la distinción de la que depende todo: sin ella, "no pisar lo cargado
  // a mano" dejaría el marcador publicado para siempre.
  it("reconoce la semilla real que está publicada hoy", () => {
    const real = "Estos términos regulan las compras hechas en la tienda online " +
      "de Mi Tienda Online. Completá acá tu razón social, CUIT, domicilio y un " +
      "medio de contacto.";
    expect(esPlantillaSinCompletar(real)).toBe(true);
  });

  it("vacío o sólo espacios es plantilla", () => {
    expect(esPlantillaSinCompletar("")).toBe(true);
    expect(esPlantillaSinCompletar("   \n ")).toBe(true);
    expect(esPlantillaSinCompletar(null)).toBe(true);
  });

  it("no le importa el acento ni la mayúscula", () => {
    expect(esPlantillaSinCompletar("COMPLETA ACA tus datos")).toBe(true);
  });

  it("un texto escrito por el comercio NO se toca", () => {
    expect(esPlantillaSinCompletar(
      "## Alcance\n\nEn Exentry Imports vendemos perfumes importados desde 2019.",
    )).toBe(false);
  });

  it("ante la duda, no es plantilla", () => {
    // Menciona "tienda online" pero no es la marca de la semilla.
    expect(esPlantillaSinCompletar("Somos una tienda online de perfumes.")).toBe(false);
  });
});

describe("formatearCuit", () => {
  it("agrupa los 11 dígitos", () => {
    expect(formatearCuit("30712345678")).toBe("30-71234567-8");
  });

  it("acepta el que ya viene con guiones", () => {
    expect(formatearCuit("30-71234567-8")).toBe("30-71234567-8");
  });

  it("si no son 11 dígitos lo deja como vino, no inventa", () => {
    expect(formatearCuit("123")).toBe("123");
  });
});

/**
 * El texto se envuelve a 80 columnas, así que una frase puede quedar partida
 * por un salto de línea. Buscarla cruda daría rojo por el formato y no por el
 * contenido, que es lo que importa acá.
 */
const plano = (s: string) => s.replace(/\s+/g, " ");

describe("politicaDePrivacidad", () => {
  const t = plano(politicaDePrivacidad(D));

  it("declara la transferencia a Estados Unidos", () => {
    // Es el punto que nadie escribe solo y el que la AAIP mira.
    expect(t).toContain("Estados Unidos");
    expect(t).toContain("nivel adecuado de protección");
  });

  it("identifica al responsable con CUIT formateado", () => {
    expect(t).toContain("Ejemplo S.R.L.");
    expect(t).toContain("30-71234567-8");
    expect(t).toContain("Av. Siempreviva 742, CABA");
  });

  it("da el plazo de respuesta del art. 14", () => {
    expect(t).toContain("diez días corridos");
  });

  it("nombra a la AAIP como autoridad de control", () => {
    expect(t).toContain("Agencia de Acceso a la Información Pública");
  });

  it("no menciona píxeles si no hay", () => {
    expect(t).not.toContain("Meta y Google");
    expect(plano(politicaDePrivacidad({ ...D, usaPixeles: true }))).toContain("Meta y Google");
  });

  it("no deja ningún hueco sin completar", () => {
    expect(t.toLowerCase()).not.toContain("completá");
    expect(t).not.toContain("[");
  });
});

describe("terminosYCondiciones", () => {
  const t = plano(terminosYCondiciones(D));

  it("dice el plazo de arrepentimiento y quién paga la vuelta", () => {
    expect(t).toContain("diez días corridos");
    expect(t).toContain("lo pagamos nosotros");
  });

  it("dice la garantía legal de 6 meses", () => {
    expect(t).toContain("seis meses");
  });

  it("manda a la Ventanilla Única Federal", () => {
    expect(t).toContain("Ventanilla Única Federal");
  });

  it("los precios incluyen IVA y están en pesos", () => {
    expect(t).toContain("pesos argentinos");
    expect(t).toContain("IVA");
  });
});

describe("paginasLegalesPendientes", () => {
  it("propone las dos cuando no hay ninguna", () => {
    const r = paginasLegalesPendientes(D, []);
    expect(r.map(p => p.slug)).toEqual(["politica-de-privacidad", "terminos-y-condiciones"]);
    expect(r.every(p => p.motivo === "falta")).toBe(true);
  });

  it("reemplaza los términos que siguen siendo plantilla", () => {
    const r = paginasLegalesPendientes(D, [
      { slug: "terminos-y-condiciones", content: "Completá acá tus datos" },
    ]);
    expect(r.find(p => p.slug === "terminos-y-condiciones")?.motivo).toBe("plantilla");
  });

  it("NO toca lo que el comercio escribió", () => {
    const r = paginasLegalesPendientes(D, [
      { slug: "terminos-y-condiciones", content: "## Nuestros términos\n\nRedactados por nuestro abogado." },
      { slug: "politica-de-privacidad", content: "## Privacidad\n\nTexto propio revisado." },
    ]);
    expect(r).toEqual([]);
  });

  it("apretar dos veces no puede pisar nada", () => {
    // Después de aplicar, las páginas quedan con el contenido generado, que
    // no es plantilla: la segunda pasada no propone nada.
    const generadas = paginasLegalesPendientes(D, []).map(p => ({
      slug: p.slug, content: p.content,
    }));
    expect(paginasLegalesPendientes(D, generadas)).toEqual([]);
  });
});

describe("estadoPublicacionLegal", () => {
  const propias = [
    { slug: "terminos-y-condiciones", content: "## Términos revisados", status: "published" },
    { slug: "politica-de-privacidad", content: "## Privacidad revisada", status: "published" },
  ];

  it("sólo queda lista cuando las dos páginas se ven públicamente", () => {
    expect(estadoPublicacionLegal(propias)).toEqual({
      listaParaPublicar: true, faltantesOPlantilla: 0, borradores: 0,
    });
  });

  it("distingue un borrador de una página faltante", () => {
    expect(estadoPublicacionLegal([
      { slug: "terminos-y-condiciones", content: "## Términos revisados", status: "draft" },
    ])).toEqual({
      listaParaPublicar: false, faltantesOPlantilla: 1, borradores: 1,
    });
  });

  it("una plantilla publicada sigue siendo incompleta", () => {
    expect(estadoPublicacionLegal([
      { slug: "terminos-y-condiciones", content: "Mi Tienda Online. Completá acá tus datos", status: "published" },
      { slug: "politica-de-privacidad", content: "## Privacidad", status: "published" },
    ])).toEqual({
      listaParaPublicar: false, faltantesOPlantilla: 1, borradores: 0,
    });
  });
});
