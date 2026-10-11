/**
 * Guía de las 15 entrevistas de E2 (docs/TESIS.md §9, docs/ENTREVISTAS_E2.md).
 *
 * Regla de «The Mom Test»: preguntar por lo que el comercio **hizo**, no por
 * lo que haría ni por nuestra idea. Por eso ninguna pregunta nombra el margen
 * ni la ganancia: el criterio de éxito es que el comercio la nombre solo como
 * pregunta sin respuesta. Si la sugerimos, el dato no vale. Un test lo exige.
 *
 * Cada bloque dice qué campo del formulario llena, así la entrevista se carga
 * tal cual se hizo.
 */

export interface BloqueGuia {
  titulo: string;
  /** Campo de «Cargar entrevista» que llena este bloque. */
  campo: string;
  preguntas: string[];
}

export const GUIA_E2: BloqueGuia[] = [
  {
    titulo: "Cómo trabaja hoy",
    campo: "Herramientas",
    preguntas: [
      "Contame cómo fue tu última venta, desde que entró el cliente hasta que cobraste.",
      "¿Dónde anotás las ventas, el stock y los gastos? ¿Qué programas, planillas o cuadernos usás?",
      "¿Vendés por internet? ¿Por dónde: tienda, redes, WhatsApp, MercadoLibre?",
      "¿Trabajás con influencers o hacés publicidad? ¿Cómo sabés qué te funcionó?",
    ],
  },
  {
    titulo: "Lo que paga",
    campo: "Cuánto paga por mes",
    preguntas: [
      "¿Cuánto pagás por mes por cada una de esas herramientas? (contador incluido, si te hace algo de esto)",
      "¿Cuándo fue la última vez que cambiaste de sistema? ¿Por qué?",
    ],
  },
  {
    titulo: "Lo que no puede responder",
    campo: "Qué no puede responder hoy · nombra el margen real",
    preguntas: [
      "¿Qué te preguntaste del negocio el último mes y no pudiste contestar con lo que tenés?",
      "¿Cómo decidiste el último aumento de precios? ¿Qué miraste?",
      "Si mañana tuvieras que cerrar una línea de productos o un canal, ¿con qué dato lo decidirías?",
      "¿Qué hiciste la última vez que necesitaste ese dato? ¿Cuánto tiempo te llevó?",
    ],
  },
  {
    titulo: "Cierre",
    campo: "Notas",
    preguntas: [
      "¿Quién más debería escuchar esto? ¿Me presentás a otro comercio como el tuyo?",
      "¿Puedo volver a escribirte en unas semanas para mostrarte algo?",
    ],
  },
];

export const REGLAS_E2 = [
  "Preguntá por hechos pasados y concretos, no por opiniones ni por el futuro.",
  "No presentes Nerqia hasta el final, y sólo si lo pide.",
  "No nombres el margen ni la ganancia: marcá «nombra el margen real» sólo si lo dice solo.",
  "Anotá sus palabras textuales en «Qué no puede responder hoy».",
  "Cargá la entrevista el mismo día.",
];
