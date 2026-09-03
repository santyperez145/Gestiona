# ADR 003 — Nerqia como identidad y dominio canónicos

**Estado:** aceptado
**Fecha:** 2026-09-03

## Decisión

La marca pública del Commerce Operating System es **Nerqia** y su origen
canónico es **https://nerqia.app**. Los productos se presentan como Nerqia
Commerce, Nerqia Business, Nerqia Pay, Nerqia Finance y Nerqia Platform.

`www.nerqia.app` existe como alias y redirige permanentemente al dominio raíz.
Las tiendas siguen viviendo en `/tienda/:slug`: el logo y nombre del comercio
permanecen aislados de la marca de la plataforma.

## Compatibilidad

El cambio de marca no justifica romper datos ni integraciones. Se conservan:

- códigos persistidos como `gestiona_pay` y `gestiona_envios`;
- claves de almacenamiento local que mantienen sesiones y preferencias;
- variables de entorno y headers publicados `X-Gestiona-*`;
- el origen Vercel anterior, sólo en las allowlists de transición.

Estos valores son namespace técnico heredado, no copy visible. Una versión
futura puede introducir aliases `X-Nerqia-*`, pero los anteriores no se retiran
sin versión, telemetría de adopción y ventana de migración.

## Configuración operativa

- Vercel sirve el dominio y emite TLS automáticamente.
- Supabase Auth usa `https://nerqia.app` como Site URL y permite los callbacks
  exactos de producción, `www`, previews y localhost.
- Las Edge Functions reciben `PUBLIC_BASE_URL`, `PUBLIC_APP_URL` y
  `PLATFORM_ALLOWED_ORIGINS` con el origen nuevo.
- El remitente de correo pasa a `nerqia.app`, pero queda **no verificado** hasta
  publicar en DNS los registros que entregue Resend. Vercel no provee casillas.

## Guardas

`brandIdentity.test.ts` recorre las superficies activas y falla si reaparecen
la marca o dominios anteriores fuera de las excepciones técnicas declaradas.
También valida favicon/PWA, origen canónico, redirect y configuración de Auth.
