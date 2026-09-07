/**
 * CommerceBusinessAlerts — Alertas de negocio para el dashboard de Commerce
 *
 * Diseño moderno con alertas importantes del negocio
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Bell, XCircle, AlertCircle, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface BusinessAlert {
  type: "critical" | "warning" | "info" | "success";
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  icon?: any;
}

interface CommerceBusinessAlertsProps {
  alerts: BusinessAlert[];
  title?: string;
  onDismiss?: (index: number) => void;
}

const typeColors = {
  critical: "bg-red-500/10 text-red-600 border-red-500/30",
  warning: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30",
  info: "bg-blue-500/10 text-blue-600 border-blue-500/30",
  success: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
};

const typeIcons = {
  critical: XCircle,
  warning: AlertTriangle,
  info: Bell,
  success: CheckCircle2,
};

export default function CommerceBusinessAlerts({
  alerts,
  title = "Alertas de Negocio",
  onDismiss,
}: CommerceBusinessAlertsProps) {
  if (alerts.length === 0) {
    return (
      <Card className="border-border/50 shadow-lg">
        <CardContent className="p-6 text-center">
          <div className="flex flex-col items-center gap-3">
            <div className="p-3 rounded-full bg-emerald-500/10">
              <CheckCircle2 className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <p className="font-semibold text-emerald-600">Sin alertas</p>
              <p className="text-sm text-muted-foreground mt-1">Todo está en orden</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            {title}
          </CardTitle>
          <Badge variant="destructive" className="text-xs">
            {alerts.length} alertas
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {alerts.map((alert, index) => {
            const Icon = typeIcons[alert.type];
            const colorClass = typeColors[alert.type];

            return (
              <div
                key={index}
                className={`p-4 rounded-lg border ${colorClass} transition-all hover:shadow-md`}
              >
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg ${colorClass.split(' ')[0]}`}>
                    <Icon className={`h-4 w-4 ${colorClass.split(' ')[1]}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-sm">{alert.title}</p>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs shrink-0">
                          {alert.type}
                        </Badge>
                        {onDismiss && (
                          <button
                            onClick={() => onDismiss(index)}
                            className="text-muted-foreground hover:text-foreground text-xs"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{alert.description}</p>
                    {alert.action && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 h-8 text-xs"
                        onClick={alert.action.onClick}
                      >
                        {alert.action.label}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
