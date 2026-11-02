/** «20446484436» → «20-44648443-6». Lo que no son 11 dígitos queda como vino. */
export function formatearCuit(cuit: string | null | undefined): string {
  const d = String(cuit ?? "").replace(/\D/g, "");
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : String(cuit ?? "");
}
