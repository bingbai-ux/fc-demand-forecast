import React from 'react';

interface AlgorithmBadgeProps {
  algorithm: 'arima' | 'simple' | 'ensemble';
  className?: string;
}

/**
 * アルゴリズムバッジ（商品名横に小さく表示）
 * 既存UIを崩さない最小限の表示
 */
export function AlgorithmBadge({ algorithm, className = '' }: AlgorithmBadgeProps) {
  const styles = {
    arima: {
      bg: 'bg-green-100',
      text: 'text-green-800',
      icon: '🧠',
      label: 'ARIMA'
    },
    ensemble: {
      bg: 'bg-purple-100',
      text: 'text-purple-800',
      icon: '🔮',
      label: 'Ensemble'
    },
    simple: {
      bg: 'bg-gray-100',
      text: 'text-gray-600',
      icon: '📊',
      label: 'Simple'
    }
  };

  const style = styles[algorithm] || styles.simple;

  return (
    <span 
      className={`inline-flex items-center ml-1.5 px-1.5 py-0.5 text-[10px] font-medium rounded ${style.bg} ${style.text} ${className}`}
      title={`予測アルゴリズム: ${style.label}`}
    >
      <span className="mr-0.5">{style.icon}</span>
      {style.label}
    </span>
  );
}
