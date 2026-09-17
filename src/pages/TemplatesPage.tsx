import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Download, Upload, Eye, Edit, Copy, Calendar, Tag } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import EmptyState from "@/components/shared/EmptyState";

export default function TemplatesPage() {
  usePageTitle("Plantillas de Marketing");
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState("all");

  const reload = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("marketing_templates")
      .select("*")
      .eq("org_id", activeOrg?.id)
      .order("created_at", { ascending: false });
    if (!error) {
      setTemplates(data);
    }
    setLoading(false);
  };

  useEffect(() => { reload(); }, [user, activeOrg]);

  const handleCreate = async (formData) => {
    try {
      const { data, error } = await supabase
        .from("marketing_templates")
        .insert({ ...formData, org_id: activeOrg?.id, created_by: user?.id })
        .select()
        .single();
      if (error) throw error;
      toast.success("Plantilla creada");
      setOpen(false);
      reload();
    } catch (err) {
      toast.error("Error creando plantilla");
    }
  };

  const handleUpdate = async (id, formData) => {
    try {
      const { error } = await supabase
        .from("marketing_templates")
        .update(formData)
        .eq("id", id)
        .eq("org_id", activeOrg?.id);
      if (error) throw error;
      toast.success("Plantilla actualizada");
      setEditing(null);
      reload();
    } catch (err) {
      toast.error("Error actualizando plantilla");
    }
  };

  const handleDelete = async (id) => {
    try {
      const { error } = await supabase
        .from("marketing_templates")
        .delete()
        .eq("id", id)
        .eq("org_id", activeOrg?.id);
      if (error) throw error;
      toast.success("Plantilla eliminada");
      reload();
    } catch (err) {
      toast.error("Error eliminando plantilla");
    }
  };

  if (loading) return <div className="p-8 text-center">Cargando...</div>;

  const filtered = filter === "all" ? templates : templates.filter(t => t.category === filter);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Tag}
        title="Plantillas de Marketing"
        description="Plantillas reutilizables para campañas rápidas"
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gradient-gold text-primary-foreground">
                <Plus className="w-4 h-4 mr-2" />Nueva Plantilla
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border/60 max-w-lg">
              <DialogHeader><DialogTitle className="font-display">Nueva Plantilla</DialogTitle></DialogHeader>
              <TemplateForm onSave={(d) => { handleCreate(d); setOpen(false); reload(); }} />
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(template => (
          <div key={template.id} className="bg-white rounded-lg shadow border border-border/60 p-4 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-semibold text-lg">{template.name}</h3>
                <p className="text-sm text-muted-foreground">{template.category}</p>
              </div>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">{template.status}</span>
            </div>
            <p className="text-sm text-muted-foreground mb-4">{template.description}</p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(template)}>
                <Edit className="w-4 h-4 mr-1" />Editar
              </Button>
              <Button variant="outline" size="sm">
                <Eye className="w-4 h-4 mr-1" />Vista
              </Button>
              <Button variant="outline" size="sm">
                <Copy className="w-4 h-4 mr-1" />Copiar
              </Button>
              <Button variant="destructive" size="sm" onClick={() => handleDelete(template.id)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <EmptyState icon={Tag} title="No hay plantillas" description="Crea tu primera plantilla para acelerar tus campañas" />
      )}
    </div>
  );
}

function TemplateForm({ onSave }) {
  const [form, setForm] = useState({ name: "", description: "", category: "", content: "" });
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
        <Label>Nombre de plantilla</Label>
        <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Ej: Post Instagram producto" />
      </div>
      <div>
        <Label>Categoría</Label>
        <Select onValueChange={v => setForm({...form, category: v})}>
          <SelectTrigger><SelectValue placeholder="Selecciona una categoría" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="social">Redes Sociales</SelectItem>
            <SelectItem value="email">Email Marketing</SelectItem>
            <SelectItem value="web">Landing Page</SelectItem>
            <SelectItem value="print">Impresión</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Descripción</Label>
        <Textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Describe el propósito de esta plantilla" />
      </div>
      <div>
        <Label>Contenido (HTML/Markdown)</Label>
        <Textarea value={form.content} onChange={e => setForm({...form, content: e.target.value})} placeholder="Contenido de la plantilla..." className="min-h-[120px]" />
      </div>
      <Button type="submit" disabled={saving} className="w-full">
        {saving ? "Guardando..." : "Guardar Plantilla"}
      </Button>
    </form>
  );
}