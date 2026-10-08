import { ImageMagick, initializeImageMagick, MagickFormat, MagickImageInfo, MagickReadSettings } from 'npm:@imagemagick/magick-wasm@0.0.44';
import { MAX_IMAGE_BYTES } from './catalogImages.ts';

let initialization: Promise<void> | null = null;
async function ready() {
  if (!initialization) {
    initialization = Deno.readFile(new URL(import.meta.resolve('npm:@imagemagick/magick-wasm@0.0.44/magick.wasm')))
      .then(bytes => initializeImageMagick(bytes)).catch(error => { initialization = null; throw error; });
  }
  await initialization;
}

export async function prepareCatalogImage(bytes: Uint8Array, mime: string) {
  const png = bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v);
  const jpg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = bytes.length >= 12 && new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF'
    && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP';
  const format = png && mime === 'image/png' ? MagickFormat.Png
    : jpg && mime === 'image/jpeg' ? MagickFormat.Jpeg
    : webp && mime === 'image/webp' ? MagickFormat.WebP : null;
  if (!format || bytes.length > MAX_IMAGE_BYTES) throw new Error('catalog_image_signature');
  await ready();
  const settings = new MagickReadSettings();
  settings.format = format;
  // Ping checks dimensions before allocating the decoded pixel raster.
  const info = MagickImageInfo.create(bytes, settings);
  if (info.width < 100 || info.height < 100 || info.width * info.height > 4_000_000
    || info.width > 6000 || info.height > 6000) throw new Error('catalog_image_dimensions');
  const prepared = ImageMagick.read(bytes, format, image => {
    image.autoOrient();
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    if (scale < 1) image.resize(Math.round(image.width * scale), Math.round(image.height * scale));
    image.strip();
    image.quality = 85;
    return image.write(MagickFormat.WebP, output => ({ bytes: new Uint8Array(output), width: image.width, height: image.height }));
  });
  if (prepared.width < 100 || prepared.height < 100) throw new Error('catalog_image_dimensions');
  if (!prepared.bytes.length || prepared.bytes.length > MAX_IMAGE_BYTES) throw new Error('catalog_image_output');
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(prepared.bytes));
  return { ...prepared, sha256: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('') };
}
