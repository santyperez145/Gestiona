/**
 * InventoryLedger — Inventario como ledger para Business
 *
 * Features:
 * - Stock por ubicación
 * - Stock en tránsito
 * - Stock reservado
 * - Stock negativo (error)
 * - Rotación
 * - Forecast de stock
 * - Reposiciones
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Package, Warehouse, Truck, Clock, AlertTriangle, TrendingUp, ArrowRight, RefreshCw, BarChart3, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface LocationStock {
  id: string;
  name: string;
  available: number;
  inTransit: number;
  reserved: number;
  total: number;
  capacity: number;
}

const LOCATIONS: LocationStock[] = [
  { id: "1", name: "Sucursal Norte", available: 450, inTransit: 50, reserved: 30, total: 530, capacity: 1000 },
  { id: "2", name: "Sucursal Sur", available: 320, inTransit: 80, reserved: 20, total: 420, capacity: 800 },
  { id: "3", name: "Depósito Central", available: 800, inTransit: 120, reserved: 50, total: 970, capacity: 2000 },
];

interface ProductStock {
  id: string;
  name: string;
  sku: string;
  stock: number;
  reserved: number;
  available: number;
  status: "ok" | "low" | "critical" | "negative";
  location: string;
  rotation: number;
}

const PRODUCT_STOCK: ProductStock[] = [
  { id: "1", name: "Producto A", sku: "SKU-001", stock: 50, reserved: 10, available: 40, status: "ok", location: "Sucursal Norte", rotation: 12 },
  { id: "2", name: "Producto B", sku: "SKU-002", stock: 8, reserved: 5, available: 3, status: "critical", location: "Sucursal Sur", rotation: 25 },
  { id: "3", name: "Producto C", sku: "SKU-003", stock: 15, reserved: 8, available: 7, status: "low", location: "Depósito Central", rotation: 8 },
  { id: "4", name: "Producto D", sku: "SKU-004", stock: -2, reserved: 0, available: -2, status: "negative", location: "Sucursal Norte", rotation: 15 },
];

function LocationCard({ location }: { location: LocationStock }) {
  const utilization = (location.total / location.capacity) * 100;
  const isOverCapacity = utilization > 90;

  return (
    <Card className={cn(isOverCapacity ? "border-amber-500/50" : "")}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-sm font-medium">{location.name}</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">Capacidad: {location.capacity}</p>
          </div>
          {isOverCapacity && (
            <Badge variant="destructive" className="text-[10px]">
              <AlertTriangle className="h-3 w-3 mr-1" />
              Casi lleno
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2 rounded bg-muted/50">
            <p className="text-xs text-muted-foreground">Disponible</p>
            <p className="text-lg font-bold">{location.available}</p>
          </div>
          <div className="p-2 rounded bg-muted/50">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-lg font-bold">{location.total}</p>
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">En tránsito</span>
            <span className="font-medium">{location.inTransit}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Reservado</span>
            <span className="font-medium">{location.reserved}</span>
          </div>
        </div>
        <Progress value={utilization} className={cn("h-2", isOverCapacity ? "bg-amber-500" : "")} />
        <p className="text-xs text-muted-foreground text-right">{utilization.toFixed(1)}% ocupado</p>
      </CardContent>
    </Card>
  );
}

function ProductStockCard({ product }: { product: ProductStock }) {
  const statusColors = {
    ok: "bg-emerald-500/10 text-emerald-700 border-emerald-500/25",
    low: "bg-amber-500/10 text-amber-700 border-amber-500/25",
    critical: "bg-destructive/10 text-destructive border-destructive/20",
    negative: "bg-destructive text-destructive border-destructive",
  };

  const statusLabels = {
    ok: "OK",
    low: "Bajo",
    critical: "Crítico",
    negative: "Negativo",
  };

  return (
    <Card className={cn(product.status === "negative" ? "border-destructive" : "")}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-sm font-medium">{product.name}</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">{product.sku}</p>
          </div>
          <Badge variant="secondary" className={cn("text-[10px]", statusColors[product.status])}>
            {statusLabels[product.status]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <div className="p-2 rounded bg-muted/50">
            <p className="text-xs text-muted-foreground">Stock</p>
            <p className={cn("text-lg font-bold", product.status === "negative" ? "text-destructive" : "")}>{product.stock}</p>
          </div>
          <div className="p-2 rounded bg-muted/50">
            <p className="text-xs text-muted-foreground">Reservado</p>
            <p className="text-lg font-bold">{product.reserved}</p>
          </div>
          <div className="p-2 rounded bg-muted/50">
            <p className="text-xs text-muted-foreground">Disponible</p>
            <p className="text-lg font-bold">{product.available}</p>
          </div>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Ubicación</span>
          <span className="font-medium">{product.location}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Rotación</span>
          <span className="font-medium">{product.rotation}/mes</span>
        </div>
        {product.status === "critical" && (
          <Button size="sm" variant="outline" className="w-full h-8 gap-2">
            <RefreshCw className="h-3 w-3" />
            Reponer
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default function InventoryLedger() {
  const totalStock = LOCATIONS.reduce((sum, loc) => sum + loc.total, 0);
  const totalCapacity = LOCATIONS.reduce((sum, loc) => sum + loc.capacity, 0);
  const overallUtilization = (totalStock / totalCapacity) * 100;

  return (
    <div className="space-y-6">
      {/* KPIs de Inventario */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Stock Total</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalStock.toLocaleString()}</div>
            <div className="flex items-center text-xs mt-1 text-muted-foreground">
              <span className="text-emerald-600 mr-1">+12%</span> vs mes anterior
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Utilización</CardTitle>
            <Warehouse className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{overallUtilization.toFixed(1)}%</div>
            <Progress value={overallUtilization} className="h-2 mt-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">En Tránsito</CardTitle>
            <Truck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{LOCATIONS.reduce((sum, loc) => sum + loc.inTransit, 0).toLocaleString()}</div>
            <div className="flex items-center text-xs mt-1 text-muted-foreground">
              <Clock className="h-3 w-3 mr-1" />
              Entrega estimada: 2-3 días
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Stock Crítico</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{PRODUCT_STOCK.filter(p => p.status === "critical" || p.status === "negative").length}</div>
            <div className="flex items-center text-xs mt-1 text-muted-foreground">
              Requiere acción inmediata
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="locations" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="locations">Por Ubicación</TabsTrigger>
          <TabsTrigger value="products">Por Producto</TabsTrigger>
          <TabsTrigger value="forecast">Forecast</TabsTrigger>
        </TabsList>

        {/* Por Ubicación */}
        <TabsContent value="locations" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Stock por Ubicación</h3>
            <Button size="sm" variant="outline" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Actualizar
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {LOCATIONS.map(location => (
              <LocationCard key={location.id} location={location} />
            ))}
          </div>
        </TabsContent>

        {/* Por Producto */}
        <TabsContent value="products" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Stock por Producto</h3>
            <Button size="sm" className="gap-2">
              <Plus className="h-4 w-4" />
              Ajustar Stock
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {PRODUCT_STOCK.map(product => (
              <ProductStockCard key={product.id} product={product} />
            ))}
          </div>
        </TabsContent>

        {/* Forecast */}
        <TabsContent value="forecast" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                Forecast de Stock
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                  <div className="h-2 w-2 rounded-full bg-emerald-500 mt-2" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Producto "X" se agotará en 15 días</p>
                    <p className="text-xs text-muted-foreground mt-1">Rotación actual: 8/mes • Stock actual: 45 • Ventas promedio: 3/día</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50/50 dark:bg-amber-950/50">
                  <div className="h-2 w-2 rounded-full bg-amber-500 mt-2" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Producto "Y" tiene exceso de stock</p>
                    <p className="text-xs text-muted-foreground mt-1">Rotación actual: 2/mes • Stock actual: 120 • Ventas promedio: 2/día</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-50/50 dark:bg-blue-950/50">
                  <div className="h-2 w-2 rounded-full bg-blue-500 mt-2" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Reposición sugerida para 7 productos</p>
                    <p className="text-xs text-muted-foreground mt-1">Basado en forecast de ventas para los próximos 30 días</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
