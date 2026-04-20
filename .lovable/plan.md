

## Plan: Finalización Fase 2 — Cron Jobs + Estado de Resultados PDF + Backups UI

### 1. Registrar Cron Jobs (pg_cron)

Insert SQL directo (no migración) con la URL del proyecto y anon key, para invocar las 3 edge functions programadas:

- **`fetch-usd-rate`** — Diario 09:00 ART (12:00 UTC): actualiza cotizaciones USD blue/oficial/MEP desde dolarapi.com
- **`auto-recurring-expenses`** — Día 1 de cada mes 00:30 UTC: replica gastos con `recurring=true`
- **`weekly-backup`** — Domingos 23:59 UTC: dump JSON completo a bucket `backups/`

```sql
select cron.schedule('fetch-usd-rate-daily', '0 12 * * *', $$ select net.http_post(...) $$);
select cron.schedule('auto-recurring-expenses-monthly', '30 0 1 * *', $$ select net.http_post(...) $$);
select cron.schedule('weekly-backup-sunday', '59 23 * * 0', $$ select net.http_post(...) $$);
```

### 2. Estado de Resultados Contable + PDF (`ReportsPage.tsx`)

Nuevo tab "Estado de Resultados" con formato contable estándar:
```
Ingresos por ventas              $X
(-) Costo de mercadería (COGS)   $X
= Ganancia bruta                 $X     (margen %)
(-) Gastos operativos            $X
    · Categoría A                $X
    · Categoría B                $X
(-) Impuestos estimados          $X
= Ganancia neta                  $X     (margen neto %)
```

- Selector de período: Mes actual / Mes anterior / Trimestre / Año / Personalizado
- Export PDF con jsPDF + autotable, membrete con nombre de empresa y logo desde `settings`
- Botón "Descargar PDF profesional"

### 3. Sección Backups en `SettingsPage.tsx`

- Lista del bucket `backups/{userId}/` con archivos descargables (signed URLs)
- Botón "Generar backup manual ahora" → invoca `weekly-backup` on-demand
- Mostrar fecha del último backup automático

### 4. Eliminación de hardcodeos restantes

Auditoría final en:
- `seedData.ts` — comentar o eliminar valores demo fijos si aún se usan
- `stockNotifications.ts` — usar threshold de settings
- Cualquier referencia a `15` (comisión pasero), `WhatsApp` numbers fijos → mover a settings

### Archivos

| Archivo | Cambio |
|---|---|
| SQL insert directo | Registrar 3 cron jobs con URL + anon key |
| `src/pages/ReportsPage.tsx` | Tab "Estado de Resultados" + export PDF profesional |
| `src/pages/SettingsPage.tsx` | Sección "Backups" con listado y botón manual |
| `src/lib/seedData.ts`, `src/lib/stockNotifications.ts` | Limpieza de hardcodeos restantes |

### Orden
1. Cron jobs (insert SQL)
2. Estado de Resultados + PDF
3. Sección Backups en Settings
4. Auditoría final hardcodeos

