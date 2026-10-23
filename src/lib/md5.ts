/**
 * MD5 (RFC 1321) de bytes, en hexadecimal. Sólo para nombrar los lotes de
 * ARBA, que llevan el MD5 del .zip en el nombre (el navegador no trae MD5 en
 * `crypto.subtle`). No sirve ni se usa para nada de seguridad.
 */
const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

export function md5Hex(datos: Uint8Array): string {
  const largo = datos.length;
  const bloques = ((largo + 8) >>> 6) + 1;
  const m = new Uint8Array(bloques * 64);
  m.set(datos);
  m[largo] = 0x80;
  const bits = largo * 8;
  const vista = new DataView(m.buffer);
  vista.setUint32(m.length - 8, bits >>> 0, true);
  vista.setUint32(m.length - 4, Math.floor(bits / 2 ** 32), true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let b = 0; b < bloques; b++) {
    const w = (i: number) => vista.getUint32(b * 64 + i * 4, true);
    let a = a0, bb = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (bb & c) | (~bb & d); g = i; }
      else if (i < 32) { f = (d & bb) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = bb ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (bb | ~d); g = (7 * i) % 16; }
      const t = d;
      d = c;
      c = bb;
      const x = (a + f + K[i] + w(g)) >>> 0;
      bb = (bb + ((x << S[i]) | (x >>> (32 - S[i])))) >>> 0;
      a = t;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + bb) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  const salida = new DataView(new ArrayBuffer(16));
  [a0, b0, c0, d0].forEach((v, i) => salida.setUint32(i * 4, v, true));
  return Array.from(new Uint8Array(salida.buffer), x => x.toString(16).padStart(2, "0")).join("");
}
