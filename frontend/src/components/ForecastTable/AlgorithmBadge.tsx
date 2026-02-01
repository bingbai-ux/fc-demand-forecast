interface AlgorithmBadgeProps {
  algorithm: 'arima' | 'simple' | 'ensemble';
  className?: string;
}

/**
 * アルゴリズムバッジ（商品名横に小さく表示）
 * inline styleで確実にスタイル適用
 */
export function AlgorithmBadge({ algorithm, className = '' }: AlgorithmBadgeProps) {
  const styles = {
    arima: {
      bg: '#dcfce7',      // green-100
      text: '#166534',    // green-800
      icon: '🧠',
      label: 'ARIMA'
    },
    ensemble: {
      bg: '#f3e8ff',      // purple-100
      text: '#6b21a8',    // purple-800
      icon: '🔮',
      label: 'Ensemble'
    },
    simple: {
      bg: '#f3f4f6',      // gray-100
      text: '#4b5563',    // gray-600
      icon: '📊',
      label: 'Simple'
    }
  };

  const style = styles[algorithm] || styles.simple;

  return (
    <span 
      className={`inline-flex items-center ml-1 px-1.5 py-0.5 text-[10px] font-medium rounded ${className}`}
      style={{
        backgroundColor: style.bg,
        color: style.text
      }}
      title={`予測アルゴリズム: ${style.label}`}
    >
      <span className="mr-0.5">{style.icon}</span>
      {style.label}
    </span>
  );
}
