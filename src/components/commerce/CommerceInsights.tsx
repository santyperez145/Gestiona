/**
 * CommerceInsights — Insights inteligentes para el dashboard de Commerce
 *
 * Diseño moderno con insights y recomendaciones del negocio
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles, TrendingUp, AlertCircle, CheckCircle2, Lightbulb } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface Insight {
  type: "opportunity" | "warning" | "success" | "info";
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface CommerceInsightsProps {
  insights: Insight[];
  title?: string;
}

const typeIcons = {
  opportunity: Lightbulb,
  warning: AlertCircle,
  success: CheckCircle2,
  info: TrendingUp,
};

const typeColors = {
  opportunity: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30",
  warning: "bg-red-500/10 text-red-600 border-red-500/30",
  success: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  info: "bg-blue-500/10 text-blue-600 border-blue-500/30",
};

export default function CommerceInsights({
  insights,
  title = "Insights Inteligentes",
}: CommerceInsightsProps) {
  if (insights.length === 0) {
    return (
      <Card className="border-border/50 shadow-lg">
        <CardContent className="p-6 text-center">
          <div className="flex flex-col items-center gap-3">
            <div className="p-3 rounded-full bg-emerald-500/10">
              <CheckCircle2 className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <p className="font-semibold text-emerald-600">Todo en orden</p>
              <p className="text-sm text-muted-foreground mt-1">No hay insights en este momento</p>
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
          <Sparkles className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {insights.map((insight, index) => {
            const Icon = typeIcons[insight.type];
            const colorClass = typeColors[insight.type];

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
                      <p className="font-semibold text-sm">{insight.title}</p>
                      <Badge variant="secondary" className="text-xs shrink-0">
                        {insight.type}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{insight.description}</p>
                    {insight.action && (
                      <button
                        onClick={insight.action.onClick}
                        className="mt-2 text-xs font-medium text-primary hover:underline"
                      >
                        {insight.action.label} →
                      </button>
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
