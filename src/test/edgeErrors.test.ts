import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { detalleDeEdgeFunction, mensajeDeEdgeFunction, mensajeSeguroParaCliente } from "@/lib/edgeErrors";

/**
 * El mensaje real de la Edge Function llega a la pantalla.
 *
 * `functions.invoke` reemplaza el cuerpo del error por «Edge Function returned
 * a non-2xx status code». El cuerpo queda en `error.context`, pero en este repo
 * no lo leía nadie: 30 lugares en 13 archivos mostraban el genérico.
 */

/** Un `Response` de mentira, como el que deja `FunctionsHttpError.context`. */
function respuestaFalsa(cuerpo: unknown, opts: { rompeJson?: boolean; sinClone?: boolean } = {}) {
  const r = {
    json: async () => {
      if (opts.rompeJson) throw new Error("Unexpected end of JSON input");
      return cuerpo;
    },
    clone() { return opts.sinClone ? undefined : r; },
  };
  if (opts.sinClone) delete (r as Partial<typeof r>).clone;
  return r;
}

const httpError = (cuerpo: unknown, opts = {}) => ({
  message: "Edge Function returned a non-2xx status code",
  context: respuestaFalsa(cuerpo, opts),
});

describe("mensajeDeEdgeFunction", () => {
  it("sin error devuelve vacío, para poder usarlo como condición", async () => {
    expect(await mensajeDeEdgeFunction(null, { ok: true })).toBe("");
    expect(await mensajeDeEdgeFunction(undefined, undefined)).toBe("");
  });

  it("prefiere el error del cuerpo 200, sin tocar la red", async () => {
    // `verificar_delegacion` responde 200 con { ok:false, error } justamente
    // para que el cliente pueda leerlo.
    const msg = await mensajeDeEdgeFunction(null, { ok: false, error: "El CUIT no está autorizado" });
    expect(msg).toBe("El CUIT no está autorizado");
  });

  it("lee el cuerpo del no-2xx en vez del genérico", async () => {
    const msg = await mensajeDeEdgeFunction(httpError({ error: "el punto de venta no existe" }));
    expect(msg).toBe("el punto de venta no existe");
    expect(msg).not.toContain("non-2xx");
  });

  it("conserva el código estructurado de un no-2xx para elegir recuperación", async () => {
    const detalle = await detalleDeEdgeFunction(httpError({
      error: "Configurá la caja",
      code: "POS_SETUP_REQUIRED",
    }));
    expect(detalle).toEqual({ message: "Configurá la caja", code: "POS_SETUP_REQUIRED", reference: "" });
  });

  it("acepta `message` además de `error` en el cuerpo", async () => {
    expect(await mensajeDeEdgeFunction(httpError({ message: "sin permiso" }))).toBe("sin permiso");
  });

  it("cae al genérico si el cuerpo no se puede leer, y no lo tapa con un error de parseo", async () => {
    // Un cuerpo vacío o ya consumido no debe convertir el problema real en
    // "Unexpected end of JSON input", que manda a mirar el lugar equivocado.
    const msg = await mensajeDeEdgeFunction(httpError(null, { rompeJson: true }));
    expect(msg).toContain("No se pudo completar la operación");
    expect(msg).not.toContain("Edge Function");
  });

  it("funciona aunque el Response no tenga clone()", async () => {
    const msg = await mensajeDeEdgeFunction(httpError({ error: "sin clone" }, { sinClone: true }));
    expect(msg).toBe("sin clone");
  });

  it("un error común sin context conserva su mensaje", async () => {
    expect(await mensajeDeEdgeFunction(new Error("Failed to fetch"))).toBe("Failed to fetch");
  });

  it("nunca devuelve vacío cuando hubo error", async () => {
    // Un toast con string vacío no dice nada y parece que no pasó nada.
    expect(await mensajeDeEdgeFunction({})).toContain("No se pudo completar la operación");
    expect(await mensajeDeEdgeFunction({ message: "   " })).toContain("No se pudo completar la operación");
  });

  it("un cuerpo con error vacío no gana sobre el genérico", async () => {
    expect(await mensajeDeEdgeFunction(httpError({ error: "" })))
      .toContain("No se pudo completar la operación");
  });

  it("separa el diagnóstico de plataforma del mensaje para comercio y comprador", async () => {
    const body = {
      error: "Resend invalid_api_key en Supabase",
      public_message: "Tu compra sigue confirmada.",
      merchant_message: "Revisá la cuenta de correo conectada.",
      operator_message: "Resend devolvió HTTP 401 invalid_api_key.",
      code: "EMAIL_CREDENTIALS_REJECTED",
      reference: "mail-abcd1234",
    };

    expect(await mensajeDeEdgeFunction(httpError(body), undefined, "customer"))
      .toBe("Tu compra sigue confirmada. Referencia: mail-abcd1234.");
    expect(await mensajeDeEdgeFunction(httpError(body), undefined, "merchant"))
      .toBe("Revisá la cuenta de correo conectada. Referencia: mail-abcd1234.");
    expect(await mensajeDeEdgeFunction(httpError(body), undefined, "platform"))
      .toBe("Resend devolvió HTTP 401 invalid_api_key. Referencia: mail-abcd1234.");
  });

  it("un comprador nunca ve infraestructura aunque la Function sólo devuelva el error crudo", async () => {
    for (const leaked of ["Resend", "SMTP", "Supabase", "Edge Function", "superadmin", "JWT", "SQLSTATE"]) {
      const message = await mensajeDeEdgeFunction(httpError({ error: `${leaked}: detalle privado` }), undefined, "customer");
      expect(message).not.toContain(leaked);
      expect(message).toContain("Intentá nuevamente");
    }
  });
});

describe("mensajeSeguroParaCliente", () => {
  it("conserva un mensaje de negocio y elimina el prefijo del RPC", () => {
    expect(mensajeSeguroParaCliente(new Error("P0001: Sin stock suficiente de Remera")))
      .toBe("Sin stock suficiente de Remera");
  });

  it("no filtra diagnósticos de base de datos o infraestructura", () => {
    for (const detail of [
      "PGRST202 function public.request_store_return does not exist",
      "duplicate key violates unique constraint orders_pkey",
      "Supabase JWT token expired",
      "invalid input syntax for type uuid",
    ]) {
      expect(mensajeSeguroParaCliente(new Error(detail), "Mensaje público"))
        .toBe("Mensaje público");
    }
  });
});

describe("la extracción vive en un solo lugar", () => {
  /**
   * ⚠️ `PlatformAdminPage.adminCall` ya leía `error.context` y lo hacía bien —
   * desde hacía meses. Nunca se propagó: los otros 47 archivos que invocan
   * Edge Functions mostraban el genérico. Un patrón correcto encerrado en un
   * archivo no protege a nadie.
   *
   * Si alguien vuelve a escribirlo a mano, este test lo dice.
   */
  it("nadie más lee error.context por su cuenta", () => {
    const ROOT = resolve(__dirname, "../..");
    const culpables: string[] = [];

    const recorrer = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== "test") recorrer(p); continue; }
        if (!/\.tsx?$/.test(e.name)) continue;
        const rel = p.slice(ROOT.length + 1).split("\\").join("/");
        if (rel === "src/lib/edgeErrors.ts") continue;
        const texto = readFileSync(p, "utf8");
        texto.split("\n").forEach((linea, i) => {
          const limpia = linea.trim();
          if (limpia.startsWith("//") || limpia.startsWith("*")) return;
          if (/\berror\s*(?:as[^)]*)?\)?\s*\.context\b|\.context\s*\)?\s*as\s+Response/.test(linea)) {
            culpables.push(`${rel}:${i + 1}`);
          }
        });
      }
    };
    recorrer(resolve(ROOT, "src"));

    expect(culpables, [
      "Alguien volvió a leer `error.context` a mano.",
      "",
      "Va por `mensajeDeEdgeFunction(error, data)`: maneja el cuerpo del 200,",
      "el del no-2xx, el Response sin clone(), el cuerpo no-JSON y el genérico.",
      "",
      ...culpables,
    ].join("\n")).toEqual([]);
  });
});
