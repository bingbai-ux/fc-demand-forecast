import { ChevronDown, ChevronUp, EyeOff } from 'lucide-react';
import type { ProductTableData, SortState, PeriodUnit } from '../types';
import { format, parseISO, startOfWeek, startOfMonth } from 'date-fns';
import { ja } from 'date-fns/locale';
import { useState, useEffect } from 'react';

interface DataTableProps {
  products: ProductTableData[];
  sortState: SortState;
  periodUnit: PeriodUnit;
  dateColumns: string[];
  totalDays: number;
  selectedProductId?: string | null;
  onSort: (column: string) => void;
  onHideProduct: (productId: string) => void;
  onShowChart?: (product: ProductTableData) => void;
  onSelectProduct?: (product: ProductTableData | null) => void;
}

export function DataTable({
  products,
  sortState,
  periodUnit,
  dateColumns,
  totalDays: _totalDays,
  selectedProductId,
  onSort,
  onHideProduct,
  onShowChart: _onShowChart,
  onSelectProduct,
}: DataTableProps) {
  // ========== 列幅リサイズ機能 ==========
  
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem('fc-column-widths');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const [resizing, setResizing] = useState<{
    columnId: string;
    startX: number;
    startWidth: number;
  } | null>(null);

  // デフォルト幅の定義
  const defaultWidths: Record<string, number> = {
    productName: 180,
    brandName: 140,
    categoryName: 160,
    supplierName: 160,
  };

  const getWidth = (columnId: string) => columnWidths[columnId] || defaultWidths[columnId] || 100;

  const onResizeStart = (e: React.MouseEvent, columnId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setResizing({
      columnId,
      startX: e.clientX,
      startWidth: getWidth(columnId),
    });
  };

  useEffect(() => {
    if (!resizing) return;

    const onMouseMove = (e: MouseEvent) => {
      const diff = e.clientX - resizing.startX;
      const newWidth = Math.max(80, resizing.startWidth + diff);
      setColumnWidths(prev => ({ ...prev, [resizing.columnId]: newWidth }));
    };

    const onMouseUp = () => {
      localStorage.setItem('fc-column-widths', JSON.stringify(columnWidths));
      setResizing(null);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [resizing, columnWidths]);

  // 日付カラムを集計単位に応じてグループ化
  const getAggregatedDateColumns = (): string[] => {
    if (periodUnit === 'day') {
      return dateColumns;
    }

    const grouped = new Set<string>();
    dateColumns.forEach(date => {
      const d = parseISO(date);
      if (periodUnit === 'week') {
        grouped.add(format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
      } else {
        grouped.add(format(startOfMonth(d), 'yyyy-MM'));
      }
    });
    return Array.from(grouped).sort();
  };

  const aggregatedColumns = getAggregatedDateColumns();

  // 日付カラムのラベル
  const getDateLabel = (date: string): string => {
    if (periodUnit === 'day') {
      const d = parseISO(date);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    } else if (periodUnit === 'week') {
      const d = parseISO(date);
      return `${d.getMonth() + 1}/${d.getDate()}週`;
    } else {
      return format(parseISO(date + '-01'), 'M月', { locale: ja });
    }
  };

  // 商品の日付別売上を集計
  const getAggregatedSales = (product: ProductTableData, column: string): number => {
    if (periodUnit === 'day') {
      return product.salesByDate[column] || 0;
    }

    let total = 0;
    Object.entries(product.salesByDate).forEach(([date, qty]) => {
      const d = parseISO(date);
      let key: string;
      if (periodUnit === 'week') {
        key = format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd');
      } else {
        key = format(startOfMonth(d), 'yyyy-MM');
      }
      if (key === column) {
        total += qty;
      }
    });
    return total;
  };

  // ソートアイコン
  const SortIcon = ({ column }: { column: string }) => {
    if (sortState.column !== column) {
      return <span className="w-4 h-4 inline-block" />;
    }
    return sortState.direction === 'asc' ? (
      <ChevronUp className="w-4 h-4 inline-block" />
    ) : (
      <ChevronDown className="w-4 h-4 inline-block" />
    );
  };

  // リサイズハンドル（幅を広げてクリックしやすく）
  const ResizeHandle = ({ columnId }: { columnId: string }) => (
    <div
      onMouseDown={(e) => onResizeStart(e, columnId)}
      className="absolute top-0 bottom-0 cursor-col-resize group"
      style={{ 
        right: -4,
        width: 8,
        backgroundColor: resizing?.columnId === columnId ? '#3b82f6' : 'transparent',
        zIndex: 30,
      }}
    >
      {/* ホバー時に視覚的なフィードバック - 青い線 */}
      <div 
        className="absolute top-0 bottom-0 transition-all"
        style={{
          left: 3,
          width: 2,
          backgroundColor: resizing?.columnId === columnId ? '#3b82f6' : '#d1d5db',
          opacity: resizing?.columnId === columnId ? 1 : 0,
        }}
      />
      <div 
        className="absolute top-0 bottom-0 group-hover:opacity-100 opacity-0 transition-opacity"
        style={{
          left: 3,
          width: 2,
          backgroundColor: '#3b82f6',
        }}
      />
    </div>
  );

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm" style={{ minWidth: 835 + aggregatedColumns.length * 55 + 370, tableLayout: 'fixed' }}>
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr className="border-b">
              {/* 商品名 - sticky固定 */}
              <th
                onClick={() => onSort('productName')}
                className="px-3 py-2 text-left font-semibold bg-white border-r cursor-pointer hover:bg-gray-100 relative whitespace-nowrap"
                style={{
                  position: 'sticky',
                  left: 0,
                  zIndex: 20,
                  width: getWidth('productName'),
                  minWidth: 150,
                  boxShadow: '2px 0 4px rgba(0,0,0,0.1)',
                }}
              >
                <span className="inline-flex items-center gap-1">
                  商品名
                  <SortIcon column="productName" />
                </span>
                <ResizeHandle columnId="productName" />
              </th>
              
              {/* ブランド */}
              <th 
                onClick={() => onSort('brandName')}
                className="px-3 py-2 text-left font-semibold relative cursor-pointer hover:bg-gray-100 whitespace-nowrap" 
                style={{ width: getWidth('brandName'), minWidth: 100 }}
              >
                <span className="inline-flex items-center gap-1">
                  ブランド
                  <SortIcon column="brandName" />
                </span>
                <ResizeHandle columnId="brandName" />
              </th>
              
              {/* カテゴリ */}
              <th 
                onClick={() => onSort('categoryName')}
                className="px-3 py-2 text-left font-semibold relative cursor-pointer hover:bg-gray-100 whitespace-nowrap" 
                style={{ width: getWidth('categoryName'), minWidth: 120 }}
              >
                <span className="inline-flex items-center gap-1">
                  カテゴリ
                  <SortIcon column="categoryName" />
                </span>
                <ResizeHandle columnId="categoryName" />
              </th>
              
              {/* 仕入先 */}
              <th 
                onClick={() => onSort('supplierName')}
                className="px-3 py-2 text-left font-semibold relative cursor-pointer hover:bg-gray-100 whitespace-nowrap" 
                style={{ width: getWidth('supplierName'), minWidth: 120 }}
              >
                <span className="inline-flex items-center gap-1">
                  仕入先
                  <SortIcon column="supplierName" />
                </span>
                <ResizeHandle columnId="supplierName" />
              </th>
              
              {/* 単価 */}
              <th 
                onClick={() => onSort('price')}
                className="px-3 py-2 text-right font-semibold cursor-pointer hover:bg-gray-100 whitespace-nowrap" 
                style={{ minWidth: 70, width: 70 }}
              >
                <span className="inline-flex items-center gap-1 justify-end">
                  単価
                  <SortIcon column="price" />
                </span>
              </th>
              
              {/* 原価 */}
              <th 
                onClick={() => onSort('cost')}
                className="px-3 py-2 text-right font-semibold cursor-pointer hover:bg-gray-100 whitespace-nowrap" 
                style={{ minWidth: 70, width: 70 }}
              >
                <span className="inline-flex items-center gap-1 justify-end">
                  原価
                  <SortIcon column="cost" />
                </span>
              </th>
              
              {/* 在庫 - 青背景 */}
              <th 
                onClick={() => onSort('stockTotal')}
                className="px-3 py-2 text-right font-semibold bg-blue-100 cursor-pointer hover:bg-blue-200 whitespace-nowrap" 
                style={{ minWidth: 55, width: 55 }}
                title="前回の在庫更新時点のデータ"
              >
                <span className="inline-flex items-center gap-1 justify-end">
                  在庫
                  <SortIcon column="stockTotal" />
                </span>
              </th>
              
              {/* 日付列 - 緑背景 */}
              {aggregatedColumns.map(col => (
                <th 
                  key={col} 
                  className="px-2 py-2 text-right font-semibold bg-green-100 whitespace-nowrap"
                  style={{ minWidth: 55, width: 55 }}
                >
                  {getDateLabel(col)}
                </th>
              ))}
              
              {/* 数量計 - 黄背景 */}
              <th 
                onClick={() => onSort('totalQuantity')}
                className="px-3 py-2 text-right font-semibold bg-yellow-100 cursor-pointer hover:bg-yellow-200 whitespace-nowrap" 
                style={{ minWidth: 70, width: 70 }}
              >
                <span className="inline-flex items-center gap-1 justify-end">
                  数量計
                  <SortIcon column="totalQuantity" />
                </span>
              </th>
              
              {/* 売上計 - 黄背景 */}
              <th 
                onClick={() => onSort('totalSales')}
                className="px-3 py-2 text-right font-semibold bg-yellow-100 cursor-pointer hover:bg-yellow-200 whitespace-nowrap" 
                style={{ minWidth: 90, width: 90 }}
              >
                <span className="inline-flex items-center gap-1 justify-end">
                  売上計
                  <SortIcon column="totalSales" />
                </span>
              </th>
              
              {/* 原価計 - 黄背景 */}
              <th 
                onClick={() => onSort('totalCost')}
                className="px-3 py-2 text-right font-semibold bg-yellow-100 cursor-pointer hover:bg-yellow-200 whitespace-nowrap" 
                style={{ minWidth: 90, width: 90 }}
              >
                <span className="inline-flex items-center gap-1 justify-end">
                  原価計
                  <SortIcon column="totalCost" />
                </span>
              </th>
              
              {/* 粗利率 - 黄背景 */}
              <th 
                onClick={() => onSort('grossMargin')}
                className="px-3 py-2 text-right font-semibold bg-yellow-100 cursor-pointer hover:bg-yellow-200 whitespace-nowrap" 
                style={{ minWidth: 70, width: 70 }}
              >
                <span className="inline-flex items-center gap-1 justify-end">
                  粗利率
                  <SortIcon column="grossMargin" />
                </span>
              </th>
              
              {/* 操作 */}
              <th className="px-2 py-2 text-center font-semibold whitespace-nowrap" style={{ minWidth: 50 }}>
                操作
              </th>
            </tr>
          </thead>
          
          <tbody>
            {products.map((product, index) => {
              const isSelected = selectedProductId === product.productId;
              const rowBg = isSelected 
                ? 'bg-blue-50' 
                : index % 2 === 0 
                  ? 'bg-white' 
                  : 'bg-gray-50';
              
              return (
                <tr 
                  key={product.productId} 
                  className={`border-b hover:bg-gray-100 cursor-pointer ${rowBg} ${isSelected ? 'ring-2 ring-blue-300 ring-inset' : ''}`}
                  onClick={() => onSelectProduct?.(isSelected ? null : product)}
                >
                  {/* 商品名 - sticky固定 */}
                  <td
                    className={`px-3 py-2 text-left border-r ${rowBg}`}
                    style={{
                      position: 'sticky',
                      left: 0,
                      zIndex: 5,
                      width: getWidth('productName'),
                      boxShadow: '2px 0 4px rgba(0,0,0,0.05)',
                    }}
                  >
                    <div className="truncate" title={product.productName}>
                      {product.productName}
                    </div>
                  </td>
                  
                  {/* ブランド */}
                  <td className="px-3 py-2" style={{ width: getWidth('brandName') }}>
                    <div className="truncate" title={product.brandName || ''}>{product.brandName || '-'}</div>
                  </td>
                  
                  {/* カテゴリ */}
                  <td className="px-3 py-2" style={{ width: getWidth('categoryName') }}>
                    <div className="truncate" title={product.categoryName || ''}>{product.categoryName || '-'}</div>
                  </td>
                  
                  {/* 仕入先 */}
                  <td className="px-3 py-2" style={{ width: getWidth('supplierName') }}>
                    <div className="truncate" title={product.supplierName || ''}>{product.supplierName || '-'}</div>
                  </td>
                  
                  {/* 単価 */}
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {product.price.toLocaleString()}
                  </td>
                  
                  {/* 原価 */}
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {product.cost.toLocaleString()}
                  </td>
                  
                  {/* 在庫 - 薄い青背景 */}
                  <td className="px-3 py-2 text-right bg-blue-50 whitespace-nowrap">
                    {product.stockTotal > 0 ? product.stockTotal : '-'}
                  </td>
                  
                  {/* 日付列 - 薄い緑背景 */}
                  {aggregatedColumns.map(col => {
                    const sales = getAggregatedSales(product, col);
                    return (
                      <td key={col} className="px-2 py-2 text-right bg-green-50 whitespace-nowrap">
                        {sales > 0 ? sales : '-'}
                      </td>
                    );
                  })}
                  
                  {/* 数量計 - 薄い黄背景 */}
                  <td className="px-3 py-2 text-right bg-yellow-50 font-medium whitespace-nowrap">
                    {product.totalQuantity}
                  </td>
                  
                  {/* 売上計 - 薄い黄背景 */}
                  <td className="px-3 py-2 text-right bg-yellow-50 font-medium whitespace-nowrap">
                    ¥{product.totalSales.toLocaleString()}
                  </td>
                  
                  {/* 原価計 - 薄い黄背景 */}
                  <td className="px-3 py-2 text-right bg-yellow-50 whitespace-nowrap">
                    ¥{product.totalCost.toLocaleString()}
                  </td>
                  
                  {/* 粗利率 - 薄い黄背景 */}
                  <td className="px-3 py-2 text-right bg-yellow-50 whitespace-nowrap">
                    {product.grossMargin.toFixed(1)}%
                  </td>
                  
                  {/* 操作 */}
                  <td className="px-2 py-2 text-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onHideProduct(product.productId);
                      }}
                      className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                      title="この商品を非表示"
                    >
                      <EyeOff className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      
      {products.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          表示するデータがありません
        </div>
      )}
    </div>
  );
}
