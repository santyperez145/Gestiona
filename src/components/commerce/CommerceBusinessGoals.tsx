/**
 * CommerceBusinessGoals — Objetivos de negocio para el dashboard de Commerce
 *
 * Diseño moderno con objetivos y metas del negocio
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Target, TrendingUp, CheckCircle2, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

interface BusinessGoal {
  label: string;
  current: number;
  target: number;
  unit: string;
  status: "on-track" | "at-risk" | "completed" | "behind";
  deadline?: string;
}

interface CommerceBusinessGoalsProps {
  goals: BusinessGoal[];
  title?: string;
}

const statusColors = {
  "on-track": "text-emerald-600 bg-emerald-500/10 border-emerald-500/30",
  "at-risk": "text-yellow-600 bg-yellow-500/10 border-yellow-500/30",
  "completed": "text-green-600 bg-green-500/10 border-green-500/30",
  "behind": "text-red-600 bg-red-500/10 border-red-500/30",
};

const statusIcons = {
  "on-track": TrendingUp,
  "at-risk": AlertCircle,
  "completed": CheckCircle2,
  "behind": AlertCircle,
};

export default function CommerceBusinessGoals({
  goals,
  title = "Objetivos de Negocio",
}: CommerceBusinessGoalsProps) {
  return (
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {goals.map((goal, index) => {
            const progress = Math.min(100, (goal.current / goal.target) * 100);
            const StatusIcon = statusIcons[goal.status];
            const statusClass = statusColors[goal.status];

            return (
              <div key={index} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <StatusIcon className={`h-4 w-4 ${statusClass.split(' ')[0]}`} />
                    <p className="font-medium text-sm">{goal.label}</p>
                  </div>
                  <Badge variant="secondary" className={`text-xs ${statusClass.split(' ')[0]}`}>
                    {goal.status === "on-track" ? "En camino" : goal.status === "at-risk" ? "En riesgo" : goal.status === "completed" ? "Completado" : "Atrasado"}
                  </Badge>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {goal.current.toLocaleString()} / {goal.target.toLocaleString()} {goal.unit}
                    </span>
                    <span className="font-semibold">{progress.toFixed(0)}%</span>
                  </div>
                  <Progress value={progress} className="h-2" />
                  {goal.deadline && (
                    <p className="text-xs text-muted-foreground">Fecha límite: {goal.deadline}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
