/**
 * CommerceRiskAnalysis — Análisis de riesgo para el dashboard de Commerce
 *
 * Diseño moderno con análisis de riesgo y mitigación
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Shield, CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

interface RiskMetric {
  label: string;
  level: "low" | "medium" | "high" | "critical";
  score: number; // 0-100
  description?: string;
  mitigation?: string;
}

interface CommerceRiskAnalysisProps {
  risks: RiskMetric[];
  title?: string;
}

const levelColors = {
  low: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30",
  medium: "text-yellow-600 bg-yellow-500/10 border-yellow-500/30",
  high: "text-red-600 bg-red-500/10 border-red-500/30",
  critical: "text-red-700 bg-red-600/20 border-red-600/40",
};

const levelIcons = {
  low: CheckCircle2,
  medium: AlertTriangle,
  high: XCircle,
  critical: XCircle,
};

export default function CommerceRiskAnalysis({
  risks,
  title = "Análisis de Riesgo",
}: CommerceRiskAnalysisProps) {
  const avgRisk = risks.reduce((sum, r) => sum + r.score, 0) / risks.length;
  const overallRisk = avgRisk <= 30 ? "low" : avgRisk <= 50 ? "medium" : avgRisk <= 70 ? "high" : "critical";
  const overallClass = levelColors[overallRisk];

  return (
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            {title}
          </CardTitle>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Riesgo promedio</p>
            <p className={`text-lg font-bold ${overallClass.split(' ')[0]}`}>
              {avgRisk.toFixed(0)}/100
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Overall risk status */}
          <div className={`p-3 rounded-lg border ${overallClass}`}>
            <div className="flex items-center gap-2">
              <Shield className={`h-5 w-5 ${overallClass.split(' ')[0]}`} />
              <div>
                <p className="font-semibold text-sm">
                  {overallRisk === "low" ? "Bajo" : overallRisk === "medium" ? "Medio" : overallRisk === "high" ? "Alto" : "Crítico"}
                </p>
                <p className="text-xs opacity-80">Nivel de riesgo general</p>
              </div>
            </div>
          </div>

          {/* Risks */}
          <div className="space-y-3">
            {risks.map((risk, index) => {
              const LevelIcon = levelIcons[risk.level];
              const levelClass = levelColors[risk.level];

              return (
                <div key={index} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <LevelIcon className={`h-4 w-4 ${levelClass.split(' ')[0]}`} />
                      <p className="font-medium text-sm">{risk.label}</p>
                    </div>
                    <Badge variant="secondary" className={`text-xs ${levelClass.split(' ')[0]}`}>
                      {risk.level === "low" ? "Bajo" : risk.level === "medium" ? "Medio" : risk.level === "high" ? "Alto" : "Crítico"}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{risk.score}/100</span>
                      {risk.description && (
                        <span className="text-muted-foreground">{risk.description}</span>
                      )}
                    </div>
                    <Progress value={risk.score} className="h-2" />
                    {risk.mitigation && (
                      <p className="text-xs text-muted-foreground mt-1">
                        <span className="font-medium">Mitigación:</span> {risk.mitigation}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
