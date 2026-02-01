#!/usr/bin/env python3
"""
新宿店シミュレーション - スマレジCSVファイルを使用
ABCDEランク別重み付け + リードタイム + 発注間隔
"""

import pandas as pd
import numpy as np
import requests
import json
from datetime import datetime

# 設定
API_BASE = "https://fc-demand-forecast-production.up.railway.app/api"
STORE_ID = 1  # 新宿店
LEAD_TIME = 3  # リードタイム（日）
ORDER_INTERVAL = 7  # 発注間隔（日）
FORECAST_DAYS = LEAD_TIME + ORDER_INTERVAL  # 予測日数 = 10日

# ABCDEランク別係数（中程度パターン）
RANK_COEFFICIENTS = {
    'A': 1.3,
    'B': 1.15,
    'C': 1.0,
    'D': 0.8,
    'E': 0.6
}

print("=" * 60)
print("新宿店 ABCDEランク別シミュレーション")
print("=" * 60)

# 1. スマレジCSVから在庫データを読み込む
print("\n📊 スマレジCSVから在庫データを読み込み中...")
csv_path = "/home/ubuntu/upload/在庫一覧(20260130110411).csv"
stock_df = pd.read_csv(csv_path, encoding='utf-8-sig')

print(f"   読み込んだ商品数: {len(stock_df)}")
print(f"   カラム: {list(stock_df.columns)}")

# 在庫データの整形
stock_df = stock_df.rename(columns={
    '商品ID': 'product_id',
    '商品コード': 'product_code',
    '商品名': 'product_name',
    '原単価(税抜)': 'cost_price',
    'グループコード': 'supplier_name',
    '商品単価': 'selling_price',
    '在庫数': 'stock_amount',
    '在庫金額': 'stock_value'
})

# マイナス在庫は0として扱う（発注計算用）
stock_df['stock_for_calc'] = stock_df['stock_amount'].apply(lambda x: max(0, x))

print(f"\n📈 在庫サマリー:")
print(f"   総商品数: {len(stock_df)}")
print(f"   在庫あり商品: {len(stock_df[stock_df['stock_amount'] > 0])}")
print(f"   在庫なし商品: {len(stock_df[stock_df['stock_amount'] == 0])}")
print(f"   マイナス在庫商品: {len(stock_df[stock_df['stock_amount'] < 0])}")
print(f"   総在庫数量: {stock_df['stock_for_calc'].sum():,}")
print(f"   総在庫金額: ¥{stock_df[stock_df['stock_value'] > 0]['stock_value'].sum():,.0f}")

# 2. APIから売上データ（日販）を取得
print("\n📊 APIから売上データを取得中...")

# 仕入先一覧を取得
suppliers_resp = requests.get(f"{API_BASE}/forecast/suppliers?storeId={STORE_ID}")
suppliers_data = suppliers_resp.json()
if isinstance(suppliers_data, dict) and 'data' in suppliers_data:
    suppliers = suppliers_data['data']
else:
    suppliers = suppliers_data
print(f"   仕入先数: {len(suppliers)}")

# 各仕入先の売上データを取得
all_products = []
for supplier_name in suppliers[:100]:  # 主要100社
    try:
        resp = requests.post(
            f"{API_BASE}/forecast",
            json={
                "storeId": str(STORE_ID),
                "suppliers": [supplier_name],
                "forecastDays": FORECAST_DAYS,
                "startDate": "2026-01-30",
                "endDate": "2026-02-09"
            },
            timeout=60
        )
        if resp.status_code == 200:
            data = resp.json()
            if 'products' in data:
                for p in data['products']:
                    all_products.append({
                        'product_id': p.get('productId'),
                        'product_name': p.get('productName'),
                        'supplier_name': supplier_name,
                        'daily_sales': p.get('dailySales', 0),
                        'current_stock': p.get('currentStock', 0),
                        'selling_price': p.get('sellingPrice', 0),
                        'is_active': p.get('isActive', False)
                    })
    except Exception as e:
        print(f"   エラー ({supplier_name}): {e}")

print(f"   取得した商品数: {len(all_products)}")

# 3. CSVと売上データをマージ
print("\n🔗 在庫データと売上データをマージ中...")
sales_df = pd.DataFrame(all_products)

# 商品名でマージ（商品IDが異なる場合があるため）
merged_df = stock_df.merge(
    sales_df[['product_name', 'daily_sales', 'is_active']],
    on='product_name',
    how='left'
)

# 売上データがない商品は日販0
merged_df['daily_sales'] = merged_df['daily_sales'].fillna(0)
merged_df['is_active'] = merged_df['is_active'].fillna(False)

print(f"   マージ後商品数: {len(merged_df)}")
print(f"   売上データあり: {len(merged_df[merged_df['daily_sales'] > 0])}")

# 4. アクティブ商品のみをフィルタ（isActive=True または 在庫>0）
active_df = merged_df[(merged_df['is_active'] == True) | (merged_df['stock_for_calc'] > 0)].copy()
print(f"\n📦 アクティブ商品数: {len(active_df)}")

# 5. ABCDEランク付け（売上金額ベース）
print("\n🏷️ ABCDEランク付け...")
active_df['sales_value'] = active_df['daily_sales'] * active_df['selling_price']
active_df = active_df.sort_values('sales_value', ascending=False).reset_index(drop=True)

# 累積売上比率を計算
total_sales = active_df['sales_value'].sum()
if total_sales > 0:
    active_df['cumulative_ratio'] = active_df['sales_value'].cumsum() / total_sales
else:
    active_df['cumulative_ratio'] = 0

# ランク付け
def assign_rank(ratio, sales):
    if sales == 0:
        return 'E'
    if ratio <= 0.50:
        return 'A'
    elif ratio <= 0.75:
        return 'B'
    elif ratio <= 0.90:
        return 'C'
    elif ratio <= 0.97:
        return 'D'
    else:
        return 'E'

active_df['rank'] = active_df.apply(lambda x: assign_rank(x['cumulative_ratio'], x['sales_value']), axis=1)

# ランク別集計
rank_summary = active_df.groupby('rank').agg({
    'product_name': 'count',
    'daily_sales': 'sum',
    'sales_value': 'sum',
    'stock_for_calc': 'sum',
    'stock_value': 'sum'
}).rename(columns={'product_name': 'product_count'})

print("\n📊 ランク別サマリー:")
print(rank_summary.to_string())

# 6. 発注シミュレーション
print("\n🚚 発注シミュレーション...")

def calculate_order(row, use_rank_coef=False):
    """発注数を計算"""
    daily_sales = row['daily_sales']
    current_stock = row['stock_for_calc']
    
    if use_rank_coef:
        coef = RANK_COEFFICIENTS.get(row['rank'], 1.0)
    else:
        coef = 1.0
    
    # 発注数 = 日販 × 予測日数 × 係数 - 現在庫
    required = daily_sales * FORECAST_DAYS * coef
    order_qty = max(0, required - current_stock)
    
    return order_qty

# 現行ロジック（係数なし）
active_df['order_current'] = active_df.apply(lambda x: calculate_order(x, use_rank_coef=False), axis=1)

# 中程度パターン（係数あり）
active_df['order_ranked'] = active_df.apply(lambda x: calculate_order(x, use_rank_coef=True), axis=1)

# 発注金額を計算
active_df['order_value_current'] = active_df['order_current'] * active_df['cost_price']
active_df['order_value_ranked'] = active_df['order_ranked'] * active_df['cost_price']

# 7. 結果サマリー
print("\n" + "=" * 60)
print("📊 シミュレーション結果")
print("=" * 60)

print(f"\n【基準データ】")
print(f"   対象商品数: {len(active_df)}")
print(f"   現在庫数量: {active_df['stock_for_calc'].sum():,.0f}個")
print(f"   現在庫金額: ¥{active_df[active_df['stock_value'] > 0]['stock_value'].sum():,.0f}")
print(f"   欠品商品数: {len(active_df[active_df['stock_for_calc'] == 0])} ({len(active_df[active_df['stock_for_calc'] == 0]) / len(active_df) * 100:.1f}%)")

print(f"\n【発注シミュレーション比較】")
print(f"   予測日数: {FORECAST_DAYS}日（リードタイム{LEAD_TIME}日 + 発注間隔{ORDER_INTERVAL}日）")
print(f"")
print(f"   現行ロジック（係数1.0）:")
print(f"     発注数量: {active_df['order_current'].sum():,.0f}個")
print(f"     発注金額: ¥{active_df['order_value_current'].sum():,.0f}")
print(f"")
print(f"   中程度パターン（A=1.3, B=1.15, C=1.0, D=0.8, E=0.6）:")
print(f"     発注数量: {active_df['order_ranked'].sum():,.0f}個")
print(f"     発注金額: ¥{active_df['order_value_ranked'].sum():,.0f}")

# ランク別詳細
print(f"\n【ランク別詳細】")
print(f"{'ランク':<6} {'商品数':<8} {'係数':<6} {'現行発注':<12} {'ランク別発注':<12} {'差分':<10} {'欠品数':<8}")
print("-" * 70)

for rank in ['A', 'B', 'C', 'D', 'E']:
    rank_data = active_df[active_df['rank'] == rank]
    if len(rank_data) > 0:
        coef = RANK_COEFFICIENTS[rank]
        order_current = rank_data['order_current'].sum()
        order_ranked = rank_data['order_ranked'].sum()
        diff = order_ranked - order_current
        stockout = len(rank_data[rank_data['stock_for_calc'] == 0])
        print(f"{rank:<6} {len(rank_data):<8} {coef:<6.2f} {order_current:<12,.0f} {order_ranked:<12,.0f} {diff:+10,.0f} {stockout:<8}")

# 8. 結果をCSVに保存
output_path = "/home/ubuntu/fc-demand-forecast/analysis/shinjuku_simulation_result.csv"
active_df.to_csv(output_path, index=False, encoding='utf-8-sig')
print(f"\n📁 詳細結果を保存: {output_path}")

# サマリーをCSVに保存
summary_data = []
for rank in ['A', 'B', 'C', 'D', 'E']:
    rank_data = active_df[active_df['rank'] == rank]
    if len(rank_data) > 0:
        summary_data.append({
            'ランク': rank,
            '商品数': len(rank_data),
            '係数': RANK_COEFFICIENTS[rank],
            '現行発注数': rank_data['order_current'].sum(),
            'ランク別発注数': rank_data['order_ranked'].sum(),
            '差分': rank_data['order_ranked'].sum() - rank_data['order_current'].sum(),
            '欠品商品数': len(rank_data[rank_data['stock_for_calc'] == 0]),
            '在庫金額': rank_data[rank_data['stock_value'] > 0]['stock_value'].sum()
        })

summary_df = pd.DataFrame(summary_data)
summary_path = "/home/ubuntu/fc-demand-forecast/analysis/shinjuku_simulation_summary.csv"
summary_df.to_csv(summary_path, index=False, encoding='utf-8-sig')
print(f"📁 サマリーを保存: {summary_path}")

print("\n✅ シミュレーション完了")
