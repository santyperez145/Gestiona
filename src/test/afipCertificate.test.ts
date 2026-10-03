import { describe, expect, it } from "vitest";
import { validateAfipCertificateMetadata } from "../../supabase/functions/_shared/afipCertificate";

const now = new Date("2026-10-03T00:00:00.000Z");
const valid = {
  notBefore: new Date("2026-01-01T00:00:00.000Z"),
  notAfter: new Date("2027-01-01T00:00:00.000Z"),
  subjectSerialNumber: "CUIT 30712345678",
  certificateModulus: "abc",
  certificateExponent: "10001",
  privateKeyModulus: "abc",
  privateKeyExponent: "10001",
  fingerprintSha256: "a".repeat(64),
};

describe("credencial fiscal de plataforma", () => {
  it("acepta un par vigente, coincidente y perteneciente al CUIT", () => {
    expect(validateAfipCertificateMetadata(valid, "30712345678", now)).toEqual({
      notBefore: "2026-01-01T00:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z",
      fingerprintSha256: "a".repeat(64),
      subjectCuit: "30712345678",
    });
  });

  it("rechaza CRT/KEY que no forman el mismo par", () => {
    expect(() => validateAfipCertificateMetadata({ ...valid, privateKeyModulus: "otro" }, "30712345678", now))
      .toThrow(/mismo par/);
  });

  it("rechaza certificados vencidos, futuros o de otro CUIT", () => {
    expect(() => validateAfipCertificateMetadata({ ...valid, notAfter: now }, "30712345678", now)).toThrow(/venció/);
    expect(() => validateAfipCertificateMetadata({ ...valid, notBefore: new Date("2026-10-04T00:00:00Z") }, "30712345678", now)).toThrow(/todavía no/);
    expect(() => validateAfipCertificateMetadata(valid, "30700000009", now)).toThrow(/pertenece al CUIT/);
  });
});
