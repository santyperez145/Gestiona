// D8 — snapshots gestionados por organización.
//
// El bucket es privado y la UI nunca lo lista directamente: esta función es la
// única que autoriza al dueño, firma una descarga y registra la integridad.
// El cron usa un secreto distinto de la anon key; no es una API pública que un
// navegador pueda disparar. Un snapshot con una tabla truncada o fallida se
// registra como fallido y jamás se presenta como respaldo recuperable.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireUser } from "../_shared/requireUser.ts";
import {
  collectOrganizationSnapshot,
  SNAPSHOT_SCHEMA_VERSION,
  sha256,
  snapshotIsComplete,
  snapshotManifest,
  validateSnapshot,
} from "../_shared/organizationSnapshot.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BACKUP_BUCKET = "backups";
const RETENTION_DAYS = 56;
const RETAINED_SNAPSHOTS = 8;

type BackupAction = "create" | "list" | "download" | "verify" | "cron-backup" | "cron-sync";
type BackupTrigger = "manual" | "scheduled";

type SnapshotRow = {
  id: string;
  org_id: string;
  status: "processing" | "completed" | "failed";
  snapshot_schema_version: number;
  storage_path: string | null;
  checksum_sha256: string | null;
  created_at: string;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isValidAction(value: unknown): value is BackupAction {
  return value === "create" || value === "list" || value === "download" || value === "verify" || value === "cron-backup" || value === "cron-sync";
}

// Evita una comparación que corte en el primer carácter distinto. No convierte
// esto en criptografía por sí solo, pero tampoco revela un prefijo del secreto.
function secretsMatch(expected: string | undefined, actual: string | null): boolean {
  if (!expected || !actual) return false;
  let difference = expected.length ^ actual.length;
  const size = Math.max(expected.length, actual.length);
  for (let index = 0; index < size; index += 1) {
    difference |= (expected.charCodeAt(index) || 0) ^ (actual.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function safeFailureReason(error: unknown): string {
  if (error instanceof Error && error.message.includes("storage")) return "No se pudo guardar el archivo privado";
  return "No se pudo completar el snapshot";
}

function publicSnapshot(row: Record<string, unknown>) {
  const {
    id, status, trigger, created_at, completed_at, expires_at, size_bytes,
    total_rows, table_count, last_verified_at, last_verification_status,
    failure_reason,
  } = row;
  return {
    id, status, trigger, created_at, completed_at, expires_at, size_bytes,
    total_rows, table_count, last_verified_at, last_verification_status,
    failure_reason,
  };
}

async function ownerCanAccess(admin: SupabaseClient, orgId: string, userId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("memberships")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("No se pudo verificar el acceso a la organización");
  return data?.role === "owner";
}

async function backupIsEntitled(admin: SupabaseClient, orgId: string): Promise<boolean> {
  const { data: organization, error: organizationError } = await admin
    .from("organizations")
    .select("plan_id")
    .eq("id", orgId)
    .maybeSingle();
  if (organizationError) throw new Error("No se pudo consultar el plan de la organización");
  if (!organization?.plan_id) return false;
  const { data: plan, error: planError } = await admin
    .from("plans")
    .select("backups_enabled")
    .eq("id", organization.plan_id)
    .maybeSingle();
  if (planError) throw new Error("No se pudo consultar el plan de la organización");
  return plan?.backups_enabled === true;
}

async function pruneOldSnapshots(admin: SupabaseClient, orgId: string) {
  const { data, error } = await admin
    .from("organization_backup_snapshots")
    .select("id, storage_path")
    .eq("org_id", orgId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .range(RETAINED_SNAPSHOTS, RETAINED_SNAPSHOTS + 100);
  if (error || !data?.length) return;

  const paths = data.map(row => row.storage_path).filter((path): path is string => !!path);
  if (paths.length) await admin.storage.from(BACKUP_BUCKET).remove(paths);
  await admin.from("organization_backup_snapshots").delete().in("id", data.map(row => row.id));
}

async function createSnapshot(
  admin: SupabaseClient,
  orgId: string,
  trigger: BackupTrigger,
  createdBy: string | null,
) {
  const snapshot = await collectOrganizationSnapshot(admin, orgId);
  const manifest = snapshotManifest(snapshot);
  const totalRows = snapshot.tables.reduce((total, table) => total + table.row_count, 0);
  const backupId = crypto.randomUUID();
  const storagePath = `org/${orgId}/${backupId}.json`;
  const expiresAt = new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { error: initialInsertError } = await admin.from("organization_backup_snapshots").insert({
    id: backupId,
    org_id: orgId,
    created_by: createdBy,
    trigger,
    status: "processing",
    storage_path: storagePath,
    snapshot_schema_version: snapshot.schema_version,
    table_count: snapshot.tables.length,
    total_rows: totalRows,
    manifest,
    expires_at: expiresAt,
  });
  if (initialInsertError) throw new Error("No se pudo iniciar el registro del snapshot");

  if (!snapshotIsComplete(snapshot)) {
    await admin.from("organization_backup_snapshots").update({
      status: "failed",
      failure_reason: "El snapshot tuvo tablas truncadas o con error; no se guardó ningún archivo",
      completed_at: new Date().toISOString(),
    }).eq("id", backupId);
    return { ok: false as const, id: backupId, reason: "Hay tablas incompletas; el respaldo no se guardó" };
  }

  const serialized = JSON.stringify(snapshot);
  const checksum = await sha256(serialized);
  const sizeBytes = new TextEncoder().encode(serialized).byteLength;
  const { error: uploadError } = await admin.storage.from(BACKUP_BUCKET).upload(storagePath, serialized, {
    contentType: "application/json; charset=utf-8",
    upsert: false,
  });
  if (uploadError) {
    await admin.from("organization_backup_snapshots").update({
      status: "failed",
      failure_reason: "No se pudo guardar el archivo privado",
      completed_at: new Date().toISOString(),
    }).eq("id", backupId);
    return { ok: false as const, id: backupId, reason: safeFailureReason(uploadError) };
  }

  const { error: finishError } = await admin.from("organization_backup_snapshots").update({
    status: "completed",
    checksum_sha256: checksum,
    size_bytes: sizeBytes,
    completed_at: new Date().toISOString(),
  }).eq("id", backupId);
  if (finishError) {
    await admin.storage.from(BACKUP_BUCKET).remove([storagePath]);
    await admin.from("organization_backup_snapshots").update({
      status: "failed",
      failure_reason: "No se pudo registrar el snapshot guardado",
      completed_at: new Date().toISOString(),
    }).eq("id", backupId);
    return { ok: false as const, id: backupId, reason: "No se pudo registrar el snapshot guardado" };
  }

  // Un upload exitoso no alcanza: antes de presentarlo como recuperable se lo
  // vuelve a descargar desde el bucket privado y se controla hash, cobertura y
  // conteos. Si esa lectura falla, el archivo no queda marcado como válido.
  const verification = await verifySnapshot(admin, {
    id: backupId,
    org_id: orgId,
    status: "completed",
    snapshot_schema_version: snapshot.schema_version,
    storage_path: storagePath,
    checksum_sha256: checksum,
    created_at: new Date().toISOString(),
  });
  if (!verification.ok) {
    await admin.storage.from(BACKUP_BUCKET).remove([storagePath]);
    await admin.from("organization_backup_snapshots").update({
      status: "failed",
      failure_reason: verification.reason ?? "El archivo guardado no superó la verificación",
      completed_at: new Date().toISOString(),
    }).eq("id", backupId);
    return { ok: false as const, id: backupId, reason: verification.reason ?? "El archivo guardado no superó la verificación" };
  }

  await pruneOldSnapshots(admin, orgId);
  return { ok: true as const, id: backupId, totalRows, tableCount: snapshot.tables.length };
}

async function listSnapshots(admin: SupabaseClient, orgId: string) {
  const { data, error } = await admin
    .from("organization_backup_snapshots")
    .select("id, status, trigger, created_at, completed_at, expires_at, size_bytes, total_rows, table_count, last_verified_at, last_verification_status, failure_reason")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error("No se pudo leer el historial de respaldos");
  return (data ?? []).map(row => publicSnapshot(row as Record<string, unknown>));
}

async function getOwnerSnapshot(admin: SupabaseClient, id: string, orgId: string): Promise<SnapshotRow | null> {
  const { data, error } = await admin
    .from("organization_backup_snapshots")
    .select("id, org_id, status, snapshot_schema_version, storage_path, checksum_sha256, created_at")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error("No se pudo leer el snapshot");
  return data as SnapshotRow | null;
}

async function verifySnapshot(admin: SupabaseClient, snapshot: SnapshotRow) {
  let verification: { ok: boolean; reason?: string };
  try {
    if (snapshot.status !== "completed" || !snapshot.storage_path || !snapshot.checksum_sha256) {
      verification = { ok: false, reason: "El snapshot no se completó" };
    } else {
      const { data, error } = await admin.storage.from(BACKUP_BUCKET).download(snapshot.storage_path);
      if (error || !data) {
        verification = { ok: false, reason: "No se pudo leer el archivo privado" };
      } else {
        const raw = await data.text();
        const matchesChecksum = await sha256(raw) === snapshot.checksum_sha256;
        if (!matchesChecksum) {
          verification = { ok: false, reason: "El hash del archivo no coincide" };
        } else {
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = null;
          }
          verification = validateSnapshot(parsed, snapshot.org_id);
        }
      }
    }
  } catch {
    verification = { ok: false, reason: "No se pudo validar el archivo privado" };
  }

  await admin.from("organization_backup_snapshots").update({
    last_verified_at: new Date().toISOString(),
    last_verification_status: verification.ok ? "passed" : "failed",
    ...(verification.ok ? {} : { failure_reason: verification.reason }),
  }).eq("id", snapshot.id);
  return verification;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  let body: { action?: unknown; orgId?: unknown; backupId?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Cuerpo JSON inválido" }, 400);
  }
  if (!isValidAction(body.action)) return json({ error: "Acción de respaldo inválida" }, 400);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRole) return json({ error: "Configuración de backup no disponible" }, 503);
  const admin = createClient(url, serviceRole);

  // El helper compartido de cron conserva `cron-sync` como cuerpo. El header
  // secreto, no ese nombre, determina que esto es una ejecución programada.
  const requestedByCron = body.action === "cron-backup" || body.action === "cron-sync";
  if (requestedByCron) {
    if (!secretsMatch(Deno.env.get("BACKUP_CRON_SECRET"), req.headers.get("x-backup-cron-secret"))) {
      return json({ error: "No autorizado" }, 401);
    }
    const { data: plans, error: plansError } = await admin.from("plans").select("id").eq("backups_enabled", true);
    if (plansError) return json({ error: "No se pudieron leer los planes habilitados" }, 500);
    const planIds = (plans ?? []).map(plan => plan.id);
    if (!planIds.length) return json({ processed: 0, completed: 0, failed: 0 });
    const { data: organizations, error: orgsError } = await admin
      .from("organizations")
      .select("id")
      .in("plan_id", planIds)
      .limit(1_000);
    if (orgsError) return json({ error: "No se pudieron leer las organizaciones habilitadas" }, 500);

    let completed = 0;
    let failed = 0;
    for (const organization of organizations ?? []) {
      // ⚠️ Esta ventana —no el cron— es la que fija el RPO.
      //
      // Estaba en 6 días, para una corrida semanal. Al pasar el cron a diario
      // (20260825000030) habría saltado 5 de cada 6 días y el RPO habría
      // seguido siendo de casi una semana: **cambiar la frecuencia del cron
      // sola no baja el RPO**. Se descubrió disparando el backup a mano y
      // recibiendo {"processed":4,"completed":0,"failed":0} — un no-op que
      // responde 200.
      //
      // 20 h deja margen para que la corrida diaria no se saltee a sí misma
      // por unos minutos de diferencia de horario.
      const recentThreshold = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
      const { data: recent, error: recentError } = await admin.from("organization_backup_snapshots")
        .select("id, org_id, status, snapshot_schema_version, storage_path, checksum_sha256, created_at")
        .eq("org_id", organization.id)
        .eq("status", "completed")
        .gte("created_at", recentThreshold);
      if (recentError) {
        failed += 1;
        continue;
      }
      if (recent?.length) {
        // Si una corrida anterior quedó sin confirmación, el cron no la ignora:
        // la prueba de lectura se repite antes de decidir que esa semana está cubierta.
        let hasCurrentVerifiedSnapshot = false;
        for (const backup of recent) {
          const verification = await verifySnapshot(admin, backup as SnapshotRow);
          // V1 sigue siendo un archivo íntegro y descargable, pero no cubre
          // las relaciones que agregamos en v2. Una ampliación del contrato
          // genera un nuevo snapshot; no borra ni marca corrupto al anterior.
          hasCurrentVerifiedSnapshot ||= verification.ok
            && (backup as SnapshotRow).snapshot_schema_version === SNAPSHOT_SCHEMA_VERSION;
        }
        if (hasCurrentVerifiedSnapshot) continue;
        // Un archivo reciente pero corrupto o de contrato viejo no cuenta para
        // la ventana semanal: se intenta producir uno nuevo en esta misma
        // corrida, sin esperar siete días ni degradar el historial anterior.
      }
      const result = await createSnapshot(admin, organization.id, "scheduled", null);
      if (result.ok) completed += 1;
      else failed += 1;
    }
    return json({ processed: (organizations ?? []).length, completed, failed });
  }

  const auth = await requireUser(req, corsHeaders);
  if (auth.response) return auth.response;
  if (typeof body.orgId !== "string" || !body.orgId) return json({ error: "orgId requerido" }, 400);
  const canAccess = await ownerCanAccess(admin, body.orgId, auth.user.id);
  if (!canAccess) return json({ error: "Sólo el dueño puede gestionar los respaldos" }, 403);

  if (body.action === "list") {
    return json({ backups: await listSnapshots(admin, body.orgId) });
  }
  if (body.action === "create") {
    if (!await backupIsEntitled(admin, body.orgId)) {
      return json({ error: "Tu plan no incluye respaldos gestionados" }, 403);
    }
    const result = await createSnapshot(admin, body.orgId, "manual", auth.user.id);
    return json(result, result.ok ? 201 : 422);
  }
  if (typeof body.backupId !== "string" || !body.backupId) return json({ error: "backupId requerido" }, 400);
  const snapshot = await getOwnerSnapshot(admin, body.backupId, body.orgId);
  if (!snapshot) return json({ error: "Snapshot no encontrado" }, 404);

  if (body.action === "download") {
    if (snapshot.status !== "completed" || !snapshot.storage_path) return json({ error: "El snapshot no está disponible" }, 409);
    const { data, error } = await admin.storage.from(BACKUP_BUCKET).createSignedUrl(snapshot.storage_path, 60);
    if (error || !data?.signedUrl) return json({ error: "No se pudo preparar la descarga" }, 500);
    return json({ url: data.signedUrl, expires_in_seconds: 60 });
  }
  if (body.action === "verify") {
    return json(await verifySnapshot(admin, snapshot));
  }
  return json({ error: "Acción no disponible" }, 400);
});
