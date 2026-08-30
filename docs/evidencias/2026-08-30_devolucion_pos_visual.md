# Evidencia visual — devolución POS transaccional

**Fecha:** 2026-08-30  
**Commit funcional:** `dae7a0e`  
**Superficie:** producción, `https://exentryimports.vercel.app/devoluciones`  
**Sesión:** organización real autenticada; recorrido de sólo lectura

## Alcance verificado

- La ruta publicada carga con título `Devoluciones | Gestiona`, H1 único
  `Devoluciones`, CTA `Nueva devolución` y estado vacío explícito.
- El modal `Nueva devolución de mostrador` tiene nombre accesible, explica que
  importes y topes salen del ticket y deja el foco en la búsqueda.
- La composición se comprobó a 360×800, 768×900, 1024×900 y 1440×1000. En los
  cuatro viewports `documentElement.scrollWidth <= innerWidth`; el modal queda
  íntegramente dentro del ancho disponible.
- La consola terminó con cero errores y cero advertencias.
- El viewport se restituyó al tamaño del navegador y el modal quedó cerrado.

## Límite honesto

No se creó una devolución real durante esta comprobación para no modificar
datos del negocio. La atomicidad, topes, idempotencia, autorización, caja,
stock, ledger y limpieza se verificaron por separado con la fixture PostgreSQL
reversible documentada en `ROADMAP.md`. Mercado Pago live y una nota de crédito
productiva continúan como gates externos antes de declarar el circuito
comercialmente certificado.
