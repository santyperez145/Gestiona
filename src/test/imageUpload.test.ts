/**
 * La validación y el nombrado deciden qué entra al bucket y con qué nombre.
 * Equivocarse ahí no rompe en pantalla: sube un archivo que después no se ve,
 * o pisa el de otra organización.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  validarImagen, rutaDeSubida, extensionDe, escalaPara, pesoLegible,
  PRESETS, MAX_BYTES,
} from "@/lib/imageUpload";

/** Un File de mentira, que es lo único que hace falta para estas reglas. */
const archivo = (nombre: string, tipo: string, bytes = 1024) =>
  new File([new Uint8Array(bytes)], nombre, { type: tipo });

describe("validarImagen", () => {
  it("acepta lo que los navegadores muestran", () => {
    for (const t of ["image/jpeg", "image/png", "image/webp"]) {
      expect(validarImagen(archivo("foto.jpg", t)).ok, t).toBe(true);
    }
  });

  it("acepta HEIC, que es lo que sale de un iPhone", () => {
    expect(validarImagen(archivo("IMG_0001.HEIC", "image/heic")).ok).toBe(true);
  });

  it("rechaza lo que no es imagen con un motivo legible", () => {
    const r = validarImagen(archivo("lista.pdf", "application/pdf"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("Ese archivo no es una imagen.");
  });

  it("rechaza un formato de imagen que el navegador no muestra", () => {
    const r = validarImagen(archivo("raw.tif", "image/tiff"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain("JPG, PNG o WebP");
  });

  it("rechaza lo enorme diciendo cuánto pesa", () => {
    const r = validarImagen(archivo("gigante.jpg", "image/jpeg", MAX_BYTES + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain("MB");
  });

  it("rechaza un archivo vacío", () => {
    expect(validarImagen(archivo("vacio.jpg", "image/jpeg", 0)).ok).toBe(false);
  });
});

describe("extensionDe", () => {
  it("sale del tipo, no del nombre", () => {
    // El nombre miente seguido: "foto.png" exportada como JPEG.
    expect(extensionDe(archivo("foto.png", "image/jpeg"))).toBe("jpg");
  });

  it("HEIC termina en jpg porque se convierte al comprimir", () => {
    expect(extensionDe(archivo("IMG.HEIC", "image/heic"))).toBe("jpg");
  });

  it("cae al nombre cuando el tipo no dice nada", () => {
    expect(extensionDe(archivo("dibujo.webp", ""))).toBe("webp");
  });

  it("ante un nombre raro usa jpg en vez de inventar una extensión", () => {
    expect(extensionDe(archivo("sin-extension", ""))).toBe("jpg");
    expect(extensionDe(archivo("raro.нечто", ""))).toBe("jpg");
  });
});

describe("rutaDeSubida", () => {
  const org = "11111111-2222-3333-4444-555555555555";

  it("prefija por organización para poder separar por tenant", () => {
    expect(rutaDeSubida(org, archivo("f.jpg", "image/jpeg"))).toMatch(new RegExp(`^${org}/`));
  });

  it("no reutiliza el nombre original", () => {
    // Usarlo invita a pisar el archivo de otro y filtra cómo se llamaba.
    const ruta = rutaDeSubida(org, archivo("lista-de-precios-2026.jpg", "image/jpeg"));
    expect(ruta).not.toContain("lista-de-precios");
  });

  it("dos subidas del mismo archivo no colisionan", () => {
    const f = archivo("f.jpg", "image/jpeg");
    expect(rutaDeSubida(org, f)).not.toBe(rutaDeSubida(org, f));
  });

  it("admite una carpeta para separar banners de productos", () => {
    expect(rutaDeSubida(org, archivo("f.jpg", "image/jpeg"), "banners"))
      .toMatch(new RegExp(`^${org}/banners/`));
  });
});

describe("escalaPara", () => {
  it("achica sólo el lado que se pasa", () => {
    expect(escalaPara(4000, 3000, 2000)).toBeCloseTo(0.5);
    expect(escalaPara(3000, 4000, 2000)).toBeCloseTo(0.5);
  });

  it("nunca agranda una imagen chica", () => {
    // Estirar una foto de 300px a 2000 la deja borrosa y pesa más.
    expect(escalaPara(300, 200, 2000)).toBe(1);
    expect(escalaPara(2000, 1000, 2000)).toBe(1);
  });
});

describe("presets", () => {
  it("un logo se achica más que un banner, y el banner más que un producto no", () => {
    expect(PRESETS.logo.maxLado).toBeLessThan(PRESETS.producto.maxLado);
    expect(PRESETS.producto.maxLado).toBeLessThan(PRESETS.banner.maxLado);
  });

  it("la calidad se mantiene alta donde se mira de cerca", () => {
    expect(PRESETS.producto.calidad).toBeGreaterThan(PRESETS.banner.calidad);
  });
});

describe("pesoLegible", () => {
  it("usa la unidad que corresponde", () => {
    expect(pesoLegible(512)).toBe("512 B");
    expect(pesoLegible(2048)).toBe("2 KB");
    expect(pesoLegible(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

/**
 * ── La foto del producto no puede ser un PNG entero ────────────────────────
 *
 * ⚠️ Medido en la tienda real el 2026-08-28: **las 50 imágenes del catálogo son
 * PNG y pesan 9,6 MB** —~190 KB cada una— servidas dentro de tarjetas de ~160px
 * en mobile. Y Supabase no transforma imágenes en este plan (`/render/image/`
 * devuelve 403), así que no hay redimensionado al servir: lo que se sube es lo
 * que baja el comprador.
 *
 * La causa era una línea razonable con una consecuencia que no se ve:
 * `file.type === "image/png" ? "image/png" : "image/jpeg"`, para no perder la
 * transparencia de un logo. Pero **`canvas.toBlob` ignora la calidad cuando el
 * formato es PNG**, porque PNG es sin pérdida. Una foto subida como PNG se
 * guardaba entera.
 *
 * 📌 WebP resuelve las dos cosas a la vez: soporta transparencia **y** comprime
 * con pérdida. No hay que elegir entre el logo y el peso.
 */
describe("comprimirImagen elige el formato que pesa menos", () => {
  const fuente = readFileSync(
    join(process.cwd(), "src", "lib", "imageUpload.ts"), "utf8",
  );

  it("intenta WebP antes que PNG o JPEG", () => {
    expect(fuente).toMatch(/codificar\("image\/webp"\)/);
  });

  it("⚠️ comprueba que el navegador lo haya producido de verdad", () => {
    /**
     * `toBlob` con un tipo que no soporta **devuelve PNG en silencio**, sin
     * error. Sin este chequeo, un Safari viejo subiría PNGs enormes creyendo
     * que son WebP — el mismo bug con otro disfraz.
     */
    expect(
      fuente,
      "no verifica el tipo del blob: un navegador sin WebP subiría PNG creyendo que comprimió",
    ).toMatch(/blob\.type\s*!==\s*"image\/webp"/);
  });

  it("conserva el camino viejo cuando WebP no está", () => {
    // Un navegador sin WebP tiene que seguir respetando la transparencia del
    // PNG, aunque pese más. Perder el fondo de un logo es peor que 190 KB.
    expect(fuente).toMatch(/file\.type === "image\/png" \? "image\/png" : "image\/jpeg"/);
  });

  it("la extensión sigue al formato real, no al del archivo original", () => {
    // Subir un WebP llamado `.png` hace que algunos CDN sirvan el
    // Content-Type equivocado y el navegador confíe en el nombre.
    expect(fuente).toMatch(/salida === "image\/webp" \? "\.webp"/);
  });
});
