import { RefreshCw, Package } from 'lucide-react';

interface HeaderProps {
  lastUpdated: string | null;
  stockUpdatedAt: string | null;
  isLoading: boolean;
  isUpdatingStock: boolean;
  needsRefresh?: boolean;
  onRefresh: () => void;
  onUpdateStock: () => void;
  onDisplayRefresh?: () => void;
}

export function Header({ 
  lastUpdated, 
  stockUpdatedAt, 
  isLoading, 
  isUpdatingStock,
  needsRefresh = false,
  onRefresh,
  onUpdateStock,
  onDisplayRefresh,
}: HeaderProps) {
  // 在庫更新日時をフォーマット
  const formatStockDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    try {
      const date = new Date(dateStr);
      return date.toLocaleString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return null;
    }
  };

  const formattedStockDate = formatStockDate(stockUpdatedAt);

  return (
    <header className="bg-white shadow-sm border-b border-gray-200">
      <div className="max-w-full mx-auto px-4 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-[#1A365D]">
          売上分析
        </h1>
        <div className="flex items-center gap-4">
          {/* 表示を更新ボタン（サキヨミグラデーション） */}
          {onDisplayRefresh && (
            <button
              onClick={onDisplayRefresh}
              disabled={isLoading || isUpdatingStock}
              className={`btn-sakiyomi-primary flex items-center gap-2 ${
                needsRefresh ? 'animate-pulse' : ''
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              表示を更新
              {needsRefresh && <span className="ml-1 text-xs bg-white/20 px-1.5 py-0.5 rounded">!</span>}
            </button>
          )}
          
          {/* 最終更新日時 */}
          {lastUpdated && (
            <span className="text-sm text-gray-500">
              最終更新: {lastUpdated}
            </span>
          )}
          
          {/* 区切り線 */}
          <div className="h-6 w-px bg-gray-300" />
          
          {/* 在庫データ情報と同期ボタン */}
          <div className="flex items-center gap-2 text-sm text-gray-600">
            {formattedStockDate && (
              <span>
                <span className="font-medium">在庫:</span> {formattedStockDate}
              </span>
            )}
            <button
              onClick={onUpdateStock}
              disabled={isUpdatingStock || isLoading}
              className="flex items-center gap-1 text-[#0D4F4F] hover:text-[#0A3D3D] hover:underline disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isUpdatingStock ? (
                <>
                  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  同期中...
                </>
              ) : (
                <>
                  <Package className="w-3 h-3" />
                  在庫を同期
                </>
              )}
            </button>
          </div>
          
          {/* 区切り線 */}
          <div className="h-6 w-px bg-gray-300" />
          
          {/* 売上データ同期ボタン（控えめに） */}
          <button
            onClick={onRefresh}
            disabled={isLoading || isUpdatingStock}
            className="flex items-center gap-1 text-sm text-gray-600 hover:text-[#1A365D] hover:underline disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
            売上を同期
          </button>
        </div>
      </div>
    </header>
  );
}
