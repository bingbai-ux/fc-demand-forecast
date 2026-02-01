import { useState } from 'react';

interface OrderBreakdownTooltipProps {
  breakdown: string;
  rank: string;
  safetyDays: number;
  algorithm: string;
  confidence: number;
}

/**
 * 発注内訳ツールチップ（詳細ボタン用）
 * 計算式の可視化
 */
export function OrderBreakdownTooltip({ 
  breakdown, 
  rank, 
  safetyDays, 
  algorithm,
  confidence 
}: OrderBreakdownTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);

  // breakdownパース: "予測61 + LT24 + 安全15 - 在庫10 - 発注済5 = 純需要85"
  const parts = breakdown.split(' = ');
  const calculation = parts[0]?.split(' - ').join('\n- ').split(' + ').join('+ ') || breakdown;
  const result = parts[1] || '';

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setIsOpen(!isOpen)}
        onBlur={() => setTimeout(() => setIsOpen(false), 200)}
        className="text-xs text-blue-600 hover:text-blue-800 underline focus:outline-none"
      >
        詳細
      </button>

      {isOpen && (
        <div className="absolute z-50 right-0 mt-2 w-72 p-4 bg-white rounded-lg shadow-xl border border-gray-200 text-sm">
          <div className="flex items-center justify-between mb-3 pb-2 border-b">
            <span className="font-bold text-gray-800">計算内訳</span>
            <span className={`px-2 py-0.5 text-xs rounded ${
              rank === 'A' ? 'bg-red-100 text-red-800' :
              rank === 'B' ? 'bg-orange-100 text-orange-800' :
              rank === 'C' ? 'bg-yellow-100 text-yellow-800' :
              rank === 'D' ? 'bg-green-100 text-green-800' :
              'bg-gray-100 text-gray-600'
            }`}>
              {rank}ランク
            </span>
          </div>

          <div className="space-y-2 text-gray-600 font-mono text-xs">
            {calculation.split('\n').map((line, i) => (
              <div key={i} className={line.startsWith('-') ? 'text-red-600' : 'text-green-600'}>
                {line}
              </div>
            ))}
          </div>

          <div className="mt-3 pt-2 border-t">
            <div className="flex justify-between items-center">
              <span className="font-bold text-blue-600">{result}</span>
              <span className="text-xs text-gray-500">
                信頼度: {Math.round(confidence * 100)}%
              </span>
            </div>
          </div>

          <div className="mt-3 pt-2 border-t text-xs text-gray-500 space-y-1">
            <div>アルゴリズム: {algorithm === 'arima' ? '🧠 ARIMA' : '📊 Simple'}</div>
            <div>安全在庫: {safetyDays}日分</div>
          </div>

          {/* 矢印 */}
          <div className="absolute -top-2 right-4 w-4 h-4 bg-white border-l border-t border-gray-200 transform rotate-45" />
        </div>
      )}
    </div>
  );
}

/**
 * 簡易版：ホバーで表示
 */
export function OrderBreakdownHover({ 
  breakdown, 
  rank, 
  safetyDays 
}: Omit<OrderBreakdownTooltipProps, 'algorithm' | 'confidence'>) {
  return (
    <div className="group relative inline-block">
      <span className="cursor-help border-b border-dotted border-gray-400">
        {breakdown.split(' = ')[1] || breakdown}
      </span>
      
      <div className="hidden group-hover:block absolute z-50 bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-64 p-3 bg-gray-800 text-white text-xs rounded shadow-lg">
        <div className="font-bold mb-1">{rank}ランク・安全在庫{safetyDays}日</div>
        <div className="font-mono">{breakdown}</div>
        <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-gray-800 rotate-45" />
      </div>
    </div>
  );
}
