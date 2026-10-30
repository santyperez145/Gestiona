// Mapeo de columnas de la importación de clientes (2026-10-30).
//
// Antes cada campo tomaba una sola columna: del export de clientes de
// Tiendanube (y de muchas planillas) se perdía todo lo que no fuera nombre,
// email, teléfono y la calle — número, piso, localidad, código postal,
// provincia y DNI/CUIT. Ahora varias columnas pueden sumar a la dirección y el
// documento, la empresa y el historial de compras quedan en el cliente.
// La validación y el matching siguen en la base (`stage_customer_import`).

export type CampoCliente =
  | "" | "name" | "email" | "phone" | "address" | "address_extra"
  | "company" | "tax_id" | "birthday" | "notes" | "tags";

export const CAMPOS_CLIENTE: { value: CampoCliente; label: string }[] = [
  { value: "", label: "— Ignorar —" },
  { value: "name", label: "Nombre" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Teléfono" },
  { value: "address", label: "Dirección (calle)" },
  { value: "address_extra", label: "Dirección (número, piso, ciudad, CP, provincia)" },
  { value: "company", label: "Empresa" },
  { value: "tax_id", label: "DNI / CUIT" },
  { value: "birthday", label: "Cumpleaños (YYYY-MM-DD)" },
  { value: "notes", label: "Notas" },
  { value: "tags", label: "Etiquetas" },
];

export type OrigenClientes = "tiendanube" | "shopify" | "generic";

function normalizar(h: string): string {
  return h.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

/** Columnas que sólo tienen sentido como historial: van a notas con su título. */
const HISTORIAL = /^(total consumido|cantidad de compras|ultima compra|total spent|total orders)$/;

export function campoDeEncabezado(encabezado: string): CampoCliente {
  const h = normalizar(encabezado);
  if (/^(dni|cuit|cuil|documento|dni ?\/ ?cuit|nro\.? de documento|numero de documento|tax ?id)/.test(h)) return "tax_id";
  if (/empresa|razon social|company/.test(h)) return "company";
  if (/e-?mail|correo/.test(h)) return "email";
  if (/tel[ef]|phone|celular|movil|whatsapp/.test(h)) return "phone";
  if (/^(numero|nro\.?|piso|departamento|depto|localidad|ciudad|city|codigo postal|cp|zip|provincia|provincia o estado|province|address ?2)$/.test(h)) return "address_extra";
  if (/direcc|address|domicilio|calle/.test(h)) return "address";
  if (/cumplea|birth|nacimiento/.test(h)) return "birthday";
  if (/etiqueta|tags?$/.test(h)) return "tags";
  if (/nota|note|comentario/.test(h) || HISTORIAL.test(h)) return "notes";
  if (/^(nombre|name|nombre y apellido|nombre completo|cliente|first name|apellido|last name)$/.test(h) || /^nombre\b/.test(h)) return "name";
  return "";
}

export function detectarMapeo(encabezados: string[]): Record<string, CampoCliente> {
  return Object.fromEntries(encabezados.map((h, i) => [String(i), campoDeEncabezado(h)]));
}

/** El export de clientes de Tiendanube tiene columnas que una planilla propia no. */
export function detectarOrigen(encabezados: string[]): OrigenClientes {
  const hs = new Set(encabezados.map(normalizar));
  if (hs.has("dni / cuit") || hs.has("provincia o estado") || hs.has("total consumido")) return "tiendanube";
  if (hs.has("accepts email marketing") || hs.has("total spent")) return "shopify";
  return "generic";
}

export interface FilaClienteImportada {
  name?: string; email?: string; phone?: string; address?: string; company?: string;
  birthday?: string; notes?: string; tags?: string[];
}

/**
 * Filas listas para `stage_customer_import`. Las columnas que comparten campo
 * se juntan en el orden del archivo (nombre + apellido, calle + número + piso…).
 */
export function filasParaImportar(
  encabezados: string[],
  filas: string[][],
  mapeo: Record<string, string>,
  origen: OrigenClientes = "generic",
): FilaClienteImportada[] {
  const columnas = (campo: CampoCliente) =>
    encabezados.map((_, i) => i).filter(i => mapeo[String(i)] === campo);
  const por = Object.fromEntries(CAMPOS_CLIENTE.map(c => [c.value, columnas(c.value)])) as Record<CampoCliente, number[]>;
  const valores = (fila: string[], campo: CampoCliente) =>
    por[campo].map(i => (fila[i] ?? "").trim()).filter(Boolean);
  const etiquetaOrigen = origen === "generic" ? null : origen;

  return filas.flatMap(fila => {
    const name = valores(fila, "name").join(" ");
    const email = valores(fila, "email")[0] ?? "";
    const phone = valores(fila, "phone")[0] ?? "";
    if (!name && !email && !phone) return [];

    const calle = valores(fila, "address").join(" ");
    const resto = valores(fila, "address_extra");
    const address = [calle, ...resto].filter(Boolean).join(", ");

    const notas: string[] = [];
    const doc = valores(fila, "tax_id")[0];
    if (doc) notas.push(`DNI/CUIT: ${doc}`);
    for (const i of por.notes) {
      const v = (fila[i] ?? "").trim();
      if (!v) continue;
      notas.push(HISTORIAL.test(normalizar(encabezados[i])) ? `${encabezados[i].trim()}: ${v}` : v);
    }

    const tags = valores(fila, "tags").flatMap(t => t.split(/[,;|]/)).map(t => t.trim()).filter(Boolean);
    if (etiquetaOrigen && !tags.includes(etiquetaOrigen)) tags.push(etiquetaOrigen);
    // Con etiquetas propias la base no pone «importado»: se conserva igual.
    if (tags.length && !tags.includes("importado")) tags.push("importado");

    return [{
      name: name || undefined,
      email: email || undefined,
      phone: phone || undefined,
      address: address || undefined,
      company: valores(fila, "company")[0] || undefined,
      birthday: valores(fila, "birthday")[0] || undefined,
      notes: notas.length ? notas.join(" · ") : undefined,
      tags: tags.length ? [...new Set(tags)].slice(0, 20) : undefined,
    }];
  });
}
