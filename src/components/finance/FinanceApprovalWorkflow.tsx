/**
 * FinanceApprovalWorkflow — Workflow de solicitud a aprobación para Finance
 *
 * Features:
 * - Pipeline de solicitudes
 * - Políticas versionadas
 * - Presupuestos
 * - Aprobaciones pendientes
 * - Alertas de sobre-presupuesto
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Clock, CheckCircle, XCircle, AlertTriangle, DollarSign, FileText, User, Calendar, ArrowRight, Eye, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Request {
  id: string;
  title: string;
  requester: string;
  amount: number;
  category: string;
  status: "pending" | "approved" | "rejected";
  date: string;
  priority: "high" | "medium" | "low";
}

const REQUESTS: Request[] = [
  { id: "1", title: "Compra de mercadería", requester: "Juan Pérez", amount: 5000, category: "Inventario", status: "pending", date: "2026-09-07", priority: "high" },
  { id: "2", title: "Gasto de marketing", requester: "María García", amount: 1200, category: "Marketing", status: "pending", date: "2026-09-06", priority: "medium" },
  { id: "3", title: "Servicio técnico", requester: "Carlos López", amount: 800, category: "Servicios", status: "approved", date: "2026-09-05", priority: "low" },
  { id: "4", title: "Renovación de software", requester: "Ana Martínez", amount: 2500, category: "Software", status: "rejected", date: "2026-09-04", priority: "medium" },
];

interface Budget {
  id: string;
  name: string;
  allocated: number;
  spent: number;
  available: number;
  center: string;
}

const BUDGETS: Budget[] = [
  { id: "1", name: "Marketing Q3", allocated: 10000, spent: 7500, available: 2500, center: "Marketing" },
  { id: "2", name: "Inventario Q3", allocated: 50000, spent: 32000, available: 18000, center: "Operaciones" },
  { id: "3", name: "Servicios Q3", allocated: 5000, spent: 4200, available: 800, center: "Administración" },
];

function RequestCard({ request }: { request: Request }) {
  const statusColors = {
    pending: "bg-amber-500/10 text-amber-700 border-amber-500/25",
    approved: "bg-emerald-500/10 text-emerald-700 border-emerald-500/25",
    rejected: "bg-destructive/10 text-destructive border-destructive/20",
  };

  const statusIcons = {
    pending: Clock,
    approved: CheckCircle,
    rejected: XCircle,
  };

  const StatusIcon = statusIcons[request.status];

  return (
    <Card className="hover:border-primary/30 transition-colors">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-sm font-medium">{request.title}</CardTitle>
            <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
              <User className="h-3 w-3" />
              <span>{request.requester}</span>
              <span>•</span>
              <Calendar className="h-3 w-3" />
              <span>{request.date}</span>
            </div>
          </div>
          <Badge variant="secondary" className={cn("text-[10px]", statusColors[request.status])}>
            <StatusIcon className="h-3 w-3 mr-1" />
            {request.status === "pending" ? "Pendiente" : request.status === "approved" ? "Aprobado" : "Rechazado"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Monto</span>
          <span className="text-lg font-bold">${request.amount.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Categoría</span>
          <Badge variant="outline" className="text-[10px]">{request.category}</Badge>
        </div>
        {request.status === "pending" && (
          <div className="flex gap-2 pt-2">
            <Button size="sm" variant="outline" className="flex-1 h-8">
              <Eye className="h-3 w-3 mr-1" />
              Ver
            </Button>
            <Button size="sm" className="flex-1 h-8 bg-emerald-600 hover:bg-emerald-700">
              <Check className="h-3 w-3 mr-1" />
              Aprobar
            </Button>
            <Button size="sm" variant="destructive" className="flex-1 h-8">
              <X className="h-3 w-3 mr-1" />
              Rechazar
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BudgetCard({ budget }: { budget: Budget }) {
  const percentage = (budget.spent / budget.allocated) * 100;
  const isOverBudget = percentage > 90;
  const isExceeded = percentage > 100;

  return (
    <Card className={cn(isExceeded ? "border-destructive/50" : "")}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-sm font-medium">{budget.name}</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">{budget.center}</p>
          </div>
          {isOverBudget && (
            <Badge variant="destructive" className="text-[10px]">
              <AlertTriangle className="h-3 w-3 mr-1" />
              {isExceeded ? "Excedido" : "Crítico"}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Asignado</span>
          <span className="text-sm font-medium">${budget.allocated.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Gastado</span>
          <span className="text-sm font-medium">${budget.spent.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Disponible</span>
          <span className={cn("text-sm font-bold", isExceeded ? "text-destructive" : "")}>
            ${budget.available.toLocaleString()}
          </span>
        </div>
        <Progress value={Math.min(percentage, 100)} className={cn("h-2", isOverBudget ? "bg-destructive" : "")} />
        <p className="text-xs text-muted-foreground text-right">{percentage.toFixed(1)}% gastado</p>
      </CardContent>
    </Card>
  );
}

export default function FinanceApprovalWorkflow() {
  const pendingRequests = REQUESTS.filter(r => r.status === "pending");
  const approvedRequests = REQUESTS.filter(r => r.status === "approved");
  const rejectedRequests = REQUESTS.filter(r => r.status === "rejected");

  return (
    <div className="space-y-6">
      <Tabs defaultValue="requests" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="requests">Solicitudes</TabsTrigger>
          <TabsTrigger value="budgets">Presupuestos</TabsTrigger>
        </TabsList>

        {/* Solicitudes */}
        <TabsContent value="requests" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Solicitudes de Gasto</h3>
            <Button size="sm" className="gap-2">
              <FileText className="h-4 w-4" />
              Nueva Solicitud
            </Button>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {pendingRequests.map(request => (
              <RequestCard key={request.id} request={request} />
            ))}
          </div>

          {approvedRequests.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-3">Aprobadas recientemente</h4>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {approvedRequests.map(request => (
                  <RequestCard key={request.id} request={request} />
                ))}
              </div>
            </div>
          )}

          {rejectedRequests.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-3">Rechazadas recientemente</h4>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {rejectedRequests.map(request => (
                  <RequestCard key={request.id} request={request} />
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        {/* Presupuestos */}
        <TabsContent value="budgets" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Presupuestos por Centro de Costo</h3>
            <Button size="sm" variant="outline" className="gap-2">
              <DollarSign className="h-4 w-4" />
              Crear Presupuesto
            </Button>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {BUDGETS.map(budget => (
              <BudgetCard key={budget.id} budget={budget} />
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Alertas de Presupuesto
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50/50 dark:bg-amber-950/50">
                  <div className="h-2 w-2 rounded-full bg-amber-500 mt-2" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Marketing Q3 está al 75% del presupuesto</p>
                    <p className="text-xs text-muted-foreground mt-1">Considera aprobar nuevas solicitudes con cautela</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50/50 dark:bg-amber-950/50">
                  <div className="h-2 w-2 rounded-full bg-amber-500 mt-2" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Servicios Q3 está al 84% del presupuesto</p>
                    <p className="text-xs text-muted-foreground mt-1">Revisa gastos pendientes antes de aprobar nuevos</p>
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
