import { LucideIcon } from "lucide-react";
import { ReactNode } from "react";

export type WorkspaceViewTab = {
  id: string;
  label: string;
  icon: LucideIcon;
  count?: string | number;
};

type WorkspaceViewTabsProps = {
  tabs: WorkspaceViewTab[];
  activeTab: string;
  onChange: (tab: string) => void;
  ariaLabel: string;
  meta?: ReactNode;
};

export default function WorkspaceViewTabs({ tabs, activeTab, onChange, ariaLabel, meta }: WorkspaceViewTabsProps) {
  return (
    <div className="workspace-view-tabs" data-active-tab={activeTab}>
      <div className="workspace-view-tabs__list" role="tablist" aria-label={ariaLabel}>
        {tabs.map(({ id, label, icon: Icon, count }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            data-state={activeTab === id ? "active" : "inactive"}
            className={`workspace-view-tabs__tab ${activeTab === id ? "is-active" : ""}`}
            onClick={() => onChange(id)}
          >
            <Icon className="h-4 w-4" />
            <span>{label}</span>
            {count !== undefined && <span className="workspace-view-tabs__count">{count}</span>}
          </button>
        ))}
      </div>
      {meta && <div className="workspace-view-tabs__meta">{meta}</div>}
    </div>
  );
}
