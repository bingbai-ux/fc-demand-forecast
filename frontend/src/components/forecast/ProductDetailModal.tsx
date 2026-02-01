import React, { useState, useEffect } from 'react';
import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Area,
  ComposedChart,
  Bar,
} from 'recharts';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

interface ProductDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: any;
  storeId: string;
  onOrderQuantityChange: (productId: string, quantity: number) => void;
}

export const ProductDetailModal: React.FC<ProductDetailModalProps> = ({
  isOpen,
  onClose,
  product,
  storeId,
  onOrderQuantityChange,
}) => {
  const [detailData, setDetailData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [adjustedQuantity, setAdjustedQuantity] = useState(product?.recommendedOrder || 0);
  const [simulation, setSimulation] = useState<any[]>([]);
  
  // 詳細データを取得
  useEffect(() => {
    if (isOpen && product) {
      fetchProductDetail();
      setAdjustedQuantity(product.recommendedOrder || 0);
    }
  }, [isOpen, product]);
  
  // 発注数変更時にシミュレーションを再計算
  useEffect(() => {
    if (detailData) {
      runSimulation(adjustedQuantity);
    }
  }, [adjustedQuantity, detailData]);
  
  const fetchProductDetail = async () => {
    setLoading(true);
    try {
      const productId = product.productId || product.product_id;
      const response = await fetch(
        `${API_BASE_URL}/api/forecast/product-detail/${productId}?storeId=${storeId}&days=30`
      );
      const result = await response.json();
      
      if (result.success) {
        setDetailData(result.data);
        setSimulation(result.data.simulation || []);
      }
    } catch (error) {
      console.error('商品詳細取得エラー:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const runSimulation = async (orderQuantity: number) => {
    if (!detailData) return;
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/forecast/simulate-stock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentStock: detailData.currentStock,
          avgDailySales: detailData.avgDailySales,
          leadTime: detailData.leadTime,
          orderQuantity,
          safetyStock: product.safetyStock || 0,
          days: 14,
        }),
      });
      const result = await response.json();
      
      if (result.success) {
        setSimulation(result.simulation);
      }
    } catch (error) {
      console.error('シミュレーションエラー:', error);
    }
  };
  
  // 発注数調整
  const adjustQuantity = (delta: number) => {
    const lot = detailData?.orderLot || 1;
    const newQty = Math.max(0, adjustedQuantity + delta * lot);
    setAdjustedQuantity(newQty);
  };
  
  // 確定
  const handleConfirm = () => {
    const productId = product.productId || product.product_id;
    onOrderQuantityChange(productId, adjustedQuantity);
    onClose();
  };
  
  // 安定度の表示
  const getStabilityLabel = (cv: number) => {
    if (cv < 0.3) return { label: '安定', color: 'text-green-600' };
    if (cv < 0.7) return { label: 'やや不安定', color: 'text-yellow-600' };
    return { label: '不安定', color: 'text-red-600' };
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        {/* ヘッダー */}
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">
            商品詳細: {product?.productName || product?.product_name}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl"
          >
            ×
          </button>
        </div>
        
        {loading ? (
          <div className="p-12 text-center">読み込み中...</div>
        ) : detailData ? (
          <div className="p-6 space-y-6">
            {/* 基本情報カード */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-semibold text-gray-700 mb-3">📋 基本情報</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">ABCランク</span>
                    <span className="font-medium">
                      {product.rank}
                      <span className="text-gray-400 ml-1">
                        ({product.rank === 'A' ? '欠品厳禁' : 
                          product.rank === 'B' ? '原則欠品なし' :
                          product.rank === 'C' ? 'バランス' :
                          product.rank === 'D' ? '在庫圧縮OK' : '最小在庫'})
                      </span>
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">変動係数</span>
                    <span className={getStabilityLabel(detailData.coefficientOfVariation).color}>
                      {detailData.coefficientOfVariation.toFixed(2)}
                      （{getStabilityLabel(detailData.coefficientOfVariation).label}）
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">安全在庫</span>
                    <span>{product.safetyStock}個</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">日平均売上</span>
                    <span>{detailData.avgDailySales}個</span>
                  </div>
                </div>
              </div>
              
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-semibold text-gray-700 mb-3">📦 発注設定</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">発注ロット</span>
                    <span>{detailData.orderLot}個</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">リードタイム</span>
                    <span>{detailData.leadTime}日</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">仕入先</span>
                    <span>{detailData.supplierName || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">単価</span>
                    <span>¥{detailData.unitPrice?.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>
            
            {/* 売上推移グラフ */}
            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="font-semibold text-gray-700 mb-3">📈 過去30日の売上推移</h3>
              {detailData.salesHistory && detailData.salesHistory.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart data={detailData.salesHistory}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(v) => {
                      const d = new Date(v);
                      return `${d.getMonth() + 1}/${d.getDate()}`;
                    }}
                    fontSize={12}
                  />
                  <YAxis fontSize={12} />
                  <Tooltip
                    labelFormatter={(v) => {
                      const d = new Date(v);
                      return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
                    }}
                    formatter={(value, name) => {
                      if (name === 'quantity') return [value + '個', '販売数'];
                      return [value, name];
                    }}
                  />
                  <Bar 
                    dataKey="quantity" 
                    fill="#3B82F6" 
                    name="quantity"
                    opacity={0.7}
                  />
                  <Line
                    type="monotone"
                    dataKey="quantity"
                    stroke="#1D4ED8"
                    strokeWidth={2}
                    dot={false}
                    name="トレンド"
                  />
                  <ReferenceLine 
                    y={detailData.avgDailySales} 
                    stroke="#EF4444" 
                    strokeDasharray="5 5"
                    label={{ value: `平均 ${detailData.avgDailySales.toFixed(1)}`, fill: '#EF4444', fontSize: 12 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-gray-400">
                  グラフデータがありません
                </div>
              )}
              {detailData.stockoutDays > 0 && (
                <div className="mt-2 text-sm text-red-600">
                  ⚠️ 過去30日間で{detailData.stockoutDays}日の欠品がありました
                </div>
              )}
            </div>
            
            {/* 在庫シミュレーション */}
            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="font-semibold text-gray-700 mb-3">
                📦 在庫推移シミュレーション
                <span className="text-sm font-normal text-gray-500 ml-2">
                  （発注数: {adjustedQuantity}個の場合）
                </span>
              </h3>
              {simulation && simulation.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart data={simulation}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(v) => {
                      const d = new Date(v);
                      return `${d.getMonth() + 1}/${d.getDate()}`;
                    }}
                    fontSize={12}
                  />
                  <YAxis fontSize={12} />
                  <Tooltip
                    labelFormatter={(v) => {
                      const d = new Date(v);
                      return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
                    }}
                    formatter={(value, name) => {
                      if (name === 'stock') return [value + '個', '在庫数'];
                      return [value, name];
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="stock"
                    fill="#10B981"
                    stroke="#059669"
                    fillOpacity={0.3}
                    name="stock"
                  />
                  <ReferenceLine 
                    y={product.safetyStock || 0} 
                    stroke="#F59E0B" 
                    strokeDasharray="5 5"
                    label={{ value: '安全在庫', fill: '#F59E0B', fontSize: 12 }}
                  />
                  <ReferenceLine 
                    y={0} 
                    stroke="#EF4444" 
                    strokeWidth={2}
                  />
                </ComposedChart>
              </ResponsiveContainer>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-gray-400">
                  シミュレーションデータがありません
                </div>
              )}
              <div className="mt-2 flex gap-4 text-sm">
                <span className="text-gray-600">
                  現在庫: <strong>{detailData.currentStock}個</strong>
                </span>
                {simulation.some(s => s.stock <= 0) && (
                  <span className="text-red-600 font-medium">
                    ⚠️ このまま発注すると欠品が発生します
                  </span>
                )}
              </div>
            </div>
            
            {/* 欠品コスト */}
            {detailData.estimatedStockoutLoss > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <h3 className="font-semibold text-yellow-800 mb-2">💰 欠品コスト分析</h3>
                <div className="text-sm text-yellow-700">
                  <p>過去30日間の欠品日数: <strong>{detailData.stockoutDays}日</strong></p>
                  <p>推定機会損失: <strong>¥{detailData.estimatedStockoutLoss.toLocaleString()}</strong></p>
                  <p className="text-xs mt-1 text-yellow-600">
                    （計算式: 平均日販 {detailData.avgDailySales.toFixed(1)}個 × 単価 ¥{detailData.unitPrice?.toLocaleString()} × 欠品日数 {detailData.stockoutDays}日）
                  </p>
                </div>
              </div>
            )}
            
            {/* 発注数調整 */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="font-semibold text-blue-800 mb-3">🛒 発注数調整</h3>
              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-600">推奨: {product.recommendedOrder}個</span>
                <span className="text-gray-400">→</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => adjustQuantity(-1)}
                    className="w-10 h-10 bg-white border rounded hover:bg-gray-100 font-bold"
                  >
                    −{detailData.orderLot}
                  </button>
                  <button
                    onClick={() => setAdjustedQuantity(Math.max(0, adjustedQuantity - 1))}
                    className="w-8 h-10 bg-white border rounded hover:bg-gray-100"
                  >
                    −1
                  </button>
                  <input
                    type="number"
                    value={adjustedQuantity}
                    onChange={(e) => setAdjustedQuantity(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-20 h-10 border rounded text-center text-lg font-bold"
                  />
                  <button
                    onClick={() => setAdjustedQuantity(adjustedQuantity + 1)}
                    className="w-8 h-10 bg-white border rounded hover:bg-gray-100"
                  >
                    +1
                  </button>
                  <button
                    onClick={() => adjustQuantity(1)}
                    className="w-10 h-10 bg-white border rounded hover:bg-gray-100 font-bold"
                  >
                    +{detailData.orderLot}
                  </button>
                </div>
                <button
                  onClick={() => setAdjustedQuantity(product.recommendedOrder)}
                  className="px-3 py-2 text-sm text-blue-600 hover:underline"
                >
                  推奨に戻す
                </button>
              </div>
              <div className="mt-3 text-sm text-gray-600">
                発注金額: <strong>¥{(adjustedQuantity * detailData.unitPrice).toLocaleString()}</strong>
                {adjustedQuantity !== product.recommendedOrder && (
                  <span className="ml-2 text-blue-600">
                    （推奨比: {adjustedQuantity > product.recommendedOrder ? '+' : ''}
                    {adjustedQuantity - product.recommendedOrder}個）
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-12 text-center text-gray-500">
            データを取得できませんでした
          </div>
        )}
        
        {/* フッター */}
        <div className="sticky bottom-0 bg-white border-t px-6 py-4 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border rounded hover:bg-gray-100"
          >
            キャンセル
          </button>
          <button
            onClick={handleConfirm}
            className="px-6 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            確定
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProductDetailModal;
