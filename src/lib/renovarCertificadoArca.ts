// Asistente de renovación del certificado de la plataforma en ARCA
// (META_FINALIZACION §1). El certificado identifica a Nerqia ante WSAA; cada
// comercio delega `wsfe` a nuestro CUIT. Para renovarlo hay que generar una
// clave y un pedido de certificado (CSR) en la computadora de quien lo
// tramita, subir el CSR a ARCA y cargar acá el CRT emitido con esa clave.
// Esto sólo arma los comandos y los pasos: la clave nunca pasa por Nerqia
// salvo en el formulario de carga, que la cifra antes de guardarla.

export type AmbienteArca = "homologacion" | "produccion";

/** Sólo dígitos; un CUIT tiene 11. */
export function cuitLimpio(cuit: string): string {
  return (cuit ?? "").replace(/\D/g, "");
}

export function cuitValido(cuit: string): boolean {
  const d = cuitLimpio(cuit);
  if (d.length !== 11) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((s, p, i) => s + p * Number(d[i]), 0);
  const resto = 11 - (suma % 11);
  const verificador = resto === 11 ? 0 : resto === 10 ? 9 : resto;
  return verificador === Number(d[10]);
}

/**
 * Texto seguro dentro del subject de openssl: sin barras, comillas, signos
 * igual ni caracteres de control; tildes y eñes se pasan a ASCII.
 */
export function textoParaSubject(texto: string): string {
  return (texto ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 .,&-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
}

export interface ComandosCsr {
  archivoClave: string;
  archivoPedido: string;
  generarClave: string;
  generarPedido: string;
}

/** Comandos de openssl con el formato de subject que pide ARCA. */
export function comandosCsr(cuit: string, razonSocial: string, ambiente: AmbienteArca, fecha = new Date()): ComandosCsr | null {
  const d = cuitLimpio(cuit);
  const organizacion = textoParaSubject(razonSocial);
  if (!cuitValido(d) || !organizacion) return null;
  const sufijo = `${ambiente === "produccion" ? "prod" : "homo"}-${fecha.toISOString().slice(0, 10)}`;
  const archivoClave = `nerqia-${sufijo}.key`;
  const archivoPedido = `nerqia-${sufijo}.csr`;
  return {
    archivoClave,
    archivoPedido,
    generarClave: `openssl genrsa -out ${archivoClave} 2048`,
    generarPedido: `openssl req -new -key ${archivoClave} -subj "/C=AR/O=${organizacion}/CN=nerqia/serialNumber=CUIT ${d}" -out ${archivoPedido}`,
  };
}

/** Dónde se sube el CSR en ARCA según el ambiente. */
export function dondeSubirElPedido(ambiente: AmbienteArca): string {
  return ambiente === "produccion"
    ? "En ARCA, con clave fiscal: «Administración de Certificados Digitales» → agregar alias (por ejemplo, nerqia) → subir el archivo .csr → descargar el certificado .crt."
    : "En ARCA, con clave fiscal: «WSASS - Autogestión Certificados Homologación» → nuevo certificado → pegar el contenido del .csr → copiar el certificado y guardarlo como .crt.";
}
