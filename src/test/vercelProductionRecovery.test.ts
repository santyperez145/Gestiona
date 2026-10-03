import { describe, expect, it } from "vitest";
import {
  validateDeploymentUrl,
  validateInspectedDeployment,
  validateRecoveryRequest,
  validateRecoveryResult,
} from "../../scripts/vercel-production-recovery.mjs";

describe("production recovery guard", () => {
  it("accepts only immutable HTTPS Vercel deployment hosts", () => {
    expect(validateDeploymentUrl("https://nerqia-abc123-owner.vercel.app")).toBe("https://nerqia-abc123-owner.vercel.app");
    for (const invalid of [
      "https://nerqia.app",
      "http://nerqia-abc.vercel.app",
      "https://evil.example.com",
      "https://nerqia-abc.vercel.app/path",
      "https://nerqia-abc.vercel.app?next=evil",
      "https://user:pass@nerqia-abc.vercel.app",
    ]) expect(() => validateDeploymentUrl(invalid)).toThrow();
  });

  it("requires an operation-specific human confirmation", () => {
    expect(validateRecoveryRequest({
      operation: "rollback",
      deploymentUrl: "https://nerqia-old-owner.vercel.app",
      confirmation: "ROLLBACK NERQIA",
    })).toEqual({ operation: "rollback", deploymentUrl: "https://nerqia-old-owner.vercel.app" });
    expect(() => validateRecoveryRequest({
      operation: "rollback",
      deploymentUrl: "https://nerqia-old-owner.vercel.app",
      confirmation: "PROMOTE NERQIA",
    })).toThrow(/Confirmación inválida/);
  });

  it("rejects foreign, unfinished and never-production rollback targets", () => {
    const valid = { id: "dpl_123", name: "nerqia", readyState: "READY", target: "production", aliases: ["nerqia.app"] };
    expect(validateInspectedDeployment(valid, "rollback")).toBe(valid);
    expect(() => validateInspectedDeployment({ ...valid, name: "other" }, "rollback")).toThrow(/no pertenece/);
    expect(() => validateInspectedDeployment({ ...valid, readyState: "ERROR" }, "rollback")).toThrow(/READY/);
    expect(() => validateInspectedDeployment({ ...valid, target: null }, "rollback")).toThrow(/producción/);
    expect(() => validateInspectedDeployment({ ...valid, id: "not-immutable" }, "rollback")).toThrow(/inmutable/);
  });

  it("requires the production alias and permits a rebuilt promotion ID", () => {
    const selected = { id: "dpl_old", name: "nerqia", readyState: "READY", target: null, aliases: [] };
    const promoted = { id: "dpl_new", name: "nerqia", readyState: "READY", target: "production", aliases: ["nerqia.app"] };
    expect(validateRecoveryResult(selected, promoted, "promote")).toBe(promoted);
    expect(() => validateRecoveryResult(selected, promoted, "rollback")).toThrow(/deploy elegido/);
    expect(() => validateRecoveryResult(selected, { ...promoted, aliases: [] }, "promote")).toThrow(/alias productivo/);
  });
});
