import type { Store, PeriodUnit } from '../types';
import { DateRangePicker } from './DateRangePicker';

interface StorePeriodSelectorProps {
  stores: Store[];
  selectedStores: string[];
  onStoreChange: (storeIds: string[]) => void;
  fromDate: string;
  toDate: string;
  periodUnit: PeriodUnit;
  onFromDateChange: (date: string) => void;
  onToDateChange: (date: string) => void;
  onPeriodUnitChange: (unit: PeriodUnit) => void;
}

export function StorePeriodSelector({
  stores,
  selectedStores,
  onStoreChange,
  fromDate,
  toDate,
  periodUnit,
  onFromDateChange,
  onToDateChange,
  onPeriodUnitChange,
}: StorePeriodSelectorProps) {
  const allSelected = selectedStores.length === stores.length;

  const handleToggleAll = () => {
    if (allSelected) {
      onStoreChange([]);
    } else {
      onStoreChange(stores.map(s => s.storeId));
    }
  };

  const handleToggleStore = (storeId: string) => {
    if (selectedStores.includes(storeId)) {
      onStoreChange(selectedStores.filter(id => id !== storeId));
    } else {
      onStoreChange([...selectedStores, storeId]);
    }
  };

  // 店舗名を短縮表示
  const getShortName = (storeName: string): string => {
    if (storeName.includes('ニュウマン新宿')) return '新宿';
    if (storeName.includes('湘南')) return '湘南';
    if (storeName.includes('学芸大学')) return '学大';
    if (storeName.includes('代官山')) return '代官山';
    if (storeName.includes('YYYard cafe')) return 'YYcafe';
    if (storeName.includes('YYYard')) return 'YYYard';
    return storeName.slice(0, 6);
  };

  const periodUnits: { value: PeriodUnit; label: string }[] = [
    { value: 'day', label: '日次' },
    { value: 'week', label: '週次' },
    { value: 'month', label: '月次' },
  ];

  // 日付変更ハンドラー
  const handleDateChange = (from: string, to: string) => {
    onFromDateChange(from);
    onToDateChange(to);
  };

  // グラデーションスタイル
  const gradientStyle = { background: 'linear-gradient(90deg, #0D4F4F 0%, #1A365D 100%)' };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {/* 店舗選択 */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-gray-700">店舗:</span>
          <button
            onClick={handleToggleAll}
            className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
              allSelected
                ? 'text-white border-[#0D4F4F]'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
            style={allSelected ? gradientStyle : {}}
          >
            全店舗
          </button>
          {stores.map(store => (
            <label
              key={store.storeId}
              className="flex items-center gap-1.5 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selectedStores.includes(store.storeId)}
                onChange={() => handleToggleStore(store.storeId)}
                className="w-4 h-4 rounded border-gray-300 focus:ring-[#0D4F4F] accent-[#0D4F4F]"
              />
              <span className="text-sm text-gray-700" title={store.storeName}>
                {getShortName(store.storeName)}
              </span>
            </label>
          ))}
        </div>

        {/* 区切り線 */}
        <div className="hidden sm:block h-8 w-px bg-gray-300" />

        {/* 期間選択（スマレジ風DateRangePicker） */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">期間:</span>
          <DateRangePicker
            fromDate={fromDate}
            toDate={toDate}
            onDateChange={handleDateChange}
          />
        </div>

        {/* 区切り線 */}
        <div className="hidden sm:block h-8 w-px bg-gray-300" />

        {/* 表示単位 */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">表示単位:</span>
          <div className="flex items-center gap-3">
            {periodUnits.map(unit => (
              <label key={unit.value} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="periodUnit"
                  value={unit.value}
                  checked={periodUnit === unit.value}
                  onChange={() => onPeriodUnitChange(unit.value)}
                  className="w-4 h-4 border-gray-300 focus:ring-[#0D4F4F] accent-[#0D4F4F]"
                />
                <span className="text-sm text-gray-700">{unit.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
