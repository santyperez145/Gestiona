import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import { toast } from "sonner";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Map, Plus, Trash2, Users, Target, Edit2, Globe, MapPin, ChevronRight, Activity, X,
} from "lucide-react";

interface Territory {
  id: string;
  name: string;
  description: string | null;
  color: string;
  active: boolean;
}

interface Rule {
  id: string;
  territory_id: string;
  name: string;
  priority: number;
  conditions: Condition[];
  assigned_user_id: string | null;
  use_round_robin: boolean;
  active: boolean;
}

interface Condition {
  field: string;
  op: string;
  value: string | number;
}

interface Member {
  user_id: string;
  email: string;
}

interface AssignmentLog {
  id: string;
  entity_type: string;
  entity_id: string;
  assigned_user_id: string | null;
  reason: string | null;
  created_at: string;
}

const FIELD_OPTIONS = [
  { value: "city",       label: "Ciudad" },
  { value: "province",   label: "Provincia" },
  { value: "tag",        label: "Tag" },
  { value: "source",     label: "Origen" },
  { value: "industry",   label: "Industria" },
  { value: "value",      label: "Valor ($)" },
];
const OP_OPTIONS = [
  { value: "eq",          label: "es" },
  { value: "neq",         label: "no es" },
  { value: "contains",    label: "contiene" },
  { value: "starts_with", label: "empieza con" },
  { value: "gte",         label: "≥" },
  { value: "lte",         label: "≤" },
];

export default function TerritoriesPage() {
  usePageTitle("Territorios");
  const { activeOrg } = useOrg();

  const [territories, setTerritories] = useState<Territory[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [members, setMembers] = useState<Record<string, Member[]>>({}); // territory_id → users
  const [recentAssignments, setRecentAssignments] = useState<AssignmentLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [orgMembers, setOrgMembers] = useState<Member[]>([]);

  const [territoryDialog, setTerritoryDialog] = useState<{ open: boolean; territory?: Territory }>({ open: false });
  const [ruleDialog, setRuleDialog] = useState<{ open: boolean; territoryId?: string; rule?: Rule }>({ open: false });

  // ── Load all ─────────────────────────────────────────────────────────────
  const load = async () => {
    if (!activeOrg?.id) return;
    setLoading(true);
    try {
      const [tRes, rRes, aRes, omRes] = await Promise.all([
        supabase.from("territories").select("*").eq("org_id", activeOrg.id).order("name"),
        supabase.from("territory_rules").select("*").eq("org_id", activeOrg.id).order("priority"),
        supabase.from("territory_assignments")
          .select("*")
          .eq("org_id", activeOrg.id)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("memberships")
          .select("user_id, role")
          .eq("org_id", activeOrg.id),
      ]);

      const ts = (tRes.data ?? []) as Territory[];
      const rs = (rRes.data ?? []) as Rule[];
      const as_ = (aRes.data ?? []) as AssignmentLog[];

      setTerritories(ts);
      setRules(rs);
      setRecentAssignments(as_);

      // Best-effort org member list: get user emails via separate query
      // (we only have user_id from memberships)
      const userIds = (omRes.data ?? []).map((m) => (m as { user_id: string }).user_id);
      if (userIds.length > 0) {
        // We can't query auth.users directly from client — show user_ids only
        // (an admin RPC could expose emails; out of scope here).
        setOrgMembers(userIds.map((id) => ({ user_id: id, email: id.slice(0, 8) + "…" })));
      }

      // Members per territory (placeholder — would need separate fetch)
      const memberMap: Record<string, Member[]> = {};
      ts.forEach((t) => (memberMap[t.id] = []));
      setMembers(memberMap);
    } catch (e) {
      toast.error("Error cargando territorios: " + (e instanceof Error ? e.message : "desconocido"));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [activeOrg?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => ({
    territories: territories.filter(t => t.active).length,
    rules: rules.filter(r => r.active).length,
    last30: recentAssignments.filter(
      a => Date.now() - new Date(a.created_at).getTime() < 30 * 86_400_000
    ).length,
    coverage: territories.length > 0
      ? Math.round((territories.filter(t => rules.some(r => r.territory_id === t.id)).length / territories.length) * 100)
      : 0,
  }), [territories, rules, recentAssignments]);

  // ── CRUD: Territory ──────────────────────────────────────────────────────
  const saveTerritory = async (data: Partial<Territory>) => {
    if (!activeOrg) return;
    try {
      if (territoryDialog.territory?.id) {
        const { error } = await supabase
          .from("territories")
          .update({ ...data, updated_at: new Date().toISOString() })
          .eq("id", territoryDialog.territory.id);
        if (error) throw error;
        toast.success("Territorio actualizado");
      } else {
        const { error } = await supabase
          .from("territories")
          .insert({ ...data, org_id: activeOrg.id });
        if (error) throw error;
        toast.success("Territorio creado");
      }
      setTerritoryDialog({ open: false });
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const deleteTerritory = async (id: string) => {
    if (!confirm("¿Eliminar este territorio? Se borrarán también todas sus reglas.")) return;
    const { error } = await supabase.from("territories").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Territorio eliminado"); load(); }
  };

  // ── CRUD: Rule ────────────────────────────────────────────────────────────
  const saveRule = async (data: Partial<Rule>) => {
    if (!activeOrg || !ruleDialog.territoryId) return;
    try {
      if (ruleDialog.rule?.id) {
        const { error } = await supabase
          .from("territory_rules")
          .update({ ...data, updated_at: new Date().toISOString() })
          .eq("id", ruleDialog.rule.id);
        if (error) throw error;
        toast.success("Regla actualizada");
      } else {
        const { error } = await supabase
          .from("territory_rules")
          .insert({
            ...data,
            org_id: activeOrg.id,
            territory_id: ruleDialog.territoryId,
          });
        if (error) throw error;
        toast.success("Regla creada");
      }
      setRuleDialog({ open: false });
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const deleteRule = async (id: string) => {
    const { error } = await supabase.from("territory_rules").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Regla eliminada"); load(); }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Map}
        title="Territorios y reglas"
        description="Auto-asignación de leads, clientes y deals según condiciones configurables"
        actions={
          <Button size="sm" onClick={() => setTerritoryDialog({ open: true })}>
            <Plus className="w-4 h-4 mr-1" /> Nuevo territorio
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="Territorios activos" value={kpis.territories} icon={Globe} color="primary" />
        <KPICard label="Reglas activas"       value={kpis.rules}       icon={Target} color="blue" />
        <KPICard label="Asignaciones 30d"     value={kpis.last30}      icon={Activity} color="success" />
        <KPICard label="Cobertura"            value={`${kpis.coverage}%`} icon={MapPin}  color={kpis.coverage >= 75 ? "success" : "warning"} sub="terrs. con reglas" />
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground animate-pulse">Cargando…</p>
      ) : territories.length === 0 ? (
        <div className="rounded-xl border border-border/40 bg-card p-10 text-center space-y-3">
          <Map className="w-12 h-12 mx-auto text-muted-foreground/40" />
          <p className="text-sm font-medium">Sin territorios todavía</p>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            Creá un territorio (ej. "Córdoba Capital", "Cuentas Enterprise") y definí reglas para
            auto-asignar leads a la persona correcta.
          </p>
          <Button size="sm" onClick={() => setTerritoryDialog({ open: true })}>
            <Plus className="w-4 h-4 mr-1" /> Crear primer territorio
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {territories.map(t => {
            const tRules = rules.filter(r => r.territory_id === t.id);
            const tMembers = members[t.id] ?? [];
            return (
              <div key={t.id} className="rounded-xl border border-border/40 bg-card overflow-hidden">
                <div className="flex items-center gap-3 px-5 py-3 border-b border-border/40">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: t.color }} />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-sm leading-tight">{t.name}</h3>
                    {t.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{t.description}</p>
                    )}
                  </div>
                  <Badge variant="outline" className="text-[10px] gap-1">
                    <Users className="w-3 h-3" /> {tMembers.length}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] gap-1">
                    <Target className="w-3 h-3" /> {tRules.length}
                  </Badge>
                  <Button variant="ghost" size="sm" onClick={() => setTerritoryDialog({ open: true, territory: t })}>
                    <Edit2 className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => deleteTerritory(t.id)} className="text-destructive">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>

                {/* Rules */}
                <div className="px-5 py-3 space-y-2">
                  {tRules.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">Sin reglas — los leads no se auto-asignarán a este territorio.</p>
                  ) : (
                    tRules.map(r => (
                      <div key={r.id} className="flex items-center gap-2.5 p-2.5 rounded-md border border-border/30 bg-muted/10 hover:bg-muted/20 transition-colors">
                        <Badge className="text-[10px] font-mono shrink-0">P{r.priority}</Badge>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{r.name}</p>
                          <p className="text-[11px] text-muted-foreground truncate font-mono">
                            {r.conditions.length === 0
                              ? "(sin condiciones — matchea todo)"
                              : r.conditions.map(c => `${c.field} ${c.op} ${c.value}`).join(" AND ")}
                          </p>
                          <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                            Asignar a:{" "}
                            {r.use_round_robin
                              ? <span className="text-blue-400">round-robin del territorio</span>
                              : r.assigned_user_id
                                ? <span className="font-mono">{r.assigned_user_id.slice(0, 8)}…</span>
                                : <span className="text-yellow-500">no definido</span>}
                          </p>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setRuleDialog({ open: true, territoryId: t.id, rule: r })}>
                          <Edit2 className="w-3 h-3" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => deleteRule(r.id)} className="text-destructive">
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    ))
                  )}
                  <Button variant="outline" size="sm" className="w-full mt-1 text-xs h-8" onClick={() => setRuleDialog({ open: true, territoryId: t.id })}>
                    <Plus className="w-3 h-3 mr-1" /> Agregar regla
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Recent assignments log */}
      {recentAssignments.length > 0 && (
        <div className="rounded-xl border border-border/40 bg-card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary/70" />
            <h2 className="font-display text-sm font-semibold tracking-tight">Últimas asignaciones</h2>
          </div>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {recentAssignments.map(a => (
              <div key={a.id} className="flex items-center gap-2 text-[11px] py-1.5 px-2 rounded-md hover:bg-muted/20 transition-colors">
                <Badge variant="outline" className="text-[9px] uppercase">{a.entity_type}</Badge>
                <ChevronRight className="w-3 h-3 text-muted-foreground/60" />
                <span className="font-mono text-muted-foreground/80">{a.entity_id.slice(0, 8)}…</span>
                <span className="text-muted-foreground/60">→</span>
                <span className="font-mono">{a.assigned_user_id?.slice(0, 8) ?? "—"}…</span>
                <span className="ml-auto text-muted-foreground/60 italic truncate max-w-[200px]">{a.reason}</span>
                <span className="text-muted-foreground/40 shrink-0">{new Date(a.created_at).toLocaleDateString("es-AR")}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Territory dialog */}
      <TerritoryDialog
        open={territoryDialog.open}
        territory={territoryDialog.territory}
        onClose={() => setTerritoryDialog({ open: false })}
        onSave={saveTerritory}
      />

      {/* Rule dialog */}
      <RuleDialog
        open={ruleDialog.open}
        rule={ruleDialog.rule}
        orgMembers={orgMembers}
        onClose={() => setRuleDialog({ open: false })}
        onSave={saveRule}
      />
    </div>
  );
}

// ─── Territory dialog ────────────────────────────────────────────────────────
function TerritoryDialog({
  open, territory, onClose, onSave,
}: {
  open: boolean;
  territory?: Territory;
  onClose: () => void;
  onSave: (data: Partial<Territory>) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#3b82f6");
  const [active, setActive] = useState(true);

  useEffect(() => {
    setName(territory?.name ?? "");
    setDescription(territory?.description ?? "");
    setColor(territory?.color ?? "#3b82f6");
    setActive(territory?.active ?? true);
  }, [territory, open]);

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{territory ? "Editar territorio" : "Nuevo territorio"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div className="space-y-1.5">
            <Label>Nombre</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ej. Córdoba Capital" />
          </div>
          <div className="space-y-1.5">
            <Label>Descripción</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="Para qué se usa" />
          </div>
          <div className="space-y-1.5">
            <Label>Color</Label>
            <div className="flex items-center gap-2">
              <Input type="color" value={color} onChange={e => setColor(e.target.value)} className="w-16 h-9 p-1" />
              <Input value={color} onChange={e => setColor(e.target.value)} className="flex-1 font-mono text-sm" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} id="terr-active" />
            <Label htmlFor="terr-active" className="cursor-pointer">Activo</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => onSave({ name, description: description || null, color, active })} disabled={!name.trim()}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Rule dialog ────────────────────────────────────────────────────────────
function RuleDialog({
  open, rule, orgMembers, onClose, onSave,
}: {
  open: boolean;
  rule?: Rule;
  orgMembers: Member[];
  onClose: () => void;
  onSave: (data: Partial<Rule>) => void;
}) {
  const [name, setName] = useState("");
  const [priority, setPriority] = useState(100);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [assignedUserId, setAssignedUserId] = useState<string>("");
  const [useRoundRobin, setUseRoundRobin] = useState(false);

  useEffect(() => {
    setName(rule?.name ?? "Regla");
    setPriority(rule?.priority ?? 100);
    setConditions(rule?.conditions ?? []);
    setAssignedUserId(rule?.assigned_user_id ?? "");
    setUseRoundRobin(rule?.use_round_robin ?? false);
  }, [rule, open]);

  const addCondition = () => setConditions([...conditions, { field: "city", op: "eq", value: "" }]);
  const updateCondition = (i: number, patch: Partial<Condition>) =>
    setConditions(conditions.map((c, idx) => idx === i ? { ...c, ...patch } : c));
  const removeCondition = (i: number) =>
    setConditions(conditions.filter((_, idx) => idx !== i));

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{rule ? "Editar regla" : "Nueva regla"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2 max-h-[60vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label>Nombre</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ej. CABA premium" />
            </div>
            <div className="space-y-1.5">
              <Label>Prioridad</Label>
              <Input type="number" value={priority} onChange={e => setPriority(Number(e.target.value) || 100)} />
            </div>
          </div>

          {/* Conditions */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Condiciones (AND)</Label>
              <Button variant="outline" size="sm" onClick={addCondition} className="text-xs h-7">
                <Plus className="w-3 h-3 mr-1" /> Agregar
              </Button>
            </div>
            {conditions.length === 0 ? (
              <p className="text-[11px] text-muted-foreground italic px-1">Sin condiciones — la regla matcheará a TODOS los nuevos leads.</p>
            ) : (
              conditions.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select value={c.field} onValueChange={v => updateCondition(i, { field: v })}>
                    <SelectTrigger className="h-9 text-xs w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FIELD_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={c.op} onValueChange={v => updateCondition(i, { op: v })}>
                    <SelectTrigger className="h-9 text-xs w-24"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {OP_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input
                    value={String(c.value)}
                    onChange={e => updateCondition(i, { value: e.target.value })}
                    className="h-9 text-xs flex-1"
                    placeholder="valor"
                  />
                  <Button variant="ghost" size="sm" onClick={() => removeCondition(i)} className="text-destructive h-9 w-9 p-0">
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ))
            )}
          </div>

          {/* Assignment */}
          <div className="space-y-2 pt-3 border-t border-border/40">
            <Label>Asignación</Label>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="rr"
                checked={useRoundRobin}
                onChange={e => setUseRoundRobin(e.target.checked)}
              />
              <Label htmlFor="rr" className="cursor-pointer text-sm font-normal">
                Distribuir round-robin entre miembros del territorio
              </Label>
            </div>
            {!useRoundRobin && (
              <Select value={assignedUserId} onValueChange={setAssignedUserId}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Elegí un vendedor" />
                </SelectTrigger>
                <SelectContent>
                  {orgMembers.length === 0 ? (
                    <SelectItem value="none" disabled>Sin miembros</SelectItem>
                  ) : orgMembers.map(m => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      <span className="font-mono">{m.user_id.slice(0, 12)}…</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={() => onSave({
              name,
              priority,
              conditions,
              assigned_user_id: useRoundRobin ? null : (assignedUserId || null),
              use_round_robin: useRoundRobin,
              active: true,
            })}
            disabled={!name.trim() || (!useRoundRobin && !assignedUserId)}
          >
            Guardar regla
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
