#!/usr/bin/env python3
"""
新宿店 2025年10月 月末在庫予測シミュレーション（API経由）

目的:
- 2025年9月のデータを使って10月の発注を計算
- 10月の実際の売上データと照らし合わせて月末在庫を予測
- 中程度パターン vs 現行ロジックを比較
"""

import requests
import json
import pandas as pd
import numpy as np

# バックエンドAPI
API_BASE = "https://fc-demand-forecast-production.up.railway.app/api"

# 新宿店のstore_id
STORE_ID = "2"  # MiNi by FOOD&COMPANY ニュウマン新宿店

# 期間設定
SEPT_ORDER_DATE = "2025-09-30"  # 9月末時点での発注計算
OCT_ORDER_DATE = "2025-10-31"   # 10月末時点での確認

# リードタイム＋発注間隔
LEAD_TIME = 3
ORDER_INTERVAL = 7
FORECAST_DAYS = LEAD_TIME + ORDER_INTERVAL  # 10日

print("=" * 80)
print("新宿店 2025年10月 月末在庫予測シミュレーション")
print("=" * 80)
print(f"店舗ID: {STORE_ID}")
print(f"予測日数（リードタイム＋発注間隔）: {FORECAST_DAYS}日")

# 1. 仕入先一覧を取得
print("\n1. 仕入先一覧を取得...")
suppliers_response = requests.get(f"{API_BASE}/forecast/suppliers")
suppliers = suppliers_response.json().get('data', [])
print(f"   仕入先数: {len(suppliers)}")

# 2. 9月末時点での予測を取得（参照期間: 9月の14日間）
print("\n2. 9月末時点での予測を取得...")
sept_forecast_response = requests.post(
    f"{API_BASE}/forecast/calculate",
    json={
        "storeId": STORE_ID,
        "supplierNames": suppliers[:50],  # 主要な仕入先
        "orderDate": SEPT_ORDER_DATE,
        "forecastDays": FORECAST_DAYS,
        "lookbackDays": 14
    }
)
sept_forecast = sept_forecast_response.json()
print(f"   9月末予測: {sept_forecast.get('summary', {}).get('totalProducts', 0)}商品")

# 3. 10月末時点での予測を取得（10月の実績を含む）
print("\n3. 10月末時点での予測を取得...")
oct_forecast_response = requests.post(
    f"{API_BASE}/forecast/calculate",
    json={
        "storeId": STORE_ID,
        "supplierNames": suppliers[:50],
        "orderDate": OCT_ORDER_DATE,
        "forecastDays": FORECAST_DAYS,
        "lookbackDays": 30  # 10月全体を参照
    }
)
oct_forecast = oct_forecast_response.json()
print(f"   10月末予測: {oct_forecast.get('summary', {}).get('totalProducts', 0)}商品")

# 4. 商品データを抽出
print("\n4. 商品データを抽出...")

sept_products = {}
for group in sept_forecast.get('supplierGroups', []):
    for p in group.get('products', []):
        sept_products[p['productId']] = {
            'productName': p.get('productName', ''),
            'supplierName': p.get('supplierName', ''),
            'sept_avg_daily_sales': p.get('avgDailySales', 0),
            'sept_current_stock': p.get('currentStock', 0),
            'sept_forecast_qty': p.get('forecastQuantity', 0),
            'sept_recommended_order': p.get('recommendedOrder', 0),
            'rank': p.get('abcRank', 'E'),
            'cost': p.get('cost', 0),
            'retailPrice': p.get('retailPrice', 0),
        }

oct_products = {}
for group in oct_forecast.get('supplierGroups', []):
    for p in group.get('products', []):
        oct_products[p['productId']] = {
            'oct_avg_daily_sales': p.get('avgDailySales', 0),
            'oct_current_stock': p.get('currentStock', 0),
        }

print(f"   9月末商品数: {len(sept_products)}")
print(f"   10月末商品数: {len(oct_products)}")

# 5. シミュレーション実行
print("\n5. シミュレーション実行...")

# 係数設定
CURRENT_LOGIC_COEF = {'A': 1.0, 'B': 1.0, 'C': 1.0, 'D': 1.0, 'E': 1.0}  # 現行（均一）
MODERATE_COEF = {'A': 1.3, 'B': 1.15, 'C': 1.0, 'D': 0.8, 'E': 0.6}  # 中程度パターン

results = []

for pid, sept_data in sept_products.items():
    oct_data = oct_products.get(pid, {})
    
    # 9月のデータ
    avg_daily_sales = sept_data['sept_avg_daily_sales']
    sept_stock = sept_data['sept_current_stock']
    rank = sept_data['rank']
    cost = sept_data['cost']
    
    # 10月の実績（日販の変化から推定）
    oct_avg_daily_sales = oct_data.get('oct_avg_daily_sales', 0)
    oct_actual_sales = oct_avg_daily_sales * 31  # 10月は31日
    
    # 現行ロジック: 発注数 = max(0, 日販 × 予測日数 - 現在庫)
    current_order_per_cycle = max(0, avg_daily_sales * FORECAST_DAYS * CURRENT_LOGIC_COEF[rank] - sept_stock)
    
    # 中程度パターン: 発注数 = max(0, 日販 × 予測日数 × ランク係数 - 現在庫)
    moderate_order_per_cycle = max(0, avg_daily_sales * FORECAST_DAYS * MODERATE_COEF[rank] - sept_stock)
    
    # 10月中に4回発注すると仮定（週1回）
    num_orders = 4
    current_total_order = current_order_per_cycle * num_orders
    moderate_total_order = moderate_order_per_cycle * num_orders
    
    # 10月末の予測在庫
    # 月末在庫 = 9月末在庫 + 10月発注合計 - 10月実売上
    current_oct_end_stock = sept_stock + current_total_order - oct_actual_sales
    moderate_oct_end_stock = sept_stock + moderate_total_order - oct_actual_sales
    
    # 欠品判定（月末在庫がマイナス）
    current_stockout = current_oct_end_stock < 0
    moderate_stockout = moderate_oct_end_stock < 0
    
    results.append({
        'product_id': pid,
        'product_name': sept_data['productName'],
        'supplier_name': sept_data['supplierName'],
        'rank': rank,
        'sept_avg_daily_sales': round(avg_daily_sales, 2),
        'sept_stock': round(sept_stock, 1),
        'oct_avg_daily_sales': round(oct_avg_daily_sales, 2),
        'oct_actual_sales': round(oct_actual_sales, 1),
        'current_order_per_cycle': round(current_order_per_cycle, 1),
        'current_total_order': round(current_total_order, 1),
        'current_oct_end_stock': round(current_oct_end_stock, 1),
        'current_stockout': current_stockout,
        'moderate_order_per_cycle': round(moderate_order_per_cycle, 1),
        'moderate_total_order': round(moderate_total_order, 1),
        'moderate_oct_end_stock': round(moderate_oct_end_stock, 1),
        'moderate_stockout': moderate_stockout,
        'cost': cost,
        'current_stock_value': round(max(0, current_oct_end_stock) * cost, 0),
        'moderate_stock_value': round(max(0, moderate_oct_end_stock) * cost, 0),
    })

df = pd.DataFrame(results)

# アクティブ商品のみ（9月に売上があった商品）
df_active = df[df['sept_avg_daily_sales'] > 0].copy()
print(f"   アクティブ商品数: {len(df_active)}")

# 6. 結果サマリー
print("\n" + "=" * 80)
print("シミュレーション結果サマリー")
print("=" * 80)

# 全体サマリー
print("\n【全体】")
print(f"  対象商品数: {len(df_active)}")
print(f"  9月日販合計: {df_active['sept_avg_daily_sales'].sum():.1f}個/日")
print(f"  10月実売上合計: {df_active['oct_actual_sales'].sum():.0f}個")

print("\n【現行ロジック（均一係数1.0）】")
current_stockout_count = df_active['current_stockout'].sum()
current_stock_value = df_active['current_stock_value'].sum()
print(f"  10月発注合計: {df_active['current_total_order'].sum():.0f}個")
print(f"  10月末在庫金額: ¥{current_stock_value:,.0f}")
print(f"  欠品商品数: {current_stockout_count}商品 ({current_stockout_count/len(df_active)*100:.1f}%)")

print("\n【中程度パターン（A=1.3, B=1.15, C=1.0, D=0.8, E=0.6）】")
moderate_stockout_count = df_active['moderate_stockout'].sum()
moderate_stock_value = df_active['moderate_stock_value'].sum()
print(f"  10月発注合計: {df_active['moderate_total_order'].sum():.0f}個")
print(f"  10月末在庫金額: ¥{moderate_stock_value:,.0f}")
print(f"  欠品商品数: {moderate_stockout_count}商品 ({moderate_stockout_count/len(df_active)*100:.1f}%)")

# 差分
if current_stock_value > 0:
    stock_diff = moderate_stock_value - current_stock_value
    stock_diff_pct = (stock_diff / current_stock_value * 100)
    print(f"\n【比較】")
    print(f"  在庫金額差: ¥{stock_diff:+,.0f} ({stock_diff_pct:+.1f}%)")
    print(f"  欠品商品数差: {int(moderate_stockout_count - current_stockout_count):+d}商品")

# ランク別サマリー
print("\n" + "=" * 80)
print("ランク別詳細")
print("=" * 80)

rank_summary = []
for rank in ['A', 'B', 'C', 'D', 'E']:
    rank_df = df_active[df_active['rank'] == rank]
    if len(rank_df) == 0:
        continue
    
    current_stockout = rank_df['current_stockout'].sum()
    moderate_stockout = rank_df['moderate_stockout'].sum()
    current_value = rank_df['current_stock_value'].sum()
    moderate_value = rank_df['moderate_stock_value'].sum()
    
    rank_summary.append({
        'ランク': rank,
        '係数': MODERATE_COEF[rank],
        '商品数': len(rank_df),
        '現行_欠品数': int(current_stockout),
        '現行_欠品率': f"{current_stockout/len(rank_df)*100:.1f}%",
        '現行_在庫金額': int(current_value),
        '中程度_欠品数': int(moderate_stockout),
        '中程度_欠品率': f"{moderate_stockout/len(rank_df)*100:.1f}%",
        '中程度_在庫金額': int(moderate_value),
    })
    
    print(f"\n【{rank}ランク】商品数: {len(rank_df)}, 係数: {MODERATE_COEF[rank]}")
    print(f"  現行: 欠品{int(current_stockout)}商品 ({current_stockout/len(rank_df)*100:.1f}%), 在庫金額¥{current_value:,.0f}")
    print(f"  中程度: 欠品{int(moderate_stockout)}商品 ({moderate_stockout/len(rank_df)*100:.1f}%), 在庫金額¥{moderate_value:,.0f}")

# CSVに保存
df_active.to_csv('/home/ubuntu/fc-demand-forecast/analysis/shinjuku_oct_simulation_results.csv', index=False)
print("\n\n商品別結果保存: shinjuku_oct_simulation_results.csv")

rank_df = pd.DataFrame(rank_summary)
rank_df.to_csv('/home/ubuntu/fc-demand-forecast/analysis/shinjuku_oct_rank_summary.csv', index=False)
print("ランク別結果保存: shinjuku_oct_rank_summary.csv")

print("\n" + "=" * 80)
print("シミュレーション完了！")
print("=" * 80)
