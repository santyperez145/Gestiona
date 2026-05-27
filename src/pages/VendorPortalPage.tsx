import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  Building, Package, FileText, MessageCircle, DollarSign,
  CheckCircle, Clock, AlertTriangle, Plus, ExternalLink,
  Mail, Send, Star, Download
} from "lucide-react";

interface Vendor {
  id: string;
  name: string;
  email: string;
  is_active: boolean;
  last_login: string | null;
  pending_invoices: number;
  pending_amount: number;
  catalog_items: number;
  unread_messages: number;
  rating: number;
}

interface VendorInvoice {
  id: string;
  vendor_name: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  amount: number;
  status: string;
  purchase_order_ref: string | null;
}

interface CatalogItem {
  id: string;
  vendor_name: string;
  sku: string;
  name: string;
  unit_price: number;
  min_order_qty: number;
  lead_time_days: number;
  stock_available: number;
  is_active: boolean;
}

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  pending:  { label: "Pendiente", color: "bg-yellow-100 text-yellow-800" },
  approved: { label: "Aprobada",  color: "bg-blue-100 text-blue-700" },
  rejected: { label: "Rechazada", color: "bg-red-100 text-red-700" },
  paid:     { label: "Pagada",    color: "bg-green-100 text-green-700" },
  disputed: { label: "Disputada", color: "bg-orange-100 text-orange-700" },
};


export default function VendorPortalPage() {
  const { orgId } = useOrganization();
  const [tab, setTab] = useState<"vendors" | "invoices" | "catalog" | "messages">("vendors");
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [invoices, setInvoices] = useState<VendorInvoice[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Vendor | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    Promise.all([
      supabase
        .from("vendor_portal_access")
        .select("id, supplier_id, email, is_active, last_login, suppliers!inner(name)")
        .eq("org_id", orgId),
      supabase
        .from("vendor_invoices")
        .select("id, supplier_id, invoice_number, invoice_date, due_date, amount, status, purchase_order_ref, suppliers!inner(name)")
        .eq("org_id", orgId)
        .order("invoice_date", { ascending: false }),
      supabase
        .from("vendor_catalog_items")
        .select("id, supplier_id, sku, name, unit_price, min_order_qty, lead_time_days, stock_available, is_active, suppliers!inner(name)")
        .eq("org_id", orgId)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("vendor_messages")
        .select("supplier_id, is_read")
        .eq("org_id", orgId)
        .eq("is_read", false)
        .eq("sender_type", "supplier"),
    ]).then(([accessRes, invoicesRes, catalogRes, messagesRes]) => {
      const accessData = accessRes.data ?? [];
      const invoicesData = invoicesRes.data ?? [];
      const catalogData = catalogRes.data ?? [];
      const messagesData = messagesRes.data ?? [];

      if (accessRes.error) toast.error("Error cargando proveedores");
      if (invoicesRes.error) toast.error("Error cargando facturas");
      if (catalogRes.error) toast.error("Error cargando catálogos");

      // Build vendor list from portal access entries
      const builtVendors: Vendor[] = (accessData as any[]).map(a => {
        const supplierId = a.supplier_id;
        const pendingInvs = invoicesData.filter((i: any) => i.supplier_id === supplierId && i.status === "pending");
        return {
          id: a.id,
          name: (a.suppliers as any)?.name ?? a.email,
          email: a.email,
          is_active: a.is_active,
          last_login: a.last_login,
          pending_invoices: pendingInvs.length,
          pending_amount: pendingInvs.reduce((s: number, i: any) => s + (i.amount ?? 0), 0),
          catalog_items: catalogData.filter((c: any) => c.supplier_id === supplierId).length,
          unread_messages: messagesData.filter((m: any) => m.supplier_id === supplierId).length,
          rating: 0,
        };
      });
      setVendors(builtVendors);

      const mappedInvoices: VendorInvoice[] = (invoicesData as any[]).map(i => ({
        id: i.id,
        vendor_name: (i.suppliers as any)?.name ?? "",
        invoice_number: i.invoice_number,
        invoice_date: i.invoice_date,
        due_date: i.due_date,
        amount: i.amount,
        status: i.status,
        purchase_order_ref: i.purchase_order_ref,
      }));
      setInvoices(mappedInvoices);

      const mappedCatalog: CatalogItem[] = (catalogData as any[]).map(c => ({
        id: c.id,
        vendor_name: (c.suppliers as any)?.name ?? "",
        sku: c.sku,
        name: c.name,
        unit_price: c.unit_price,
        min_order_qty: c.min_order_qty,
        lead_time_days: c.lead_time_days,
        stock_available: c.stock_available,
        is_active: c.is_active,
      }));
      setCatalog(mappedCatalog);

      setLoading(false);
    });
  }, [orgId]);

  const totalPending = invoices.filter(i => i.status === "pending").reduce((s, i) => s + i.amount, 0);
  const totalApproved = invoices.filter(i => i.status === "approved").reduce((s, i) => s + i.amount, 0);

  const approveInvoice = (id: string) => {
    setInvoices(prev => prev.map(i => i.id === id ? { ...i, status: "approved" } : i));
    toast.success("Factura aprobada");
  };
  const rejectInvoice = (id: string) => {
    setInvoices(prev => prev.map(i => i.id === id ? { ...i, status: "rejected" } : i));
    toast.info("Factura rechazada");
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Building className="w-6 h-6 text-primary" /> Portal de Proveedores</h1>
          <p className="text-muted-foreground text-sm mt-1">Self-service para proveedores: catálogos, facturas y comunicaciones</p>
        </div>
        <Dialog open={showInvite} onOpenChange={setShowInvite}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Invitar Proveedor</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Invitar al Portal</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div><Label>Email del Proveedor</Label><Input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="proveedor@empresa.com" /></div>
              <div><Label>Nombre del Proveedor</Label><Input placeholder="Empresa SA" /></div>
              <Button className="w-full" onClick={() => { toast.success("Invitación enviada"); setShowInvite(false); }}>
                <Mail className="w-4 h-4 mr-2" />Enviar Invitación
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4 flex gap-3 items-center"><Building className="w-8 h-8 text-blue-500" /><div><p className="text-xs text-muted-foreground">Proveedores Activos</p><p className="text-2xl font-bold">{vendors.filter(v => v.is_active).length}</p></div></CardContent></Card>
        <Card><CardContent className="p-4 flex gap-3 items-center"><Clock className="w-8 h-8 text-yellow-500" /><div><p className="text-xs text-muted-foreground">Facturas Pendientes</p><p className="text-xl font-bold">${(totalPending / 1000).toFixed(0)}K</p></div></CardContent></Card>
        <Card><CardContent className="p-4 flex gap-3 items-center"><CheckCircle className="w-8 h-8 text-green-500" /><div><p className="text-xs text-muted-foreground">Aprobadas para Pago</p><p className="text-xl font-bold">${(totalApproved / 1000).toFixed(0)}K</p></div></CardContent></Card>
        <Card><CardContent className="p-4 flex gap-3 items-center"><Package className="w-8 h-8 text-purple-500" /><div><p className="text-xs text-muted-foreground">Ítems en Catálogos</p><p className="text-2xl font-bold">{catalog.length}</p></div></CardContent></Card>
      </div>

      <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="vendors">Proveedores</TabsTrigger>
          <TabsTrigger value="invoices">Facturas</TabsTrigger>
          <TabsTrigger value="catalog">Catálogos</TabsTrigger>
          <TabsTrigger value="messages">Mensajes</TabsTrigger>
        </TabsList>

        {/* VENDORS */}
        <TabsContent value="vendors" className="space-y-3">
          {vendors.map(v => (
            <Card key={v.id} className={`cursor-pointer hover:shadow-md transition-shadow ${!v.is_active ? "opacity-50" : ""}`} onClick={() => setSelected(v)}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center font-bold text-primary">{v.name.slice(0, 2).toUpperCase()}</div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{v.name}</span>
                    {v.is_active ? <Badge className="bg-green-100 text-green-700 border-0 text-xs">Activo</Badge> : <Badge variant="secondary" className="text-xs">Inactivo</Badge>}
                    {v.unread_messages > 0 && <Badge className="bg-blue-500 text-white text-xs">{v.unread_messages} msg</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{v.email} · Último acceso: {v.last_login ? new Date(v.last_login).toLocaleDateString("es-AR") : "Nunca"}</p>
                </div>
                <div className="text-right text-sm">
                  <p className="font-medium">{v.pending_invoices} fact. pendientes</p>
                  <p className="text-muted-foreground">${(v.pending_amount / 1000).toFixed(0)}K</p>
                </div>
                {v.rating > 0 && (
                  <div className="flex items-center gap-1 text-sm text-yellow-600">
                    <Star className="w-4 h-4 fill-yellow-500 text-yellow-500" />{v.rating}
                  </div>
                )}
                <Button size="sm" variant="outline" onClick={e => { e.stopPropagation(); toast.info("Abriendo portal..."); }}>
                  <ExternalLink className="w-3 h-3 mr-1" />Portal
                </Button>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* INVOICES */}
        <TabsContent value="invoices" className="space-y-3">
          {invoices.map(inv => (
            <Card key={inv.id} className={inv.status === "pending" && new Date(inv.due_date) < new Date() ? "border-red-300" : ""}>
              <CardContent className="p-4 flex items-center gap-4">
                {new Date(inv.due_date) < new Date() && inv.status === "pending" && (
                  <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-medium">{inv.invoice_number}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_CFG[inv.status]?.color ?? ""}`}>{STATUS_CFG[inv.status]?.label}</span>
                    {inv.purchase_order_ref && <span className="text-xs text-muted-foreground">OC: {inv.purchase_order_ref}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{inv.vendor_name} · Emitida: {inv.invoice_date} · Vence: {inv.due_date}</p>
                </div>
                <p className="font-bold text-lg">${inv.amount.toLocaleString()}</p>
                <div className="flex gap-2">
                  {inv.status === "pending" && (
                    <>
                      <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => approveInvoice(inv.id)}>Aprobar</Button>
                      <Button size="sm" variant="outline" onClick={() => rejectInvoice(inv.id)}>Rechazar</Button>
                    </>
                  )}
                  {inv.status === "approved" && (
                    <Button size="sm" variant="outline" onClick={() => toast.success("Pago programado")}>Pagar</Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => toast.info("Descargando...")}><Download className="w-4 h-4" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* CATALOG */}
        <TabsContent value="catalog">
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 border-b">
                  <tr>
                    <th className="text-left py-3 px-4">Producto</th>
                    <th className="text-left py-3 px-4">Proveedor</th>
                    <th className="text-left py-3 px-4">SKU</th>
                    <th className="text-right py-3 px-4">Precio Unit.</th>
                    <th className="text-right py-3 px-4">Mín. Pedido</th>
                    <th className="text-right py-3 px-4">Lead Time</th>
                    <th className="text-right py-3 px-4">Stock Disp.</th>
                    <th className="py-3 px-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {catalog.map(item => (
                    <tr key={item.id} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="py-3 px-4 font-medium">{item.name}</td>
                      <td className="py-3 px-4 text-muted-foreground">{item.vendor_name}</td>
                      <td className="py-3 px-4 font-mono text-xs">{item.sku}</td>
                      <td className="py-3 px-4 text-right font-medium">${item.unit_price.toLocaleString()}</td>
                      <td className="py-3 px-4 text-right">{item.min_order_qty} u.</td>
                      <td className="py-3 px-4 text-right">{item.lead_time_days}d</td>
                      <td className={`py-3 px-4 text-right font-medium ${item.stock_available < 5 ? "text-red-600" : ""}`}>{item.stock_available}</td>
                      <td className="py-3 px-4">
                        <Button size="sm" variant="outline" onClick={() => toast.success("Agregado a orden de compra")}>Pedir</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* MESSAGES */}
        <TabsContent value="messages" className="space-y-4">
          <div className="text-sm text-muted-foreground mb-2">Canal de comunicación directa con proveedores</div>
          {vendors.filter(v => v.is_active).map(v => (
            <Card key={v.id}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-sm">{v.name.slice(0, 2).toUpperCase()}</div>
                <div className="flex-1">
                  <span className="font-medium text-sm">{v.name}</span>
                  {v.unread_messages > 0 && <Badge className="ml-2 bg-blue-500 text-white text-xs">{v.unread_messages} nuevos</Badge>}
                  <p className="text-xs text-muted-foreground mt-0.5">{v.email}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => toast.info(`Abriendo chat con ${v.name}...`)}>
                  <MessageCircle className="w-3 h-3 mr-1" />Chat
                </Button>
                <Button size="sm" variant="ghost" onClick={() => toast.info("Enviando email...")}>
                  <Send className="w-4 h-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
