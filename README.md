# Nerqia Commerce OS

Nerqia permite crear una tienda online, vender por distintos canales y operar
productos, stock, clientes, compras, cobros y margen desde una sola fuente de
verdad. Commerce es la puerta de entrada; Business, Pay, Finance, Automate y
Platform completan el sistema operativo del comercio.

Producción: [nerqia.app](https://nerqia.app)

## Producto

| Superficie | Ruta | Responsabilidad |
|---|---|---|
| Commerce | `/tienda-online`, `/pedidos-online`, `/tienda/:slug` | Tiendas, checkout, pedidos, conversión y canales. |
| Business | `/` | POS, catálogo, inventario, clientes, compras y operación. |
| Finance | `/finance` | Documentos, gastos, aprobaciones, obligaciones y conciliación. |
| Platform | `/platform` | Alta de comercios, billing, soporte, riesgo e integraciones. |

Todas las superficies privadas comparten identidad, organizaciones y Business
Graph, pero mantienen navegación y permisos propios. Una tienda personaliza su
experiencia sin duplicar productos, clientes, stock o costos.

## Stack

- React 18, TypeScript, React Router y Vite 8;
- Tailwind CSS y primitives Radix;
- TanStack Query para estado remoto;
- Supabase/PostgreSQL para datos, RLS, Auth, Storage, Realtime y Edge Functions;
- Vercel para frontend y endpoints públicos;
- Vitest y Playwright para verificación;
- Sentry opcional para observabilidad;
- Anthropic como proveedor actual de funciones del Business Copilot.

La arquitectura vigente está en
[docs/ARQUITECTURA.md](docs/ARQUITECTURA.md). El producto y el siguiente trabajo
están en [ROADMAP.md](ROADMAP.md).

## Inicio local

Requisitos: Node.js 20 o superior, npm y acceso al proyecto Supabase cuando se
necesiten datos reales.

```bash
npm ci
npm run dev
```

La app queda en `http://localhost:8080`.

Crear `.env.local` a partir de las variables disponibles en Vercel/Supabase:

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon-key>
```

No commitear secretos. Sin esas variables la interfaz puede compilar, pero no
puede validar tiendas ni datos reales.

## Comandos

```bash
npm run dev              # servidor local
npm run typecheck        # TypeScript real de la aplicación
npm run lint             # ESLint
npm test                 # suite Vitest
npm run build            # bundle de producción + PWA
npm run test:e2e         # Playwright local
npm run check:enlaces    # enlaces internos de documentación
npm run check:conteos    # cifras documentadas con fecha/comando
```

Antes de un commit:

```bash
NODE_OPTIONS=--max-old-space-size=6144 npm run typecheck
NODE_OPTIONS=--max-old-space-size=6144 npm run lint
NODE_OPTIONS=--max-old-space-size=6144 npm test
NODE_OPTIONS=--max-old-space-size=6144 npm run build
git diff --check
```

No usar `npx tsc --noEmit`: el `tsconfig.json` raíz contiene referencias y no
comprueba la aplicación. El comando válido es `npm run typecheck`.

## Trabajo seguro

El repositorio se modifica desde más de un equipo. Antes de planificar o elegir
un número de migración:

```bash
git fetch origin
git log --oneline main..origin/main
git log --oneline origin/main..main
```

Las reglas completas están en [CONTRIBUTING.md](CONTRIBUTING.md). Invariantes:

- la base, no el navegador, mueve stock y calcula importes de checkout;
- cada ruta y permiso nace en `src/app/routeManifest.ts`;
- los secretos entran por OAuth o Edge Functions y nunca vuelven al cliente;
- RLS y funciones server-side son la barrera de tenant;
- un error de permisos o red nunca se convierte en una lista vacía;
- toda capacidad se entrega de punta a punta, con estados y recuperación;
- los datos reales no se modifican para probar: usar fixtures `ZZ` y rollback.

## Migraciones

Los archivos viven en `supabase/migrations/` y usan un prefijo de 14 dígitos.
Se escriben idempotentes y se aplican de forma controlada:

```bash
npx supabase db query --linked --file supabase/migrations/<archivo>.sql
npx supabase db push --linked --dry-run
```

El `dry-run` debe terminar con la base al día y ninguna migración pendiente. Si
el libro remoto menciona una versión sin archivo local, no marcarla como
revertida: primero recuperar o reconstruir el archivo correcto.

## E2E y datos

Los specs públicos corren sin credenciales. El panel autenticado necesita:

```bash
E2E_USER=pruebas@dominio.com
E2E_PASSWORD=<secreto>
npm run test:e2e:ci
```

La sesión se guarda en `e2e/.auth/usuario.json`, que está ignorado. Los tests
contra producción son de lectura; cualquier verificación que escriba debe ser
reversible y dejar cero restos.

## Deploy

Cada push a `main` inicia un deploy en Vercel. El dominio canónico es
`nerqia.app`; `www.nerqia.app` redirige al apex. Supabase usa ese origen y
los dominios permitidos declarados en `supabase/config.toml`.

Las Edge Functions se publican con:

```bash
npm run deploy:functions
```

Una entrega no está cerrada hasta que el deploy figure `Ready` y el flujo se
compruebe en producción sin mutar datos del comercio.

## Documentación

- [Índice vigente](docs/INDICE.md)
- [Roadmap](ROADMAP.md)
- [Dirección visual](DESIGNROADMAP.md)
- [Estrategia y benchmarks](docs/ESTRATEGIA.md)
- [Arquitectura](docs/ARQUITECTURA.md)
- [Finance](docs/FINANCE.md)
- [Experiencia competitiva](docs/ESTANDAR_EXPERIENCIA_COMPETITIVA.md)
- [Legal](docs/LEGAL.md)

Los documentos describen el presente y las decisiones activas. La historia de
entregas, auditorías e incidentes vive en Git.
