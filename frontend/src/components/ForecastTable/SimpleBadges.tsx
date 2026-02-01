/**
 * シンプルバッジコンポーネント（ツールチップ付き）
 * Tailwind競合を避けてインラインCSSのみ使用
 */

interface AlgorithmBadgeProps {
  algorithm: string;
}

export function AlgorithmBadge({ algorithm }: AlgorithmBadgeProps) {
  const isArima = algorithm === 'arima';
  const tooltip = isArima 
    ? 'ARIMA: 時系列分析による高精度予測（季節性考慮）'
    : 'Simple: 過去平均に基づく標準予測';
    
  return (
    <span 
      style={{
        backgroundColor: isArima ? '#10B981' : '#6B7280',
        color: 'white',
        padding: '2px 6px',
        borderRadius: '4px',
        fontSize: '10px',
        marginLeft: '4px',
        display: 'inline-block',
        fontWeight: 'bold',
        cursor: 'help'
      }}
      title={tooltip}
    >
      {isArima ? '🧠ARIMA' : '📊Simple'}
    </span>
  );
}

interface RankBadgeProps {
  rank: string;
}

export function RankBadge({ rank }: RankBadgeProps) {
  const colors: {[key: string]: {bg: string, text: string, border: string}} = {
    'A': { bg: '#FEE2E2', text: '#991B1B', border: '#FECACA' }, // 赤
    'B': { bg: '#FFEDD5', text: '#9A3412', border: '#FDBA74' }, // 橙
    'C': { bg: '#FEF3C7', text: '#92400E', border: '#FDE68A' }, // 黄
    'D': { bg: '#D1FAE5', text: '#065F46', border: '#A7F3D0' }, // 緑
    'E': { bg: '#F3F4F6', text: '#4B5563', border: '#E5E7EB' }  // 灰
  };
  
  const color = colors[rank] || colors['E'];
  const tooltip = {
    'A': 'Aランク: 最重要品（売上上位40%）',
    'B': 'Bランク: 重要品（売上上位65%）',
    'C': 'Cランク: 標準品（売上上位80%）',
    'D': 'Dランク: 低優先品（売上上位92%）',
    'E': 'Eランク: 最少品（それ以下）'
  }[rank] || 'ランク情報なし';
  
  return (
    <span
      style={{
        backgroundColor: color.bg,
        color: color.text,
        padding: '4px 8px',
        borderRadius: '4px',
        fontWeight: 'bold',
        fontSize: '12px',
        border: `1px solid ${color.border}`,
        display: 'inline-block',
        cursor: 'help'
      }}
      title={tooltip}
    >
      {rank}
    </span>
  );
}

interface OrderBreakdownProps {
  breakdown: string;
  netDemand: number;
}

export function OrderBreakdown({ breakdown, netDemand }: OrderBreakdownProps) {
  return (
    <span 
      style={{
        cursor: 'help',
        borderBottom: '1px dotted #9CA3AF'
      }}
      title={breakdown}
    >
      純需要{netDemand}
    </span>
  );
}

interface AlertIconProps {
  alertFlags?: string[];
}

export function AlertIcon({ alertFlags }: AlertIconProps) {
  if (!alertFlags || alertFlags.length === 0) {
    return <span title="適正">🟢</span>;
  }
  
  const hasStockout = alertFlags.includes('stockout');
  const hasLowStock = alertFlags.includes('low_stock');
  const hasSurge = alertFlags.includes('order_surge');
  
  if (hasStockout) {
    return <span title="欠品中！">🔴</span>;
  }
  if (hasLowStock) {
    return <span title="在庫少">🟡</span>;
  }
  if (hasSurge) {
    return <span title="売上急増">📈</span>;
  }
  
  return <span title={alertFlags.join(', ')}>⚠️</span>;
}
