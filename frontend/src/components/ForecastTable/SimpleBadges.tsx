/**
 * シンプルバッジコンポーネント
 * Tailwind競合を避けてインラインCSSのみ使用
 */

interface AlgorithmBadgeProps {
  algorithm: string;
}

export function AlgorithmBadge({ algorithm }: AlgorithmBadgeProps) {
  const isArima = algorithm === 'arima';
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
        fontWeight: 'bold'
      }}
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
        display: 'inline-block'
      }}
    >
      {rank}
    </span>
  );
}

interface OrderBreakdownProps {
  breakdown: string;
}

export function OrderBreakdown({ breakdown }: OrderBreakdownProps) {
  return (
    <span 
      style={{
        cursor: 'help',
        borderBottom: '1px dotted #9CA3AF'
      }}
      title={breakdown}
    >
      {breakdown.split(' = ')[1] || breakdown}
    </span>
  );
}
