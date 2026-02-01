#!/usr/bin/env python3
"""
新宿店シミュレーション - スマレジCSVのみを使用
ABCDEランク別重み付け + リードタイム + 発注間隔

日販は過去の売上データから推定（月間売上 ÷ 30日）
新宿店の月間売上は約840万円（2025年10月実績）
"""

import pandas as pd
import numpy as np

# 設定
LEAD_TIME = 3  # リードタイム（日）
ORDER_INTERVAL = 7  # 発注間隔（日）
FORECAST_DAYS = LEAD_TIME + ORDER_INTERVAL  # 予測日数 = 10日

# 月間売上（2025年10月実績）
MONTHLY_SALES = 8460307  # ¥8,460,307

# ABCDEランク別係数（中程度パターン）
RANK_COEFFICIENTS = {
    'A': 1.3,
    'B': 1.15,
    'C': 1.0,
    'D': 0.8,
    'E': 0.6
}

print("=" * 60)
print("新宿店 ABCDEランク別シミュレーション（CSVのみ）")
print("=" * 60)

# 1. スマレジCSVから在庫データを読み込む
print("\n📊 スマレジCSVから在庫データを読み込み中...")
csv_path = "/home/ubuntu/upload/在庫一覧(20260130110411).csv"
stock_df = pd.read_csv(csv_path, encoding='utf-8-sig')

print(f"   読み込んだ商品数: {len(stock_df)}")

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

# 在庫金額（販売価格ベース）を計算
stock_df['stock_value_retail'] = stock_df['stock_for_calc'] * stock_df['selling_price']

print(f"\n📈 在庫サマリー:")
print(f"   総商品数: {len(stock_df)}")
print(f"   在庫あり商品: {len(stock_df[stock_df['stock_amount'] > 0])}")
print(f"   マイナス在庫商品: {len(stock_df[stock_df['stock_amount'] < 0])}")
print(f"   総在庫数量: {stock_df['stock_for_calc'].sum():,}")
print(f"   総在庫金額（原価）: ¥{stock_df[stock_df['stock_value'] > 0]['stock_value'].sum():,.0f}")
print(f"   総在庫金額（販売価格）: ¥{stock_df['stock_value_retail'].sum():,.0f}")

# 2. 日販を推定
# 在庫金額の比率から各商品の売上を推定
# 仮定：在庫金額が大きい商品ほど売上も大きい
print("\n📊 日販を推定中...")

# 在庫金額の合計
total_stock_value = stock_df['stock_value_retail'].sum()

# 各商品の売上比率を計算（在庫金額ベース）
stock_df['sales_ratio'] = stock_df['stock_value_retail'] / total_stock_value if total_stock_value > 0 else 0

# 月間売上から日販を推定
daily_total_sales = MONTHLY_SALES / 30
stock_df['estimated_daily_sales_value'] = stock_df['sales_ratio'] * daily_total_sales

# 日販数量を計算
stock_df['daily_sales'] = stock_df['estimated_daily_sales_value'] / stock_df['selling_price']
stock_df['daily_sales'] = stock_df['daily_sales'].fillna(0)

print(f"   月間売上: ¥{MONTHLY_SALES:,}")
print(f"   日販合計（推定）: ¥{daily_total_sales:,.0f}")
print(f"   日販数量合計（推定）: {stock_df['daily_sales'].sum():,.1f}個/日")

# 3. ABCDEランク付け（推定売上金額ベース）
print("\n🏷️ ABCDEランク付け...")

# 売上金額でソート
stock_df = stock_df.sort_values('estimated_daily_sales_value', ascending=False).reset_index(drop=True)

# 累積売上比率を計算
total_sales = stock_df['estimated_daily_sales_value'].sum()
if total_sales > 0:
    stock_df['cumulative_ratio'] = stock_df['estimated_daily_sales_value'].cumsum() / total_sales
else:
    stock_df['cumulative_ratio'] = 0

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

stock_df['rank'] = stock_df.apply(lambda x: assign_rank(x['cumulative_ratio'], x['estimated_daily_sales_value']), axis=1)

# ランク別集計
rank_counts = stock_df.groupby('rank').size()
print("\n📊 ランク別商品数:")
for rank in ['A', 'B', 'C', 'D', 'E']:
    if rank in rank_counts.index:
        print(f"   {rank}ランク: {rank_counts[rank]}商品")

# 4. 発注シミュレーション
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
stock_df['order_current'] = stock_df.apply(lambda x: calculate_order(x, use_rank_coef=False), axis=1)

# 中程度パターン（係数あり）
stock_df['order_ranked'] = stock_df.apply(lambda x: calculate_order(x, use_rank_coef=True), axis=1)

# 発注金額を計算
stock_df['order_value_current'] = stock_df['order_current'] * stock_df['cost_price']
stock_df['order_value_ranked'] = stock_df['order_ranked'] * stock_df['cost_price']

# 5. 結果サマリー
print("\n" + "=" * 60)
print("📊 シミュレーション結果")
print("=" * 60)

print(f"\n【基準データ】")
print(f"   対象商品数: {len(stock_df)}")
print(f"   現在庫数量: {stock_df['stock_for_calc'].sum():,.0f}個")
print(f"   現在庫金額（原価）: ¥{stock_df[stock_df['stock_value'] > 0]['stock_value'].sum():,.0f}")
print(f"   現在庫金額（販売価格）: ¥{stock_df['stock_value_retail'].sum():,.0f}")
print(f"   欠品商品数: {len(stock_df[stock_df['stock_for_calc'] == 0])} ({len(stock_df[stock_df['stock_for_calc'] == 0]) / len(stock_df) * 100:.1f}%)")

print(f"\n【発注シミュレーション比較】")
print(f"   予測日数: {FORECAST_DAYS}日（リードタイム{LEAD_TIME}日 + 発注間隔{ORDER_INTERVAL}日）")
print(f"")
print(f"   現行ロジック（係数1.0）:")
print(f"     発注数量: {stock_df['order_current'].sum():,.0f}個")
print(f"     発注金額（原価）: ¥{stock_df['order_value_current'].sum():,.0f}")
print(f"")
print(f"   中程度パターン（A=1.3, B=1.15, C=1.0, D=0.8, E=0.6）:")
print(f"     発注数量: {stock_df['order_ranked'].sum():,.0f}個")
print(f"     発注金額（原価）: ¥{stock_df['order_value_ranked'].sum():,.0f}")

# ランク別詳細
print(f"\n【ランク別詳細】")
print(f"{'ランク':<6} {'商品数':<8} {'係数':<6} {'現行発注':<12} {'ランク別発注':<12} {'差分':<10} {'欠品数':<8}")
print("-" * 70)

for rank in ['A', 'B', 'C', 'D', 'E']:
    rank_data = stock_df[stock_df['rank'] == rank]
    if len(rank_data) > 0:
        coef = RANK_COEFFICIENTS[rank]
        order_current = rank_data['order_current'].sum()
        order_ranked = rank_data['order_ranked'].sum()
        diff = order_ranked - order_current
        stockout = len(rank_data[rank_data['stock_for_calc'] == 0])
        print(f"{rank:<6} {len(rank_data):<8} {coef:<6.2f} {order_current:<12,.0f} {order_ranked:<12,.0f} {diff:+10,.0f} {stockout:<8}")

# 6. 在庫回転率と適正在庫の分析
print(f"\n【在庫分析】")
# 在庫日数 = 現在庫 ÷ 日販
stock_df['stock_days'] = stock_df.apply(
    lambda x: x['stock_for_calc'] / x['daily_sales'] if x['daily_sales'] > 0 else 999,
    axis=1
)

for rank in ['A', 'B', 'C', 'D', 'E']:
    rank_data = stock_df[stock_df['rank'] == rank]
    if len(rank_data) > 0:
        avg_stock_days = rank_data[rank_data['stock_days'] < 999]['stock_days'].mean()
        total_stock_value = rank_data['stock_value_retail'].sum()
        print(f"   {rank}ランク: 平均在庫日数 {avg_stock_days:.1f}日, 在庫金額 ¥{total_stock_value:,.0f}")

# 7. 結果をCSVに保存
output_path = "/home/ubuntu/fc-demand-forecast/analysis/shinjuku_csv_simulation_result.csv"
stock_df.to_csv(output_path, index=False, encoding='utf-8-sig')
print(f"\n📁 詳細結果を保存: {output_path}")

# サマリーをCSVに保存
summary_data = []
for rank in ['A', 'B', 'C', 'D', 'E']:
    rank_data = stock_df[stock_df['rank'] == rank]
    if len(rank_data) > 0:
        avg_stock_days = rank_data[rank_data['stock_days'] < 999]['stock_days'].mean()
        summary_data.append({
            'ランク': rank,
            '商品数': len(rank_data),
            '係数': RANK_COEFFICIENTS[rank],
            '現行発注数': rank_data['order_current'].sum(),
            'ランク別発注数': rank_data['order_ranked'].sum(),
            '差分': rank_data['order_ranked'].sum() - rank_data['order_current'].sum(),
            '欠品商品数': len(rank_data[rank_data['stock_for_calc'] == 0]),
            '在庫金額（販売価格）': rank_data['stock_value_retail'].sum(),
            '平均在庫日数': avg_stock_days
        })

summary_df = pd.DataFrame(summary_data)
summary_path = "/home/ubuntu/fc-demand-forecast/analysis/shinjuku_csv_simulation_summary.csv"
summary_df.to_csv(summary_path, index=False, encoding='utf-8-sig')
print(f"📁 サマリーを保存: {summary_path}")

print("\n✅ シミュレーション完了")
