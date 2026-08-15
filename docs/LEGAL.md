# Relevamiento legal — tienda, CRM y plataforma

**Esto no es asesoramiento legal.** Es un relevamiento técnico hecho contra la
normativa argentina aplicable, para que un abogado o un contador lo valide. Cada
punto dice **qué exige la norma**, **qué hay hoy en el código** y **qué falta**,
con el estado medido contra la base cuando se pudo.

Última revisión: 2026-08-11.

---

## Resumen: lo que hay que resolver primero

| | Qué | Riesgo |
|---|---|---|
| 🟡 **L1** | **No había política de privacidad.** Ley 25.326 la exige apenas se recolecta un email. **Sesión 109:** el generador la escribe con los datos del comercio y los proveedores reales; falta que el dueño la revise y publique. | Multa de la AAIP y, en la práctica, rechazo de MercadoPago al revisar la cuenta. |
| ✅ **L2** | **Botón de arrepentimiento en la primera pantalla.** Resuelto en la sesión 108: barra superior, a 4px del tope, verificado en 1280 y en 375. | — |
| 🟠 **L3** | **El descuento por medio de pago toca la Ley 25.065.** Art. 37: no se puede cobrar más por tarjeta. Un descuento por transferencia es la práctica habitual, pero la lectura no es unánime. | Necesita opinión profesional, no una decisión de producto. |
| ✅ **L4** | **Consentimiento y baja de marketing.** El checkout guarda fecha/origen opt-in y las campañas sólo alcanzan clientes consentidos; email y WhatsApp incluyen baja efectiva. | Ley 25.326 art. 27. No Llame sigue aplicando si se habilitan campañas telefónicas. |
| 🟠 **L5** | **No hay contrato de tratamiento de datos entre la plataforma y el comercio.** La plataforma es *encargada* del tratamiento; el comercio es el *responsable*. | Ley 25.326 art. 25. |

---

## 1. Tienda online

### 1.1 Defensa del Consumidor — Ley 24.240

| Requisito | Estado |
|---|---|
| **Botón de arrepentimiento visible en la primera pantalla** (Res. 424/2020) | ✅ Barra superior de la tienda, verificado a 4px del tope en 1280 y 375. `request_store_return` distingue arrepentimiento (10 días corridos, sin causa) de falla (garantía), y no corta el plazo si no se registró la entrega. |
| **10 días corridos desde la entrega, sin expresar causa** (art. 34) | ✅ En el RPC. `dias_para_arrepentirse` cuenta desde `delivered_at`. |
| **El costo de devolución lo paga el vendedor** (art. 34) | ✅ El arrepentimiento de una orden online fija `return_shipping_payer = seller`; el portal registra costo y coordinación (etiqueta prepaga, reintegro o retiro). |
| **Garantía legal: 6 meses producto nuevo** (art. 11) | ✅ `trg_return_requests_warranty_window` rechaza reclamos por falla después de seis meses desde `delivered_at`. Si la entrega no se registró, no vence el derecho por una omisión del vendedor. |
| **Información cierta y detallada** (art. 4) | 🟠 10 de 60 productos publicados **sin foto** y 33 con descripción de menos de 80 caracteres. El panel de calidad los rankea. |
| **Términos y condiciones accesibles** | ✅ Publicados. |
| **Datos del proveedor: razón social, CUIT, domicilio** (art. 4) | 🟡 **Verificado: los términos publicados eran la plantilla semilla intacta** — decían "Mi Tienda Online" y cerraban con "Completá acá tu razón social, CUIT, domicilio y un medio de contacto". El generador de la sesión 109 los reescribe con los datos reales; falta que el dueño los cargue y publique. |
| **Link a Ventanilla Única Federal de Reclamos** | ✅ En el pie de la tienda y al final del formulario de arrepentimiento (sesión 108). |

### 1.2 Precios y publicidad

| Requisito | Estado |
|---|---|
| **Precio final al consumidor, con IVA incluido** (Res. 7/2002) | ✅ Los precios son finales. El IVA se discrimina en la orden desde A3. ⚠️ La tasa es única: un catálogo con 21% y 10,5% factura mal (A8 del ROADMAP). |
| **Costo Financiero Total si hay financiación** (Res. 51/2017) | 🟠 Se muestra "6 cuotas sin interés de $X". Si son **sin interés**, el CFT es 0% y alcanza; si algún día se ofrecen cuotas con interés, **hay que mostrar el CFT y el precio de contado**. Hoy no se distingue una cosa de la otra en el código. |
| **La oferta debe cumplirse en los términos publicados** (art. 7) | ✅ Es la razón de fondo de la regla "los descuentos no se acumulan, gana el mejor": si se publica "20% OFF con transferencia" y se cobrara el 10% de la oferta, se estaría incumpliendo lo publicado. |
| **Precio tachado real** | ✅ Desde la sesión 99. Antes el precio tachado no correspondía a ningún porcentaje sobre el final, que es publicidad engañosa. |
| **Ley 25.065 art. 37 — no cobrar más por tarjeta** | 🟠 **Requiere opinión profesional.** El sistema ofrece descuento por transferencia/efectivo, que en los hechos es un precio distinto según el medio. La práctica está extendida y hubo cambios normativos, pero no es una decisión que deba tomar el código. |

### 1.3 Stock y cumplimiento

| Requisito | Estado |
|---|---|
| **No vender lo que no se tiene** | ✅ Desde A2 el stock se reserva entre la orden y el pago. Antes dos compradores podían pagar la última unidad. |
| **Plazo de entrega informado** | ✅ La cotización devuelve `days_min`/`days_max`. |
| **Seguimiento del envío** | ✅ Con número de orden + email, sin cuenta. |

---

## 2. CRM y marketing — Ley 25.326

### 2.1 Lo que ya está bien

- ✅ **Export y borrado de datos** de una persona (sesión de S3).
- ✅ **Baja de las secuencias de email** (`drip-unsubscribe`, link público de un solo uso).
- ✅ **RLS por organización**: un comercio no puede leer los clientes de otro. Verificado con roles reales.
- ✅ **Los compradores de la tienda no son usuarios del SaaS**: `store_customers` y `customers` son tablas distintas, y confundirlas rompe la FK — lo encontró un test.

### 2.2 Lo que falta

| Requisito | Estado |
|---|---|
| **Política de privacidad publicada** | 🟡 El generador la escribe, incluida la declaración de que los datos se alojan en Estados Unidos. Falta revisarla y publicarla. |
| **Registro de la base de datos ante la AAIP** (art. 21) | 🔴 Trámite del comercio, no del código. **Pero la plataforma debería avisarlo en el onboarding**, porque casi ningún comercio chico sabe que existe. |
| **Consentimiento registrado para marketing** (art. 27) | ✅ El checkout guarda fecha + origen y las campañas excluyen a quien no tenga evidencia. |
| **Registro No Llame** (Ley 26.951) | 🟠 Las campañas de WhatsApp y los avisos por teléfono no consultan el registro. Aplica a llamadas y mensajes con fin publicitario. |
| **Derecho de acceso en 10 días** (art. 14) | 🟠 El export existe pero no hay un canal donde la persona lo pida ni un plazo medido. |
| **Aviso en cada comunicación de que puede pedir la baja** (art. 27) | ✅ Email y WhatsApp de marketing incluyen una baja efectiva. En WhatsApp el enlace es opaco, personal y de un solo uso. |
| **Transferencia internacional de datos** (art. 12) | 🟡 Los datos viven en Supabase (AWS `us-east-1`). Estados Unidos **no** tiene nivel adecuado de protección según la AAIP. La política generada lo declara explícitamente y lo apoya en el consentimiento informado al comprar. |
| **Medidas de seguridad** (Res. AAIP 47/2018) | ✅ En buena forma: RLS, MFA obligatorio para staff de plataforma, credenciales fuera del navegador, tablas de tokens con cero policies. |
| **Notificación de incidentes** | 🔴 No hay procedimiento escrito. La AAIP recomienda notificar; no hay plazo legal duro, pero sin procedimiento no se cumple ninguno. |

---

## 3. Panel de plataforma

| Requisito | Estado |
|---|---|
| **Contrato de tratamiento de datos con el comercio** (art. 25) | 🔴 No existe. La plataforma trata datos personales *por cuenta* del comercio: hace falta el contrato que diga qué puede y qué no. |
| **Auditoría de accesos del staff** | ✅ Los dueños ven en Ajustes → Sistema cuándo el staff generó un magic link para una cuenta de su organización. El alcance se guarda al emitirlo, por lo que no desaparece si luego se remueve al miembro. La vista no entrega el enlace, el destinatario ni metadatos internos; registra la generación, no prueba que el enlace se haya abierto. |
| **MFA para el staff** | ✅ `MfaGate` sin excepción. |
| **Separación de superficies** | ✅ Ser staff de plataforma no da permisos dentro de una organización. |
| **Facturación de la suscripción** | 🟠 Stripe cobra y **no se emite comprobante fiscal argentino** al comercio. Si la plataforma factura desde Argentina, es una obligación de ARCA, no una opción. |
| **Comisión por venta informada** | 🟠 El 5% se cobra vía `marketplace_fee`. Tiene que estar en los términos del servicio con el comercio, y hay que confirmar cuál es la cuenta de MercadoPago que la recibe. |
| **Baja del servicio y portabilidad** | 🟡 El dueño puede descargar un ZIP de datos operativos con CSV por tabla y un manifiesto que declara cobertura, errores y truncamientos. Las credenciales de acceso quedan fuera y todavía no hay importador/restauración ni garantía para relaciones hijas sin `org_id` propio (D5 del ROADMAP). Retenerlo por falta de herramienta sigue siendo un problema legal y comercial. |

---

## 4. Fiscal — ARCA (ex AFIP)

| Requisito | Estado |
|---|---|
| **Factura electrónica por cada venta** (RG 4291) | 🔴 La estructura está y las credenciales ya no se leen desde el cliente, pero **no hay certificado cargado ni una sola factura emitida**. Vender sin facturar es el riesgo fiscal más grande del sistema hoy. |
| **IVA discriminado según condición del comprador** | 🟠 El IVA sale con tasa única. Falta por producto (A8) y falta la condición frente al IVA del comprador. |
| **Libro IVA Ventas** | 🟠 Existe `/impuestos` y el libro mayor; no está atado a los comprobantes electrónicos porque todavía no hay. |
| **Conservación de comprobantes** | 🟠 Las órdenes se guardan, los comprobantes no existen. |

---

## 5. Plan sugerido, por orden

Ordenado por **riesgo dividido esfuerzo**, no por lo que sería más lindo hacer:

1. **Política de privacidad** (L1) — una página. Tiene que decir qué datos se guardan, para qué, cuánto tiempo, con quién se comparten y **que los datos se alojan en Estados Unidos**. Es lo más barato de todo y es lo primero que miran.
2. **Botón de arrepentimiento en la home** (L2) — el backend ya está. Es una página y un link en la primera pantalla.
3. **Datos del proveedor en los términos** — razón social, CUIT y domicilio. Revisar el texto actual a mano.
4. **Link a Ventanilla Única Federal** — un link en el pie.
5. **Consentimiento de marketing con fecha y origen** (L4) — una columna y un checkbox en el checkout, sin marcar por defecto.
6. **Consultar a un profesional por el descuento según medio de pago** (L3) y por el contrato de tratamiento de datos (L5).
7. **AFIP de punta a punta** — es el más grande y el más caro de postergar, pero necesita un certificado de homologación que se pide afuera.

---

## Lo que este documento no cubre

- **Habilitaciones municipales, ANMAT y aduana.** Vender perfumes importados tiene su propio marco: ANMAT prohíbe publicar ciertos productos y la importación tiene su régimen. Hay una nota en el código sobre no publicar productos con restricción de ANMAT, pero no es un análisis.
- **Propiedad intelectual de las marcas** que se revenden.
- **Relación laboral** de quien use el sistema.
- **La jurisdicción de cada comercio.** Esto está escrito para Argentina. Un comercio que venda a otro país tiene otras obligaciones, y la tienda todavía no es multi-moneda ni multi-idioma.

Cada punto marcado en 🟠 o 🔴 conviene revisarlo con un abogado especializado en
consumo y protección de datos, y con un contador para la parte fiscal. Lo que
aporta este documento es **dónde está cada cosa en el código** y qué falta, para
que esa consulta sea corta y concreta en vez de empezar de cero.
