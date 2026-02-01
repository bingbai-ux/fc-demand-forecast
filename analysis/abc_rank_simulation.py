#!/usr/bin/env python3
"""
ABCDEランク別重み付けシミュレーション

目的:
- リードタイム＋発注間隔を考慮した発注ロジック
- ABCDEランク別の重み付け係数を検証
- 各ランクの適正在庫率、欠品率、在庫金額を算出

ロジック:
発注数 = max(0, 日販 × (リードタイム + 発注間隔) × ランク係数 - 現在庫)
"""

import json
import pandas as pd
import numpy as np
from datetime import datetime, timedelta

# データ読み込み
with open('/home/ubuntu/fc-demand-forecast/analysis/raw_data_7days.json', 'r') as f:
    data = json.load(f)

# 商品データを抽出
products = []
for group in data.get('supplierGroups', []):
    for p in group.get('products', []):
        products.append({
            'productId': p.get('productId'),
            'productName': p.get('productName'),
            'supplierName': p.get('supplierName'),
            'avgDailySales': p.get('avgDailySales', 0),
            'currentStock': p.get('currentStock', 0),
            'cost': p.get('cost', 0),
            'retailPrice': p.get('retailPrice', 0),
            'lotSize': p.get('lotSize', 1),
            'abcRank': p.get('abcRank', 'E'),
        })

df = pd.DataFrame(products)
print(f"対象商品数: {len(df)}")

# アクティブ商品のみ（日販 > 0）
df_active = df[df['avgDailySales'] > 0].copy()
print(f"アクティブ商品数: {len(df_active)}")

# ABCDEランク別の商品数
print("\n=== ABCDEランク別商品数 ===")
print(df_active['abcRank'].value_counts().sort_index())

# シミュレーション設定
LEAD_TIME = 3  # リードタイム（日）
ORDER_INTERVAL = 7  # 発注間隔（日）
FORECAST_DAYS = LEAD_TIME + ORDER_INTERVAL  # 予測日数 = 10日

print(f"\nリードタイム: {LEAD_TIME}日")
print(f"発注間隔: {ORDER_INTERVAL}日")
print(f"予測日数（リードタイム＋発注間隔）: {FORECAST_DAYS}日")

# ランク別係数のパターンを定義
# 係数が高いほど多めに発注（欠品防止）
# 係数が低いほど少なめに発注（在庫削減）
coefficient_patterns = {
    'パターン1: 均一（係数1.0）': {
        'A': 1.0, 'B': 1.0, 'C': 1.0, 'D': 1.0, 'E': 1.0
    },
    'パターン2: 緩やかな傾斜': {
        'A': 1.2, 'B': 1.1, 'C': 1.0, 'D': 0.9, 'E': 0.8
    },
    'パターン3: 中程度の傾斜': {
        'A': 1.3, 'B': 1.15, 'C': 1.0, 'D': 0.8, 'E': 0.6
    },
    'パターン4: 急な傾斜': {
        'A': 1.5, 'B': 1.2, 'C': 1.0, 'D': 0.7, 'E': 0.5
    },
    'パターン5: 極端な傾斜': {
        'A': 1.8, 'B': 1.3, 'C': 1.0, 'D': 0.5, 'E': 0.3
    },
    'パターン6: A・B重視': {
        'A': 1.5, 'B': 1.3, 'C': 0.8, 'D': 0.5, 'E': 0.3
    },
}

def simulate_orders(df, coefficients, forecast_days):
    """発注シミュレーションを実行"""
    results = []
    
    for _, row in df.iterrows():
        rank = row['abcRank']
        coef = coefficients.get(rank, 1.0)
        
        # 発注数 = max(0, 日販 × 予測日数 × ランク係数 - 現在庫)
        forecast_qty = row['avgDailySales'] * forecast_days * coef
        order_qty = max(0, forecast_qty - row['currentStock'])
        
        # ロットサイズで切り上げ
        lot_size = row['lotSize'] if row['lotSize'] > 0 else 1
        if order_qty > 0:
            order_qty = np.ceil(order_qty / lot_size) * lot_size
        
        # 発注後の在庫
        stock_after_order = row['currentStock'] + order_qty
        
        # 予測期間中の需要
        expected_demand = row['avgDailySales'] * forecast_days
        
        # 欠品判定（発注後在庫 < 予測需要）
        is_stockout = stock_after_order < expected_demand
        
        # 在庫日数
        stock_days = stock_after_order / row['avgDailySales'] if row['avgDailySales'] > 0 else 999
        
        # 適正在庫判定（在庫日数が予測日数の80%〜150%）
        is_optimal = forecast_days * 0.8 <= stock_days <= forecast_days * 1.5
        
        results.append({
            'productId': row['productId'],
            'productName': row['productName'],
            'rank': rank,
            'avgDailySales': row['avgDailySales'],
            'currentStock': row['currentStock'],
            'coefficient': coef,
            'orderQty': order_qty,
            'orderAmount': order_qty * row['cost'],
            'stockAfterOrder': stock_after_order,
            'stockValue': stock_after_order * row['cost'],
            'expectedDemand': expected_demand,
            'isStockout': is_stockout,
            'stockDays': stock_days,
            'isOptimal': is_optimal,
        })
    
    return pd.DataFrame(results)

# 各パターンでシミュレーション実行
print("\n" + "=" * 80)
print("シミュレーション結果")
print("=" * 80)

all_results = []

for pattern_name, coefficients in coefficient_patterns.items():
    sim_df = simulate_orders(df_active, coefficients, FORECAST_DAYS)
    
    # 全体サマリー
    total_order_qty = sim_df['orderQty'].sum()
    total_order_amount = sim_df['orderAmount'].sum()
    total_stock_value = sim_df['stockValue'].sum()
    stockout_rate = sim_df['isStockout'].mean() * 100
    optimal_rate = sim_df['isOptimal'].mean() * 100
    
    all_results.append({
        'パターン': pattern_name,
        '発注数合計': int(total_order_qty),
        '発注金額合計': f"¥{int(total_order_amount):,}",
        '在庫金額合計': f"¥{int(total_stock_value):,}",
        '欠品率': f"{stockout_rate:.1f}%",
        '適正在庫率': f"{optimal_rate:.1f}%",
    })
    
    print(f"\n【{pattern_name}】")
    print(f"  係数: A={coefficients['A']}, B={coefficients['B']}, C={coefficients['C']}, D={coefficients['D']}, E={coefficients['E']}")
    print(f"  発注数合計: {int(total_order_qty)}個")
    print(f"  発注金額合計: ¥{int(total_order_amount):,}")
    print(f"  在庫金額合計: ¥{int(total_stock_value):,}")
    print(f"  欠品率: {stockout_rate:.1f}%")
    print(f"  適正在庫率: {optimal_rate:.1f}%")

# 全体サマリーをCSV出力
summary_df = pd.DataFrame(all_results)
summary_df.to_csv('/home/ubuntu/fc-demand-forecast/analysis/abc_simulation_summary.csv', index=False)
print("\n全体サマリー保存: abc_simulation_summary.csv")

# ランク別詳細分析（パターン4を例として）
print("\n" + "=" * 80)
print("ランク別詳細分析（パターン4: 急な傾斜）")
print("=" * 80)

selected_coefficients = coefficient_patterns['パターン4: 急な傾斜']
sim_df = simulate_orders(df_active, selected_coefficients, FORECAST_DAYS)

rank_summary = []
for rank in ['A', 'B', 'C', 'D', 'E']:
    rank_df = sim_df[sim_df['rank'] == rank]
    if len(rank_df) == 0:
        continue
    
    coef = selected_coefficients[rank]
    count = len(rank_df)
    order_qty = rank_df['orderQty'].sum()
    order_amount = rank_df['orderAmount'].sum()
    stock_value = rank_df['stockValue'].sum()
    stockout_count = rank_df['isStockout'].sum()
    stockout_rate = stockout_count / count * 100 if count > 0 else 0
    optimal_count = rank_df['isOptimal'].sum()
    optimal_rate = optimal_count / count * 100 if count > 0 else 0
    avg_stock_days = rank_df['stockDays'].mean()
    
    rank_summary.append({
        'ランク': rank,
        '係数': coef,
        '商品数': count,
        '発注数': int(order_qty),
        '発注金額': f"¥{int(order_amount):,}",
        '在庫金額': f"¥{int(stock_value):,}",
        '欠品商品数': int(stockout_count),
        '欠品率': f"{stockout_rate:.1f}%",
        '適正在庫率': f"{optimal_rate:.1f}%",
        '平均在庫日数': f"{avg_stock_days:.1f}日",
    })
    
    print(f"\n【{rank}ランク】係数: {coef}")
    print(f"  商品数: {count}")
    print(f"  発注数: {int(order_qty)}個")
    print(f"  発注金額: ¥{int(order_amount):,}")
    print(f"  在庫金額: ¥{int(stock_value):,}")
    print(f"  欠品商品数: {int(stockout_count)} ({stockout_rate:.1f}%)")
    print(f"  適正在庫率: {optimal_rate:.1f}%")
    print(f"  平均在庫日数: {avg_stock_days:.1f}日")

# ランク別詳細をCSV出力
rank_df = pd.DataFrame(rank_summary)
rank_df.to_csv('/home/ubuntu/fc-demand-forecast/analysis/abc_rank_detail.csv', index=False)
print("\nランク別詳細保存: abc_rank_detail.csv")

# 商品別詳細をCSV出力
sim_df.to_csv('/home/ubuntu/fc-demand-forecast/analysis/abc_product_detail.csv', index=False)
print("商品別詳細保存: abc_product_detail.csv")

print("\n" + "=" * 80)
print("シミュレーション完了！")
print("=" * 80)
