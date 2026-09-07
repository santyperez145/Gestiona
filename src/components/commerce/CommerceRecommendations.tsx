/**
 * CommerceRecommendations — Recomendaciones de negocio para el dashboard de Commerce
 *
 * Diseño moderno con recomendaciones inteligentes del negocio
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Lightbulb, TrendingUp, AlertCircle, CheckCircle2, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Recommendation {
  type: "opportunity" | "warning" | "success" | "info";
  title: string;
  description: string;
  impact?: "high" | "medium" | "low";
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface CommerceRecommendationsProps {
  recommendations: Recommendation[];
  title?: string;
}

const typeColors = {
  opportunity: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30",
  warning: "bg-red-500/10 text-red-600 border-red-500/30",
  success: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  info: "bg-blue-500/10 text-blue-600 border-blue-500/30",
};

const typeIcons = {
  opportunity: Lightbulb,
  warning: AlertCircle,
  success: CheckCircle2,
  info: Zap,
};

const impactColors = {
  high: "bg-red-500/10 text-red-600",
  medium: "bg-yellow-500/10 text-yellow-600",
  low: "bg-emerald-500/10 text-emerald-600",
};

export default function CommerceRecommendations({
  recommendations,
  title = "Recomendaciones Inteligentes",
}: CommerceRecommendationsProps) {
  if (recommendations.length === 0) {
    return (
      <Card className="border-border/50 shadow-lg">
        <CardContent className="p-6 text-center">
          <div className="flex flex-col items-center gap-3">
            <div className="p-3 rounded-full bg-emerald-500/10">
              <CheckCircle2 className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <p className="font-semibold text-emerald-600">Sin recomendaciones</p>
              <p className="text-sm text-muted-foreground mt-1">El negocio está en orden</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {recommendations.map((rec, index) => {
            const Icon = typeIcons[rec.type];
            const colorClass = typeColors[rec.type];
            const impactClass = rec.impact ? impactColors[rec.impact] : "";

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
                      <p className="font-semibold text-sm">{rec.title}</p>
                      <div className="flex items-center gap-2">
                        {rec.impact && (
                          <Badge className={`text-xs ${impactClass}`}>
                            {rec.impact === "high" ? "Alto" : rec.impact === "medium" ? "Medio" : "Bajo"} impacto
                          </Badge>
                        )}
                        <Badge variant="secondary" className="text-xs shrink-0">
                          {rec.type}
                        </Badge>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{rec.description}</p>
                    {rec.action && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 h-8 text-xs"
                        onClick={rec.action.onClick}
                      >
                        {rec.action.label}
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
