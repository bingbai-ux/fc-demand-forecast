import { X } from 'lucide-react';
import type { Category } from '../types';

interface CategorySettingsModalProps {
  isOpen: boolean;
  categories: Category[];
  excludedCategories: string[];
  onClose: () => void;
  onToggleCategory: (categoryId: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}

export function CategorySettingsModal({
  isOpen,
  categories,
  excludedCategories,
  onClose,
  onToggleCategory,
  onSelectAll,
  onDeselectAll,
}: CategorySettingsModalProps) {
  if (!isOpen) return null;

  const includedCount = categories.length - excludedCategories.length;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={onClose} />
        
        <div className="relative bg-white rounded-lg shadow-xl max-w-2xl w-full mx-auto z-10">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">
              カテゴリ表示設定
            </h3>
            <button
              onClick={onClose}
              className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="px-6 py-4">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-gray-600">
                {includedCount} / {categories.length} カテゴリを表示中
              </span>
              <div className="flex gap-2">
                <button
                  onClick={onSelectAll}
                  className="px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded transition-colors"
                >
                  すべて表示
                </button>
                <button
                  onClick={onDeselectAll}
                  className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded transition-colors"
                >
                  すべて非表示
                </button>
              </div>
            </div>

            <div className="max-h-96 overflow-y-auto border border-gray-200 rounded-lg">
              <div className="grid grid-cols-2 gap-1 p-2">
                {categories.map(category => (
                  <label
                    key={category.categoryId}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={!excludedCategories.includes(category.categoryId)}
                      onChange={() => onToggleCategory(category.categoryId)}
                      className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700 truncate" title={category.categoryName}>
                      {category.categoryName}
                    </span>
                  </label>
                ))}
              </div>
            </div>
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
