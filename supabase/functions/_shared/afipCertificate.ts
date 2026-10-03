export interface AfipCertificateMetadata {
  notBefore: Date;
  notAfter: Date;
  subjectSerialNumber?: string | null;
  certificateModulus: string;
  certificateExponent: string;
  privateKeyModulus: string;
  privateKeyExponent: string;
  fingerprintSha256: string;
}

export interface ValidatedAfipCertificate {
  notBefore: string;
  expiresAt: string;
  fingerprintSha256: string;
  subjectCuit: string | null;
}

function subjectCuit(serialNumber: string | null | undefined): string | null {
  const match = String(serialNumber ?? "").match(/(?:CUIT\s*)?(\d{2}[- ]?\d{8}[- ]?\d)/i);
  return match ? match[1].replace(/\D/g, "") : null;
}

/** Valida autoridad material antes de persistir el secreto. */
export function validateAfipCertificateMetadata(
  metadata: AfipCertificateMetadata,
  configuredCuit: string,
  now = new Date(),
): ValidatedAfipCertificate {
  if (!(metadata.notBefore instanceof Date) || Number.isNaN(metadata.notBefore.getTime())
      || !(metadata.notAfter instanceof Date) || Number.isNaN(metadata.notAfter.getTime())) {
    throw new Error("El certificado no informa una vigencia válida");
  }
  if (metadata.notBefore.getTime() > now.getTime()) {
    throw new Error(`El certificado todavía no está vigente (comienza ${metadata.notBefore.toISOString()})`);
  }
  if (metadata.notAfter.getTime() <= now.getTime()) {
    throw new Error(`El certificado venció ${metadata.notAfter.toISOString()}`);
  }
  if (metadata.certificateModulus !== metadata.privateKeyModulus
      || metadata.certificateExponent !== metadata.privateKeyExponent) {
    throw new Error("El certificado y la clave privada no corresponden al mismo par");
  }

  const cuit = subjectCuit(metadata.subjectSerialNumber);
  if (cuit && cuit !== configuredCuit) {
    throw new Error(`El certificado pertenece al CUIT ${cuit}, no al CUIT configurado`);
  }
  if (!/^[0-9a-f]{64}$/i.test(metadata.fingerprintSha256)) {
    throw new Error("No se pudo calcular una huella SHA-256 válida del certificado");
  }

  return {
    notBefore: metadata.notBefore.toISOString(),
    expiresAt: metadata.notAfter.toISOString(),
    fingerprintSha256: metadata.fingerprintSha256.toLowerCase(),
    subjectCuit: cuit,
  };
}
