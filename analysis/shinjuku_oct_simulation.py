#!/usr/bin/env python3
"""
新宿店 2025年10月 月末在庫予測シミュレーション

目的:
- 2025年9月のデータを使って10月の発注を計算
- 10月の実際の売上データと照らし合わせて月末在庫を予測
- 中程度パターン vs 現行ロジックを比較
"""

import os
import json
from supabase import create_client, Client
from datetime import datetime, timedelta
import pandas as pd
import numpy as np

# Supabase接続
SUPABASE_URL = "https://xwbwjmfwevnqkjjhqpnz.supabase.co"
SUPABASE_KEY = os.environ.get('SUPABASE_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3YndqbWZ3ZXZucWtqamhxcG56Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI2MjE2NjIsImV4cCI6MjA1ODE5NzY2Mn0.347j_0jlT1-qLnp5gxo4mPBNKSLFnFpXCKxGNdJMi0o')

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# 新宿店のstore_id
STORE_ID = "2"  # MiNi by FOOD&COMPANY ニュウマン新宿店

# 期間設定
SEPT_START = "2025-09-01"
SEPT_END = "2025-09-30"
OCT_START = "2025-10-01"
OCT_END = "2025-10-31"

# リードタイム＋発注間隔
LEAD_TIME = 3
ORDER_INTERVAL = 7
FORECAST_DAYS = LEAD_TIME + ORDER_INTERVAL  # 10日

print("=" * 80)
print("新宿店 2025年10月 月末在庫予測シミュレーション")
print("=" * 80)
print(f"店舗ID: {STORE_ID}")
print(f"参照期間: {SEPT_START} 〜 {SEPT_END}")
print(f"予測期間: {OCT_START} 〜 {OCT_END}")
print(f"予測日数（リードタイム＋発注間隔）: {FORECAST_DAYS}日")

# 1. 2025年9月の売上データを取得
print("\n1. 2025年9月の売上データを取得...")
sept_sales_response = supabase.table('sales_daily_summary').select(
    'product_id, sale_date, total_quantity'
).eq('store_id', STORE_ID).gte('sale_date', SEPT_START).lte('sale_date', SEPT_END).execute()

sept_sales = sept_sales_response.data
print(f"   9月売上レコード数: {len(sept_sales)}")

# 商品ごとに9月の売上を集計
sept_sales_by_product = {}
for s in sept_sales:
    pid = s['product_id']
    qty = float(s['total_quantity']) if s['total_quantity'] else 0
    if pid not in sept_sales_by_product:
        sept_sales_by_product[pid] = 0
    sept_sales_by_product[pid] += qty

print(f"   9月に売上があった商品数: {len(sept_sales_by_product)}")

# 2. 2025年10月の売上データを取得（実績）
print("\n2. 2025年10月の売上データを取得...")
oct_sales_response = supabase.table('sales_daily_summary').select(
    'product_id, sale_date, total_quantity'
).eq('store_id', STORE_ID).gte('sale_date', OCT_START).lte('sale_date', OCT_END).execute()

oct_sales = oct_sales_response.data
print(f"   10月売上レコード数: {len(oct_sales)}")

# 商品ごとに10月の売上を集計
oct_sales_by_product = {}
for s in oct_sales:
    pid = s['product_id']
    qty = float(s['total_quantity']) if s['total_quantity'] else 0
    if pid not in oct_sales_by_product:
        oct_sales_by_product[pid] = 0
    oct_sales_by_product[pid] += qty

print(f"   10月に売上があった商品数: {len(oct_sales_by_product)}")

# 3. 商品マスタを取得
print("\n3. 商品マスタを取得...")
# 9月と10月に売上があった商品のIDを取得
all_product_ids = list(set(list(sept_sales_by_product.keys()) + list(oct_sales_by_product.keys())))
print(f"   対象商品数: {len(all_product_ids)}")

products_response = supabase.table('products_cache').select('*').in_('product_id', all_product_ids).execute()
products = {p['product_id']: p for p in products_response.data}
print(f"   商品マスタ取得数: {len(products)}")

# 4. 9月末時点の在庫データを取得（stock_cacheは最新のみなので、推定する）
# 実際の9月末在庫は取得できないため、現在の在庫から逆算する
print("\n4. 在庫データを取得...")
stock_response = supabase.table('stock_cache').select(
    'product_id, stock_amount'
).eq('store_id', STORE_ID).in_('product_id', all_product_ids).execute()

current_stock = {s['product_id']: float(s['stock_amount']) if s['stock_amount'] else 0 for s in stock_response.data}
print(f"   在庫データ取得数: {len(current_stock)}")

# 5. ABCランクを計算（9月の売上金額ベース）
print("\n5. ABCランクを計算...")
product_sales_value = []
for pid, qty in sept_sales_by_product.items():
    if pid in products:
        price = float(products[pid].get('price', 0)) or 0
        sales_value = qty * price
        product_sales_value.append({
            'product_id': pid,
            'sales_qty': qty,
            'sales_value': sales_value
        })

# 売上金額でソート
product_sales_value.sort(key=lambda x: x['sales_value'], reverse=True)

# 累積構成比でランク付け
total_sales_value = sum(p['sales_value'] for p in product_sales_value)
cumulative = 0
abc_rank = {}
for p in product_sales_value:
    cumulative += p['sales_value']
    ratio = (cumulative / total_sales_value * 100) if total_sales_value > 0 else 0
    if ratio <= 50:
        abc_rank[p['product_id']] = 'A'
    elif ratio <= 75:
        abc_rank[p['product_id']] = 'B'
    elif ratio <= 90:
        abc_rank[p['product_id']] = 'C'
    elif ratio <= 97:
        abc_rank[p['product_id']] = 'D'
    else:
        abc_rank[p['product_id']] = 'E'

print(f"   ランク別商品数:")
for rank in ['A', 'B', 'C', 'D', 'E']:
    count = sum(1 for r in abc_rank.values() if r == rank)
    print(f"     {rank}ランク: {count}商品")

# 6. シミュレーション実行
print("\n6. シミュレーション実行...")

# 係数設定
CURRENT_LOGIC_COEF = {'A': 1.0, 'B': 1.0, 'C': 1.0, 'D': 1.0, 'E': 1.0}  # 現行（均一）
MODERATE_COEF = {'A': 1.3, 'B': 1.15, 'C': 1.0, 'D': 0.8, 'E': 0.6}  # 中程度パターン

results = []

for pid in all_product_ids:
    if pid not in products:
        continue
    
    product = products[pid]
    product_name = product.get('product_name', '')
    cost = float(product.get('cost', 0)) or 0
    price = float(product.get('price', 0)) or 0
    
    # 9月の売上から日販を計算
    sept_qty = sept_sales_by_product.get(pid, 0)
    avg_daily_sales = sept_qty / 30  # 9月は30日
    
    # 10月の実際の売上
    oct_actual_qty = oct_sales_by_product.get(pid, 0)
    
    # ABCランク
    rank = abc_rank.get(pid, 'E')
    
    # 9月末の推定在庫（簡易的に、現在庫 + 10月売上 - 10月発注 で逆算）
    # ここでは仮に「9月末在庫 = 日販 × 7日分」と仮定
    sept_end_stock = avg_daily_sales * 7
    
    # 現行ロジック: 発注数 = max(0, 日販 × 予測日数 - 現在庫)
    current_order = max(0, avg_daily_sales * FORECAST_DAYS * CURRENT_LOGIC_COEF[rank] - sept_end_stock)
    
    # 中程度パターン: 発注数 = max(0, 日販 × 予測日数 × ランク係数 - 現在庫)
    moderate_order = max(0, avg_daily_sales * FORECAST_DAYS * MODERATE_COEF[rank] - sept_end_stock)
    
    # 10月中に4回発注すると仮定（週1回）
    num_orders = 4
    current_total_order = current_order * num_orders
    moderate_total_order = moderate_order * num_orders
    
    # 10月末の予測在庫
    # 月末在庫 = 9月末在庫 + 10月発注合計 - 10月実売上
    current_oct_end_stock = sept_end_stock + current_total_order - oct_actual_qty
    moderate_oct_end_stock = sept_end_stock + moderate_total_order - oct_actual_qty
    
    # 欠品判定（月末在庫がマイナス）
    current_stockout = current_oct_end_stock < 0
    moderate_stockout = moderate_oct_end_stock < 0
    
    results.append({
        'product_id': pid,
        'product_name': product_name,
        'rank': rank,
        'sept_sales': sept_qty,
        'avg_daily_sales': round(avg_daily_sales, 2),
        'sept_end_stock': round(sept_end_stock, 1),
        'oct_actual_sales': oct_actual_qty,
        'current_order_per_cycle': round(current_order, 1),
        'current_total_order': round(current_total_order, 1),
        'current_oct_end_stock': round(current_oct_end_stock, 1),
        'current_stockout': current_stockout,
        'moderate_order_per_cycle': round(moderate_order, 1),
        'moderate_total_order': round(moderate_total_order, 1),
        'moderate_oct_end_stock': round(moderate_oct_end_stock, 1),
        'moderate_stockout': moderate_stockout,
        'cost': cost,
        'current_stock_value': round(max(0, current_oct_end_stock) * cost, 0),
        'moderate_stock_value': round(max(0, moderate_oct_end_stock) * cost, 0),
    })

df = pd.DataFrame(results)
print(f"   シミュレーション対象商品数: {len(df)}")

# 7. 結果サマリー
print("\n" + "=" * 80)
print("シミュレーション結果サマリー")
print("=" * 80)

# 全体サマリー
print("\n【全体】")
print(f"  対象商品数: {len(df)}")
print(f"  9月売上合計: {df['sept_sales'].sum():.0f}個")
print(f"  10月実売上合計: {df['oct_actual_sales'].sum():.0f}個")

print("\n【現行ロジック（均一係数1.0）】")
current_stockout_count = df['current_stockout'].sum()
current_stock_value = df['current_stock_value'].sum()
print(f"  10月発注合計: {df['current_total_order'].sum():.0f}個")
print(f"  10月末在庫金額: ¥{current_stock_value:,.0f}")
print(f"  欠品商品数: {current_stockout_count}商品 ({current_stockout_count/len(df)*100:.1f}%)")

print("\n【中程度パターン（A=1.3, B=1.15, C=1.0, D=0.8, E=0.6）】")
moderate_stockout_count = df['moderate_stockout'].sum()
moderate_stock_value = df['moderate_stock_value'].sum()
print(f"  10月発注合計: {df['moderate_total_order'].sum():.0f}個")
print(f"  10月末在庫金額: ¥{moderate_stock_value:,.0f}")
print(f"  欠品商品数: {moderate_stockout_count}商品 ({moderate_stockout_count/len(df)*100:.1f}%)")

# 差分
stock_diff = moderate_stock_value - current_stock_value
stock_diff_pct = (stock_diff / current_stock_value * 100) if current_stock_value > 0 else 0
print(f"\n【比較】")
print(f"  在庫金額差: ¥{stock_diff:+,.0f} ({stock_diff_pct:+.1f}%)")
print(f"  欠品商品数差: {moderate_stockout_count - current_stockout_count:+d}商品")

# ランク別サマリー
print("\n" + "=" * 80)
print("ランク別詳細")
print("=" * 80)

for rank in ['A', 'B', 'C', 'D', 'E']:
    rank_df = df[df['rank'] == rank]
    if len(rank_df) == 0:
        continue
    
    print(f"\n【{rank}ランク】商品数: {len(rank_df)}")
    print(f"  現行: 欠品{rank_df['current_stockout'].sum()}商品, 在庫金額¥{rank_df['current_stock_value'].sum():,.0f}")
    print(f"  中程度: 欠品{rank_df['moderate_stockout'].sum()}商品, 在庫金額¥{rank_df['moderate_stock_value'].sum():,.0f}")

# CSVに保存
df.to_csv('/home/ubuntu/fc-demand-forecast/analysis/shinjuku_oct_simulation_results.csv', index=False)
print("\n\n結果保存: shinjuku_oct_simulation_results.csv")

print("\n" + "=" * 80)
print("シミュレーション完了！")
print("=" * 80)
