/**
 * Auditoría de completitud por página.
 *
 * El tamaño del archivo de la página no dice nada: `/ia-commerce` tiene 15
 * líneas y delega en un componente de 900. Esto resuelve el árbol de imports
 * propios de cada ruta (sin `components/ui`, que es la librería) y mide contra
 * el Definition of Done del ROADMAP §7: loading, vacío, error recuperable,
 * permisos server-side y estados de guardado.
 *
 * No abre conexiones ni ejecuta nada: lee el código. Es un termómetro para
 * priorizar, no un gate — una página puede resolver un estado de una forma que
 * esta heurística no reconozca, y por eso imprime qué señal faltó.
 *
 *   node scripts/audit-pages.mjs            tabla completa
 *   node scripts/audit-pages.mjs --json     para procesar
 *   node scripts/audit-pages.mjs /ajustes   detalle de una ruta
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

// Vitest transforma el módulo y `import.meta.url` deja de ser un file://, así
// que el camino propio no siempre se puede resolver: ahí vale la raíz del repo.
function raizDelRepo() {
  try { return fileURLToPath(new URL('../', import.meta.url)); }
  catch { return resolve(process.cwd()); }
}
const RAIZ = raizDelRepo();
const SRC = resolve(RAIZ, 'src');

/** Resuelve `@/x` y rutas relativas a un archivo real dentro de src. */
function resolverImport(especificador, desde) {
  let base;
  if (especificador.startsWith('@/')) base = resolve(SRC, especificador.slice(2));
  else if (especificador.startsWith('.')) base = resolve(dirname(desde), especificador);
  else return null; // paquete de node_modules
  for (const sufijo of ['.tsx', '.ts', '/index.tsx', '/index.ts', '']) {
    const candidato = base + sufijo;
    if (existsSync(candidato) && !candidato.endsWith('/')) return candidato;
  }
  return null;
}

const IMPORTS = /(?:^|\n)\s*(?:import|export)[\s\S]{0,400}?from\s+['"]([^'"]+)['"]/g;
const LAZY = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * Árbol de la capa de vista propia de una página: su archivo, los componentes
 * que monta y sus hooks.
 *
 * Deliberadamente NO entra a `lib/` ni a `integrations/`. Son infraestructura
 * compartida: si contaran, cualquier página que importe `supabaseStore`
 * heredaría sus `catch` y aprobaría el estado de error sin tener ninguno —
 * medía 100% en 60 páginas y por eso no servía. Tampoco a `components/ui`,
 * que es shadcn.
 */
const CARPETAS = ['pages', 'components', 'hooks'].map(c => resolve(SRC, c));

function propio(archivo) {
  return CARPETAS.some(c => archivo.startsWith(c)) && !archivo.startsWith(resolve(SRC, 'components/ui'));
}

/**
 * Devuelve dos conjuntos:
 *
 *   `vista`  — la página, sus componentes y sus hooks. Es el único corpus
 *              donde se buscan los estados del DoD.
 *   `datos`  — además, los módulos de `lib/` e `integrations/` que la vista
 *              importa **directamente**: su capa de datos. Sirve para saber si
 *              la página lee o escribe, nada más. Sin esto `/finance/documentos`
 *              —2157 líneas— daba «no lee datos» porque consulta vía `lib/`.
 */
function arbol(entrada) {
  const vista = new Set();
  const datos = new Set();
  const pila = [entrada];
  while (pila.length) {
    const archivo = pila.pop();
    if (!archivo || vista.has(archivo)) continue;
    vista.add(archivo);
    const codigo = readFileSync(archivo, 'utf8');
    for (const rx of [IMPORTS, LAZY]) {
      rx.lastIndex = 0;
      let m;
      while ((m = rx.exec(codigo))) {
        const destino = resolverImport(m[1], archivo);
        if (!destino) continue;
        if (propio(destino)) pila.push(destino);
        else if (destino.startsWith(SRC)) datos.add(destino);
      }
    }
  }
  return { vista: [...vista], datos: [...datos] };
}

/**
 * Señales del Definition of Done. Cada una es un OR de formas en que el repo
 * ya las resuelve; `peso` es cuánto cuesta no tenerla en una página que
 * escribe datos.
 */
const SENALES = [
  { id: 'loading', etiqueta: 'carga', peso: 2, rx: /isLoading|setLoading|\bloading\b|cargando|Skeleton|animate-spin/i },
  { id: 'vacio', etiqueta: 'vacío', peso: 2, rx: /Sin \w|No hay |vac[ií]o|Todav[ií]a no|empty|primer[ao] \w+ para empezar/i },
  { id: 'error', etiqueta: 'error', peso: 3, rx: /toast\.error|catch\s*\(|setError|mensajeDeEdgeFunction/ },
  { id: 'permisos', etiqueta: 'permisos', peso: 3, rx: /has_permission|hasPermission|usePermiso|puedeEditar|canEdit|useEntitlements|roles?\s*[:=]/ },
  { id: 'exito', etiqueta: 'éxito', peso: 1, rx: /toast\.success/ },
  { id: 'offline', etiqueta: 'offline', peso: 1, rx: /isOnline|navigator\.onLine|offline|stale/i },
];

const ESCRIBE = /\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(|supabase\.functions\.invoke/;
/**
 * Lee datos del comercio: si no, es una página estática y no tiene error ni
 * offline que manejar. Son accesos concretos a propósito — `use[A-Z]\w*\(`
 * daba por «lee datos» a cualquier página que llamara `usePageTitle`.
 */
const LEE = /supabase|useQuery\(|useMutation\(|fetch\(|\w+DB\(|\.invoke\(/;
// `placeholder=` es un atributo de todo <Input>: contarlo daba un pendiente
// falso en casi todas las páginas.
const PENDIENTE = /Pr[óo]ximamente|coming soon|en construcci[óo]n|\bTODO\b|\bFIXME\b|\bWIP\b/i;

function auditar(ruta) {
  const { vista, datos } = arbol(ruta.archivo);
  const codigo = vista.map(f => readFileSync(f, 'utf8')).join('\n');
  // `types.ts` son 61k líneas generadas: entra al corpus de datos pero no se
  // lee, sólo importaría ruido y tiempo.
  const codigoDatos = codigo + '\n' + datos
    .filter(f => !f.includes('integrations/supabase/types'))
    .map(f => readFileSync(f, 'utf8')).join('\n');
  const lineas = codigo.split('\n').length;
  const faltan = SENALES.filter(s => !s.rx.test(codigo));
  const escribe = ESCRIBE.test(codigoDatos);
  const lee = LEE.test(codigoDatos);
  const pendientes = (codigo.match(PENDIENTE) || []).length;
  // Una página de sólo lectura no necesita permisos de escritura ni éxito;
  // una estática —términos, privacidad— no tiene datos que puedan fallar.
  let exigibles = escribe ? SENALES : SENALES.filter(s => !['permisos', 'exito'].includes(s.id));
  if (!lee) exigibles = exigibles.filter(s => !['carga', 'vacío', 'error', 'offline'].includes(s.etiqueta));
  const castigo = faltan.filter(s => exigibles.includes(s)).reduce((t, s) => t + s.peso, 0);
  const total = exigibles.reduce((t, s) => t + s.peso, 0);
  return {
    ...ruta,
    archivos: vista.length,
    lineas,
    escribe,
    lee,
    pendientes,
    faltan: faltan.filter(s => exigibles.includes(s)).map(s => s.etiqueta),
    // Sin nada exigible —una página estática— no hay nada que puntuar: 100.
    puntaje: total === 0 ? 100 : Math.round(((total - castigo) / total) * 100),
  };
}

const RUTA_RX = /\{\s*id:\s*"([^"]+)",\s*path:\s*"([^"]+)"[\s\S]*?import\("@\/pages\/([^"]+)"\)[\s\S]*?status:\s*"([^"]+)"/g;

/** Rutas del manifiesto que resuelven a un archivo de página existente. */
export function rutasDelManifiesto() {
  const manifiesto = readFileSync(resolve(SRC, 'app/routeManifest.ts'), 'utf8');
  const rutas = [];
  let m;
  RUTA_RX.lastIndex = 0;
  while ((m = RUTA_RX.exec(manifiesto))) {
    const archivo = resolve(SRC, 'pages', `${m[3]}.tsx`);
    if (existsSync(archivo)) rutas.push({ id: m[1], path: m[2], componente: m[3], status: m[4], archivo });
  }
  return rutas;
}

/** Informe completo, de la página más floja a la más completa. */
export function auditarRutas() {
  return rutasDelManifiesto().map(auditar).sort((a, b) => a.puntaje - b.puntaje || a.lineas - b.lineas);
}

// Sólo como CLI: importarlo desde un test no tiene que imprimir nada.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
const rutas = rutasDelManifiesto();
const filtro = process.argv.find(a => a.startsWith('/'));
const informe = auditarRutas();

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(informe.map(({ archivo, ...r }) => r), null, 2));
} else if (filtro) {
  const r = informe.find(x => x.path === filtro);
  if (!r) { console.error(`Ruta ${filtro} no está en el manifiesto.`); process.exitCode = 1; }
  else {
    console.log(`${r.path}  (${r.componente}, status ${r.status})`);
    console.log(`  archivos propios: ${r.archivos}   líneas: ${r.lineas}   escribe: ${r.escribe ? 'sí' : 'no'}`);
    console.log(`  estados sin señal: ${r.faltan.length ? r.faltan.join(', ') : 'ninguno'}`);
    console.log(`  marcas de pendiente: ${r.pendientes}`);
    console.log(`  completitud: ${r.puntaje}%`);
  }
} else {
  console.log('ruta                             arch  líneas  escr  pend  faltan                      %');
  for (const r of informe) {
    console.log(
      `${r.path.padEnd(32)} ${String(r.archivos).padStart(4)} ${String(r.lineas).padStart(7)}  ` +
      `${(r.escribe ? 'sí' : 'no').padEnd(4)}  ${String(r.pendientes).padStart(4)}  ` +
      `${(r.faltan.join(',') || '—').padEnd(26)} ${String(r.puntaje).padStart(3)}`,
    );
  }
  const flojas = informe.filter(r => r.puntaje < 100);
  console.log(`\n${rutas.length} rutas. ${flojas.length} con algún estado del DoD sin señal.`);
}
}
