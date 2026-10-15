// Renovación del certificado de la plataforma en ARCA (META_FINALIZACION §1).
// El certificado identifica a Nerqia ante WSAA; cada comercio delega `wsfe` a
// nuestro CUIT. Desde el 2026-10-15 el pedido (CSR) y su clave se generan en
// el servidor (`afip-platform-cert`, acción `generar_pedido`): la clave no
// pasa por la computadora de nadie. Acá queda sólo lo que se hace en ARCA.

export type AmbienteArca = "homologacion" | "produccion";

/** Dónde se sube el CSR en ARCA según el ambiente. */
export function dondeSubirElPedido(ambiente: AmbienteArca): string {
  return ambiente === "produccion"
    ? "En ARCA, con clave fiscal: «Administración de Certificados Digitales» → agregar alias → subir el archivo .csr → descargar el certificado .crt."
    : "En ARCA, con clave fiscal: «WSASS - Autogestión Certificados Homologación» → nuevo certificado → pegar el contenido del .csr → copiar el certificado y guardarlo como .crt.";
}
