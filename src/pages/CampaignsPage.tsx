import { useState, useMemo } from "react";
import { Filter, Users, Calendar, Sparkles, Bell, BarChart3, TrendingUp, CheckCircle2, ShieldCheck, CalendarCheck, DollarSign, Gift } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { CreatorDiscoveryPage } from "./CreatorDiscoveryPage";
import { CampaignForm } from "./CampaignForm";

/** Página principal de campañas del flujo completo (Go-Marz → Core Nerqia) */
export default function CampaignsPage() {
  const [activeTab, setActiveTab] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("Todas");

  const SAMPLE_CAMPAIGNS = [
    {
      id: 1,
      name: "#Verano2026",
      influencer: "@lucia.garcia",
      budget: 1200,
      engagement: 4.8,
      status: "En ejecución",
      start: "15/09",
      end: "30/09",
      reach: 84200,
      conversions: 42,
      roas: 5.2,
    },
    {
      id: 2,
      name: "#Navidad2026",
      influencer: "@martin.lopez",
      budget: 2500,
      engagement: 7.2,
      status: "Programada",
      start: "01/12",
      end: "24/12",
      reach: 156700,
      conversions: 89,
      roas: 6.8,
    },
    {
      id: 3,
      name: "#BackToSchool",
      influencer: "@sofia.ruiz",
      budget: 800,
      engagement: 5.1,
      status: "Borrador",
      start: "01/03",
      end: "15/03",
      reach: 42300,
      conversions: 18,
      roas: 4.1,
    },
    {
      id: 4,
      name: "#AbrilModa",
      influencer: "@valeria.p",
      budget: 1500,
      engagement: 6.3,
      status: "Revisión",
      start: "01/04",
      end: "15/04",
      reach: 67100,
      conversions: 31,
      roas: 5.9,
    },
  ];

  const filteredCampaigns = useMemo(() => {
    return SAMPLE_CAMPAIGNS.filter((c) => {
      const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === "Todas" || c.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [search, statusFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold">Gestión de Campañas</h1>
          <p className="text-sm text-muted-foreground">
            Flujo completo: brief → propuesta → aprobación → ejecución → tracking → liquidación
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            // Abrir modal de creación
          }}
          className="self-start sm:self-auto"
        >
          <Sparkles className="mr-2 h-3.5 w-3.5" /> Nueva Campaña
        </Button>
      </div>

      {/* Filtros y búsqueda */}
      <div className="flex flex-wrap gap-3 items-center bg-muted/40 rounded-xl p-3">
        <div className="relative">
          <Filter className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar campaña…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 w-64 text-sm"
          />
        </div>
        <div className="flex gap-2">
          {["Todas", "Borrador", "Programada", "En ejecución", "Revisión", "Finalizada"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-2 py-1 rounded-md text-xs font-medium transition ${statusFilter === s ? "bg-primary text-primary-foreground" : "bg-background border border-border hover:bg-muted"}`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="ml-auto text-xs text-muted-foreground">
          {filteredCampaigns.length} campañas
        </div>
      </div>

      {/* Tabla de campañas */}
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
                Presupuesto
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Engagement
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Alcance
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                ROI
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
            {filteredCampaigns.map((c) => (
              <tr key={c.id} className="hover:bg-muted">
                <td className="px-4 py-3 text-sm font-medium">{c.name}</td>
                <td className="px-4 py-3 text-sm">{c.influencer}</td>
                <td className="px-4 py-3 text-sm">$${c.budget}</td>
                <td className="px-4 py-3 text-sm">{c.engagement}%</td>
                <td className="px-4 py-3 text-sm">
                  {(c.reach / 1000).toFixed(0)}K
                </td>
                <td className="px-4 py-3 text-sm">{c.roas}x</td>
                <td className="px-4 py-3 text-sm">
                  <Badge
                    variant={c.status === "En ejecución" ? "secondary" : c.status === "Programada" ? "default" : c.status === "Borrador" ? "outline" : "destructive"}
                  >
                    {c.status}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-sm flex space-x-2">
                  <Button variant="ghost" size="xs" className="h-8">
                    <Eye className="h-3 w-3" /> Ver
                  </Button>
                  <Button variant="outline" size="xs" className="h-8">
                    <BarChart3 className="h-3 w-3" /> Reporte
                  </Button>
                  <Button variant="outline" size="xs" className="h-8">
                    <DollarSign className="h-3 w-3" /> Pago
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Métricas agregadas de campañas (KPIs) */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="h-[120px]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Inversión Total</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">En todas las campañas</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-2xl font-display font-bold">$6.000</p>
          </CardContent>
          <CardFooter className="pt-2 text-xs text-muted-foreground">
            +18% vs período anterior
          </CardFooter>
        </Card>
        <Card className="h-[120px]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Alcance Total</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">Impresiones reales</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-2xl font-display font-bold">350K</p>
          </CardContent>
          <CardFooter className="pt-2 text-xs text-muted-foreground">
            +24% vs período anterior
          </CardFooter>
        </Card>
        <Card className="h-[120px]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Conversiones</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">Ventas atribuidas</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-2xl font-display font-bold">180</p>
          </CardContent>
          <CardFooter className="pt-2 text-xs text-muted-foreground">
            +31% vs período anterior
          </CardFooter>
        </Card>
        <Card className="h-[120px]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">ROAS Promedio</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">Return on Ad Spend</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-2xl font-display font-bold">5.5x</p>
          </CardContent>
          <CardFooter className="pt-2 text-xs text-muted-foreground">
            +0.7 vs período anterior
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}

/** Icono de ojo para ver detalles (se puede reemplazar por el ícono real de lucide) */
const Eye = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="lucide lucide-eye"
  >
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"></path>
    <circle cx="12" cy="12" r="3"></circle>
  </svg>
);