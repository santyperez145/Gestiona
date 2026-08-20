# AFIP — la primera factura autorizada, y los tres bugs que la bloqueaban

Fecha: 2026-08-20. Ambiente: **homologación**. CUIT 20446484436, punto de venta 1.

Es la primera vez que este proyecto obtiene un CAE. Hasta acá la estructura
estaba escrita y nunca se había ejercido contra el organismo.

## Resultado

```
Resultado:   A  (Aprobado)
CbteTipo:    11 (Factura C — el emisor es monotributista)
CbteDesde:   1
CAE:         86330773852759
CAEFchVto:   20260830
```

## Cómo se llegó

Se replicó **exactamente** el payload que arma `solicitarCAE` y se envió a
`wswhomo.afip.gov.ar` con `openssl` y `curl`, en vez de a través de la Edge
Function. Eso permitió ver el error real de ARCA en cada paso, en lugar del
genérico *"Edge Function returned a non-2xx status code"*.

## Los tres bugs, en el orden en que aparecieron

### 1. Faltaba el envoltorio `<FeCAEReq>`

```
Error interno de aplicación: Metodo FECAESolicitar - Tag <FeCAEReq> no fue ingresado
```

`wsfeSoap` no lo agregaba y el cuerpo de `solicitarCAE` arrancaba directo en
`<FeCabReq>`. **Ninguna factura podía autorizarse nunca.** Estuvo así desde que
se escribió la función; no se notó porque no se había emitido ni una.

### 2. Faltaba `CondicionIVAReceptorId` (RG 5.616)

```
10246: Campo Condicion Frente al IVA del receptor es obligatorio conforme a lo
       reglamentado por la Resolucion General Nro 5616
```

Los códigos ya estaban modelados en `src/lib/fiscalIdentity.ts` —1 RI, 4 exento,
5 consumidor final, 6 monotributo— desde el trabajo de identidad fiscal. Lo que
faltaba era llevarlos al comprobante. Se agregó `invoices.condicion_iva_receptor`
con default 5.

### 3. Factura C con IVA discriminado

```
10047: El campo ImpIVA para comprobantes tipo C debe ser igual a cero (0)
10048: ImpTotal debe ser igual a la suma de ImpNeto + ImpTrib
```

Verificado en los dos sentidos: **con** IVA la rechaza, **sin** IVA devuelve CAE.
Un monotributista o un exento emiten clase C, y para ARCA el total **es** el
neto. Ahora la función lo fuerza y avisa por log si la factura traía IVA — que
significaría que algo aguas arriba lo calculó mal.

## Lo que este circuito todavía NO probó

- **Producción.** El certificado de homologación no sirve ahí, y en producción
  el punto de venta tiene que estar dado de alta como *Web Services*.
- **Factura A y B.** Sólo se probó C. La A exige CUIT del receptor y la
  validación existe, pero no se ejerció.
- **La Edge Function de punta a punta.** Se replicó su payload, no se la invocó:
  requiere un JWT de usuario. Lo que se probó es que el comprobante que arma es
  aceptado por ARCA.
- **Notas de crédito y débito.** No se tocaron.
