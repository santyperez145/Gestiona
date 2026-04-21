import { useOrg } from '@/lib/orgContext';
import { Building2, Check, ChevronsUpDown, Crown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export default function OrgSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const { memberships, activeOrg, switchOrg } = useOrg();

  if (!activeOrg) return null;
  const single = memberships.length <= 1;

  if (single) {
    return (
      <div className={`flex items-center gap-2 px-2 py-1.5 rounded-lg bg-secondary/30 border border-border/30 ${collapsed ? 'justify-center' : ''}`}>
        <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        {!collapsed && <span className="text-[11px] font-medium text-muted-foreground truncate">{activeOrg.name}</span>}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost" size="sm"
          className={`w-full ${collapsed ? 'justify-center px-2' : 'justify-between'} h-auto py-1.5 hover:bg-secondary/50`}
          title={collapsed ? activeOrg.name : undefined}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Building2 className="w-3.5 h-3.5 text-primary shrink-0" />
            {!collapsed && <span className="text-[11px] font-medium truncate">{activeOrg.name}</span>}
          </div>
          {!collapsed && <ChevronsUpDown className="w-3 h-3 opacity-50 shrink-0" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Tus organizaciones</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {memberships.map(m => (
          <DropdownMenuItem
            key={m.org_id}
            onClick={() => switchOrg(m.org_id)}
            className="flex items-center gap-2 cursor-pointer"
          >
            {m.role === 'owner' && <Crown className="w-3.5 h-3.5 text-primary" />}
            {m.role !== 'owner' && <Building2 className="w-3.5 h-3.5 text-muted-foreground" />}
            <span className="flex-1 truncate">{m.organization.name}</span>
            <span className="text-[10px] text-muted-foreground capitalize">{m.role}</span>
            {m.org_id === activeOrg.id && <Check className="w-3.5 h-3.5 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}