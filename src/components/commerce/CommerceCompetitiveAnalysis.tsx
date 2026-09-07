/**
 * CommerceCompetitiveAnalysis — Análisis de competencia para el dashboard de Commerce
 *
 * Diseño moderno con análisis de competencia y benchmarking
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, TrendingUp, ShoppingBag, Globe, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

interface Competitor {
  name: string;
  marketShare: number;
  growth: number;
  strength: string;
  weakness: string;
  position: "leader" | "challenger" | "follower" | "niche";
}

interface CommerceCompetitiveAnalysisProps {
  competitors: Competitor[];
  title?: string;
}

const positionColors = {
  leader: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30",
  challenger: "text-yellow-600 bg-yellow-500/10 border-yellow-500/30",
  follower: "text-blue-600 bg-blue-500/10 border-blue-500/30",
  niche: "text-purple-600 bg-purple-500/10 border-purple-500/30",
};

export default function CommerceCompetitiveAnalysis({
  competitors,
  title = "Análisis de Competencia",
}: CommerceCompetitiveAnalysisProps) {
  const totalMarketShare = competitors.reduce((sum, c) => sum + c.marketShare, 0);

  return (
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            {title}
          </CardTitle>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Market share total</p>
            <p className="text-lg font-bold">{totalMarketShare.toFixed(1)}%</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {competitors.map((competitor, index) => {
            const positionClass = positionColors[competitor.position];

            return (
              <div key={index} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`p-2 rounded-lg ${positionClass.split(' ')[0]}`}>
                      <Globe className={`h-4 w-4 ${positionClass.split(' ')[0]}`} />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{competitor.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="secondary" className={`text-xs ${positionClass.split(' ')[0]}`}>
                          {competitor.position === "leader" ? "Líder" : competitor.position === "challenger" ? "Desafiante" : competitor.position === "follower" ? "Seguidor" : "Nicho"}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {competitor.marketShare}% market share
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-1 text-xs">
                      <TrendingUp className="h-3 w-3 text-emerald-600" />
                      <span className="text-emerald-600">
                        {competitor.growth > 0 ? "+" : ""}
                        {competitor.growth}%
                      </span>
                    </div>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {competitor.marketShare}% del mercado
                    </span>
                    <span className="font-semibold">{competitor.marketShare}%</span>
                  </div>
                  <Progress value={competitor.marketShare} className="h-2" />
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
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
