/**
 * Galería del sistema visual. Sólo existe en desarrollo (import.meta.env.DEV):
 * permite ver tokens, tipografía y componentes compartidos sin sesión, con
 * datos de ejemplo, en claro y oscuro.
 */
import { Suspense, lazy, useState } from "react";
import { DollarSign, Package, ShoppingCart, Users, Plus, Search, Download, Boxes } from "lucide-react";
import { useTheme } from "next-themes";
import PageHeader from "@/components/shared/PageHeader";
import BusinessKPICard from "@/components/business/BusinessKPICard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const AppLayout = lazy(() => import("@/components/AppLayout"));

const FILAS = [
  { nombre: "Taladro percutor 13 mm 750 W", categoria: "Herramientas eléctricas", stock: 12, precio: 89990 },
  { nombre: "Bulón cabeza redonda 3/8 x 2", categoria: "Bulonería y fijaciones", stock: 1340, precio: 320 },
  { nombre: "Látex interior blanco 10 L", categoria: "Pinturería", stock: 3, precio: 41500 },
  { nombre: "Llave francesa 10\"", categoria: "Herramientas manuales", stock: 0, precio: 15800 },
];

const ars = (n: number) => n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export default function DesignShowcasePage() {
  // ?shell=1 dibuja la galería dentro del marco real (menú y barra superior).
  if (new URLSearchParams(window.location.search).get("shell") === "1") {
    return <Suspense fallback={null}><AppLayout><Galeria /></AppLayout></Suspense>;
  }
  return <Galeria />;
}

function Galeria() {
  const { theme, setTheme } = useTheme();
  const [tab, setTab] = useState("todos");
  return <div className="min-h-screen bg-background text-foreground">
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
        Oscuro <Switch checked={theme === "dark"} onCheckedChange={v => setTheme(v ? "dark" : "light")} aria-label="Tema oscuro" />
      </div>

      <PageHeader icon={Package} eyebrow="Nerqia · Catálogo" title="Productos"
        description="Todo lo que vendés en el local y en la tienda online, con el mismo stock."
        actions={<div className="flex gap-2"><Button variant="outline"><Download className="mr-1 h-4 w-4" />Exportar</Button><Button><Plus className="mr-1 h-4 w-4" />Nuevo producto</Button></div>} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <BusinessKPICard title="Ventas de hoy" value={ars(1284500)} change={12.4} trend="up" icon={DollarSign} />
        <BusinessKPICard title="Pedidos online" value="38" change={-3.1} trend="down" icon={ShoppingCart} />
        <BusinessKPICard title="Productos" value="11.042" icon={Boxes} description="214 con stock bajo" />
        <BusinessKPICard title="Clientes" value="2.391" change={4.0} trend="up" icon={Users} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle>Catálogo</CardTitle>
          <div className="relative w-64"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Buscar por nombre o código" /></div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={tab} onValueChange={setTab}><TabsList><TabsTrigger value="todos">Todos</TabsTrigger><TabsTrigger value="bajo">Stock bajo</TabsTrigger><TabsTrigger value="sin">Sin stock</TabsTrigger></TabsList></Tabs>
          <Table>
            <TableHeader><TableRow><TableHead>Producto</TableHead><TableHead>Categoría</TableHead><TableHead className="text-right">Stock</TableHead><TableHead className="text-right">Precio</TableHead></TableRow></TableHeader>
            <TableBody>
              {FILAS.map(f => <TableRow key={f.nombre}>
                <TableCell className="font-medium">{f.nombre}</TableCell>
                <TableCell><Badge variant="secondary">{f.categoria}</Badge></TableCell>
                <TableCell className="text-right tabular-nums">{f.stock === 0 ? <Badge variant="destructive">Sin stock</Badge> : f.stock}</TableCell>
                <TableCell className="text-right tabular-nums">{ars(f.precio)}</TableCell>
              </TableRow>)}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardHeader><CardTitle>Botones</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-2">
          <Button>Primario</Button><Button variant="outline">Secundario</Button><Button variant="ghost">Fantasma</Button><Button variant="destructive">Eliminar</Button>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Etiquetas</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-2">
          <Badge>Nuevo</Badge><Badge variant="secondary">Borrador</Badge><Badge variant="outline">Online</Badge><Badge variant="destructive">Vencido</Badge>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Tipografía</CardTitle></CardHeader><CardContent className="space-y-1">
          <p className="font-display text-2xl font-bold tracking-tight">Ventas del mes</p>
          <p className="text-sm text-muted-foreground">Texto de apoyo para explicar un dato.</p>
          <p className="text-xl font-semibold tabular-nums">{ars(18_420_300)}</p>
        </CardContent></Card>
      </div>
    </div>
  </div>;
}
