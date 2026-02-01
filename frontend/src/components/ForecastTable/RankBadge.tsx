interface RankBadgeProps {
  rank: 'A' | 'B' | 'C' | 'D' | 'E';
  className?: string;
  showLabel?: boolean;
}

/**
 * ABCランクバッジ（色分け強化版）
 * inline styleで確実に色を適用
 */
export function RankBadge({ rank, className = '', showLabel = false }: RankBadgeProps) {
  // inline styleで確実に色を適用（Tailwindクラスが効かない場合のフォールバック）
  const rankColors: Record<string, { bg: string; text: string; label: string }> = {
    A: { bg: '#fee2e2', text: '#991b1b', label: '最重要' },     // 赤
    B: { bg: '#ffedd5', text: '#9a3412', label: '重要' },       // 橙
    C: { bg: '#fef3c7', text: '#92400e', label: '標準' },       // 黄
    D: { bg: '#d1fae5', text: '#065f46', label: '低優先' },     // 緑
    E: { bg: '#f3f4f6', text: '#4b5563', label: '最少' }        // 灰
  };

  const colors = rankColors[rank];

  return (
    <span 
      className={`inline-flex items-center px-2 py-1 text-xs font-bold rounded border ${className}`}
      style={{
        backgroundColor: colors.bg,
        color: colors.text,
        borderColor: colors.text + '40'  // 40は透明度
      }}
      title={`ABCランク: ${colors.label}`}
    >
      {rank}
      {showLabel && (
        <span className="ml-1 font-normal text-[10px] opacity-75">{colors.label}</span>
      )}
    </span>
  );
}
