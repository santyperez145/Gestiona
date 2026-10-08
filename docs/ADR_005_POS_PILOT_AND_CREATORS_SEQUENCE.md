# ADR 005 — piloto POS y secuencia Creators

**Estado:** aceptado. **Fecha:** 2026-10-07. **Owner:** Producto / CTO.
Sustituye únicamente la pausa secundaria Creators y precisa el gate Commerce
de [ADR 004](ADR_004_GROWTH_PROFIT_SHARED_GRAPH.md).

## Contexto

El dueño solicita reemplazar el sistema de su ferretería, reforzar POS, completar
Commerce y retomar paridad Profit/Escalafy y Creators/GoMarz. Ampliar menús no
demuestra cierre de venta ni un ERP operativo. SCADI sólo expone login sin demo.

## Decisión

1. El piloto operacional une mostrador, stock, caja, cliente/deuda, compra,
   comprobante y margen sobre el Graph existente. Commerce conserva prioridad.
2. Primero cobro verificable y recuperación sin duplicados; después permisos
   sensibles, turnos, catálogo fraccionado, compras y migración conciliada.
3. Creators retoma expansión secuenciada tras el gate POS/Commerce, sin quitar
   prioridad a incidentes, seguridad, contratos y certificación existentes.
4. Profit mantiene Foundation; campañas/Ads requieren fuentes read-only y
   atribución explícita. No se anuncia utilidad neta ni paridad completa.
5. Transferencia directa CVU, impresión silenciosa/fiscal, custodia y payouts
   necesitan provider/hardware/legal contratados y comprobados por separado.

## Consecuencias

Sin clones de ERP, ledger, catálogo, stock ni customer store. Sin nuevos precios,
servicios pagos o cambios de framework por este ADR. Cada matriz conserva
implementación, evidencia interna y gate externo separados en [POS](POS_OPERACION.md),
[Profit](PROFIT.md), [Creators](INFLUENCERS.md) y [ROADMAP](../ROADMAP.md).
