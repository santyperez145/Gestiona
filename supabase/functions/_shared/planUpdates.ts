export function validatePlanUpdates(
  input: unknown,
  allowed: readonly string[],
): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Datos de plan inválidos");
  const entries = Object.entries(input);
  // Platform submits a complete row. Ignore identity/provider metadata, never write it.
  const safe = Object.fromEntries(
    entries.filter(([key]) => allowed.includes(key)),
  );
  if (Object.keys(safe).length === 0) throw new Error("No hay cambios de plan");
  for (const [key, value] of Object.entries(safe)) {
    if (key.startsWith("price_")) {
      if (
        value !== null &&
        (typeof value !== "number" ||
          !Number.isFinite(value) ||
          value < 0 ||
          value > 1e12)
      )
        throw new Error(
          "El precio debe ser un importe válido o quedar sin configurar",
        );
    } else if (key.startsWith("max_") || key === "ai_monthly_credits") {
      if (
        value !== null &&
        (typeof value !== "number" ||
          !Number.isSafeInteger(value) ||
          value < 0 ||
          value > 2147483647)
      )
        throw new Error(
          "Los límites deben ser enteros no negativos; vacío significa sin límite",
        );
    } else if (
      ["ai_enabled", "backups_enabled", "custom_branding"].includes(key)
    ) {
      if (typeof value !== "boolean")
        throw new Error(
          "Las funcionalidades deben estar activadas o desactivadas",
        );
    } else if (key === "features") {
      if (
        !Array.isArray(value) ||
        value.length > 20 ||
        value.some((v) => typeof v !== "string" || v.length > 180)
      )
        throw new Error("Usá hasta 20 características de 180 caracteres");
      safe[key] = [...new Set(value.map((v) => v.trim()).filter(Boolean))];
    } else if (key === "name") {
      if (
        typeof value !== "string" ||
        value.trim().length < 2 ||
        value.length > 80
      )
        throw new Error("El nombre debe tener entre 2 y 80 caracteres");
      safe[key] = value.trim();
    } else if (key === "description") {
      if (value !== null && (typeof value !== "string" || value.length > 600))
        throw new Error("La descripción admite hasta 600 caracteres");
    }
  }
  return safe;
}
