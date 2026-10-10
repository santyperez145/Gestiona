-- ═══════════════════════════════════════════════════════════════════════════
-- Perfil del menú: emprendedor, establecido o avanzado
-- ═══════════════════════════════════════════════════════════════════════════
--
-- META §3, «Perfiles progresivos». Un comercio que recién empieza veía las
-- mismas ~50 entradas de menú que uno con sucursales, cheques y multi-moneda.
-- El perfil decide qué queda a la vista; el resto va a «Más herramientas» y
-- al buscador (Ctrl+K). Qué destino corresponde a cada perfil vive en el
-- código (`NIVEL_DE_DESTINO` en src/lib/navigation.ts), no acá.
--
-- NULL = sin elegir: el menú completo. Así ningún comercio que ya trabaja
-- pierde de vista algo que usa; el perfil se elige en Ajustes.
--
-- Idempotente. Reversible: DROP COLUMN.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS perfil_menu text;

ALTER TABLE public.settings
  DROP CONSTRAINT IF EXISTS settings_perfil_menu_valido;
ALTER TABLE public.settings
  ADD CONSTRAINT settings_perfil_menu_valido
  CHECK (perfil_menu IS NULL OR perfil_menu IN ('emprendedor', 'establecido', 'avanzado'));

COMMENT ON COLUMN public.settings.perfil_menu IS
  'Qué entradas del menú quedan a la vista: emprendedor, establecido o avanzado. NULL = todas.';
