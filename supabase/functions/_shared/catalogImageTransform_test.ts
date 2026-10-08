import { ImageMagick, MagickColors, MagickFormat, MagickImageInfo } from 'npm:@imagemagick/magick-wasm@0.0.44';
import { prepareCatalogImage } from './catalogImageTransform.ts';

Deno.test('catalog transform rejects active content and invalid signatures before decode', async () => {
  for (const mime of ['image/png', 'image/jpeg', 'image/svg+xml']) {
    try { await prepareCatalogImage(new TextEncoder().encode('<svg/>'), mime); throw new Error('accepted'); }
    catch (error) { if (!(error instanceof Error) || error.message !== 'catalog_image_signature') throw error; }
  }
});
Deno.test('catalog transform decodes, strips metadata and creates bounded real WebP', async () => {
  // A valid header initializes the WASM, then fails closed on truncated content.
  try { await prepareCatalogImage(new Uint8Array([137,80,78,71,13,10,26,10]), 'image/png'); } catch { /* expected */ }
  const input = ImageMagick.read(MagickColors.White, 1800, 1000, image => {
    image.setAttribute('comment', 'ZZ PRIVATE PHOTO METADATA');
    return image.write(MagickFormat.Png, data => new Uint8Array(data));
  });
  const started = performance.now();
  const output = await prepareCatalogImage(input, 'image/png');
  if (output.width !== 1600 || output.height !== 889 || !/^[0-9a-f]{64}$/.test(output.sha256)) throw new Error('bad dimensions/hash');
  if (MagickImageInfo.create(output.bytes).format !== MagickFormat.WebP) throw new Error('not WebP');
  ImageMagick.read(output.bytes, image => { if (image.getAttribute('comment')) throw new Error('metadata retained'); });
  console.log(`Catalog fixture 1.8MP: ${Math.round(performance.now() - started)}ms, ${output.bytes.length} bytes`);
  const tiny = ImageMagick.read(MagickColors.White, 50, 50, image => image.write(MagickFormat.Png, data => new Uint8Array(data)));
  try { await prepareCatalogImage(tiny, 'image/png'); throw new Error('accepted'); }
  catch (error) { if (!(error instanceof Error) || error.message !== 'catalog_image_dimensions') throw error; }
});
