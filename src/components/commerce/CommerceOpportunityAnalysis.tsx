/**
 * CommerceOpportunityAnalysis — Análisis de oportunidades para el dashboard de Commerce
 *
 * Diseño moderno con análisis de oportunidades y potencial
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Lightbulb, TrendingUp, Target, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Opportunity {
  title: string;
  description: string;
  potential: "high" | "medium" | "low";
  effort?: "high" | "medium" | "low";
  impact?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface CommerceOpportunityAnalysisProps {
  opportunities: Opportunity[];
  title?: string;
}

const potentialColors = {
  high: "bg-red-500/10 text-red-600 border-red-500/30",
  medium: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30",
  low: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
};

const effortColors = {
  high: "bg-red-500/10 text-red-600",
  medium: "bg-yellow-500/10 text-yellow-600",
  low: "bg-emerald-500/10 text-emerald-600",
};

export default function CommerceOpportunityAnalysis({
  opportunities,
  title = "Análisis de Oportunidades",
}: CommerceOpportunityAnalysisProps) {
  if (opportunities.length === 0) {
    return (
      <Card className="border-border/50 shadow-lg">
        <CardContent className="p-6 text-center">
          <div className="flex flex-col items-center gap-3">
            <div className="p-3 rounded-full bg-emerald-500/10">
              <CheckCircle2 className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <p className="font-semibold text-emerald-600">Sin oportunidades</p>
              <p className="text-sm text-muted-foreground mt-1">No hay oportunidades en este momento</p>
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
        <div className="space-y-4">
          {opportunities.map((opp, index) => {
            const potentialClass = potentialColors[opp.potential];
            const effortClass = opp.effort ? effortColors[opp.effort] : "";

            return (
              <div
                key={index}
                className={`p-4 rounded-lg border ${potentialClass} transition-all hover:shadow-md`}
              >
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg ${potentialClass.split(' ')[0]}`}>
                    <Lightbulb className={`h-4 w-4 ${potentialClass.split(' ')[1]}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-sm">{opp.title}</p>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className={`text-xs ${potentialClass.split(' ')[0]}`}>
                          {opp.potential === "high" ? "Alto" : opp.potential === "medium" ? "Medio" : "Bajo"} potencial
                        </Badge>
                        {opp.effort && (
                          <Badge className={`text-xs ${effortClass}`}>
                            {opp.effort === "high" ? "Alto" : opp.effort === "medium" ? "Medio" : "Bajo"} esfuerzo
                          </Badge>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{opp.description}</p>
                    {opp.impact && (
                      <p className="text-xs font-medium text-primary mt-2">
                        <Target className="h-3 w-3 inline mr-1" />
                        {opp.impact}
                      </p>
                    )}
                    {opp.action && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 h-8 text-xs"
                        onClick={opp.action.onClick}
                      >
                        {opp.action.label}
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
