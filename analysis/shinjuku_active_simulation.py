#!/usr/bin/env python3
"""
新宿店 シミュレーション（廃盤商品除外版）
- 最新の在庫データ（2026年1月）を使用
- 廃盤商品除外: isActive=True または 在庫>0 の商品のみ対象
- 中程度パターン（ABCDEランク別重み付け＋リードタイム＋発注間隔）と現行ロジックを比較
"""

import requests
import json
from datetime import datetime, timedelta
from collections import defaultdict
import pandas as pd

API_BASE = "https://fc-demand-forecast-production.up.railway.app/api"
STORE_ID = "1"  # 新宿店（正しいstoreId）

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

def filter_active_products(products):
    """廃盤商品を除外: isActive=True または 在庫>0"""
    active_products = []
    excluded_count = 0
    
    for p in products:
        is_active = p.get('isActive', False)
        current_stock = p.get('currentStock', 0)
        
        # マイナス在庫は0として扱う
        if current_stock < 0:
            p['currentStock'] = 0
            current_stock = 0
        
        # isActive=True または 在庫>0 の商品を残す
        if is_active or current_stock > 0:
            active_products.append(p)
        else:
            excluded_count += 1
    
    return active_products, excluded_count

def assign_abc_rank_by_sales(products):
    """売上金額に基づいてABCDEランクを再計算"""
    # 売上金額を計算（日販 × 単価）
    for p in products:
        daily_sales = p.get('avgDailySales', 0)
        unit_price = p.get('retailPrice', 0)
        p['salesValue'] = daily_sales * unit_price
    
    # 売上金額でソート
    sorted_products = sorted(products, key=lambda x: x['salesValue'], reverse=True)
    total_products = len(sorted_products)
    
    # ランク付け（上位20%=A, 20-40%=B, 40-60%=C, 60-80%=D, 80-100%=E）
    for i, p in enumerate(sorted_products):
        ratio = (i + 1) / total_products
        if ratio <= 0.20:
            p['calculatedRank'] = 'A'
        elif ratio <= 0.40:
            p['calculatedRank'] = 'B'
        elif ratio <= 0.60:
            p['calculatedRank'] = 'C'
        elif ratio <= 0.80:
            p['calculatedRank'] = 'D'
        else:
            p['calculatedRank'] = 'E'
    
    return sorted_products

def calculate_order_with_rank(product, lead_time=3, order_interval=7):
    """ランク別係数を適用した発注数を計算（リードタイム＋発注間隔考慮）"""
    rank = product.get('calculatedRank', 'C')
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
        'base_order': max(0, int(base_order)) if base_order > 0 else 0,
        'coefficient': coefficient,
        'rank': rank,
        'cover_days': cover_days
    }

def simulate(products):
    """シミュレーション実行"""
    results = []
    
    for product in products:
        pid = product.get('productId')
        
        # 現行ロジックの発注数（APIから取得）
        current_order = product.get('recommendedOrder', 0)
        
        # ランク別係数を適用した発注数
        rank_result = calculate_order_with_rank(product)
        rank_order = rank_result['rank_order']
        
        # 現在庫
        current_stock = product.get('currentStock', 0)
        
        # 単価
        unit_price = product.get('retailPrice', 0)
        
        # 日販
        daily_sales = product.get('avgDailySales', 0)
        
        # 在庫日数（現在庫 ÷ 日販）
        stock_days = current_stock / daily_sales if daily_sales > 0 else float('inf')
        
        # 欠品判定（在庫0かつ売上あり）
        is_stockout = current_stock == 0 and daily_sales > 0
        
        results.append({
            'productId': pid,
            'productName': product.get('productName', ''),
            'supplierName': product.get('supplierName', ''),
            'rank': rank_result['rank'],
            'unitPrice': unit_price,
            'currentStock': current_stock,
            'avgDailySales': daily_sales,
            'stockDays': stock_days if stock_days != float('inf') else 999,
            'currentOrder': current_order,
            'currentOrderAmount': current_order * unit_price,
            'rankOrder': rank_order,
            'rankOrderAmount': rank_order * unit_price,
            'coefficient': rank_result['coefficient'],
            'coverDays': rank_result['cover_days'],
            'isStockout': is_stockout,
            'isActive': product.get('isActive', False)
        })
    
    return results

def main():
    print("=" * 70)
    print("新宿店 シミュレーション（廃盤商品除外版）")
    print("=" * 70)
    print("条件:")
    print("  - 最新の在庫データ（2026年1月）を使用")
    print("  - 廃盤商品除外: isActive=True または 在庫>0 の商品のみ対象")
    print("  - 中程度パターン: リードタイム(3日)+発注間隔(7日)×ランク係数")
    print("=" * 70)
    
    # 1. 全仕入先を取得
    print("\n1. 仕入先一覧を取得中...")
    suppliers = get_all_suppliers()
    print(f"   仕入先数: {len(suppliers)}")
    
    # 2. 最新データを取得
    print("\n2. 最新データを取得中...")
    today = datetime.now().strftime("%Y-%m-%d")
    products_all = get_forecast_data(
        suppliers,
        order_date=today,
        forecast_days=10,
        lookback_days=30
    )
    print(f"   全商品数: {len(products_all)}")
    
    if len(products_all) == 0:
        print("エラー: 商品データが取得できませんでした")
        return
    
    # 3. 廃盤商品を除外
    print("\n3. 廃盤商品を除外中...")
    products_active, excluded_count = filter_active_products(products_all)
    print(f"   除外商品数: {excluded_count}")
    print(f"   対象商品数: {len(products_active)}")
    
    # 4. ABCDEランクを再計算
    print("\n4. ABCDEランクを計算中...")
    products_ranked = assign_abc_rank_by_sales(products_active)
    
    rank_counts = defaultdict(int)
    for p in products_ranked:
        rank_counts[p['calculatedRank']] += 1
    print(f"   ランク分布: {dict(sorted(rank_counts.items()))}")
    
    # 5. シミュレーション実行
    print("\n5. シミュレーション実行中...")
    results = simulate(products_ranked)
    
    # 6. 結果集計
    print("\n" + "=" * 70)
    print("シミュレーション結果")
    print("=" * 70)
    
    df = pd.DataFrame(results)
    
    # 全体サマリー
    total_stock = df['currentStock'].sum()
    total_stock_value = (df['currentStock'] * df['unitPrice']).sum()
    
    total_current_order = df['currentOrder'].sum()
    total_current_order_value = df['currentOrderAmount'].sum()
    
    total_rank_order = df['rankOrder'].sum()
    total_rank_order_value = df['rankOrderAmount'].sum()
    
    stockout_count = df['isStockout'].sum()
    
    print(f"\n【基準データ】")
    print(f"  対象商品数: {len(df)}")
    print(f"  現在庫数量: {total_stock:,}個")
    print(f"  現在庫金額: ¥{total_stock_value:,.0f}")
    print(f"  欠品商品数: {stockout_count}商品 ({stockout_count/len(df)*100:.1f}%)")
    
    print(f"\n【発注シミュレーション】")
    print(f"\n  ■ 現行ロジック（日販×予測日数-現在庫）")
    print(f"    発注数量: {total_current_order:,}個")
    print(f"    発注金額: ¥{total_current_order_value:,.0f}")
    
    print(f"\n  ■ 中程度パターン（リードタイム+発注間隔×ランク係数）")
    print(f"    発注数量: {total_rank_order:,}個")
    print(f"    発注金額: ¥{total_rank_order_value:,.0f}")
    
    # 比較
    order_diff = total_rank_order - total_current_order
    order_value_diff = total_rank_order_value - total_current_order_value
    
    print(f"\n【比較】")
    if total_current_order > 0:
        print(f"  発注数量差: {order_diff:+,}個 ({order_diff/total_current_order*100:+.1f}%)")
    if total_current_order_value > 0:
        print(f"  発注金額差: ¥{order_value_diff:+,.0f} ({order_value_diff/total_current_order_value*100:+.1f}%)")
    
    # ランク別詳細
    print(f"\n【ランク別詳細】")
    print(f"{'ランク':^6} {'商品数':>8} {'係数':>6} {'現行発注':>12} {'ランク別発注':>14} {'差分':>12} {'欠品数':>8}")
    print("-" * 80)
    
    for rank in ['A', 'B', 'C', 'D', 'E']:
        rank_df = df[df['rank'] == rank]
        if len(rank_df) > 0:
            current_order_sum = rank_df['currentOrder'].sum()
            rank_order_sum = rank_df['rankOrder'].sum()
            diff = rank_order_sum - current_order_sum
            stockout = rank_df['isStockout'].sum()
            
            print(f"{rank:^6} {len(rank_df):>8} {RANK_COEFFICIENTS[rank]:>6.2f} {current_order_sum:>12,} {rank_order_sum:>14,} {diff:>+12,} {stockout:>8}")
    
    # 欠品商品のランク別分布
    print(f"\n【欠品商品のランク別分布】")
    stockout_df = df[df['isStockout'] == True]
    if len(stockout_df) > 0:
        for rank in ['A', 'B', 'C', 'D', 'E']:
            rank_stockout = stockout_df[stockout_df['rank'] == rank]
            if len(rank_stockout) > 0:
                print(f"  {rank}ランク: {len(rank_stockout)}商品")
    
    # 結果をCSV保存
    output_file = "/home/ubuntu/fc-demand-forecast/analysis/shinjuku_active_results.csv"
    df.to_csv(output_file, index=False, encoding='utf-8-sig')
    print(f"\n詳細結果を保存: {output_file}")
    
    # サマリーをCSV保存
    summary_data = []
    summary_data.append({'指標': '対象商品数', '値': len(df)})
    summary_data.append({'指標': '現在庫数量', '値': total_stock})
    summary_data.append({'指標': '現在庫金額', '値': total_stock_value})
    summary_data.append({'指標': '欠品商品数', '値': stockout_count})
    summary_data.append({'指標': '現行_発注数量', '値': total_current_order})
    summary_data.append({'指標': '現行_発注金額', '値': total_current_order_value})
    summary_data.append({'指標': 'ランク別_発注数量', '値': total_rank_order})
    summary_data.append({'指標': 'ランク別_発注金額', '値': total_rank_order_value})
    
    summary_df = pd.DataFrame(summary_data)
    summary_file = "/home/ubuntu/fc-demand-forecast/analysis/shinjuku_active_summary.csv"
    summary_df.to_csv(summary_file, index=False, encoding='utf-8-sig')
    print(f"サマリーを保存: {summary_file}")

if __name__ == "__main__":
    main()
