# ADR 004 — Growth y Profit sobre el mismo Graph

- **Estado:** aceptado; implementación incremental.
- **Fecha:** 2026-10-01. **Responsables:** CTO y Producto.
- **Reemplaza parcialmente:** ADR 002, secciones 2, 5 y 9.
- **No reemplaza:** ADR 001 (Finance) ni ADR 003 (identidad y dominio).

## Contexto

Commerce sigue siendo el producto insignia. CRM/marketing y rentabilidad tienen
trabajos distintos de gasto/aprobación/conciliación; incorporarlos a Finance
crearía navegación ambigua y autoridades duplicadas. El alcance estratégico no
es evidencia de paridad implementada ni autorización para lanzar todo a la vez.

## Decisión

| Producto | Trabajo | Autoridad que consume |
|---|---|---|
| Commerce | Crear tienda, vender, convertir y operar pedidos. | Catálogo, inventario, órdenes y comprador. |
| Business | Operar productos, stock, POS, compras y proveedores. | Core operacional de la organización. |
| Growth | Captar, convertir, comunicar y retener. | Identidad comercial, oportunidades y campañas. |
| Profit | Explicar contribución, cobertura y decisiones. | Hechos de margen, costos, pagos y ledger. |
| Pay | Orquestar cobros, refunds y conciliación del procesador. | Intención y evidencia externa; no custodia. |
| Finance | Documentos, gasto, obligaciones, bancos y control. | Políticas, aprobaciones y libro financiero. |
| Automate | Ejecutar workflows y agentes bajo política. | Eventos, herramientas, aprobaciones y outcomes. |
| Platform | Operar Nerqia como staff. | Control plane separado y MFA. |

Ship, Developers/MCP, Capital y Consulting son extensiones sujetas a demanda,
certificación y economics; Capital y emisión requieren partner.

### Un solo Graph

Commerce Graph y Business Graph nombran la misma autoridad ya existente, no dos
bases. Se conservan identidad, organizaciones, membresías, clientes, productos,
stock, proveedores, órdenes, cobros, facturas y ledger. Growth añade relaciones
necesarias, no una segunda tabla de clientes. Profit añade proyecciones y
procedencia, no una contabilidad ni inventario propios.

Hay un solo Permission Engine, integración por proveedor, runtime Automate y
gateway de IA. Los builders de tienda/landing comparten el Page/Theme Engine.
MCP publica herramientas tipadas y auditadas, nunca SQL genérico.

### Superficies sin rutas ficticias

Growth tendrá `/growth` cuando su shell, permisos, rutas y acciones estén
verificados. Mientras tanto mantiene `/clientes`, `/marketing`, email,
WhatsApp e Influencers. Los enlaces antiguos se redirigen después de migrar
consumidores; no se duplica una página para anunciar otro producto.

Profit Foundation vive en `/analytics?vista=rentabilidad`; desde 2026-10-02,
`/profit` es un alias de esa vista, no otra página ni una suite completa.
Usa `get_profit_period` sobre los mismos hechos, permisos tenant, contribución
y cobertura del período completo. Growth y subdominios siguen pendientes.
Mismo login/tenant, primitives y observabilidad; superficie propia no implica
repositorio separado.

### Actualización de decisiones anteriores

La congelación de ADR 002 §9 ya no describe multi-store, dominio y edición de
tema/páginas: el código actual los implementa y ARQUITECTURA es su autoridad.
Se conserva la historia del ADR y se explicita aquí su sustitución parcial.
No se descongela por ello Next.js, B2B completo, marketplaces de apps, wallet,
crédito ni regionalización. Separar storefront/console exige un gap medido.

## Secuencia y gates

1. Confiabilidad, CI y certificaciones Commerce; primera venta del segundo merchant.
2. Profit foundation sobre fuentes existentes: cobertura, orden/producto/canal,
   contribución y capital inmovilizado; sin datos ausentes convertidos en cero.
3. Growth CRM: identidad, empresas, leads, oportunidades, tareas y bandeja.
4. Marketing: consentimiento, entrega, formularios, landings, A/B y atribución.
5. Runtime Automate común: ramas, espera, reintento, aprobación y outcome.
6. Ads: importar primero; cambios de campaña sólo después de permisos y piloto.
7. Loop Profit → propuesta Growth → aprobación → ejecución → resultado medido.

La expansión secundaria de Influencers queda pausada; seguridad, incidencias,
contratos, continuidad y certificación de pagos existentes siguen siendo prioridad.
No se cambian planes/precios ni se regala Commerce por una hipótesis del texto.

## Consecuencias

- Profit interpreta; Finance y el ledger conservan autoridad financiera.
- Crecimiento comercial no se mezcla con aprobaciones y pagos empresariales.
- Una persona puede tener varios roles relacionados sin múltiples identidades
  divergentes; no se fusiona por nombre, teléfono compartido o entre tenants.
- Un gate técnico aprobado no demuestra dinero movido ni valor comercial.
- Los contratos concretos viven en [Profit](PROFIT.md), [Growth](GROWTH.md),
  [Finance](FINANCE.md) y [Intelligence](NERQIA_INTELLIGENCE.md).

## Alternativas rechazadas

- Dos clones/repositories con clientes, contabilidad y automatizaciones propios.
- Meter CRM y Profit en Finance o renombrar módulos sin cambiar el trabajo real.
- Abrir todas las superficies, conectores y agentes simultáneamente.
- Prometer ingresos, ROAS causal, crédito o proveedores certificados sin evidencia.
