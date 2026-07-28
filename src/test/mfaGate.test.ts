import { describe, it, expect } from "vitest";
import { decideMfaState } from "@/lib/mfaGate";

const admin = { isAdmin: true, orgRequiresMfa: false };
const vendedor = { isAdmin: false, orgRequiresMfa: false };

describe("decideMfaState", () => {
  it("pide el código cuando hay factor verificado y la sesión sigue en aal1", () => {
    const r = decideMfaState(
      { currentLevel: "aal1", nextLevel: "aal2" },
      [{ id: "f1", status: "verified" }],
      vendedor,
    );
    expect(r.decision).toBe("needs_code");
    expect(r.factorId).toBe("f1");
  });

  it("no pide nada cuando la sesión ya subió a aal2", () => {
    const r = decideMfaState(
      { currentLevel: "aal2", nextLevel: "aal2" },
      [{ id: "f1", status: "verified" }],
      admin,
    );
    expect(r.decision).toBe("ok");
  });

  it("ignora factores a medio enrolar (unverified)", () => {
    const r = decideMfaState(
      { currentLevel: "aal1", nextLevel: "aal2" },
      [{ id: "f1", status: "unverified" }],
      vendedor,
    );
    expect(r.decision).toBe("ok");
  });

  it("exige enrolamiento al admin cuando la org lo requiere y no tiene factor", () => {
    const r = decideMfaState(
      { currentLevel: "aal1", nextLevel: "aal1" },
      [],
      { isAdmin: true, orgRequiresMfa: true },
    );
    expect(r.decision).toBe("needs_enrollment");
  });

  it("no le exige enrolamiento a un no-admin aunque la org lo requiera", () => {
    const r = decideMfaState(
      { currentLevel: "aal1", nextLevel: "aal1" },
      [],
      { isAdmin: false, orgRequiresMfa: true },
    );
    expect(r.decision).toBe("ok");
  });

  it("no exige enrolamiento si el admin ya tiene un factor verificado", () => {
    const r = decideMfaState(
      { currentLevel: "aal2", nextLevel: "aal2" },
      [{ id: "f1", status: "verified" }],
      { isAdmin: true, orgRequiresMfa: true },
    );
    expect(r.decision).toBe("ok");
  });

  it("no deja al usuario afuera si no se pudo leer el nivel AAL", () => {
    const r = decideMfaState(null, [], { isAdmin: true, orgRequiresMfa: true });
    expect(r.decision).toBe("ok");
  });

  it("el código tiene prioridad sobre el enrolamiento: sesión a medio verificar", () => {
    const r = decideMfaState(
      { currentLevel: "aal1", nextLevel: "aal2" },
      [{ id: "f9", status: "verified" }],
      { isAdmin: true, orgRequiresMfa: true },
    );
    expect(r.decision).toBe("needs_code");
    expect(r.factorId).toBe("f9");
  });
});
