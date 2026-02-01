import type { FC } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine
} from 'recharts';

interface ChartData {
  date: string;
  sales?: number;
  inventory: number;
  isProjection?: boolean;
}

interface InventoryChartProps {
  data: ChartData[];
  safetyStock: number;
  title?: string;
}

export const InventoryChart: FC<InventoryChartProps> = ({ data, safetyStock }) => {
  if (!data || data.length === 0) {
    return (
      <div style={{ 
        height: '300px', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        backgroundColor: '#F9FAFB',
        borderRadius: '8px',
        color: '#6B7280'
      }}>
        グラフデータがありません
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '300px' }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis 
            dataKey="date" 
            tick={{ fontSize: 12 }}
            interval="preserveStartEnd"
          />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip />
          <Legend />
          
          {/* 売上（過去のみ） */}
          <Line
            type="monotone"
            dataKey="sales"
            stroke="#8884D8"
            strokeWidth={2}
            dot={{ r: 3 }}
            name="売上"
            connectNulls={false}
          />
          
          {/* 在庫推移 */}
          <Line
            type="monotone"
            dataKey="inventory"
            stroke="#10B981"
            strokeWidth={2}
            dot={{ r: 3 }}
            name="在庫"
          />
          
          {/* 安全在庫ライン */}
          <ReferenceLine 
            y={safetyStock} 
            stroke="#F59E0B" 
            strokeDasharray="5 5"
            label={{ value: `安全在庫: ${safetyStock}`, fill: '#F59E0B', fontSize: 12 }}
          />
          
          {/* ゼロライン */}
          <ReferenceLine 
            y={0} 
            stroke="#EF4444" 
            strokeWidth={2}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
