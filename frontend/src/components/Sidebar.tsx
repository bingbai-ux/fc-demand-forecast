import { BarChart3, TrendingUp, Settings, ChevronLeft, ClipboardList, PieChart } from 'lucide-react';

export type MenuType = 'sales-analysis' | 'demand-forecast' | 'order-history' | 'order-analytics' | 'settings';

interface SidebarProps {
  currentMenu: MenuType;
  onMenuChange: (menu: MenuType) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({
  currentMenu,
  onMenuChange,
  isCollapsed,
  onToggleCollapse,
}: SidebarProps) {
  const menuItems = [
    { id: 'sales-analysis' as MenuType, label: '売上分析', icon: BarChart3 },
    { id: 'demand-forecast' as MenuType, label: '需要予測', icon: TrendingUp },
    { id: 'order-history' as MenuType, label: '発注履歴', icon: ClipboardList },
    { id: 'order-analytics' as MenuType, label: '発注分析', icon: PieChart },
    { id: 'settings' as MenuType, label: '設定', icon: Settings },
  ];

  return (
    <div 
      className={`sakiyomi-sidebar text-white h-screen flex-shrink-0 transition-all duration-300 flex flex-col ${
        isCollapsed ? 'w-16' : 'w-56'
      }`}
    >
      {/* ヘッダー - ロゴ */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-white/10">
        {!isCollapsed && (
          <img src="/sakiyomi_logo.png" alt="サキヨミ" className="h-8" />
        )}
        <button
          onClick={onToggleCollapse}
          className="p-1 hover:bg-white/10 rounded transition-colors"
        >
          <ChevronLeft 
            className={`w-5 h-5 transition-transform ${isCollapsed ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {/* メニュー */}
      <nav className="mt-2 flex-1">
        {menuItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onMenuChange(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-white/10 transition-colors ${
                currentMenu === item.id 
                  ? 'bg-white/10 border-l-4 border-[#0D4F4F]' 
                  : 'border-l-4 border-transparent'
              }`}
              title={isCollapsed ? item.label : undefined}
            >
              <Icon className="w-5 h-5" />
              {!isCollapsed && <span className="text-sm">{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* フッター（サイドバー展開時のみ） */}
      {!isCollapsed && (
        <div className="p-4 text-xs text-white/50 border-t border-white/10">
          FOOD&COMPANY
        </div>
      )}
    </div>
  );
}

export default Sidebar;
