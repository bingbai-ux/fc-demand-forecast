import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface StockoutProduct {
  productId: string;
  productName: string;
  abcRank: string;
  stockoutDays: number;
  avgDailySales: number;
  unitPrice: number;
  estimatedLoss: number;
}

interface StockoutAnalysisData {
  month: string;
  summary: {
    totalLoss: number;
    totalStockoutDays: number;
    totalProducts: number;
    stockoutRate: number;
    lossChangePercent: number;
    daysChangePercent: number;
  };
  byRank: Record<string, {
    count: number;
    days: number;
    loss: number;
    targetRate: number;
  }>;
  topStockoutProducts: StockoutProduct[];
  allStockoutProducts: StockoutProduct[];
}

interface StockoutCostDashboardProps {
  storeId: string;
  isOpen: boolean;
  onClose: () => void;
}

const rankColors: Record<string, string> = {
  A: '#ef4444',
  B: '#f97316',
  C: '#eab308',
  D: '#22c55e',
  E: '#6b7280',
};

const rankLabels: Record<string, string> = {
  A: '欠品厳禁',
  B: '原則欠品なし',
  C: 'バランス',
  D: '在庫圧縮OK',
  E: '最小在庫',
};

export const StockoutCostDashboard: React.FC<StockoutCostDashboardProps> = ({
  storeId,
  isOpen,
  onClose,
}) => {
  const [data, setData] = useState<StockoutAnalysisData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  
  useEffect(() => {
    if (isOpen && storeId) {
      fetchData();
    }
  }, [isOpen, storeId, selectedMonth]);
  
  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
      const response = await fetch(
        `${apiUrl}/api/forecast/stockout-analysis/${storeId}?month=${selectedMonth}`
      );
      const result = await response.json();
      if (result.success) {
        setData(result.data);
      } else {
        setError(result.error || 'データの取得に失敗しました');
      }
    } catch (err) {
      setError('APIエラーが発生しました');
    } finally {
      setLoading(false);
    }
  };
  
  if (!isOpen) return null;
  
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('ja-JP', {
      style: 'currency',
      currency: 'JPY',
      maximumFractionDigits: 0,
    }).format(value);
  };
  
  const chartData = data ? Object.entries(data.byRank).map(([rank, info]) => ({
    rank,
    loss: info.loss,
    count: info.count,
    days: info.days,
    targetRate: info.targetRate,
    label: rankLabels[rank] || rank,
  })) : [];
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-red-600 to-orange-600 text-white p-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <span className="text-2xl">📊</span>
              <h2 className="text-xl font-bold">欠品コスト分析ダッシュボード</h2>
            </div>
            <button
              onClick={onClose}
              className="text-white hover:bg-white/20 rounded p-1"
            >
              ✕
            </button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <label className="text-sm">対象月:</label>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="bg-white/20 border border-white/30 rounded px-2 py-1 text-white"
            />
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600"></div>
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded p-4 text-red-700">
              {error}
            </div>
          ) : data ? (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <div className="text-sm text-red-600">推定機会損失</div>
                  <div className="text-2xl font-bold text-red-700">
                    {formatCurrency(data.summary.totalLoss)}
                  </div>
                  <div className={`text-sm ${data.summary.lossChangePercent < 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {data.summary.lossChangePercent > 0 ? '+' : ''}{data.summary.lossChangePercent}% 前月比
                  </div>
                </div>
                
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                  <div className="text-sm text-orange-600">欠品延べ日数</div>
                  <div className="text-2xl font-bold text-orange-700">
                    {data.summary.totalStockoutDays}日
                  </div>
                  <div className={`text-sm ${data.summary.daysChangePercent < 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {data.summary.daysChangePercent > 0 ? '+' : ''}{data.summary.daysChangePercent}% 前月比
                  </div>
                </div>
                
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <div className="text-sm text-yellow-600">欠品商品数</div>
                  <div className="text-2xl font-bold text-yellow-700">
                    {data.summary.totalProducts}件
                  </div>
                </div>
                
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <div className="text-sm text-gray-600">欠品率</div>
                  <div className="text-2xl font-bold text-gray-700">
                    {data.summary.stockoutRate}%
                  </div>
                </div>
              </div>
              
              {/* Chart: Loss by Rank */}
              <div className="bg-white border rounded-lg p-4 mb-6">
                <h3 className="font-semibold mb-4">ABCランク別 機会損失</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" tickFormatter={(v) => `¥${(v / 1000).toFixed(0)}K`} />
                      <YAxis type="category" dataKey="rank" width={30} />
                      <Tooltip
                        formatter={(value) => formatCurrency(value as number)}
                        labelFormatter={(label) => `ランク ${label}: ${rankLabels[label as string] || ''}`}
                      />
                      <Bar dataKey="loss" name="機会損失">
                        {chartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={rankColors[entry.rank] || '#6b7280'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              
              {/* Rank Summary Table */}
              <div className="bg-white border rounded-lg p-4 mb-6">
                <h3 className="font-semibold mb-4">ランク別サマリー</h3>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left">ランク</th>
                      <th className="px-3 py-2 text-right">欠品商品数</th>
                      <th className="px-3 py-2 text-right">欠品日数</th>
                      <th className="px-3 py-2 text-right">機会損失</th>
                      <th className="px-3 py-2 text-right">目標欠品率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(data.byRank).map(([rank, info]) => (
                      <tr key={rank} className="border-t">
                        <td className="px-3 py-2">
                          <span
                            className="inline-block w-6 h-6 rounded text-white text-center text-sm font-bold mr-2"
                            style={{ backgroundColor: rankColors[rank] }}
                          >
                            {rank}
                          </span>
                          {rankLabels[rank]}
                        </td>
                        <td className="px-3 py-2 text-right">{info.count}件</td>
                        <td className="px-3 py-2 text-right">{info.days}日</td>
                        <td className="px-3 py-2 text-right font-medium">{formatCurrency(info.loss)}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{info.targetRate}%以下</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              {/* Top Stockout Products */}
              <div className="bg-white border rounded-lg p-4">
                <h3 className="font-semibold mb-4">機会損失上位商品</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left">商品名</th>
                        <th className="px-3 py-2 text-center">ランク</th>
                        <th className="px-3 py-2 text-right">欠品日数</th>
                        <th className="px-3 py-2 text-right">日平均売上</th>
                        <th className="px-3 py-2 text-right">単価</th>
                        <th className="px-3 py-2 text-right">機会損失</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topStockoutProducts.map((product, index) => (
                        <tr key={product.productId} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="px-3 py-2 truncate max-w-xs">{product.productName}</td>
                          <td className="px-3 py-2 text-center">
                            <span
                              className="inline-block w-6 h-6 rounded text-white text-center text-sm font-bold"
                              style={{ backgroundColor: rankColors[product.abcRank] }}
                            >
                              {product.abcRank}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">{product.stockoutDays}日</td>
                          <td className="px-3 py-2 text-right">{product.avgDailySales}個</td>
                          <td className="px-3 py-2 text-right">{formatCurrency(product.unitPrice)}</td>
                          <td className="px-3 py-2 text-right font-medium text-red-600">
                            {formatCurrency(product.estimatedLoss)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : null}
        </div>
        
        {/* Footer */}
        <div className="border-t p-4 bg-gray-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};

export default StockoutCostDashboard;
