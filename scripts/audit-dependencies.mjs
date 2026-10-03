import { spawnSync } from "node:child_process";

const ALLOWED_DEV_ADVISORY = "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm";
const REVIEW_BEFORE = "2026-10-16";

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
      return source?.url === ALLOWED_DEV_ADVISORY;
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
const exceptionExpired = today >= REVIEW_BEFORE;
const unexpected = names.filter((name) => !isOnlyAllowedAdvisory(name, vulnerabilities));

if (exceptionExpired || unexpected.length > 0) {
  console.error(JSON.stringify(completeReport, null, 2));
  if (exceptionExpired) {
    throw new Error(`La excepcion temporal de ${ALLOWED_DEV_ADVISORY} vencio el ${REVIEW_BEFORE}.`);
  }
  throw new Error(`La auditoria encontro vulnerabilidades fuera de la excepcion: ${unexpected.join(", ")}.`);
}

console.warn(
  `Dependencias runtime: 0 vulnerabilidades. Herramientas de desarrollo: ${names.length} `
  + `entradas transitivas derivadas exclusivamente de ${ALLOWED_DEV_ADVISORY}; `
  + `sin parche publicado y con revision obligatoria antes de ${REVIEW_BEFORE}.`,
);
