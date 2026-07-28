/**
 * PermissionsTab — org-level role/permission management (AdminPage → "Permisos").
 *
 * A functional matrix: rows = app modules, columns = roles (admin/vendedor/viewer),
 * each cell holds 5 toggles (Ver/Crear/Editar/Eliminar/Exportar) that upsert into
 * the `role_permissions` table (org_id, role, module) — the same table
 * `useModulePermissions()`/`useHasPermission()` read from across the app.
 */
import { useEffect, useState, useCallback, Fragment } from "react";
import { useOrg } from "@/lib/orgContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Shield, Loader2, RotateCcw, Eye, Plus, Pencil, Trash2, Download, Lock } from "lucide-react";
import { defaultsForRole } from "@/lib/usePermissions";
import type { AppRole } from "@/lib/useUserRole";

// ─── Config ───────────────────────────────────────────────────────────────────

const MODULES: { value: string; label: string }[] = [
  { value: "sales", label: "Ventas" },
  { value: "pos", label: "POS" },
  { value: "products", label: "Productos" },
  { value: "customers", label: "Clientes" },
  { value: "crm", label: "CRM" },
  { value: "reports", label: "Reportes" },
  { value: "expenses", label: "Gastos" },
  { value: "purchases", label: "Compras" },
  { value: "invoices", label: "Facturas" },
  { value: "inventory", label: "Inventario" },
  { value: "analytics", label: "Analytics" },
  { value: "marketing", label: "Marketing" },
  { value: "support", label: "Soporte" },
  { value: "settings", label: "Configuración" },
  { value: "team", label: "Equipo" },
  { value: "finance", label: "Finanzas" },
];

const ROLES: { value: AppRole; label: string }[] = [
  { value: "admin", label: "Administrador" },
  { value: "vendedor", label: "Vendedor" },
  { value: "viewer", label: "Viewer" },
];

const ACTIONS: { key: "can_view" | "can_create" | "can_edit" | "can_delete" | "can_export"; label: string; icon: typeof Eye }[] = [
  { key: "can_view", label: "Ver", icon: Eye },
  { key: "can_create", label: "Crear", icon: Plus },
  { key: "can_edit", label: "Editar", icon: Pencil },
  { key: "can_delete", label: "Eliminar", icon: Trash2 },
  { key: "can_export", label: "Exportar", icon: Download },
];

type PermRow = {
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_export: boolean;
};

function cellKey(role: string, module: string) {
  return `${role}__${module}`;
}

export default function PermissionsTab() {
  const { activeOrg, activeRole } = useOrg();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [perms, setPerms] = useState<Record<string, PermRow>>({});

  const isOwnerOrAdmin = activeRole === "owner" || activeRole === "admin";

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const { data } = await supabase
      .from("role_permissions")
      .select("role, module, can_view, can_create, can_edit, can_delete, can_export")
      .eq("org_id", activeOrg.id);

    const map: Record<string, PermRow> = {};
    for (const role of ROLES.map((r) => r.value)) {
      for (const mod of MODULES) {
        const existing = data?.find((r: any) => r.role === role && r.module === mod.value);
        if (existing) {
          map[cellKey(role, mod.value)] = {
            can_view: existing.can_view,
            can_create: existing.can_create,
            can_edit: existing.can_edit,
            can_delete: existing.can_delete,
            can_export: existing.can_export,
          };
        } else {
          const d = defaultsForRole(role);
          map[cellKey(role, mod.value)] = { ...d };
        }
      }
    }
    setPerms(map);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (role: AppRole, module: string, actionKey: keyof PermRow) => {
    if (!activeOrg || !isOwnerOrAdmin) return;
    const key = cellKey(role, module);
    const current = perms[key] ?? defaultsForRole(role);
    const next: PermRow = { ...current, [actionKey]: !current[actionKey] };

    // Optimistic UI update
    setPerms((prev) => ({ ...prev, [key]: next }));
    setSaving((prev) => new Set(prev).add(key));

    try {
      const { error } = await supabase
        .from("role_permissions")
        .upsert(
          {
            org_id: activeOrg.id,
            role,
            module,
            ...next,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "org_id,role,module" }
        );
      if (error) throw error;
    } catch (err: any) {
      // Revert on failure
      setPerms((prev) => ({ ...prev, [key]: current }));
      toast.error("Error al guardar permiso: " + (err.message || "desconocido"));
    } finally {
      setSaving((prev) => {
        const next2 = new Set(prev);
        next2.delete(key);
        return next2;
      });
    }
  };

  const resetToDefaults = async () => {
    if (!activeOrg || !isOwnerOrAdmin) return;
    setLoading(true);
    try {
      const { error } = await supabase.rpc("seed_default_permissions", { p_org_id: activeOrg.id });
      if (error) throw error;
      toast.success("Permisos faltantes completados con valores por defecto");
      await load();
    } catch (err: any) {
      toast.error("Error: " + (err.message || "no se pudo restablecer"));
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-7 h-7 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary" />Matriz de Permisos por Rol
          </h3>
          <p className="text-xs text-muted-foreground">
            Definí qué puede hacer cada rol en cada módulo. Los cambios se guardan automáticamente.
          </p>
        </div>
        {isOwnerOrAdmin && (
          <button
            onClick={resetToDefaults}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/60 text-xs hover:bg-muted/50 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />Completar con valores por defecto
          </button>
        )}
      </div>

      {!isOwnerOrAdmin && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/30 border border-border/40 text-xs text-muted-foreground">
          <Lock className="w-3.5 h-3.5 shrink-0" />Solo los administradores de la organización pueden modificar permisos.
        </div>
      )}

      <div className="bg-card border border-border/40 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-border/40 bg-muted/20">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground sticky left-0 bg-muted/20 z-10">Módulo</th>
                {ROLES.map((role) => (
                  <th key={role.value} colSpan={ACTIONS.length} className="text-center px-2 py-2 text-xs font-semibold text-muted-foreground border-l border-border/30">
                    {role.label}
                  </th>
                ))}
              </tr>
              <tr className="border-b border-border/40 bg-muted/10">
                <th className="sticky left-0 bg-muted/10 z-10" />
                {ROLES.map((role) => (
                  <Fragment key={role.value}>
                    {ACTIONS.map((a) => (
                      <th key={`${role.value}-${a.key}`} className="px-1.5 py-1.5 text-center border-l border-border/20" title={a.label}>
                        <a.icon className="w-3 h-3 mx-auto text-muted-foreground/70" />
                      </th>
                    ))}
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {MODULES.map((mod) => (
                <tr key={mod.value} className="border-b border-border/20 hover:bg-muted/10 transition-colors">
                  <td className="px-4 py-2.5 font-medium text-sm sticky left-0 bg-card z-10">{mod.label}</td>
                  {ROLES.map((role) => {
                    const key = cellKey(role.value, mod.value);
                    const row = perms[key] ?? defaultsForRole(role.value);
                    const isSaving = saving.has(key);
                    return (
                      <Fragment key={key}>
                        {ACTIONS.map((a) => {
                          const checked = !!row[a.key];
                          return (
                            <td key={`${key}-${a.key}`} className="px-1.5 py-2 text-center border-l border-border/10">
                              <button
                                disabled={!isOwnerOrAdmin || isSaving}
                                onClick={() => toggle(role.value, mod.value, a.key)}
                                title={`${a.label} — ${role.label}`}
                                className={`w-5 h-5 rounded flex items-center justify-center border transition-colors mx-auto disabled:opacity-50 disabled:cursor-not-allowed ${
                                  checked
                                    ? "bg-primary border-primary text-primary-foreground"
                                    : "bg-muted/30 border-border/50 text-transparent hover:border-primary/40"
                                }`}
                              >
                                {checked && <span className="text-[10px] leading-none">✓</span>}
                              </button>
                            </td>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Los administradores/owners de la organización siempre tienen acceso completo salvo que definas un override explícito acá.
        Los módulos sin un registro guardado usan valores por defecto según el rol (Vendedor: ver + crear en ventas/clientes;
        Viewer: solo lectura).
      </p>
    </div>
  );
}
