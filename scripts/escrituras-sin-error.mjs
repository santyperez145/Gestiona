// Barrido: escrituras del front a la base (.insert/.update/.delete/.upsert)
// cuyo resultado nadie mira —`await supabase.from(...)...update(...)` suelto,
// sin `const { error } =`—. Si la base rechaza, la pantalla sigue como si
// hubiera guardado. Así apareció la campanita (2026-10-11).
//   node scripts/escrituras-sin-error.mjs
import fs from 'node:fs';
import path from 'node:path';
function walk(d, out = []) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    const s = fs.statSync(p);
    if (s.isDirectory()) { if (!/node_modules|[\\/]test|integrations/.test(p)) walk(p, out); }
    else if (/\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)) out.push(p);
  }
  return out;
}
const hallazgos = [];
for (const f of walk('src')) {
  const lineas = fs.readFileSync(f, 'utf8').split('\n');
  lineas.forEach((l, i) => {
    // Sentencia que empieza con `await supabase` (o `await (supabase`) sin asignar.
    if (!/^\s*await\s+\(?\s*supabase\b/.test(l)) return;
    const tramo = lineas.slice(i, i + 6).join(' ');
    if (!/\.(insert|update|delete|upsert)\s*\(/.test(tramo.split(';')[0])) return;
    hallazgos.push(`${f.split(path.sep).join('/')}:${i + 1}`);
  });
}
console.log(hallazgos.join('\n'));
console.log('total', hallazgos.length);
