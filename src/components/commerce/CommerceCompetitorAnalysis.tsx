/**
 * CommerceCompetitorAnalysis — Análisis de competencia para el dashboard de Commerce
 *
 * Diseño moderno con análisis de competencia y benchmarking
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, Users, ShoppingBag, Globe } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface Competitor {
  name: string;
  marketShare: number;
  growth: number;
  strength: string;
  weakness: string;
}

interface CommerceCompetitorAnalysisProps {
  competitors: Competitor[];
  title?: string;
}

export default function CommerceCompetitorAnalysis({
  competitors,
  title = "Análisis de Competencia",
}: CommerceCompetitorAnalysisProps) {
  return (
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {competitors.map((competitor, index) => (
            <div key={index} className="p-4 rounded-lg border border-border/50 hover:border-border transition-all hover:shadow-md">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Globe className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{competitor.name}</p>
                    <p className="text-xs text-muted-foreground">Competidor #{index + 1}</p>
                  </div>
                </div>
                <Badge variant="secondary" className="text-xs">
                  {competitor.marketShare}% market share
                </Badge>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-3 w-3 text-emerald-600" />
                  <p className="text-xs font-medium text-emerald-600">
                    {competitor.growth > 0 ? "+" : ""}
                    {competitor.growth}% crecimiento
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-muted-foreground font-medium">Fortaleza</p>
                    <p className="text-muted-foreground">{competitor.strength}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground font-medium">Debilidad</p>
                    <p className="text-muted-foreground">{competitor.weakness}</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
