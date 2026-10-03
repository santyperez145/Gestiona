#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const RECOVERY_PROJECT = "nerqia";
export const RECOVERY_ORIGIN = "https://nerqia.app";
export const RECOVERY_CONFIRMATIONS = Object.freeze({
  rollback: "ROLLBACK NERQIA",
  promote: "PROMOTE NERQIA",
});

export function validateDeploymentUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("deployment_url debe ser una URL válida de Vercel");
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.port
    || url.pathname !== "/"
    || url.search
    || url.hash
    || !/^[a-z0-9](?:[a-z0-9-]{0,251}[a-z0-9])?\.vercel\.app$/i.test(url.hostname)
  ) {
    throw new Error("deployment_url debe apuntar sólo al host HTTPS de un deploy *.vercel.app");
  }
  return `https://${url.hostname.toLowerCase()}`;
}

export function validateRecoveryRequest({ operation, deploymentUrl, confirmation }) {
  if (operation !== "rollback" && operation !== "promote") {
    throw new Error("operation debe ser rollback o promote");
  }
  const expected = RECOVERY_CONFIRMATIONS[operation];
  if (confirmation !== expected) {
    throw new Error(`Confirmación inválida: escribí exactamente ${expected}`);
  }
  return { operation, deploymentUrl: validateDeploymentUrl(deploymentUrl) };
}

export function validateInspectedDeployment(deployment, operation) {
  if (!deployment || typeof deployment !== "object") throw new Error("Vercel no devolvió un deploy válido");
  if (deployment.name !== RECOVERY_PROJECT) throw new Error("El deploy no pertenece al proyecto nerqia");
  if (deployment.readyState !== "READY") throw new Error("El deploy elegido no está READY");
  if (operation === "rollback" && deployment.target !== "production") {
    throw new Error("Rollback sólo acepta un deploy que ya haya servido en producción");
  }
  if (typeof deployment.id !== "string" || !deployment.id.startsWith("dpl_")) {
    throw new Error("Vercel no confirmó la identidad inmutable del deploy");
  }
  return deployment;
}

export function validateRecoveryResult(selected, current, operation) {
  validateInspectedDeployment(current, "promote");
  if (!Array.isArray(current.aliases) || !current.aliases.includes(new URL(RECOVERY_ORIGIN).hostname)) {
    throw new Error("Vercel no confirmó el alias productivo nerqia.app");
  }
  // Instant Rollback reasigna el deploy existente. Promote puede generar un
  // build nuevo con variables de producción, por lo que allí el ID puede cambiar.
  if (operation === "rollback" && current.id !== selected.id) {
    throw new Error("El dominio productivo no quedó asociado al deploy elegido");
  }
  return current;
}

function runVercel(args) {
  const command = process.platform === "win32" ? "vercel.cmd" : "vercel";
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim().split("\n").slice(-3).join(" ");
    throw new Error(`Vercel CLI falló${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout;
}

function inspect(target) {
  const output = runVercel(["inspect", target, "--json", "--non-interactive"]);
  const start = output.indexOf("{");
  if (start === -1) throw new Error("Vercel inspect no devolvió JSON");
  return JSON.parse(output.slice(start));
}

async function verifyPublicSurface() {
  const checks = [
    { path: "/", contentType: "text/html" },
    { path: "/estado", contentType: "text/html" },
    { path: "/sitemap.xml", contentType: "xml" },
  ];
  for (const check of checks) {
    const response = await fetch(`${RECOVERY_ORIGIN}${check.path}`, {
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: { "user-agent": "nerqia-production-recovery/1" },
    });
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !type.toLowerCase().includes(check.contentType)) {
      throw new Error(`${check.path} no quedó saludable (${response.status}, ${type || "sin content-type"})`);
    }
  }
}

export async function executeRecovery(env = process.env) {
  if (!env.VERCEL_TOKEN) throw new Error("Falta VERCEL_TOKEN en el entorno protegido");
  const request = validateRecoveryRequest({
    operation: env.RECOVERY_OPERATION,
    deploymentUrl: env.RECOVERY_DEPLOYMENT_URL,
    confirmation: env.RECOVERY_CONFIRMATION,
  });
  const selected = validateInspectedDeployment(inspect(request.deploymentUrl), request.operation);

  if (request.operation === "rollback") {
    runVercel(["rollback", request.deploymentUrl, "--timeout", "5m", "--non-interactive"]);
  } else {
    runVercel(["promote", request.deploymentUrl, "--yes", "--timeout", "5m", "--non-interactive"]);
  }

  const current = validateRecoveryResult(selected, inspect("nerqia.app"), request.operation);
  await verifyPublicSurface();
  console.log(`${request.operation} confirmado: ${current.id}; home, estado y sitemap saludables.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  executeRecovery().catch(error => {
    console.error(`Recuperación de producción falló: ${error instanceof Error ? error.message : "error inesperado"}`);
    process.exitCode = 1;
  });
}
