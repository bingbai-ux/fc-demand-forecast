import React, { useState } from 'react';

interface StepPeriodSettingProps {
  orderDate: string;
  forecastDays: number;
  lookbackPeriod: string;
  customLookbackStart: string;
  customLookbackEnd: string;
  onOrderDateChange: (date: string) => void;
  onForecastDaysChange: (days: number) => void;
  onLookbackPeriodChange: (period: string) => void;
  onCustomLookbackChange: (start: string, end: string) => void;
  onBack: () => void;
  onNext: () => void;
  daysUntilOrder: number;
}

// 発注期間のオプション（拡張版）
const FORECAST_OPTIONS = [
  { value: 1, label: '1日' },
  { value: 3, label: '3日' },
  { value: 7, label: '1週間' },
  { value: 14, label: '2週間' },
  { value: 21, label: '3週間' },
  { value: 30, label: '1ヶ月' },
];

// 参照期間のオプション（拡張版）
const LOOKBACK_OPTIONS = [
  { value: '1week', label: '1週間', recommended: false },
  { value: '2weeks', label: '2週間', recommended: true },
  { value: '1month', label: '1ヶ月', recommended: false },
  { value: '3months', label: '3ヶ月', recommended: false },
];

const StepPeriodSetting: React.FC<StepPeriodSettingProps> = ({
  orderDate,
  forecastDays,
  lookbackPeriod,
  onOrderDateChange,
  onForecastDaysChange,
  onLookbackPeriodChange,
  onBack,
  onNext,
  daysUntilOrder,
}) => {
  const today = new Date().toISOString().split('T')[0];
  
  // 任意日数入力の状態管理
  const [showCustomForecast, setShowCustomForecast] = useState(false);
  const [customForecastDays, setCustomForecastDays] = useState('');
  const [showCustomLookback, setShowCustomLookback] = useState(false);
  const [customLookbackDays, setCustomLookbackDays] = useState('');
  
  // 発注期間が定義済みオプションに含まれているか確認
  const isCustomForecast = !FORECAST_OPTIONS.some(opt => opt.value === forecastDays) && forecastDays > 0;
  
  // 参照期間が定義済みオプションに含まれているか確認
  const isCustomLookback = lookbackPeriod.startsWith('custom_');
  
  // 任意の発注期間を適用
  const handleCustomForecastApply = () => {
    const days = parseInt(customForecastDays, 10);
    if (days > 0 && days <= 365) {
      onForecastDaysChange(days);
      setShowCustomForecast(false);
    }
  };
  
  // 任意の参照期間を適用
  const handleCustomLookbackApply = () => {
    const days = parseInt(customLookbackDays, 10);
    if (days > 0 && days <= 365) {
      onLookbackPeriodChange(`custom_${days}`);
      setShowCustomLookback(false);
    }
  };
  
  // カスタム参照期間の日数を取得
  const getCustomLookbackDays = (): number | null => {
    if (lookbackPeriod.startsWith('custom_')) {
      return parseInt(lookbackPeriod.replace('custom_', ''), 10);
    }
    return null;
  };
  
  return (
    <div className="space-y-8">
      {/* 発注日 */}
      <div>
        <h3 className="text-lg font-semibold text-gray-700 mb-3">発注日</h3>
        <div className="flex items-center gap-4">
          <input
            type="date"
            value={orderDate}
            min={today}
            onChange={(e) => onOrderDateChange(e.target.value)}
            className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0D4F4F]"
          />
          {daysUntilOrder > 0 && (
            <span className="text-sm text-[#0D4F4F]">
              ※ 今日から{daysUntilOrder}日後
            </span>
          )}
          {daysUntilOrder === 0 && (
            <span className="text-sm text-green-600">
              ※ 今日
            </span>
          )}
        </div>
      </div>
      
      {/* 発注期間 */}
      <div>
        <h3 className="text-lg font-semibold text-gray-700 mb-3">
          発注期間（何日分の在庫を発注？）
        </h3>
        <div className="flex flex-wrap gap-3">
          {FORECAST_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                onForecastDaysChange(option.value);
                setShowCustomForecast(false);
              }}
              className={`px-4 py-2 rounded-lg border-2 transition-all ${
                forecastDays === option.value && !isCustomForecast
                  ? 'border-[#0D4F4F] bg-[#0D4F4F]/10 text-[#0D4F4F]'
                  : 'border-gray-200 hover:border-gray-300 text-gray-600'
              }`}
            >
              {option.label}
            </button>
          ))}
          {/* 任意日数ボタン */}
          <button
            onClick={() => setShowCustomForecast(!showCustomForecast)}
            className={`px-4 py-2 rounded-lg border-2 transition-all ${
              isCustomForecast || showCustomForecast
                ? 'border-[#0D4F4F] bg-[#0D4F4F]/10 text-[#0D4F4F]'
                : 'border-gray-200 hover:border-gray-300 text-gray-600'
            }`}
          >
            {isCustomForecast ? `${forecastDays}日` : '任意'}
          </button>
        </div>
        
        {/* 任意日数入力フォーム */}
        {showCustomForecast && (
          <div className="mt-3 flex items-center gap-3">
            <input
              type="number"
              min="1"
              max="365"
              value={customForecastDays}
              onChange={(e) => setCustomForecastDays(e.target.value)}
              placeholder="日数を入力"
              className="w-32 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0D4F4F]"
            />
            <span className="text-gray-600">日</span>
            <button
              onClick={handleCustomForecastApply}
              disabled={!customForecastDays || parseInt(customForecastDays, 10) <= 0}
              className="px-4 py-2 text-white rounded-lg hover:opacity-90 disabled:bg-gray-300 disabled:cursor-not-allowed"
              style={{ background: 'linear-gradient(90deg, #0D4F4F 0%, #1A365D 100%)' }}
            >
              適用
            </button>
          </div>
        )}
      </div>
      
      {/* 参照期間 */}
      <div>
        <h3 className="text-lg font-semibold text-gray-700 mb-3">
          売上参照期間（予測に使う過去データ）
        </h3>
        <div className="flex flex-wrap gap-3">
          {LOOKBACK_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                onLookbackPeriodChange(option.value);
                setShowCustomLookback(false);
              }}
              className={`px-4 py-2 rounded-lg border-2 transition-all flex items-center gap-2 ${
                lookbackPeriod === option.value
                  ? 'border-[#0D4F4F] bg-[#0D4F4F]/10 text-[#0D4F4F]'
                  : 'border-gray-200 hover:border-gray-300 text-gray-600'
              }`}
            >
              {option.label}
              {option.recommended && (
                <span className="text-xs bg-green-500 text-white px-1.5 py-0.5 rounded font-medium">
                  推奨
                </span>
              )}
            </button>
          ))}
          {/* 任意日数ボタン */}
          <button
            onClick={() => setShowCustomLookback(!showCustomLookback)}
            className={`px-4 py-2 rounded-lg border-2 transition-all ${
              isCustomLookback || showCustomLookback
                ? 'border-[#0D4F4F] bg-[#0D4F4F]/10 text-[#0D4F4F]'
                : 'border-gray-200 hover:border-gray-300 text-gray-600'
            }`}
          >
            {isCustomLookback ? `${getCustomLookbackDays()}日` : '任意'}
          </button>
        </div>
        
        {/* 任意日数入力フォーム */}
        {showCustomLookback && (
          <div className="mt-3 flex items-center gap-3">
            <input
              type="number"
              min="1"
              max="365"
              value={customLookbackDays}
              onChange={(e) => setCustomLookbackDays(e.target.value)}
              placeholder="日数を入力"
              className="w-32 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0D4F4F]"
            />
            <span className="text-gray-600">日</span>
            <button
              onClick={handleCustomLookbackApply}
              disabled={!customLookbackDays || parseInt(customLookbackDays, 10) <= 0}
              className="px-4 py-2 text-white rounded-lg hover:opacity-90 disabled:bg-gray-300 disabled:cursor-not-allowed"
              style={{ background: 'linear-gradient(90deg, #0D4F4F 0%, #1A365D 100%)' }}
            >
              適用
            </button>
          </div>
        )}
        
        <p className="mt-2 text-sm text-gray-500">
          ※ 2週間参照が最も予測精度が高いことが検証で確認されています
        </p>
      </div>
      
      {/* ナビゲーションボタン */}
      <div className="flex justify-between pt-4">
        <button
          onClick={onBack}
          className="px-6 py-3 rounded-lg font-medium border border-gray-300 hover:bg-gray-50"
        >
          ← 戻る
        </button>
        <button
          onClick={onNext}
          className="px-6 py-3 rounded-lg font-medium text-white hover:opacity-90"
          style={{ background: 'linear-gradient(90deg, #0D4F4F 0%, #1A365D 100%)' }}
        >
          予測を実行 →
        </button>
      </div>
    </div>
  );
};

export default StepPeriodSetting;
