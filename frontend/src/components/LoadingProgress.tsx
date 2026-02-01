interface LoadingProgressProps {
  isLoading: boolean;
}

export function LoadingProgress({ isLoading }: LoadingProgressProps) {
  if (!isLoading) {
    return null;
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-center gap-3 mb-3">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
        <span className="text-base font-medium text-gray-700">
          データを読み込み中...
        </span>
      </div>
      
      {/* 注意書き */}
      <p className="text-sm text-gray-500 text-center">
        スマレジAPIからデータを取得しています。
      </p>
      <p className="text-sm text-amber-600 text-center mt-1">
        ※ 期間や店舗数によって時間がかかる場合があります
      </p>
    </div>
  );
}
