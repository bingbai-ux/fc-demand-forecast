import { useState, useRef, useEffect } from 'react';
import { Search, Settings, EyeOff, ChevronDown } from 'lucide-react';
import type { Category, FilterState } from '../types';

interface FilterBarProps {
  filters: FilterState;
  categories: Category[];
  suppliers: string[];
  hiddenProductCount: number;
  onFilterChange: (filters: FilterState) => void;
  onOpenCategorySettings: () => void;
  onOpenHiddenProducts: () => void;
}

// 複数選択ドロップダウンコンポーネント
function MultiSelect({
  label,
  options,
  selectedValues,
  onChange,
  getOptionLabel,
  getOptionValue,
}: {
  label: string;
  options: { label: string; value: string }[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
  getOptionLabel?: (option: { label: string; value: string }) => string;
  getOptionValue?: (option: { label: string; value: string }) => string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // クリック外で閉じる
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleOption = (value: string) => {
    if (selectedValues.includes(value)) {
      onChange(selectedValues.filter(v => v !== value));
    } else {
      onChange([...selectedValues, value]);
    }
  };

  const clearAll = () => {
    onChange([]);
  };

  const selectAll = () => {
    onChange(options.map(o => getOptionValue ? getOptionValue(o) : o.value));
  };

  const displayText = selectedValues.length === 0
    ? `${label}: 全て`
    : selectedValues.length === options.length
    ? `${label}: 全て`
    : `${label}: ${selectedValues.length}件選択`;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50 focus:ring-2 focus:ring-[#0D4F4F] focus:border-[#0D4F4F] min-w-[140px]"
      >
        <span className="flex-1 text-left truncate">{displayText}</span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg">
          {/* ヘッダー */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
            <button
              type="button"
              onClick={selectAll}
              className="text-xs text-[#0D4F4F] hover:text-[#0A3D3D]"
            >
              全て選択
            </button>
            <button
              type="button"
              onClick={clearAll}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              クリア
            </button>
          </div>

          {/* オプションリスト */}
          <div className="max-h-60 overflow-y-auto p-2">
            {options.map(option => {
              const value = getOptionValue ? getOptionValue(option) : option.value;
              const label = getOptionLabel ? getOptionLabel(option) : option.label;
              const isSelected = selectedValues.includes(value);

              return (
                <label
                  key={value}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-100 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleOption(value)}
                    className="w-4 h-4 border-gray-300 rounded focus:ring-[#0D4F4F] accent-[#0D4F4F]"
                  />
                  <span className="text-sm text-gray-700 truncate">{label}</span>
                </label>
              );
            })}
            {options.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-2">選択肢がありません</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function FilterBar({
  filters,
  categories,
  suppliers,
  hiddenProductCount,
  onFilterChange,
  onOpenCategorySettings,
  onOpenHiddenProducts,
}: FilterBarProps) {
  const stockFilters: { value: FilterState['stockFilter']; label: string }[] = [
    { value: 'all', label: '全て' },
    { value: 'inStock', label: '在庫あり' },
  ];

  // カテゴリオプション
  const categoryOptions = categories.map(cat => ({
    label: cat.categoryName,
    value: cat.categoryId,
  }));

  // 仕入先オプション
  const supplierOptions = suppliers.map(supplier => ({
    label: supplier,
    value: supplier,
  }));

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <div className="flex items-center gap-4 flex-wrap">
        {/* 検索 */}
        <div className="relative flex-1 min-w-[200px] max-w-[300px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="商品名・ブランド・カテゴリ・仕入先で検索"
            value={filters.search}
            onChange={(e) => onFilterChange({ ...filters, search: e.target.value })}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#0D4F4F] focus:border-[#0D4F4F]"
          />
        </div>

        {/* カテゴリ選択（複数選択） */}
        <MultiSelect
          label="カテゴリ"
          options={categoryOptions}
          selectedValues={filters.categoryIds}
          onChange={(values) => onFilterChange({ ...filters, categoryIds: values })}
        />

        {/* 仕入先選択（複数選択） */}
        <MultiSelect
          label="仕入先"
          options={supplierOptions}
          selectedValues={filters.supplierIds}
          onChange={(values) => onFilterChange({ ...filters, supplierIds: values })}
        />

        {/* 在庫フィルタ */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">在庫:</span>
          {stockFilters.map(filter => (
            <label key={filter.value} className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="stockFilter"
                value={filter.value}
                checked={filters.stockFilter === filter.value}
                onChange={() => onFilterChange({ ...filters, stockFilter: filter.value })}
                className="w-3.5 h-3.5 border-gray-300 focus:ring-[#0D4F4F] accent-[#0D4F4F]"
              />
              <span className="text-sm text-gray-700">{filter.label}</span>
            </label>
          ))}
        </div>

        {/* 売れ数なし除外フィルタ */}
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.excludeNoSales}
              onChange={(e) => onFilterChange({ ...filters, excludeNoSales: e.target.checked })}
              className="w-4 h-4 border-gray-300 rounded focus:ring-[#0D4F4F] accent-[#0D4F4F]"
            />
            <span className="text-sm text-gray-700">売れ数なしを除外</span>
          </label>
        </div>

        {/* 設定ボタン */}
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={onOpenCategorySettings}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
          >
            <Settings className="w-4 h-4" />
            カテゴリ設定
          </button>
          <button
            onClick={onOpenHiddenProducts}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
          >
            <EyeOff className="w-4 h-4" />
            非表示商品: {hiddenProductCount}件
          </button>
        </div>
      </div>
    </div>
  );
}
