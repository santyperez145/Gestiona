import { describe, expect, it, beforeEach } from "vitest";
import {
  captureStoreReferral,
  normalizeReferralCode,
  notesWithStoreReferral,
  readStoreReferral,
} from "@/lib/storeReferral";

describe("storeReferral", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("normaliza y rechaza códigos tontos", () => {
    expect(normalizeReferralCode(" ana-10 ")).toBe("ANA-10");
    expect(normalizeReferralCode("bad@code")).toBeNull();
    expect(normalizeReferralCode("")).toBeNull();
  });

  it("captura ?ref= y lo relee por slug", () => {
    expect(captureStoreReferral("mi-tienda", "?ref=ana10")).toBe("ANA10");
    expect(readStoreReferral("mi-tienda")).toBe("ANA10");
    expect(captureStoreReferral("mi-tienda", "")).toBe("ANA10");
  });

  it("deja el tag en notas sin duplicar", () => {
    expect(notesWithStoreReferral(null, "ANA10")).toBe("[ref:ANA10]");
    expect(notesWithStoreReferral("Llamar al llegar", "ANA10")).toBe("Llamar al llegar\n[ref:ANA10]");
    expect(notesWithStoreReferral("[ref:ANA10]", "ANA10")).toBe("[ref:ANA10]");
    expect(notesWithStoreReferral("hola", null)).toBe("hola");
  });
});
