#!/usr/bin/env python3
"""
新宿店 2025年10月 月末在庫予測シミュレーション（修正版）
- 正しいフィールド名を使用
- 2025年9月のデータを使って10月の発注をシミュレーション
- 実際の10月売上と比較して月末在庫を予測
"""

import requests
import json
from datetime import datetime, timedelta
from collections import defaultdict
import pandas as pd

API_BASE = "https://fc-demand-forecast-production.up.railway.app/api"
STORE_ID = "2"  # 新宿店

# ABCDEランク別係数（中程度パターン）
RANK_COEFFICIENTS = {
    'A': 1.3,
    'B': 1.15,
    'C': 1.0,
    'D': 0.8,
    'E': 0.6
}

def get_all_suppliers():
    """全仕入先を取得"""
    response = requests.get(f"{API_BASE}/forecast/suppliers")
    data = response.json()
    return data.get('data', [])

def get_forecast_data(suppliers, order_date, forecast_days=10, lookback_days=30):
    """需要予測データを取得（バッチ処理）"""
    all_products = []
    batch_size = 50
    
    for i in range(0, len(suppliers), batch_size):
        batch = suppliers[i:i+batch_size]
        print(f"  仕入先 {i+1}-{min(i+batch_size, len(suppliers))}/{len(suppliers)} を処理中...")
        
        try:
            response = requests.post(
                f"{API_BASE}/forecast/calculate",
                json={
                    "storeId": STORE_ID,
                    "supplierNames": batch,
                    "orderDate": order_date,
                    "forecastDays": forecast_days,
                    "lookbackDays": lookback_days
                },
                timeout=120
            )
            
            if response.status_code == 200:
                data = response.json()
                for group in data.get('supplierGroups', []):
                    for product in group.get('products', []):
                        all_products.append(product)
        except Exception as e:
            print(f"    エラー: {e}")
    
    return all_products

def calculate_order_with_rank(product, lead_time=3, order_interval=7):
    """ランク別係数を適用した発注数を計算"""
    # APIから取得したランクを使用
    rank = product.get('abcRank', product.get('rank', 'C'))
    coefficient = RANK_COEFFICIENTS.get(rank, 1.0)
    
    daily_sales = product.get('avgDailySales', 0)
    current_stock = product.get('currentStock', 0)
    lot_size = product.get('lotSize', 1)
    
    # リードタイム + 発注間隔を考慮
    cover_days = lead_time + order_interval
    
    # 基本発注数 = 日販 × カバー日数 - 現在庫
    base_order = daily_sales * cover_days - current_stock
    
    # ランク係数を適用
    adjusted_order = base_order * coefficient
    
    # 発注ロットを考慮
    if adjusted_order > 0:
        order_qty = max(lot_size, int((adjusted_order + lot_size - 1) // lot_size) * lot_size)
    else:
        order_qty = 0
    
    return {
        'rank_order': max(0, order_qty),
        'base_order': max(0, int(base_order)),
        'coefficient': coefficient,
        'rank': rank
    }

def simulate_october(products_sep, actual_october_sales):
    """10月のシミュレーション"""
    results = []
    
    for product in products_sep:
        pid = product.get('productId')
        
        # 現行ロジックの発注数
        current_order = product.get('recommendedOrder', 0)
        
        # ランク別係数を適用した発注数
        rank_result = calculate_order_with_rank(product)
        rank_order = rank_result['rank_order']
        
        # 9月末在庫
        sep_end_stock = product.get('currentStock', 0)
        
        # 単価（retailPrice を使用）
        unit_price = product.get('retailPrice', 0)
        
        # 10月の実売上（あれば）
        oct_sales = actual_october_sales.get(pid, 0)
        
        # 10月末在庫予測
        current_oct_end = sep_end_stock + current_order - oct_sales
        rank_oct_end = sep_end_stock + rank_order - oct_sales
        
        results.append({
            'productId': pid,
            'productName': product.get('productName', ''),
            'supplierName': product.get('supplierName', ''),
            'rank': rank_result['rank'],
            'unitPrice': unit_price,
            'sepEndStock': sep_end_stock,
            'avgDailySales': product.get('avgDailySales', 0),
            'currentOrder': current_order,
            'rankOrder': rank_order,
            'coefficient': rank_result['coefficient'],
            'octSales': oct_sales,
            'currentOctEnd': max(0, current_oct_end),
            'rankOctEnd': max(0, rank_oct_end),
            'currentStockout': current_oct_end < 0,
            'rankStockout': rank_oct_end < 0
        })
    
    return results

def main():
    print("=" * 70)
    print("新宿店 2025年10月 月末在庫予測シミュレーション（修正版）")
    print("=" * 70)
    
    # 1. 全仕入先を取得
    print("\n1. 仕入先一覧を取得中...")
    suppliers = get_all_suppliers()
    print(f"   仕入先数: {len(suppliers)}")
    
    # 2. 2025年9月30日時点のデータを取得
    print("\n2. 2025年9月のデータを取得中...")
    products_sep = get_forecast_data(
        suppliers,
        order_date="2025-09-30",
        forecast_days=10,
        lookback_days=30
    )
    print(f"   取得商品数: {len(products_sep)}")
    
    if len(products_sep) == 0:
        print("エラー: 商品データが取得できませんでした")
        return
    
    # ランク分布を確認
    rank_counts = defaultdict(int)
    for p in products_sep:
        rank = p.get('abcRank', p.get('rank', 'C'))
        rank_counts[rank] += 1
    print(f"   ランク分布: {dict(rank_counts)}")
    
    # 3. 10月の実売上データを取得
    print("\n3. 2025年10月の売上データを取得中...")
    products_oct = get_forecast_data(
        suppliers,
        order_date="2025-10-31",
        forecast_days=1,
        lookback_days=31
    )
    
    # 10月の売上を集計
    actual_october_sales = {}
    for p in products_oct:
        pid = p.get('productId')
        daily_sales = p.get('avgDailySales', 0)
        actual_october_sales[pid] = int(daily_sales * 31)
    
    print(f"   10月売上データ商品数: {len(actual_october_sales)}")
    
    # 4. シミュレーション実行
    print("\n4. シミュレーション実行中...")
    results = simulate_october(products_sep, actual_october_sales)
    
    # 5. 結果集計
    print("\n" + "=" * 70)
    print("シミュレーション結果")
    print("=" * 70)
    
    df = pd.DataFrame(results)
    
    # 全体サマリー
    total_sep_stock = df['sepEndStock'].sum()
    total_sep_stock_value = (df['sepEndStock'] * df['unitPrice']).sum()
    
    total_current_order = df['currentOrder'].sum()
    total_rank_order = df['rankOrder'].sum()
    
    total_oct_sales = df['octSales'].sum()
    
    total_current_oct_end = df['currentOctEnd'].sum()
    total_rank_oct_end = df['rankOctEnd'].sum()
    
    total_current_oct_end_value = (df['currentOctEnd'] * df['unitPrice']).sum()
    total_rank_oct_end_value = (df['rankOctEnd'] * df['unitPrice']).sum()
    
    current_stockout_count = df['currentStockout'].sum()
    rank_stockout_count = df['rankStockout'].sum()
    
    print(f"\n【基準データ】")
    print(f"  商品数: {len(df)}")
    print(f"  9月末在庫数量: {total_sep_stock:,}個")
    print(f"  9月末在庫金額: ¥{total_sep_stock_value:,.0f}")
    
    print(f"\n【10月シミュレーション】")
    print(f"  10月売上合計: {total_oct_sales:,}個")
    
    print(f"\n  ■ 現行ロジック（日販×予測日数-現在庫）")
    print(f"    10月発注数: {total_current_order:,}個")
    print(f"    10月末在庫数量: {total_current_oct_end:,}個")
    print(f"    10月末在庫金額: ¥{total_current_oct_end_value:,.0f}")
    print(f"    欠品商品数: {current_stockout_count}商品 ({current_stockout_count/len(df)*100:.1f}%)")
    
    print(f"\n  ■ 中程度パターン（リードタイム+発注間隔×ランク係数）")
    print(f"    10月発注数: {total_rank_order:,}個")
    print(f"    10月末在庫数量: {total_rank_oct_end:,}個")
    print(f"    10月末在庫金額: ¥{total_rank_oct_end_value:,.0f}")
    print(f"    欠品商品数: {rank_stockout_count}商品 ({rank_stockout_count/len(df)*100:.1f}%)")
    
    # 比較
    order_diff = total_rank_order - total_current_order
    stock_value_diff = total_rank_oct_end_value - total_current_oct_end_value
    stockout_diff = rank_stockout_count - current_stockout_count
    
    print(f"\n【比較】")
    print(f"  発注数差: {order_diff:+,}個 ({order_diff/total_current_order*100:+.1f}%)" if total_current_order > 0 else "  発注数差: N/A")
    print(f"  在庫金額差: ¥{stock_value_diff:+,.0f} ({stock_value_diff/total_current_oct_end_value*100:+.1f}%)" if total_current_oct_end_value > 0 else "  在庫金額差: N/A")
    print(f"  欠品商品数差: {stockout_diff:+}商品")
    
    # ランク別詳細
    print(f"\n【ランク別詳細】")
    for rank in ['A', 'B', 'C', 'D', 'E']:
        rank_df = df[df['rank'] == rank]
        if len(rank_df) > 0:
            current_stockout = rank_df['currentStockout'].sum()
            rank_stockout = rank_df['rankStockout'].sum()
            current_value = (rank_df['currentOctEnd'] * rank_df['unitPrice']).sum()
            rank_value = (rank_df['rankOctEnd'] * rank_df['unitPrice']).sum()
            
            print(f"\n  {rank}ランク ({len(rank_df)}商品, 係数{RANK_COEFFICIENTS[rank]}):")
            print(f"    現行欠品率: {current_stockout/len(rank_df)*100:.1f}% ({current_stockout}商品)")
            print(f"    ランク別欠品率: {rank_stockout/len(rank_df)*100:.1f}% ({rank_stockout}商品)")
            print(f"    現行10月末在庫金額: ¥{current_value:,.0f}")
            print(f"    ランク別10月末在庫金額: ¥{rank_value:,.0f}")
    
    # 結果をCSV保存
    output_file = "/home/ubuntu/fc-demand-forecast/analysis/shinjuku_oct_correct_results.csv"
    df.to_csv(output_file, index=False, encoding='utf-8-sig')
    print(f"\n詳細結果を保存: {output_file}")

if __name__ == "__main__":
    main()
