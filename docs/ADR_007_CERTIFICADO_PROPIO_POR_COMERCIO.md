# ADR 007 — cada comercio factura con su propio certificado de ARCA

- **Estado:** aceptado; implementado en la rama `feat/certificado-propio` el
  2026-10-22. Se aplica cuando vuelva la base productiva (migración
  20261022000100, `afip-credentials`, `afip-platform-cert`).
- **Fecha:** 2026-10-22. **Decide:** el dueño («usaremos los certificados
  propios»). **Responsables:** Producto / Seguridad.
- **Reemplaza:** la decisión del 2026-08-27 (migración 20260827000050,
  «ningún comercio guarda su certificado») y la frase de
  [FACTURACION.md](FACTURACION.md) que pedía este ADR.

## Contexto

Desde agosto todos los comercios facturaban por **delegación**: cada uno
autorizaba el servicio Facturación Electrónica al CUIT de la plataforma, y
Nerqia firmaba con su certificado. Tres problemas medidos:

1. **El CUIT de la plataforma es el personal del dueño** (20-44648443-6). Cada
   comercio quedaba vinculado ante ARCA a esa persona como representante.
2. **No escala.** El instructivo oficial de ARCA
   ([ADMINREL.DelegarWS](https://www.afip.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf))
   exige que el tercero, por cada cliente, acepte la designación y asocie su
   computador fiscal a ese cliente: dos trámites manuales del dueño por
   comercio, para siempre.
3. **Punto único de falla.** Hasta el 2026-10-15 el certificado de la
   plataforma era de homologación cargado como producción: no podía facturar
   ningún comercio.

La responsabilidad impositiva no cambia entre modelos: el comprobante sale con
el CUIT del comercio y el impuesto es suyo. La delegación sólo autoriza a
«operar el Webservice en nombre de» (ARCA).

## Cómo lo hacen los demás (verificado el 2026-10-22)

| Quién | Modelo |
|---|---|
| Facturador de Mercado Libre | certificado del vendedor: la herramienta da el CSR, el vendedor lo sube a ARCA y asocia el alias a Facturación Electrónica |
| Invopop | certificado propio de cada cliente, guardado cifrado |
| Dux | delegación a un CUIT de persona física, habilitación manual |
| Facture.ar | pide la clave fiscal del comercio y genera el certificado por él |
| Tiendanube, Shopify | no facturan: apps de terceros |

## Decisión

Cada comercio factura con **su propio certificado**, como el Facturador de
Mercado Libre:

1. Nerqia genera la clave RSA 2048 y el pedido (CSR) **en el servidor**
   (`afip-credentials`, `generar_pedido`). La clave queda cifrada en
   `afip_credentials.pedido_clave`; el comercio sólo descarga el CSR.
2. El comercio, con su clave fiscal: crea el alias `nerqia` en
   «Administración de Certificados Digitales» con el CSR, descarga el .crt,
   asocia el alias a Facturación Electrónica en el Administrador de Relaciones
   y crea el punto de venta Web Services.
3. Sube el .crt (`cargar_certificado`): se comprueba que corresponda a la
   clave del pedido y a su CUIT, que no sea de homologación si el pedido es de
   producción, y se pide un ticket real a WSAA. Si ARCA lo acepta queda activo;
   si sólo falta la asociación, se guarda igual («falta asociar») para no
   pedirle que lo suba de nuevo.
4. `afip-authorize` (`verificar_delegacion`) comprueba el punto de venta y el
   último comprobante con el CUIT del comercio.
5. Un cron diario (`certificados-comercios-prueba-diaria`, 06:27 UTC) vuelve a
   probar cada certificado y la pantalla avisa 30 días antes del vencimiento.
   Renovar es agregar un certificado al mismo alias: la asociación se conserva.

**Nunca** se pide la clave fiscal del comercio. La delegación queda sólo para
un comercio que ya la tenga verificada (`modo = 'delegado'`), y el certificado
de la plataforma se conserva para el padrón de ARCA.

## Revisión de seguridad

| Riesgo | Control |
|---|---|
| Robo de la clave privada del comercio | Se genera en la Edge y nunca viaja al navegador. Se guarda cifrada (`nerqia:v1`, `secret_encrypt`); la base cifra certificado, clave y pedido aunque lleguen en claro (`trg_afip_encrypt_credentials`). `afip_credentials` tiene RLS sin políticas: ningún usuario la lee. |
| Exposición en la UI | `afip_connection_status` (definidor, filtra por membresía) muestra vigencia, emisor, última prueba y el CSR (público). Nunca PEM, clave ni ticket. |
| Alguien sin permiso carga o cambia el certificado | `afip-credentials` exige sesión real y rol dueño/administrador de esa organización. |
| Certificado ajeno o de otro CUIT | Se valida el par certificado/clave y el CUIT del subject contra el CUIT del comercio. |
| Certificado de prueba usado como real | Emisor «Computadores Test» con pedido de producción se rechaza. |
| Ticket de Acceso duplicado | El candado `afip:ta:<org>` es el mismo que usa `afip-authorize` en modo propio. |
| Verificación vieja con certificado nuevo | `afip_invalidar_contexto` resetea la verificación al cambiar el certificado. |

Matriz: `scripts/certificado-propio-matrix.sql`. Guardas:
`src/test/certificadoPropioDelComercio.test.ts`.

## Consecuencias

- El dueño deja de intervenir en el alta fiscal de cada comercio.
- El comercio hace tres pasos en ARCA en lugar de uno, y renueva cada dos años
  (con aviso y asistente).
- Pendiente con la base activa: simulacro y aplicación de la migración,
  despliegue de `afip-credentials` y `afip-platform-cert`, y el primer
  certificado real (Exentry).
