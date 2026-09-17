import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { getMarketingPostsDB, addMarketingPostDB, updateMarketingPostDB, deleteMarketingPostDB } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Edit, TrendingUp, DollarSign, Users, Calendar, Target, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";

export default function CampaignsPage() {
  usePageTitle("Campañas de Marketing");
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const reload = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("marketing_posts")
      .select("*, profiles(full_name, avatar_url), marketing_channels(name)")
      .eq("org_id", activeOrg?.id)
      .order("created_at", { ascending: false });
    if (!error) {
      setCampaigns(data);
    }
    setLoading(false);
  };

  useEffect(() => { reload(); }, [user, activeOrg]);

  const handleCreate = async (formData) => {
    try {
      const { data, error } = await supabase
        .from("marketing_posts")
        .insert({ ...formData, org_id: activeOrg?.id, created_by: user?.id, status: "draft" })
        .select()
        .single();
      if (error) throw error;
      toast.success("Campaña creada");
      setOpen(false);
      reload();
    } catch (err) {
      toast.error("Error creando campaña");
    }
  };

  const handleUpdate = async (id, formData) => {
    try {
      const { error } = await supabase
        .from("marketing_posts")
        .update(formData)
        .eq("id", id)
        .eq("org_id", activeOrg?.id);
      if (error) throw error;
      toast.success("Campaña actualizada");
      setEditing(null);
      reload();
    } catch (err) {
      toast.error("Error actualizando campaña");
    }
  };

  const handleDelete = async (id) => {
    try {
      const { error } = await supabase
        .from("marketing_posts")
        .delete()
        .eq("id", id)
        .eq("org_id", activeOrg?.id);
      if (error) throw error;
      toast.success("Campaña eliminada");
      reload();
    } catch (err) {
      toast.error("Error eliminando campaña");
    }
  };

  if (loading) return <div className="p-8 text-center">Cargando...</div>;

  const totalBudget = campaigns.reduce((sum, c) => sum + (c.budget_ars || 0), 0);
  const activeCampaigns = campaigns.filter(c => c.status === "active").length;
  const avgROI = campaigns.filter(c => c.roi).reduce((sum, c) => sum + (c.roi || 0), 0) / campaigns.filter(c => c.roi).length || 0;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Target}
        title="Campañas de Marketing"
        description="Gestiona el ciclo de vida completo de tus campañas"
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gradient-gold text-primary-foreground">
                <Plus className="w-4 h-4 mr-2" />Nueva Campaña
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border/60 max-w-lg">
              <DialogHeader><DialogTitle className="font-display">Nueva Campaña</DialogTitle></DialogHeader>
              <CampaignForm onSave={(d) => { handleCreate(d); setOpen(false); }} />
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KPICard label="Presupuesto Total" value={`$${totalBudget.toLocaleString('es-AR')}`} icon={DollarSign} sub={`${campaigns.length} campañas`} />
        <KPICard label="Campañas Activas" value={activeCampaigns} icon={TrendingUp} sub="En ejecución" />
        <KPICard label="ROI Promedio" value={`${avgROI > 0 ? '+' : ''}${avgROI.toFixed(1)}%`} icon={BarChart3} sub="Retorno sobre inversión" />
      </div>

      <div className="bg-white rounded-lg shadow border border-border/60 overflow-hidden">
        <div className="grid grid-cols-12 gap-4 p-4 border-b border-border/60 bg-muted/30">
          <div className="col-span-3 font-medium">Nombre</div>
          <div className="col-span-2 font-medium">Canal</div>
          <div className="col-span-2 font-medium">Presupuesto</div>
          <div className="col-span-2 font-medium">Estado</div>
          <div className="col-span-2 font-medium">ROI</div>
          <div className="col-span-1 font-medium">Acciones</div>
        </div>
        {campaigns.map(campaign => (
          <div key={campaign.id} className="grid grid-cols-12 gap-4 p-4 border-b border-border/60 hover:bg-muted/30">
            <div className="col-span-3">
              <div className="font-medium">{campaign.title}</div>
              <div className="text-sm text-muted-foreground">{campaign.description}</div>
            </div>
            <div className="col-span-2">
              <Badge variant="outline">{campaign.marketing_channels?.name}</Badge>
            </div>
            <div className="col-span-2">
              ${campaign.budget_ars?.toLocaleString('es-AR')}
            </div>
            <div className="col-span-2">
              <Badge variant={campaign.status === 'active' ? 'default' : campaign.status === 'draft' ? 'secondary' : 'outline'}>{campaign.status}</Badge>
            </div>
            <div className="col-span-2">
              {campaign.roi > 0 ? '+' : ''}{campaign.roi?.toFixed(1)}%
            </div>
            <div className="col-span-1 flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => setEditing(campaign)}>
                <Edit className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => handleDelete(campaign.id)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {campaigns.length === 0 && (
        <div className="text-center py-12">
          <Target className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium">No hay campañas</h3>
          <p className="text-muted-foreground">Crea tu primera campaña para empezar</p>
        </div>
      )}
    </div>
  );
}

function CampaignForm({ onSave }) {
  const [form, setForm] = useState({ title: '', description: '', channel: '', budget_ars: 0, roi: 0 });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label>Nombre de campaña</label>
        <Input value={form.title} onChange={e => setForm({...form, title: e.target.value})} placeholder="Ej: Verano 2026" />
      </div>
      <div>
        <label>Descripción</label>
        <Textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Describe la campaña" />
      </div>
      <div>
        <label>Canal de marketing</label>
        <Select onValueChange={v => setForm({...form, channel: v})}>
          <SelectTrigger><SelectValue placeholder="Selecciona un canal" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="instagram">Instagram</SelectItem>
            <SelectItem value="facebook">Facebook</SelectItem>
            <SelectItem value="email">Email</SelectItem>
            <SelectItem value="google">Google Ads</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <label>Presupuesto (ARS)</label>
        <Input type="number" value={form.budget_ars} onChange={e => setForm({...form, budget_ars: Number(e.target.value)})} placeholder="0" />
      </div>
      <div>
        <label>ROI esperado (%)</label>
        <Input type="number" step="0.1" value={form.roi} onChange={e => setForm({...form, roi: Number(e.target.value)})} placeholder="0.0" />
      </div>
      <Button type="submit" disabled={saving} className="w-full">
        {saving ? "Guardando..." : "Crear Campaña"}
      </Button>
    </form>
  );
}