# Seguridad de Nerqia

## Reportar una vulnerabilidad

Escribinos a **hola@nerqia.app** con el asunto «Seguridad». Contanos qué
encontraste, cómo reproducirlo y qué impacto creés que tiene. Respondemos en
menos de 72 horas hábiles y te avisamos cuando esté corregido.

Por favor:

- probá sólo contra una cuenta y una tienda tuyas;
- no accedas, modifiques ni borres datos de otros comercios o compradores;
- no hagas pruebas de denegación de servicio, spam ni ingeniería social;
- no publiques el hallazgo hasta que esté corregido.

Si respetás esto, no vamos a iniciar ninguna acción en tu contra.

## Alcance

- `nerqia.app` y sus subdominios, las tiendas `*.nerqia.app` y los dominios
  propios de tiendas servidos por Nerqia.
- Las funciones edge y la API pública (`/functions/v1/public-api`).

Fuera de alcance: servicios de terceros (Mercado Pago, ARCA, Supabase,
Vercel), salvo que el problema esté en cómo Nerqia los usa.

## Cómo nos protegemos

- **Aislamiento entre negocios:** RLS en todas las tablas expuestas; las
  funciones privilegiadas verifican sesión y permiso, y tienen `search_path`
  fijo. Una auditoría corre en cada cambio de esquema (simulacro en CI) y
  todos los días en producción.
- **Navegador:** CSP sin `unsafe-inline` ni `unsafe-eval`, `frame-ancestors
  'none'`, HSTS con preload, ventanas de impresión con CSP propia y datos
  escapados, exportaciones CSV sin fórmulas.
- **Pagos:** la vuelta de Mercado Pago sólo a orígenes propios; webhooks con
  firma verificada.
- **Abuso:** límites por IP en el checkout y en todas las escrituras públicas
  de la tienda.
- **Secretos:** sólo en variables de entorno de las funciones o en el vault;
  nunca en el repositorio. Certificados de ARCA cifrados.
