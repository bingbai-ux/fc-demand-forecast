import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, ReferenceLine, Tooltip } from 'recharts';
import type { ProductTableData } from '../types';

interface InlineSalesChartProps {
  product: ProductTableData | null;
  fromDate: string;
  toDate: string;
}

// カスタムツールチップ
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 z-50" style={{ zIndex: 9999 }}>
        <p className="text-xs text-gray-500 mb-1">{label}</p>
        <p className="text-base font-bold text-[#0D4F4F]">売上数: {payload[0].value} 個</p>
      </div>
    );
  }
  return null;
};

export function InlineSalesChart({ product, fromDate, toDate }: InlineSalesChartProps) {
  if (!product) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 h-[200px] flex items-center justify-center">
        <p className="text-gray-400 text-sm">商品にカーソルを合わせるとグラフが表示されます</p>
      </div>
    );
  }

  // salesByDateを配列に変換
  const chartData = Object.entries(product.salesByDate)
    .map(([date, quantity]) => ({
      date,
      displayDate: date.slice(5), // MM-DD形式
      quantity,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // 平均値を計算
  const totalQuantity = chartData.reduce((sum, d) => sum + d.quantity, 0);
  const avgQuantity = chartData.length > 0 ? totalQuantity / chartData.length : 0;
  
  // 平均売上金額を計算
  const avgSales = chartData.length > 0 ? product.totalSales / chartData.length : 0;

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <div className="flex gap-6">
        {/* 商品情報 - 色付きカードで視認性向上 */}
        <div className="w-56 flex-shrink-0 border-r border-gray-200 pr-4">
          <h3 className="font-bold text-gray-900 text-base mb-3 line-clamp-2">{product.productName}</h3>
          
          {/* 情報カード */}
          <div className="grid grid-cols-2 gap-2">
            {/* 期間 */}
            <div className="col-span-2 bg-gray-100 rounded-lg p-2">
              <p className="text-xs text-gray-500">期間</p>
              <p className="text-sm font-medium text-gray-800">{fromDate.slice(5)} 〜 {toDate.slice(5)}</p>
            </div>
            
            {/* 合計売上数 */}
            <div className="bg-[#0D4F4F]/5 rounded-lg p-2 border border-[#0D4F4F]/20">
              <p className="text-xs text-[#0D4F4F]">合計売上数</p>
              <p className="text-lg font-bold text-[#0D4F4F]">{product.totalQuantity.toLocaleString()} <span className="text-sm font-normal">個</span></p>
            </div>
            
            {/* 日平均 */}
            <div className="bg-[#2D9D9D]/10 rounded-lg p-2 border border-[#2D9D9D]/30">
              <p className="text-xs text-[#2D9D9D]">日平均</p>
              <p className="text-lg font-bold text-[#2D9D9D]">{avgQuantity.toFixed(1)} <span className="text-sm font-normal">個</span></p>
            </div>
            
            {/* 売上金額 */}
            <div className="bg-[#1A365D]/5 rounded-lg p-2 border border-[#1A365D]/20">
              <p className="text-xs text-[#1A365D]">売上金額</p>
              <p className="text-sm font-bold text-[#1A365D]">¥{product.totalSales.toLocaleString()}</p>
            </div>
            
            {/* 平均売上金額（粗利率から変更） */}
            <div className="bg-[#0D4F4F]/5 rounded-lg p-2 border border-[#0D4F4F]/20">
              <p className="text-xs text-[#0D4F4F]">平均売上</p>
              <p className="text-sm font-bold text-[#0D4F4F]">¥{Math.round(avgSales).toLocaleString()}</p>
            </div>
          </div>
        </div>

        {/* グラフ */}
        <div className="flex-1 h-[180px]">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <XAxis
                  dataKey="displayDate"
                  tick={{ fontSize: 10, fill: '#6B7280' }}
                  tickLine={false}
                  axisLine={{ stroke: '#E5E7EB' }}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#6B7280' }}
                  tickLine={false}
                  axisLine={{ stroke: '#E5E7EB' }}
                  width={30}
                />
                <Tooltip 
                  content={<CustomTooltip />} 
                  cursor={{ stroke: '#94A3B8', strokeWidth: 1, strokeDasharray: '3 3' }}
                  wrapperStyle={{ zIndex: 9999 }}
                />
                <ReferenceLine
                  y={avgQuantity}
                  stroke="#2D9D9D"
                  strokeDasharray="3 3"
                  label={{ value: '平均', position: 'right', fontSize: 10, fill: '#2D9D9D' }}
                />
                <Line
                  type="monotone"
                  dataKey="quantity"
                  stroke="#0D4F4F"
                  strokeWidth={2}
                  dot={{ fill: '#0D4F4F', strokeWidth: 0, r: 3 }}
                  activeDot={{ fill: '#0D4F4F', strokeWidth: 0, r: 5 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm">
              売上データがありません
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
