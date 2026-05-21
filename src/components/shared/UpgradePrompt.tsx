import { Link } from 'react-router-dom';
import { Zap, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  title: string;
  description: string;
  currentPlan?: string | null;
  /** If provided, shows inline inside content. Otherwise renders a full card. */
  inline?: boolean;
}

export default function UpgradePrompt({ title, description, currentPlan, inline }: Props) {
  if (inline) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Lock className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
        <Link to="/pricing" className="shrink-0">
          <Button size="sm" className="h-8 text-xs gradient-gold text-primary-foreground">
            <Zap className="w-3 h-3 mr-1" />Actualizar
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center max-w-sm mx-auto">
      <div className="w-16 h-16 rounded-[10px] bg-primary/10 border border-primary/20 flex items-center justify-center mb-5">
        <Lock className="w-7 h-7 text-primary" />
      </div>
      <h3 className="text-xl font-display font-bold mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground mb-2">{description}</p>
      {currentPlan && (
        <p className="text-xs text-muted-foreground/60 mb-6">Plan actual: <span className="font-medium">{currentPlan}</span></p>
      )}
      <Link to="/pricing">
        <Button className="gradient-gold text-primary-foreground font-semibold shadow-gold">
          <Zap className="w-4 h-4 mr-2" />Ver planes de upgrade
        </Button>
      </Link>
    </div>
  );
}
