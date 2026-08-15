import { describe, expect, it } from "vitest";
import { backupTrustLabel, formatBackupBytes, type OrganizationBackup } from "@/lib/orgBackups";

const base: OrganizationBackup = {
  id: "backup-1",
  status: "completed",
  trigger: "scheduled",
  created_at: "2026-08-15T12:00:00.000Z",
  completed_at: "2026-08-15T12:01:00.000Z",
  expires_at: "2026-10-10T12:00:00.000Z",
  size_bytes: 1024,
  total_rows: 10,
  table_count: 3,
  last_verified_at: null,
  last_verification_status: null,
  failure_reason: null,
};

describe("respaldos gestionados", () => {
  it("no promete integridad cuando el snapshot no se verificó", () => {
    expect(backupTrustLabel(base)).toBe("Pendiente de verificar");
    expect(backupTrustLabel({ ...base, last_verification_status: "passed" })).toBe("Integridad verificada");
    expect(backupTrustLabel({ ...base, last_verification_status: "failed" })).toBe("Integridad con error");
  });

  it("prioriza un fallo del snapshot aunque haya una verificación vieja", () => {
    expect(backupTrustLabel({ ...base, status: "failed", last_verification_status: "passed" })).toBe("Falló");
  });

  it("muestra tamaños legibles sin inventar un tamaño ausente", () => {
    expect(formatBackupBytes(null)).toBe("—");
    expect(formatBackupBytes(512)).toBe("512 B");
    expect(formatBackupBytes(1536)).toBe("1.5 KB");
  });
});
