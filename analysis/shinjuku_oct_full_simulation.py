#!/usr/bin/env python3
"""
新宿店 2025年10月 月末在庫予測シミュレーション（全仕入先対応版）
- 2025年9月のデータを使って10月の発注をシミュレーション
- 実際の10月売上と比較して月末在庫を予測
- 中程度パターン（ABCDEランク別重み付け）と現行ロジックを比較
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
    batch_size = 50  # 一度に50仕入先ずつ
    
    for i in range(0, len(suppliers), batch_size):
        batch = suppliers[i:i+batch_size]
        print(f"  仕入先 {i+1}-{min(i+batch_size, len(suppliers))}/{len(suppliers)} を処理中...")
        
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
                    product['supplierName'] = group.get('supplierName', '')
                    all_products.append(product)
    
    return all_products

def assign_abc_rank(products):
    """売上金額に基づいてABCDEランクを付与"""
    # 売上金額を計算（日販 × 単価）
    for p in products:
        p['salesValue'] = p.get('avgDailySales', 0) * p.get('unitPrice', 0)
    
    # 売上金額でソート
    sorted_products = sorted(products, key=lambda x: x['salesValue'], reverse=True)
    total_products = len(sorted_products)
    
    # ランク付け（累積比率）
    for i, p in enumerate(sorted_products):
        ratio = (i + 1) / total_products
        if ratio <= 0.20:
            p['rank'] = 'A'
        elif ratio <= 0.40:
            p['rank'] = 'B'
        elif ratio <= 0.60:
            p['rank'] = 'C'
        elif ratio <= 0.80:
            p['rank'] = 'D'
        else:
            p['rank'] = 'E'
    
    return sorted_products

def calculate_order_with_rank(product, forecast_days, lead_time=3, order_interval=7):
    """ランク別係数を適用した発注数を計算"""
    rank = product.get('rank', 'C')
    coefficient = RANK_COEFFICIENTS.get(rank, 1.0)
    
    daily_sales = product.get('avgDailySales', 0)
    current_stock = product.get('currentStock', 0)
    
    # リードタイム + 発注間隔を考慮
    cover_days = lead_time + order_interval
    
    # 基本発注数 = 日販 × カバー日数 - 現在庫
    base_order = daily_sales * cover_days - current_stock
    
    # ランク係数を適用
    adjusted_order = base_order * coefficient
    
    # 発注ロットを考慮
    order_lot = product.get('orderLot', 1)
    if adjusted_order > 0:
        order_qty = max(order_lot, int((adjusted_order + order_lot - 1) // order_lot) * order_lot)
    else:
        order_qty = 0
    
    return {
        'rank_order': max(0, order_qty),
        'base_order': max(0, int(base_order)),
        'coefficient': coefficient
    }

def simulate_october(products_sep, actual_october_sales):
    """10月のシミュレーション"""
    results = []
    
    for product in products_sep:
        pid = product.get('productId')
        
        # 現行ロジックの発注数
        current_order = product.get('recommendedOrder', 0)
        
        # ランク別係数を適用した発注数
        rank_result = calculate_order_with_rank(product, forecast_days=10)
        rank_order = rank_result['rank_order']
        
        # 9月末在庫
        sep_end_stock = product.get('currentStock', 0)
        
        # 10月の実売上（あれば）
        oct_sales = actual_october_sales.get(pid, 0)
        
        # 10月末在庫予測
        # 現行ロジック: 9月末在庫 + 発注数 - 10月売上
        current_oct_end = sep_end_stock + current_order - oct_sales
        
        # ランク別ロジック
        rank_oct_end = sep_end_stock + rank_order - oct_sales
        
        results.append({
            'productId': pid,
            'productName': product.get('productName', ''),
            'supplierName': product.get('supplierName', ''),
            'rank': product.get('rank', 'C'),
            'unitPrice': product.get('unitPrice', 0),
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
    print("新宿店 2025年10月 月末在庫予測シミュレーション（全仕入先対応版）")
    print("=" * 70)
    
    # 1. 全仕入先を取得
    print("\n1. 仕入先一覧を取得中...")
    suppliers = get_all_suppliers()
    print(f"   仕入先数: {len(suppliers)}")
    
    # 2. 2025年9月30日時点のデータを取得（10月発注の基準）
    print("\n2. 2025年9月のデータを取得中...")
    products_sep = get_forecast_data(
        suppliers,
        order_date="2025-09-30",
        forecast_days=10,  # 10月10日までカバー
        lookback_days=30   # 9月の売上を参照
    )
    print(f"   取得商品数: {len(products_sep)}")
    
    if len(products_sep) == 0:
        print("エラー: 商品データが取得できませんでした")
        return
    
    # 3. ABCDEランクを付与
    print("\n3. ABCDEランクを付与中...")
    products_sep = assign_abc_rank(products_sep)
    
    rank_counts = defaultdict(int)
    for p in products_sep:
        rank_counts[p['rank']] += 1
    print(f"   ランク分布: {dict(rank_counts)}")
    
    # 4. 10月の実売上データを取得
    print("\n4. 2025年10月の売上データを取得中...")
    # 10月全体の売上を取得するため、10月31日を基準に30日間参照
    products_oct = get_forecast_data(
        suppliers,
        order_date="2025-10-31",
        forecast_days=1,
        lookback_days=31  # 10月全体
    )
    
    # 10月の売上を集計（日販 × 31日）
    actual_october_sales = {}
    for p in products_oct:
        pid = p.get('productId')
        daily_sales = p.get('avgDailySales', 0)
        actual_october_sales[pid] = int(daily_sales * 31)
    
    print(f"   10月売上データ商品数: {len(actual_october_sales)}")
    
    # 5. シミュレーション実行
    print("\n5. シミュレーション実行中...")
    results = simulate_october(products_sep, actual_october_sales)
    
    # 6. 結果集計
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
    
    print(f"\n  ■ 現行ロジック")
    print(f"    10月発注数: {total_current_order:,}個")
    print(f"    10月末在庫数量: {total_current_oct_end:,}個")
    print(f"    10月末在庫金額: ¥{total_current_oct_end_value:,.0f}")
    print(f"    欠品商品数: {current_stockout_count}商品 ({current_stockout_count/len(df)*100:.1f}%)")
    
    print(f"\n  ■ 中程度パターン（ABCDEランク別）")
    print(f"    10月発注数: {total_rank_order:,}個")
    print(f"    10月末在庫数量: {total_rank_oct_end:,}個")
    print(f"    10月末在庫金額: ¥{total_rank_oct_end_value:,.0f}")
    print(f"    欠品商品数: {rank_stockout_count}商品 ({rank_stockout_count/len(df)*100:.1f}%)")
    
    # ランク別詳細
    print(f"\n【ランク別詳細】")
    for rank in ['A', 'B', 'C', 'D', 'E']:
        rank_df = df[df['rank'] == rank]
        if len(rank_df) > 0:
            print(f"\n  {rank}ランク ({len(rank_df)}商品, 係数{RANK_COEFFICIENTS[rank]}):")
            print(f"    現行欠品率: {rank_df['currentStockout'].sum()/len(rank_df)*100:.1f}%")
            print(f"    ランク別欠品率: {rank_df['rankStockout'].sum()/len(rank_df)*100:.1f}%")
            print(f"    現行10月末在庫金額: ¥{(rank_df['currentOctEnd'] * rank_df['unitPrice']).sum():,.0f}")
            print(f"    ランク別10月末在庫金額: ¥{(rank_df['rankOctEnd'] * rank_df['unitPrice']).sum():,.0f}")
    
    # 結果をCSV保存
    output_file = "/home/ubuntu/fc-demand-forecast/analysis/shinjuku_oct_full_results.csv"
    df.to_csv(output_file, index=False, encoding='utf-8-sig')
    print(f"\n詳細結果を保存: {output_file}")
    
    # サマリーをCSV保存
    summary_data = {
        '指標': [
            '商品数',
            '9月末在庫数量',
            '9月末在庫金額',
            '10月売上合計',
            '現行_10月発注数',
            '現行_10月末在庫数量',
            '現行_10月末在庫金額',
            '現行_欠品商品数',
            '現行_欠品率',
            'ランク別_10月発注数',
            'ランク別_10月末在庫数量',
            'ランク別_10月末在庫金額',
            'ランク別_欠品商品数',
            'ランク別_欠品率'
        ],
        '値': [
            len(df),
            total_sep_stock,
            total_sep_stock_value,
            total_oct_sales,
            total_current_order,
            total_current_oct_end,
            total_current_oct_end_value,
            current_stockout_count,
            f"{current_stockout_count/len(df)*100:.1f}%",
            total_rank_order,
            total_rank_oct_end,
            total_rank_oct_end_value,
            rank_stockout_count,
            f"{rank_stockout_count/len(df)*100:.1f}%"
        ]
    }
    summary_df = pd.DataFrame(summary_data)
    summary_file = "/home/ubuntu/fc-demand-forecast/analysis/shinjuku_oct_full_summary.csv"
    summary_df.to_csv(summary_file, index=False, encoding='utf-8-sig')
    print(f"サマリーを保存: {summary_file}")

if __name__ == "__main__":
    main()
