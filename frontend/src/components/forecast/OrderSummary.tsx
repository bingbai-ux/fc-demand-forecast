import React from 'react';

interface SupplierGroup {
  supplierName: string;
  products: any[];
  totalOrderQuantity: number;
  totalOrderAmount: number;
  supplierSettings?: {
    leadTimeDays: number;
    minOrderAmount: number;
    freeShippingAmount: number | null;
    shippingFee: number;
    orderMethod: string;
    email: string;
  };
  orderConditions?: {
    meetsMinOrder: boolean;
    amountToMinOrder: number;
    meetsFreeShipping: boolean;
    amountToFreeShipping: number;
    estimatedArrival: string;
  };
}

interface OrderSummaryProps {
  supplierGroups: SupplierGroup[];
  orderQuantities: Record<string, number>;
  onBulkOrder: () => Promise<void>;
  isOrdering: boolean;
}

const OrderSummary: React.FC<OrderSummaryProps> = ({
  supplierGroups,
  orderQuantities,
  onBulkOrder,
  isOrdering,
}) => {
  // 発注可能な仕入先をフィルタリング
  const orderableGroups = supplierGroups.filter(group => {
    const currentTotalAmount = group.products.reduce((sum, p) => {
      const qty = orderQuantities[p.productId] ?? p.recommendedOrder;
      return sum + (qty * (p.cost || 0));
    }, 0);
    
    const minOrderAmount = group.supplierSettings?.minOrderAmount || 0;
    const meetsMinOrder = currentTotalAmount >= minOrderAmount;
    
    const hasOrderItems = group.products.some(p => 
      (orderQuantities[p.productId] ?? p.recommendedOrder) > 0
    );
    
    return meetsMinOrder && hasOrderItems;
  });

  // 合計金額を計算
  const totalAmount = orderableGroups.reduce((sum, group) => {
    const groupAmount = group.products.reduce((pSum, p) => {
      const qty = orderQuantities[p.productId] ?? p.recommendedOrder;
      return pSum + (qty * (p.cost || 0));
    }, 0);
    return sum + groupAmount;
  }, 0);

  // 合計商品数を計算
  const totalItems = orderableGroups.reduce((sum, group) => {
    return sum + group.products.filter(p => 
      (orderQuantities[p.productId] ?? p.recommendedOrder) > 0
    ).length;
  }, 0);

  // 発注合計数（個数）を計算
  const totalQuantity = orderableGroups.reduce((sum, group) => {
    return sum + group.products.reduce((pSum, p) => {
      const qty = orderQuantities[p.productId] ?? p.recommendedOrder;
      return pSum + qty;
    }, 0);
  }, 0);

  return (
    <div className="bg-white rounded-lg shadow-sm border p-4 sticky top-0 z-10">
      <div className="flex justify-between items-center">
        <div className="flex gap-6">
          <div>
            <span className="text-xs text-gray-500">発注対象</span>
            <p className="text-lg font-bold">
              {orderableGroups.length} <span className="text-sm font-normal text-gray-400">/ {supplierGroups.length}社</span>
            </p>
          </div>
          <div>
            <span className="text-xs text-gray-500">合計金額</span>
            <p className="text-lg font-bold text-[#0D4F4F]">¥{totalAmount.toLocaleString()}</p>
          </div>
          <div>
            <span className="text-xs text-gray-500">合計商品数</span>
            <p className="text-lg font-bold">{totalItems}点</p>
          </div>
          <div>
            <span className="text-xs text-gray-500">発注合計数</span>
            <p className="text-lg font-bold">{totalQuantity}個</p>
          </div>
        </div>

        <button
          onClick={onBulkOrder}
          disabled={orderableGroups.length === 0 || isOrdering}
          className={`px-5 py-2 rounded-lg font-bold ${
            orderableGroups.length > 0 && !isOrdering
              ? 'text-white hover:opacity-90'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }`}
          style={orderableGroups.length > 0 && !isOrdering ? { background: 'linear-gradient(90deg, #0D4F4F 0%, #1A365D 100%)' } : {}}
        >
          {isOrdering ? '発注中...' : `一括発注（${orderableGroups.length}社）`}
        </button>
      </div>
    </div>
  );
};

export default OrderSummary;
