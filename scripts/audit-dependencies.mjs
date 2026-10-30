import { spawnSync } from "node:child_process";

// Avisos de herramientas de desarrollo sin parche publicado, cada uno con su
// motivo y su fecha de revisión: vencida la fecha, la puerta vuelve a fallar.
// Nunca entra uno de runtime (ésos frenan siempre, más abajo).
const EXCEPCIONES = [
  {
    // Revisada 2026-10-14: `braces` sigue sin versión corregida (la última es
    // 3.0.3, de 2024-05). DoS por patrones anidados; acá sólo recibe los globs
    // fijos de tailwind.config.ts y del watcher de Vite al compilar, nunca
    // entrada de usuarios, y no viaja al bundle.
    url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
    revisarAntesDe: "2026-11-13",
  },
  {
    // Revisada 2026-10-30: `deepmerge` no tiene versión corregida (la última es
    // 4.3.1, de 2023-03, y el aviso la incluye). Prototype poisoning al
    // combinar objetos de afuera; acá lo usa @rollup/plugin-node-resolve dentro
    // de workbox-build, al compilar el service worker con nuestra propia
    // configuración. No recibe entrada de usuarios ni viaja al bundle.
    url: "https://github.com/advisories/GHSA-gcqx-w48m-w2h4",
    revisarAntesDe: "2026-11-29",
  },
];

function runAudit(extraArgs = []) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error("Ejecuta esta puerta mediante npm run check:dependencies.");
  }
  const result = spawnSync(
    process.execPath,
    [npmCli, "audit", "--audit-level=moderate", "--json", ...extraArgs],
    {
      encoding: "utf8",
      windowsHide: true,
    },
  );

  if (result.error) throw result.error;
  if (!result.stdout.trim()) {
    throw new Error(`npm audit no devolvio un reporte JSON. ${result.stderr.trim()}`);
  }

  try {
    return JSON.parse(result.stdout);
  } catch (cause) {
    throw new Error(`npm audit devolvio JSON invalido: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

function vulnerabilityCount(report) {
  return Number(report?.metadata?.vulnerabilities?.total ?? 0);
}

function isOnlyAllowedAdvisory(name, vulnerabilities, visiting = new Set()) {
  const vulnerability = vulnerabilities[name];
  if (!vulnerability || visiting.has(name)) return false;

  const nextVisiting = new Set(visiting);
  nextVisiting.add(name);

  return Array.isArray(vulnerability.via)
    && vulnerability.via.length > 0
    && vulnerability.via.every((source) => {
      if (typeof source === "string") {
        return isOnlyAllowedAdvisory(source, vulnerabilities, nextVisiting);
      }
      return EXCEPCIONES.some((excepcion) => source?.url === excepcion.url);
    });
}

const runtimeReport = runAudit(["--omit=dev"]);
if (vulnerabilityCount(runtimeReport) > 0) {
  console.error(JSON.stringify(runtimeReport, null, 2));
  throw new Error("La auditoria de dependencias de produccion encontro vulnerabilidades.");
}

const completeReport = runAudit();
const vulnerabilities = completeReport.vulnerabilities ?? {};
const names = Object.keys(vulnerabilities);

if (names.length === 0) {
  console.log("Dependencias: 0 vulnerabilidades en runtime y herramientas de desarrollo.");
  process.exit(0);
}

const today = new Date().toISOString().slice(0, 10);
const vencidas = EXCEPCIONES.filter((excepcion) => today >= excepcion.revisarAntesDe);
const unexpected = names.filter((name) => !isOnlyAllowedAdvisory(name, vulnerabilities));

if (vencidas.length > 0 || unexpected.length > 0) {
  console.error(JSON.stringify(completeReport, null, 2));
  if (vencidas.length > 0) {
    throw new Error(`Vencio la revision de: ${vencidas.map((e) => `${e.url} (${e.revisarAntesDe})`).join(", ")}.`);
  }
  throw new Error(`La auditoria encontro vulnerabilidades fuera de la excepcion: ${unexpected.join(", ")}.`);
}

console.warn(
  `Dependencias runtime: 0 vulnerabilidades. Herramientas de desarrollo: ${names.length} `
  + `entradas transitivas derivadas sólo de avisos sin parche publicado, con revision obligatoria: `
  + EXCEPCIONES.map((e) => `${e.url} antes de ${e.revisarAntesDe}`).join("; ") + ".",
);
