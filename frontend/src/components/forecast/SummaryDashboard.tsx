import type { ReactNode } from 'react';

interface SummaryMetrics {
  totalProducts: number;
  needCheck: number;
  stockout: number;
  urgentOrder: number;
  excessStock: number;
  estimatedStockoutCost: number;
}

interface SummaryDashboardProps {
  metrics: SummaryMetrics;
  onFilterClick?: (filterType: string) => void;
}

export function SummaryDashboard({ metrics, onFilterClick }: SummaryDashboardProps): ReactNode {
  const items = [
    {
      key: 'needCheck',
      label: '要確認',
      value: metrics.needCheck,
      color: '#F59E0B', // 黄
      bgColor: '#FEF3C7',
      tooltip: '予測信頼度70%未満の商品'
    },
    {
      key: 'stockout',
      label: '欠品中',
      value: metrics.stockout,
      color: '#EF4444', // 赤
      bgColor: '#FEE2E2',
      tooltip: '現在庫が安全在庫を割れている商品'
    },
    {
      key: 'urgentOrder',
      label: '発注急増',
      value: metrics.urgentOrder,
      color: '#8B5CF6', // 紫
      bgColor: '#EDE9FE',
      tooltip: '3日以内に欠品リスクがある商品'
    },
    {
      key: 'excessStock',
      label: '過剰在庫',
      value: metrics.excessStock,
      color: '#10B981', // 緑
      bgColor: '#D1FAE5',
      tooltip: '在庫が予測需要の2倍以上の商品'
    }
  ];

  return (
    <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#F9FAFB', borderRadius: '8px' }}>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        {items.map((item) => (
          <button
            key={item.key}
            onClick={() => onFilterClick?.(item.key)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 12px',
              backgroundColor: item.bgColor,
              border: `1px solid ${item.color}40`,
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 500
            }}
            title={item.tooltip}
          >
            <span style={{ color: item.color }}>{item.label}:</span>
            <span style={{ color: '#1F2937', fontWeight: 'bold' }}>{item.value}件</span>
          </button>
        ))}
        
        {metrics.estimatedStockoutCost > 0 && (
          <div 
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 12px',
              backgroundColor: '#FEE2E2',
              border: '1px solid #EF444440',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 500,
              color: '#991B1B'
            }}
            title="欠品による推定機会損失"
          >
            <span>推定欠品コスト:</span>
            <span style={{ fontWeight: 'bold' }}>
              ¥{metrics.estimatedStockoutCost.toLocaleString()}
            </span>
          </div>
        )}
        
        <div style={{ marginLeft: 'auto', fontSize: '12px', color: '#6B7280' }}>
          合計: {metrics.totalProducts}商品
        </div>
      </div>
    </div>
  );
}
