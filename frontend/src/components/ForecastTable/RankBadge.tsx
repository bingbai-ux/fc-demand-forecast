import React from 'react';

interface RankBadgeProps {
  rank: 'A' | 'B' | 'C' | 'D' | 'E';
  className?: string;
  showLabel?: boolean;
}

/**
 * ABCランクバッジ（色分け強化版）
 * 画像の既存UIに合わせたデザイン
 */
export function RankBadge({ rank, className = '', showLabel = false }: RankBadgeProps) {
  const rankStyles = {
    A: {
      bg: 'bg-red-100',
      text: 'text-red-800',
      border: 'border-red-200',
      label: '最重要'
    },
    B: {
      bg: 'bg-orange-100',
      text: 'text-orange-800',
      border: 'border-orange-200',
      label: '重要'
    },
    C: {
      bg: 'bg-yellow-100',
      text: 'text-yellow-800',
      border: 'border-yellow-200',
      label: '標準'
    },
    D: {
      bg: 'bg-green-100',
      text: 'text-green-800',
      border: 'border-green-200',
      label: '低優先'
    },
    E: {
      bg: 'bg-gray-100',
      text: 'text-gray-600',
      border: 'border-gray-200',
      label: '最少'
    }
  };

  const style = rankStyles[rank];

  return (
    <span 
      className={`inline-flex items-center px-2 py-1 text-xs font-bold rounded border ${style.bg} ${style.text} ${style.border} ${className}`}
      title={`ABCランク: ${style.label}`}
    >
      {rank}
      {showLabel && (
        <span className="ml-1 font-normal text-[10px] opacity-75">{style.label}</span>
      )}
    </span>
  );
}
