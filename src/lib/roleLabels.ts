const ROLE_LABELS: Record<string, string> = {
  owner: 'Propietario', admin: 'Administrador', vendedor: 'Vendedor', viewer: 'Sólo lectura',
  superadmin: 'Administrador de plataforma', support: 'Soporte', finance: 'Finanzas',
};

export function roleLabel(role: string | null | undefined): string {
  return ROLE_LABELS[role ?? ''] ?? 'Sin rol asignado';
}
