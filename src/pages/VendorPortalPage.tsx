import { useState } from "react";
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

const MOCK_VENDORS: Vendor[] = [
  { id: "v1", name: "TechParts SA", email: "ventas@techparts.com.ar", is_active: true, last_login: "2026-05-26T14:30:00Z", pending_invoices: 2, pending_amount: 485_000, catalog_items: 47, unread_messages: 3, rating: 4.8 },
  { id: "v2", name: "Distribuidora López", email: "contacto@dlopez.com.ar", is_active: true, last_login: "2026-05-27T09:00:00Z", pending_invoices: 1, pending_amount: 192_000, catalog_items: 23, unread_messages: 0, rating: 4.2 },
  { id: "v3", name: "Importaciones MNZ", email: "info@mnz.com.ar", is_active: true, last_login: "2026-05-20T11:00:00Z", pending_invoices: 3, pending_amount: 890_000, catalog_items: 85, unread_messages: 1, rating: 3.9 },
  { id: "v4", name: "Proveedor Nuevo", email: "nuevo@proveedor.com", is_active: false, last_login: null, pending_invoices: 0, pending_amount: 0, catalog_items: 0, unread_messages: 0, rating: 0 },
];

const MOCK_INVOICES: VendorInvoice[] = [
  { id: "i1", vendor_name: "TechParts SA", invoice_number: "FP-2026-0142", invoice_date: "2026-05-10", due_date: "2026-05-25", amount: 285_000, status: "pending", purchase_order_ref: "OC-001245" },
  { id: "i2", vendor_name: "TechParts SA", invoice_number: "FP-2026-0143", invoice_date: "2026-05-15", due_date: "2026-05-30", amount: 200_000, status: "approved", purchase_order_ref: "OC-001248" },
  { id: "i3", vendor_name: "Distribuidora López", invoice_number: "DL-0089", invoice_date: "2026-05-20", due_date: "2026-06-05", amount: 192_000, status: "pending", purchase_order_ref: null },
  { id: "i4", vendor_name: "Importaciones MNZ", invoice_number: "MNZ-2026-456", invoice_date: "2026-04-30", due_date: "2026-05-15", amount: 540_000, status: "pending", purchase_order_ref: "OC-001230" },
  { id: "i5", vendor_name: "Importaciones MNZ", invoice_number: "MNZ-2026-412", invoice_date: "2026-04-15", due_date: "2026-04-30", amount: 350_000, status: "paid", purchase_order_ref: "OC-001210" },
];

const MOCK_CATALOG: CatalogItem[] = [
  { id: "ci1", vendor_name: "TechParts SA", sku: "TP-NB-001", name: "Notebook Lenovo IdeaPad 3", unit_price: 290_000, min_order_qty: 1, lead_time_days: 3, stock_available: 15, is_active: true },
  { id: "ci2", vendor_name: "TechParts SA", sku: "TP-MO-005", name: "Monitor LG 27 IPS", unit_price: 430_000, min_order_qty: 2, lead_time_days: 5, stock_available: 8, is_active: true },
  { id: "ci3", vendor_name: "Importaciones MNZ", sku: "MNZ-AU-001", name: "Auriculares Sony WH-1000XM5", unit_price: 97_000, min_order_qty: 3, lead_time_days: 7, stock_available: 20, is_active: true },
  { id: "ci4", vendor_name: "Distribuidora López", sku: "DL-TC-002", name: "Teclado Mecánico Redragon K552", unit_price: 29_000, min_order_qty: 5, lead_time_days: 2, stock_available: 50, is_active: true },
];

export default function VendorPortalPage() {
  const { orgId } = useOrganization();
  const [tab, setTab] = useState<"vendors" | "invoices" | "catalog" | "messages">("vendors");
  const [invoices, setInvoices] = useState<VendorInvoice[]>(MOCK_INVOICES);
  const [selected, setSelected] = useState<Vendor | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");

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
        <Card><CardContent className="p-4 flex gap-3 items-center"><Building className="w-8 h-8 text-blue-500" /><div><p className="text-xs text-muted-foreground">Proveedores Activos</p><p className="text-2xl font-bold">{MOCK_VENDORS.filter(v => v.is_active).length}</p></div></CardContent></Card>
        <Card><CardContent className="p-4 flex gap-3 items-center"><Clock className="w-8 h-8 text-yellow-500" /><div><p className="text-xs text-muted-foreground">Facturas Pendientes</p><p className="text-xl font-bold">${(totalPending / 1000).toFixed(0)}K</p></div></CardContent></Card>
        <Card><CardContent className="p-4 flex gap-3 items-center"><CheckCircle className="w-8 h-8 text-green-500" /><div><p className="text-xs text-muted-foreground">Aprobadas para Pago</p><p className="text-xl font-bold">${(totalApproved / 1000).toFixed(0)}K</p></div></CardContent></Card>
        <Card><CardContent className="p-4 flex gap-3 items-center"><Package className="w-8 h-8 text-purple-500" /><div><p className="text-xs text-muted-foreground">Ítems en Catálogos</p><p className="text-2xl font-bold">{MOCK_CATALOG.length}</p></div></CardContent></Card>
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
          {MOCK_VENDORS.map(v => (
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
                  {MOCK_CATALOG.map(item => (
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
          {MOCK_VENDORS.filter(v => v.is_active).map(v => (
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
