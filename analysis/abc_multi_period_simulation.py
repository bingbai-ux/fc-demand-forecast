#!/usr/bin/env python3
"""
ABCDEランク別重み付け - 複数期間シミュレーション

目的:
- 複数の期間データを使用してより信頼性の高い検証を行う
- 在庫金額削減と欠品率のトレードオフを分析
"""

import json
import pandas as pd
import numpy as np
import os
from glob import glob

# 期間データファイルを読み込み
period_files = glob('/home/ubuntu/fc-demand-forecast/analysis/period_*.json')
print(f"期間データファイル数: {len(period_files)}")

all_products = []

for filepath in period_files:
    period_name = os.path.basename(filepath).replace('period_', '').replace('.json', '')
    
    with open(filepath, 'r') as f:
        data = json.load(f)
    
    for group in data.get('supplierGroups', []):
        for p in group.get('products', []):
            if p.get('avgDailySales', 0) > 0:  # アクティブ商品のみ
                all_products.append({
                    'period': period_name,
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

df = pd.DataFrame(all_products)
print(f"総レコード数: {len(df)}")
print(f"期間数: {df['period'].nunique()}")
print(f"ユニーク商品数: {df['productId'].nunique()}")

# ABCDEランク別の商品数
print("\n=== ABCDEランク別商品数（全期間合計） ===")
print(df['abcRank'].value_counts().sort_index())

# シミュレーション設定
LEAD_TIME = 3  # リードタイム（日）
ORDER_INTERVAL = 7  # 発注間隔（日）
FORECAST_DAYS = LEAD_TIME + ORDER_INTERVAL  # 予測日数 = 10日

print(f"\nリードタイム: {LEAD_TIME}日")
print(f"発注間隔: {ORDER_INTERVAL}日")
print(f"予測日数（リードタイム＋発注間隔）: {FORECAST_DAYS}日")

# ランク別係数のパターンを定義
coefficient_patterns = {
    'パターン1: 均一': {
        'A': 1.0, 'B': 1.0, 'C': 1.0, 'D': 1.0, 'E': 1.0
    },
    'パターン2: 緩やか': {
        'A': 1.2, 'B': 1.1, 'C': 1.0, 'D': 0.9, 'E': 0.8
    },
    'パターン3: 中程度': {
        'A': 1.3, 'B': 1.15, 'C': 1.0, 'D': 0.8, 'E': 0.6
    },
    'パターン4: 急傾斜': {
        'A': 1.5, 'B': 1.2, 'C': 1.0, 'D': 0.7, 'E': 0.5
    },
    'パターン5: 極端': {
        'A': 1.8, 'B': 1.3, 'C': 1.0, 'D': 0.5, 'E': 0.3
    },
    'パターン6: A・B重視': {
        'A': 1.5, 'B': 1.3, 'C': 0.8, 'D': 0.5, 'E': 0.3
    },
    'パターン7: 在庫最小化': {
        'A': 1.2, 'B': 1.0, 'C': 0.7, 'D': 0.4, 'E': 0.2
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
            'period': row['period'],
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
print("\n" + "=" * 100)
print("パターン別シミュレーション結果（全期間平均）")
print("=" * 100)

all_results = []

for pattern_name, coefficients in coefficient_patterns.items():
    sim_df = simulate_orders(df, coefficients, FORECAST_DAYS)
    
    # 全体サマリー
    total_order_qty = sim_df['orderQty'].sum()
    total_order_amount = sim_df['orderAmount'].sum()
    total_stock_value = sim_df['stockValue'].sum()
    stockout_rate = sim_df['isStockout'].mean() * 100
    optimal_rate = sim_df['isOptimal'].mean() * 100
    
    # ランク別欠品率
    rank_stockout = {}
    for rank in ['A', 'B', 'C', 'D', 'E']:
        rank_df = sim_df[sim_df['rank'] == rank]
        if len(rank_df) > 0:
            rank_stockout[rank] = f"{rank_df['isStockout'].mean() * 100:.1f}%"
        else:
            rank_stockout[rank] = "N/A"
    
    all_results.append({
        'パターン': pattern_name,
        '係数A': coefficients['A'],
        '係数B': coefficients['B'],
        '係数C': coefficients['C'],
        '係数D': coefficients['D'],
        '係数E': coefficients['E'],
        '発注金額': int(total_order_amount),
        '在庫金額': int(total_stock_value),
        '全体欠品率': f"{stockout_rate:.1f}%",
        '適正在庫率': f"{optimal_rate:.1f}%",
        'A欠品率': rank_stockout['A'],
        'B欠品率': rank_stockout['B'],
        'C欠品率': rank_stockout['C'],
        'D欠品率': rank_stockout['D'],
        'E欠品率': rank_stockout['E'],
    })
    
    print(f"\n【{pattern_name}】")
    print(f"  係数: A={coefficients['A']}, B={coefficients['B']}, C={coefficients['C']}, D={coefficients['D']}, E={coefficients['E']}")
    print(f"  発注金額: ¥{int(total_order_amount):,}")
    print(f"  在庫金額: ¥{int(total_stock_value):,}")
    print(f"  全体欠品率: {stockout_rate:.1f}%")
    print(f"  適正在庫率: {optimal_rate:.1f}%")
    print(f"  ランク別欠品率: A={rank_stockout['A']}, B={rank_stockout['B']}, C={rank_stockout['C']}, D={rank_stockout['D']}, E={rank_stockout['E']}")

# 結果をCSV出力
summary_df = pd.DataFrame(all_results)
summary_df.to_csv('/home/ubuntu/fc-demand-forecast/analysis/abc_multi_period_summary.csv', index=False)
print("\n\n全体サマリー保存: abc_multi_period_summary.csv")

# 推奨パターンの詳細分析
print("\n" + "=" * 100)
print("推奨パターン: パターン3（中程度の傾斜）のランク別詳細")
print("=" * 100)

selected_coefficients = coefficient_patterns['パターン3: 中程度']
sim_df = simulate_orders(df, selected_coefficients, FORECAST_DAYS)

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
        '発注金額': int(order_amount),
        '在庫金額': int(stock_value),
        '欠品商品数': int(stockout_count),
        '欠品率': f"{stockout_rate:.1f}%",
        '適正在庫率': f"{optimal_rate:.1f}%",
        '平均在庫日数': round(avg_stock_days, 1),
    })
    
    print(f"\n【{rank}ランク】係数: {coef}")
    print(f"  商品数: {count}")
    print(f"  発注金額: ¥{int(order_amount):,}")
    print(f"  在庫金額: ¥{int(stock_value):,}")
    print(f"  欠品率: {stockout_rate:.1f}%")
    print(f"  適正在庫率: {optimal_rate:.1f}%")
    print(f"  平均在庫日数: {avg_stock_days:.1f}日")

# ランク別詳細をCSV出力
rank_df = pd.DataFrame(rank_summary)
rank_df.to_csv('/home/ubuntu/fc-demand-forecast/analysis/abc_multi_period_rank_detail.csv', index=False)
print("\nランク別詳細保存: abc_multi_period_rank_detail.csv")

# 在庫金額削減効果の比較
print("\n" + "=" * 100)
print("在庫金額削減効果の比較（パターン1: 均一 を基準）")
print("=" * 100)

baseline = all_results[0]['在庫金額']
print(f"基準（均一）: ¥{baseline:,}")

for result in all_results[1:]:
    diff = result['在庫金額'] - baseline
    diff_pct = (diff / baseline) * 100
    print(f"{result['パターン']}: ¥{result['在庫金額']:,} ({diff_pct:+.1f}%)")

print("\n" + "=" * 100)
print("シミュレーション完了！")
print("=" * 100)
