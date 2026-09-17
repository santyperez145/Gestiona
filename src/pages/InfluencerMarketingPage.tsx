import { useState } from "react";
import { Bell, Store, TrendingUp, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function InfluencerMarketingPage() {
  const [activeTab, setActiveTab] = useState<string>("overview");

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-display font-bold">Influencer Marketing</h1>
        <div className="flex flex-wrap gap-2 sm:gap-4">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setActiveTab("overview")}
            className={activeTab === "overview" ? "bg-muted" : ""}
          >
            <Store className="h-4 w-4" />
            <span className="ml-2">Tienda</span>
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setActiveTab("influencers")}
            className={activeTab === "influencers" ? "bg-muted" : ""}
          >
            <Users className="h-4 w-4" />
            <span className="ml-2">Influencers</span>
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setActiveTab("campaigns")}
            className={activeTab === "campaigns" ? "bg-muted" : ""}
          >
            <Bell className="h-4 w-4" />
            <span className="ml-2">Campañas</span>
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setActiveTab("analytics")}
            className={activeTab === "analytics" ? "bg-muted" : ""}
          >
            <TrendingUp className="h-4 w-4" />
            <span className="ml-2">Analytics</span>
          </Button>
        </div>
      </div>

      {activeTab === "overview" && (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="h-[120px]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Influencers Activos</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Últimos 30 días
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <p className="text-2xl font-display font-bold">124</p>
            </CardContent>
            <CardFooter className="pt-2 text-xs text-muted-foreground">
              +12% vs mes anterior
            </CardFooter>
          </Card>
          <Card className="h-[120px]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Campañas En Vivo</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                En ejecución
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <p className="text-2xl font-display font-bold">18</p>
            </CardContent>
            <CardFooter className="pt-2 text-xs text-muted-foreground">
              +8% vs mes anterior
            </CardFooter>
          </Card>
          <Card className="h-[120px]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Alcance Total</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Impresiones
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <p className="text-2xl font-display font-bold">2.4M</p>
            </CardContent>
            <CardFooter className="pt-2 text-xs text-muted-foreground">
              +22% vs mes anterior
            </CardFooter>
          </Card>
          <Card className="h-[120px]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold">ROAS Promedio</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Return on Ad Spend
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <p className="text-2xl font-display font-bold">4.2x</p>
            </CardContent>
            <CardFooter className="pt-2 text-xs text-muted-foreground">
              +0.8 vs mes anterior
            </CardFooter>
          </Card>
        </div>
      )}

      {activeTab === "influencers" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-display font-semibold">Influencers</h2>
            <Button variant="outline" size="sm">
              <Users className="mr-2 h-3 w-3" /> Nuevo Influencer
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Influencer
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Plataforma
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Seguidores
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Tasa de Engagement
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Última Campaña
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Estado
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                <tr className="hover:bg-muted">
                  <td className="px-4 py-3 text-sm font-medium">
                    <div className="flex items-center space-x-3">
                      <div className="h-9 w-9 flex-shrink-0">
                        <img
                          src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop&crop=face"
                          alt=""
                          className="rounded-full"
                        />
                      </div>
                      <div>
                        <p className="text-sm font-medium">@lucia.garcia</p>
                        <p className="text-xs text-muted-foreground">Lucía García</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className="flex items-center space-x-2 text-xs">
                      <span className="h-2 w-2 rounded-full bg-amber-500"></span>
                      Instagram
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">84.2K</td>
                  <td className="px-4 py-3 text-sm">4.8%</td>
                  <td className="px-4 py-3 text-sm">Hace 2 días</td>
                  <td className="px-4 py-3 text-sm">
                    <Badge variant="secondary">Activo</Badge>
                  </td>
                  <td className="px-4 py-3 text-sm flex space-x-2">
                    <Button variant="ghost" size="xs">
                      <Bell className="h-3 w-3" /> Notificar
                    </Button>
                    <Button variant="outline" size="xs">
                      <Store className="h-3 w-3" /> Ver tienda
                    </Button>
                  </td>
                </tr>
                <tr className="hover:bg-muted">
                  <td className="px-4 py-3 text-sm font-medium">
                    <div className="flex items-center space-x-3">
                      <div className="h-9 w-9 flex-shrink-0">
                        <img
                          src="https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=100&h=100&fit=crop&crop=face"
                          alt=""
                          className="rounded-full"
                        />
                      </div>
                      <div>
                        <p className="text-sm font-medium">@martin.lopez</p>
                        <p className="text-xs text-muted-foreground">Martín López</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className="flex items-center space-x-2 text-xs">
                      <span className="h-2 w-2 rounded-full bg-teal-500"></span>
                      TikTok
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">156.7K</td>
                  <td className="px-4 px-3 py-3 text-sm">7.2%</td>
                  <td className="px-4 py-3 text-sm">Hace 5 días</td>
                  <td className="px-4 py-3 text-sm">
                    <Badge variant="secondary">Activo</Badge>
                  </td>
                  <td className="px-4 py-3 text-sm flex space-x-2">
                    <Button variant="ghost" size="xs">
                      <Bell className="h-3 w-3" /> Notificar
                    </Button>
                    <Button variant="outline" size="xs">
                      <Store className="h-3 w-3" /> Ver tienda
                    </Button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "campaigns" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-display font-semibold">Campañas</h2>
            <Button variant="outline" size="sm">
              <Bell className="mr-2 h-3 w-3" /> Nueva Campaña
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Campaña
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Influencer
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Objetivo
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Presupuesto
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Fecha
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Estado
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                <tr className="hover:bg-muted">
                  <td className="px-4 py-3 text-sm font-medium">#Verano2026</td>
                  <td className="px-4 py-3 text-sm">@lucia.garcia</td>
                  <td className="px-4 py-3 text-sm">Awareness</td>
                  <td className="px-4 py-3 text-sm">$1,200</td>
                  <td className="px-4 py-3 text-sm">15/09 - 30/09</td>
                  <td className="px-4 py-3 text-sm">
                    <Badge variant="secondary">Activa</Badge>
                  </td>
                  <td className="px-4 py-3 text-sm flex space-x-2">
                    <Button variant="ghost" size="xs">
                      <Eye className="h-3 w-3" /> Ver detalles
                    </Button>
                    <Button variant="outline" size="xs">
                      <BarChart3 className="h-3 w-3" /> Reporte
                    </Button>
                  </td>
                </tr>
                <tr className="hover:bg-muted">
                  <td className="px-4 py-3 text-sm font-medium">#Navidad2026</td>
                  <td className="px-4 py-3 text-sm">@martin.lopez</td>
                  <td className="px-4 py-3 text-sm">Conversión</td>
                  <td className="px-4 py-3 text-sm">$2,500</td>
                  <td className="px-4 py-3 text-sm">01/12 - 24/12</td>
                  <td className="px-4 py-3 text-sm">
                    <Badge variant="default">Programada</Badge>
                  </td>
                  <td className="px-4 py-3 text-sm flex space-x-2">
                    <Button variant="ghost" size="xs">
                      <Eye className="h-3 w-3" /> Ver detalles
                    </Button>
                    <Button variant="outline" size="xs">
                      <BarChart3 className="h-3 w-3" /> Reporte
                    </Button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "analytics" && (
        <div className="space-y-6">
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-4">
              <h2 className="text-xl font-display font-semibold">Rendimiento General</h2>
              <div className="h-[300px] w-full">
                {/* Placeholder for chart */}
                <div className="h-full w-full bg-muted/50 rounded-lg flex items-center justify-center text-sm text-muted-foreground">
                  Gráfico de Tendencias
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <h2 className="text-xl font-display font-semibold">Distribución por Plataforma</h2>
              <div className="h-[300px] w-full">
                {/* Placeholder for chart */}
                <div className="h-full w-full bg-muted/50 rounded-lg flex items-center justify-center text-sm text-muted-foreground">
                  Distribución de Inversión
                </div>
              </div>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="text-lg font-medium font-display mb-2">Top Performing Influencers</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between px-3 py-2 bg-muted/50 rounded-lg text-sm">
                  <span>@lucia.garcia</span>
                  <span>4.8% engagement</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2 bg-muted/50 rounded-lg text-sm">
                  <span>@martin.lopez</span>
                  <span>7.2% engagement</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2 bg-muted/50 rounded-lg text-sm">
                  <span>@sofia.ruiz</span>
                  <span>5.1% engagement</span>
                </div>
              </div>
            </div>
            <div>
              <h3 className="text-lg font-medium font-display mb-2">Próximas Actividades</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between px-3 py-2 bg-muted/50 rounded-lg text-sm">
                  <span>Reunión de estrategia</span>
                  <span>Hoy 15:00</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2 bg-muted/50 rounded-lg text-sm">
                  <span>Envío de briefs</span>
                  <span>Mañana 09:00</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2 bg-muted/50 rounded-lg text-sm">
                  <span>Revisión de contenido</span>
                  <span>19/09</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}