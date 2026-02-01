import { X, Eye } from 'lucide-react';
import type { ProductTableData } from '../types';

interface HiddenProductsModalProps {
  isOpen: boolean;
  hiddenProducts: ProductTableData[];
  onClose: () => void;
  onRestoreProduct: (productId: string) => void;
  onRestoreAll: () => void;
}

export function HiddenProductsModal({
  isOpen,
  hiddenProducts,
  onClose,
  onRestoreProduct,
  onRestoreAll,
}: HiddenProductsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={onClose} />
        
        <div className="relative bg-white rounded-lg shadow-xl max-w-2xl w-full mx-auto z-10">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">
              非表示商品 ({hiddenProducts.length}件)
            </h3>
            <button
              onClick={onClose}
              className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="px-6 py-4">
            {hiddenProducts.length === 0 ? (
              <p className="text-center text-gray-500 py-8">
                非表示の商品はありません
              </p>
            ) : (
              <>
                <div className="flex justify-end mb-4">
                  <button
                    onClick={onRestoreAll}
                    className="px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded transition-colors"
                  >
                    すべて復元
                  </button>
                </div>

                <div className="max-h-96 overflow-y-auto border border-gray-200 rounded-lg">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                          商品名
                        </th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                          カテゴリ
                        </th>
                        <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">
                          操作
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {hiddenProducts.map(product => (
                        <tr key={product.productId} className="hover:bg-gray-50">
                          <td className="px-4 py-2 text-sm text-gray-900">
                            {product.productName}
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-600">
                            {product.categoryName}
                          </td>
                          <td className="px-4 py-2 text-center">
                            <button
                              onClick={() => onRestoreProduct(product.productId)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-sm text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            >
                              <Eye className="w-4 h-4" />
                              復元
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              閉じる
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
