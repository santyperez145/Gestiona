# Restore drill de snapshots por organización

Un snapshot no se considera recuperable sólo porque exista o porque su hash sea
correcto. Este runbook ensaya que el archivo privado todavía puede convertirse
en filas válidas contra el esquema PostgreSQL actual.

## Ejecución

~~~bash
npm run drill:restore
~~~

Requiere una sesión activa del Supabase CLI y que el repo esté linkeado al
proyecto. No necesita copiar claves a `.env`: obtiene la credencial operativa en
memoria mediante el CLI, no la imprime y la descarta al terminar.

El drill:

1. elige el snapshot v3 más reciente con verificación de integridad aprobada;
2. descarga el objeto desde el bucket privado `backups`;
3. vuelve a calcular SHA-256 y valida manifiesto, tablas, filas y exclusión de
   credenciales;
4. abre una transacción y crea un esquema único `zz_restore_drill_*`;
5. clona cada tabla desde `public` con tipos, defaults, `NOT NULL` y checks;
6. convierte el JSON mediante los tipos reales de PostgreSQL e inserta todas
   las filas del snapshot;
7. compara tablas y filas restauradas con el manifiesto;
8. mide el tiempo técnico de carga, elimina el esquema y comprueba cero restos.

Ante cualquier error, el bloque SQL elimina el sandbox y vuelve a propagar el
fallo. Además, la transacción protege contra una desconexión antes del cleanup.
El script nunca inserta, actualiza ni borra filas de `public`.

## Qué demuestra y qué no

Demuestra recuperabilidad del archivo, compatibilidad con el esquema actual,
tipos válidos, constraints de fila y limpieza del entorno aislado. Complementa
la verificación de descarga/hash que ya realiza `weekly-backup`.

No reconstruye todavía un proyecto Supabase vacío, roles, Auth, Storage,
secrets, funciones, cron, DNS ni integraciones externas. Tampoco copia foreign
keys al sandbox: las tablas clonadas se usan para comprobar la restauración del
dataset de una organización sin depender del registro raíz de producción.
Por eso la medición se denomina **RTO técnico del restore de datos**, no RTO
contractual de recuperación completa.

## Evidencia

| Fecha UTC | Snapshot | Cobertura | RTO técnico | Restos |
|---|---|---:|---:|---:|
| 2026-08-21 | v3 privado, hash verificado | 147 tablas / 63 filas | 937,22 ms | 0 |

La evidencia no registra IDs, nombres de organizaciones, claves ni contenido de
las filas. El drill debe repetirse después de ampliar el contrato de snapshots
y, como mínimo, trimestralmente. Un aumento material de volumen exige registrar
una nueva línea: el tiempo de 63 filas no predice el de un comercio grande.

## Próximo nivel de resiliencia

Para declarar un RTO/RPO comercial faltan dos ensayos adicionales:

- reconstrucción completa en un proyecto aislado desde migraciones más
  snapshots, con Auth, Storage, funciones y secrets rotados;
- prueba de failover con reloj de inicio/fin, responsables, criterios de vuelta
  y verificación funcional de POS, checkout, pagos y facturación.
