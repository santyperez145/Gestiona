/**
 * Subida de imágenes: validación, compresión y nombre de archivo.
 *
 * Las partes que deciden algo viven acá y no dentro del componente, para poder
 * testearlas sin un navegador. La compresión importa más de lo que parece: una
 * foto sacada con el teléfono pesa entre 3 y 8 MB, y un banner de 6 MB arruina
 * el LCP de la home aunque se vea bien. Redimensionar antes de subir es la
 * diferencia entre una tienda que carga y una que no.
 */

/** Lo que aceptan los buckets. HEIC entra porque es lo que sale de un iPhone. */
export const TIPOS_ACEPTADOS = [
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/avif",
  "image/heic", "image/heif",
];

/** Tope antes de comprimir. Más que esto es casi seguro un archivo equivocado. */
export const MAX_BYTES = 15 * 1024 * 1024;

export interface Limites {
  /** Lado mayor al que se reduce. Un banner no necesita más de 2000 px. */
  maxLado: number;
  /** Calidad JPEG/WebP, 0 a 1. */
  calidad: number;
}

/** Un producto se mira de cerca; un logo se ve chico. */
export const PRESETS = {
  banner:   { maxLado: 2000, calidad: 0.82 },
  producto: { maxLado: 1600, calidad: 0.85 },
  logo:     { maxLado: 512,  calidad: 0.9  },
} satisfies Record<string, Limites>;

/**
 * Un solo objeto y no un union discriminado: este repo compila con
 * `strictNullChecks: false`, y sin eso TypeScript ensancha `true`/`false` a
 * `boolean` y no estrecha el union al chequear `!check.ok` — `motivo` quedaba
 * inaccesible justo en la rama donde hace falta.
 */
export interface Validacion {
  ok: boolean;
  /** Por qué no se puede subir. Vacío cuando `ok` es true. */
  motivo?: string;
}

/**
 * ¿Se puede subir este archivo?
 *
 * Devuelve el motivo en castellano y listo para mostrar: un "Invalid MIME
 * type" no le dice nada a quien está cargando la foto de un perfume.
 */
export function validarImagen(file: File): Validacion {
  if (!file.type.startsWith("image/")) {
    return { ok: false, motivo: "Ese archivo no es una imagen." };
  }
  if (!TIPOS_ACEPTADOS.includes(file.type)) {
    return { ok: false, motivo: `No se puede usar ${file.type}. Probá con JPG, PNG o WebP.` };
  }
  if (file.size > MAX_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return { ok: false, motivo: `La imagen pesa ${mb} MB y el máximo son 15 MB.` };
  }
  if (file.size === 0) {
    return { ok: false, motivo: "El archivo está vacío." };
  }
  return { ok: true };
}

/**
 * Ruta única dentro del bucket.
 *
 * Va prefijada por organización para que las políticas de storage puedan
 * separar por tenant, y el nombre es un uuid: usar el nombre original invita a
 * pisar el archivo de otro y a filtrar cómo se llamaba el archivo del cliente.
 */
export function rutaDeSubida(orgId: string, file: File, carpeta = ""): string {
  const ext = extensionDe(file);
  const base = carpeta ? `${orgId}/${carpeta}` : orgId;
  return `${base}/${crypto.randomUUID()}.${ext}`;
}

/** Extensión a partir del tipo, con el nombre del archivo como respaldo. */
export function extensionDe(file: File): string {
  const porTipo: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
    "image/gif": "gif", "image/avif": "avif",
    // Se convierten a JPEG al comprimir: ningún navegador muestra HEIC.
    "image/heic": "jpg", "image/heif": "jpg",
  };
  if (porTipo[file.type]) return porTipo[file.type];
  const delNombre = file.name.split(".").pop()?.toLowerCase();
  return delNombre && /^[a-z0-9]{1,5}$/.test(delNombre) ? delNombre : "jpg";
}

/** Cuánto hay que achicar para que el lado mayor entre en el límite. */
export function escalaPara(ancho: number, alto: number, maxLado: number): number {
  const mayor = Math.max(ancho, alto);
  if (mayor <= maxLado) return 1;   // nunca se agranda
  return maxLado / mayor;
}

/**
 * Redimensiona y recomprime en el navegador antes de subir.
 *
 * Los GIF se dejan intactos: pasarlos por un canvas los convierte en una imagen
 * fija y se pierde la animación, que suele ser justo el motivo por el que
 * alguien sube un GIF.
 */
export async function comprimirImagen(file: File, limites: Limites): Promise<File> {
  if (file.type === "image/gif") return file;
  if (typeof document === "undefined") return file;   // sin DOM, no hay canvas

  try {
    const bitmap = await createImageBitmap(file);
    const escala = escalaPara(bitmap.width, bitmap.height, limites.maxLado);

    const ancho = Math.round(bitmap.width * escala);
    const alto = Math.round(bitmap.height * escala);

    const canvas = document.createElement("canvas");
    canvas.width = ancho;
    canvas.height = alto;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, ancho, alto);
    bitmap.close?.();

    // PNG se mantiene PNG para no perder transparencia — un logo recortado
    // sobre fondo transparente pasado a JPEG queda con un rectángulo blanco.
    const salida = file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>(res =>
      canvas.toBlob(res, salida, limites.calidad));
    if (!blob) return file;

    // Si comprimir no ayudó, se sube el original: recomprimir un JPEG ya
    // optimizado sólo suma artefactos.
    if (blob.size >= file.size && escala === 1) return file;

    const nombre = file.name.replace(/\.[^.]+$/, "") + (salida === "image/png" ? ".png" : ".jpg");
    return new File([blob], nombre, { type: salida });
  } catch {
    // HEIC sin soporte, imagen corrupta, canvas bloqueado: se sube el original
    // y que decida el servidor. Fallar acá sería peor que subir de más.
    return file;
  }
}

/** Para mostrarle a la persona qué se ahorró. */
export function pesoLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
