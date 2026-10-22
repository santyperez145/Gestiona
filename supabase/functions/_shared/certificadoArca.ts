/**
 * Criptografía del certificado de ARCA, compartida por la plataforma y los
 * comercios: generar el pedido (clave + CSR) en el servidor y leer un
 * certificado contra su clave y su CUIT.
 *
 * La clave privada se genera acá y no sale: quien la necesita la guarda cifrada.
 */
// @ts-ignore node-forge no publica tipos ESM compatibles con Deno.
import forge from "https://esm.sh/node-forge@1.3.1";
import { validateAfipCertificateMetadata } from "./afipCertificate.ts";
import { ALIAS_ARCA, organizacionParaSubject } from "./certificadoArcaReglas.ts";

/** Clave RSA 2048 (WebCrypto) y su pedido de certificado firmado. */
export async function generarClaveYPedido(args: { cuit: string; razonSocial: string | null }): Promise<{ clavePem: string; csrPem: string }> {
  const par = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", par.privateKey));
  let binario = "";
  for (const byte of pkcs8) binario += String.fromCharCode(byte);
  const b64 = (btoa(binario).match(/.{1,64}/g) ?? []).join("\n");
  const clavePem = `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`;

  const clave = forge.pki.privateKeyFromPem(clavePem);
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = forge.pki.setRsaPublicKey(clave.n, clave.e);
  csr.setSubject([
    { name: "countryName", value: "AR" },
    { name: "organizationName", value: organizacionParaSubject(args.razonSocial) },
    { name: "commonName", value: ALIAS_ARCA },
    { type: "2.5.4.5", value: `CUIT ${String(args.cuit).replace(/\D/g, "")}` },
  ]);
  csr.sign(clave, forge.md.sha256.create());
  return { clavePem, csrPem: forge.pki.certificationRequestToPem(csr) };
}

/** «CN=Computadores, O=AFIP, C=AR». */
// deno-lint-ignore no-explicit-any
export function textoDeEmisor(cert: any): string {
  return cert.issuer.attributes.map((a: { shortName?: string; name?: string; value: string }) => `${a.shortName ?? a.name}=${a.value}`).join(", ");
}

export interface CertificadoLeido {
  notBefore: string;
  expiresAt: string;
  fingerprintSha256: string;
  emisor: string;
}

/**
 * Comprueba que el certificado esté vigente, que corresponda a la clave y que
 * sea del CUIT esperado. Lanza con un mensaje para el comercio si no.
 */
export function leerCertificado(certPem: string, clavePem: string, cuit: string): CertificadoLeido {
  const cert = forge.pki.certificateFromPem(certPem.trim());
  const clave = forge.pki.privateKeyFromPem(clavePem.trim());
  const digest = forge.md.sha256.create();
  digest.update(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes());
  const meta = validateAfipCertificateMetadata({
    notBefore: cert.validity.notBefore,
    notAfter: cert.validity.notAfter,
    subjectSerialNumber: cert.subject.getField("serialNumber")?.value ?? null,
    certificateModulus: cert.publicKey.n.toString(16),
    certificateExponent: cert.publicKey.e.toString(16),
    privateKeyModulus: clave.n.toString(16),
    privateKeyExponent: clave.e.toString(16),
    fingerprintSha256: digest.digest().toHex(),
  }, String(cuit).replace(/\D/g, ""));
  return { notBefore: meta.notBefore, expiresAt: meta.expiresAt, fingerprintSha256: meta.fingerprintSha256, emisor: textoDeEmisor(cert) };
}
