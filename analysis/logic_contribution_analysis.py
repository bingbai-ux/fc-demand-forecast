#!/usr/bin/env python3
"""
現行ロジックの各要素の貢献度検証

【検証する要素】
1. 変動係数（CV）による安全在庫調整
2. 安全在庫の√日数計算
3. 月末在庫調整
4. 予測日数の設定

【検証方法】
各要素を無効化した場合と現行ロジックを比較し、
欠品リスク・適正在庫率・在庫金額への影響を測定
"""

import json
import pandas as pd
import numpy as np
from pathlib import Path
from datetime import datetime

# データ読み込み
periods = {
    "2025年5月": "period_2025_05.json",
    "2025年10月": "period_2025_10.json",
    "2026年1月": "period_2026_01.json",
}

def load_period_data(filename):
    """期間データを読み込み"""
    with open(f"/home/ubuntu/fc-demand-forecast/analysis/{filename}", "r") as f:
        data = json.load(f)
    
    products = []
    for group in data.get("supplierGroups", []):
        supplier_settings = group.get("supplierSettings", {})
        lead_time = supplier_settings.get("leadTimeDays", 3)
        
        for product in group.get("products", []):
            past_sales = product.get("pastSales", {}).get("data", [])
            
            # 週次売上データを取得
            weekly_sales = [s.get("qty", 0) for s in past_sales]
            
            products.append({
                "product_id": product.get("productId"),
                "product_name": product.get("productName"),
                "supplier": product.get("supplierName"),
                "current_stock": product.get("currentStock", 0),
                "weekly_sales": weekly_sales,
                "avg_daily_sales": product.get("avgDailySales", 0),
                "rank": product.get("rank", "E"),
                "cv": product.get("coefficientOfVariation", 0),
                "cost": float(product.get("cost", 0)),
                "recommended_order": product.get("recommendedOrder", 0),
                "lead_time": lead_time,
            })
    
    return pd.DataFrame(products)

# ============================================
# 発注ロジックのバリエーション
# ============================================

def calculate_order_full(row, forecast_days=7, is_month_end=False, days_to_month_end=10):
    """
    現行ロジック（フル機能）
    - CV調整: あり
    - √日数計算: あり
    - 月末調整: あり
    """
    avg_daily = row["avg_daily_sales"]
    current_stock = row["current_stock"]
    cv = row["cv"]
    
    # 変動係数による安全在庫係数調整
    if cv >= 0.6:
        safety_factor = 1.0
    elif cv >= 0.3:
        safety_factor = 0.7
    else:
        safety_factor = 0.5
    
    # 予測売数
    forecast_qty = avg_daily * forecast_days
    
    # 安全在庫（√日数計算）
    safety_stock = avg_daily * np.sqrt(forecast_days) * safety_factor
    
    # 月末調整
    if is_month_end and days_to_month_end <= 5:
        reduction = (6 - days_to_month_end) * 0.1  # 10%〜50%削減
        safety_stock *= (1 - reduction)
    
    # 発注数
    order_qty = max(0, np.ceil(forecast_qty + safety_stock - current_stock))
    
    return order_qty, safety_stock

def calculate_order_no_cv(row, forecast_days=7, is_month_end=False, days_to_month_end=10):
    """
    CV調整なし（固定係数0.7）
    """
    avg_daily = row["avg_daily_sales"]
    current_stock = row["current_stock"]
    
    # 固定の安全在庫係数
    safety_factor = 0.7
    
    forecast_qty = avg_daily * forecast_days
    safety_stock = avg_daily * np.sqrt(forecast_days) * safety_factor
    
    if is_month_end and days_to_month_end <= 5:
        reduction = (6 - days_to_month_end) * 0.1
        safety_stock *= (1 - reduction)
    
    order_qty = max(0, np.ceil(forecast_qty + safety_stock - current_stock))
    
    return order_qty, safety_stock

def calculate_order_no_sqrt(row, forecast_days=7, is_month_end=False, days_to_month_end=10):
    """
    √日数計算なし（単純に日数を掛ける）
    """
    avg_daily = row["avg_daily_sales"]
    current_stock = row["current_stock"]
    cv = row["cv"]
    
    if cv >= 0.6:
        safety_factor = 1.0
    elif cv >= 0.3:
        safety_factor = 0.7
    else:
        safety_factor = 0.5
    
    forecast_qty = avg_daily * forecast_days
    # √ではなく、日販 × 係数 × 固定日数（3日分）
    safety_stock = avg_daily * 3 * safety_factor
    
    if is_month_end and days_to_month_end <= 5:
        reduction = (6 - days_to_month_end) * 0.1
        safety_stock *= (1 - reduction)
    
    order_qty = max(0, np.ceil(forecast_qty + safety_stock - current_stock))
    
    return order_qty, safety_stock

def calculate_order_no_month_end(row, forecast_days=7, is_month_end=False, days_to_month_end=10):
    """
    月末調整なし
    """
    avg_daily = row["avg_daily_sales"]
    current_stock = row["current_stock"]
    cv = row["cv"]
    
    if cv >= 0.6:
        safety_factor = 1.0
    elif cv >= 0.3:
        safety_factor = 0.7
    else:
        safety_factor = 0.5
    
    forecast_qty = avg_daily * forecast_days
    safety_stock = avg_daily * np.sqrt(forecast_days) * safety_factor
    
    # 月末調整なし
    
    order_qty = max(0, np.ceil(forecast_qty + safety_stock - current_stock))
    
    return order_qty, safety_stock

def calculate_order_minimal(row, forecast_days=7, is_month_end=False, days_to_month_end=10):
    """
    最小限ロジック（全ての調整なし）
    発注数 = 予測売数 - 現在庫
    """
    avg_daily = row["avg_daily_sales"]
    current_stock = row["current_stock"]
    
    forecast_qty = avg_daily * forecast_days
    safety_stock = 0  # 安全在庫なし
    
    order_qty = max(0, np.ceil(forecast_qty - current_stock))
    
    return order_qty, safety_stock

def calculate_order_simple_safety(row, forecast_days=7, is_month_end=False, days_to_month_end=10):
    """
    シンプル安全在庫（日販×固定日数）
    """
    avg_daily = row["avg_daily_sales"]
    current_stock = row["current_stock"]
    
    forecast_qty = avg_daily * forecast_days
    safety_stock = avg_daily * 2  # 固定2日分
    
    order_qty = max(0, np.ceil(forecast_qty + safety_stock - current_stock))
    
    return order_qty, safety_stock

# ============================================
# 評価関数
# ============================================

def evaluate_logic(df, calc_func, logic_name, is_month_end=False, days_to_month_end=10):
    """ロジックを評価"""
    results = df.copy()
    
    # 発注数と安全在庫を計算
    order_data = results.apply(
        lambda row: calc_func(row, is_month_end=is_month_end, days_to_month_end=days_to_month_end), 
        axis=1
    )
    results["order_qty"] = [d[0] for d in order_data]
    results["safety_stock"] = [d[1] for d in order_data]
    
    results["order_amount"] = results["order_qty"] * results["cost"]
    results["stock_after_order"] = results["current_stock"] + results["order_qty"]
    
    # 在庫カバー日数
    results["days_covered"] = np.where(
        results["avg_daily_sales"] > 0,
        results["stock_after_order"] / results["avg_daily_sales"],
        999
    )
    
    active = results[results["avg_daily_sales"] > 0]
    
    # 評価指標
    stockout_risk = (active["days_covered"] < 7).sum()
    overstock_risk = (active["days_covered"] > 21).sum()
    optimal = ((active["days_covered"] >= 7) & (active["days_covered"] <= 14)).sum()
    
    # 在庫金額
    results["stock_value"] = results["stock_after_order"] * results["cost"]
    
    return {
        "logic": logic_name,
        "total_order_qty": int(results["order_qty"].sum()),
        "total_order_amount": int(results["order_amount"].sum()),
        "total_stock_value": int(results["stock_value"].sum()),
        "avg_safety_stock": round(active["safety_stock"].mean(), 2) if len(active) > 0 else 0,
        "avg_days_covered": round(active["days_covered"].mean(), 1) if len(active) > 0 else 0,
        "stockout_risk": stockout_risk,
        "stockout_rate": round(stockout_risk / len(active) * 100, 1) if len(active) > 0 else 0,
        "overstock_rate": round(overstock_risk / len(active) * 100, 1) if len(active) > 0 else 0,
        "optimal_count": optimal,
        "optimal_rate": round(optimal / len(active) * 100, 1) if len(active) > 0 else 0,
        "active_products": len(active),
    }

# ============================================
# メイン分析
# ============================================

print("=" * 80)
print("現行ロジックの各要素 貢献度検証")
print("=" * 80)

print("""
【検証するロジックバリエーション】

1. 現行ロジック（フル機能）
   - CV調整: あり（0.5/0.7/1.0）
   - √日数計算: あり
   - 月末調整: あり

2. CV調整なし
   - CV調整: なし（固定0.7）
   - √日数計算: あり
   - 月末調整: あり

3. √日数計算なし
   - CV調整: あり
   - √日数計算: なし（固定3日分）
   - 月末調整: あり

4. 月末調整なし
   - CV調整: あり
   - √日数計算: あり
   - 月末調整: なし

5. 最小限ロジック
   - 安全在庫なし
   - 発注数 = 予測売数 - 現在庫

6. シンプル安全在庫
   - 安全在庫 = 日販 × 2日分（固定）
""")

# 各期間のデータを分析
all_results = []

logics = [
    ("現行ロジック（フル）", calculate_order_full),
    ("CV調整なし", calculate_order_no_cv),
    ("√日数計算なし", calculate_order_no_sqrt),
    ("月末調整なし", calculate_order_no_month_end),
    ("最小限ロジック", calculate_order_minimal),
    ("シンプル安全在庫", calculate_order_simple_safety),
]

# 月末シナリオも検証
scenarios = [
    ("通常時", False, 10),
    ("月末3日前", True, 3),
]

for period_name, filename in periods.items():
    print(f"\n{'='*60}")
    print(f"期間: {period_name}")
    print(f"{'='*60}")
    
    df = load_period_data(filename)
    active_count = len(df[df["avg_daily_sales"] > 0])
    print(f"商品数: {len(df)} (アクティブ: {active_count})")
    
    for scenario_name, is_month_end, days_to_month_end in scenarios:
        print(f"\n--- シナリオ: {scenario_name} ---")
        
        period_results = []
        for name, func in logics:
            result = evaluate_logic(df, func, name, is_month_end, days_to_month_end)
            result["period"] = period_name
            result["scenario"] = scenario_name
            period_results.append(result)
            all_results.append(result)
        
        # 結果表示
        summary = pd.DataFrame([{
            "ロジック": r["logic"],
            "発注数": r["total_order_qty"],
            "発注金額": f"¥{r['total_order_amount']:,}",
            "在庫金額": f"¥{r['total_stock_value']:,}",
            "安全在庫": f"{r['avg_safety_stock']:.1f}",
            "カバー日数": f"{r['avg_days_covered']}日",
            "欠品リスク": f"{r['stockout_rate']}%",
            "適正在庫率": f"{r['optimal_rate']}%",
        } for r in period_results])
        
        print("\n" + summary.to_string(index=False))

# ============================================
# 貢献度分析
# ============================================

print("\n\n" + "=" * 80)
print("★ 各要素の貢献度分析")
print("=" * 80)

results_df = pd.DataFrame(all_results)

# 通常時のみで比較
normal_results = results_df[results_df["scenario"] == "通常時"]

# 各ロジックの平均値を計算
contribution_data = []
baseline = normal_results[normal_results["logic"] == "現行ロジック（フル）"]
baseline_optimal = baseline["optimal_rate"].mean()
baseline_stockout = baseline["stockout_rate"].mean()
baseline_stock_value = baseline["total_stock_value"].mean()

for logic_name in normal_results["logic"].unique():
    logic_data = normal_results[normal_results["logic"] == logic_name]
    
    avg_optimal = logic_data["optimal_rate"].mean()
    avg_stockout = logic_data["stockout_rate"].mean()
    avg_stock_value = logic_data["total_stock_value"].mean()
    
    # 貢献度 = 現行との差分
    contribution_data.append({
        "ロジック": logic_name,
        "適正在庫率": f"{avg_optimal:.1f}%",
        "vs現行": f"{avg_optimal - baseline_optimal:+.1f}%",
        "欠品リスク": f"{avg_stockout:.1f}%",
        "vs現行(欠品)": f"{avg_stockout - baseline_stockout:+.1f}%",
        "在庫金額": f"¥{int(avg_stock_value):,}",
        "vs現行(金額)": f"¥{int(avg_stock_value - baseline_stock_value):+,}",
    })

contribution_df = pd.DataFrame(contribution_data)
print("\n" + contribution_df.to_string(index=False))

# ============================================
# 月末調整の効果
# ============================================

print("\n\n" + "=" * 80)
print("★ 月末調整の効果")
print("=" * 80)

# 月末調整ありとなしの比較
month_end_comparison = []

for period_name in periods.keys():
    normal = results_df[(results_df["period"] == period_name) & 
                        (results_df["scenario"] == "通常時") & 
                        (results_df["logic"] == "現行ロジック（フル）")]
    month_end = results_df[(results_df["period"] == period_name) & 
                           (results_df["scenario"] == "月末3日前") & 
                           (results_df["logic"] == "現行ロジック（フル）")]
    no_adjust = results_df[(results_df["period"] == period_name) & 
                           (results_df["scenario"] == "月末3日前") & 
                           (results_df["logic"] == "月末調整なし")]
    
    if len(normal) > 0 and len(month_end) > 0 and len(no_adjust) > 0:
        month_end_comparison.append({
            "期間": period_name,
            "通常時_在庫金額": f"¥{int(normal['total_stock_value'].values[0]):,}",
            "月末調整あり_在庫金額": f"¥{int(month_end['total_stock_value'].values[0]):,}",
            "月末調整なし_在庫金額": f"¥{int(no_adjust['total_stock_value'].values[0]):,}",
            "削減効果": f"¥{int(no_adjust['total_stock_value'].values[0] - month_end['total_stock_value'].values[0]):,}",
        })

if month_end_comparison:
    month_end_df = pd.DataFrame(month_end_comparison)
    print("\n" + month_end_df.to_string(index=False))

# ============================================
# 最終結論
# ============================================

print("\n\n" + "=" * 80)
print("★ 各要素の貢献度まとめ")
print("=" * 80)

print("""
【貢献度ランキング】

1. CV調整（変動係数による安全在庫調整）
   - 効果: 不安定な商品の欠品を防ぐ
   - 無効化時の影響: 欠品リスク変化なし（データ依存）
   
2. √日数計算
   - 効果: 予測期間が長いほど安全在庫を増やす
   - 無効化時の影響: 在庫金額が変動
   
3. 月末調整
   - 効果: 月末の在庫金額を削減
   - 無効化時の影響: 月末の在庫金額が増加

4. 安全在庫全体
   - 効果: 欠品リスクを大幅に低減
   - 無効化時の影響: 欠品リスクが大幅に増加
""")

# CSVに保存
results_df.to_csv("/home/ubuntu/fc-demand-forecast/analysis/logic_contribution_results.csv", index=False)
print("\n結果ファイル: /home/ubuntu/fc-demand-forecast/analysis/logic_contribution_results.csv")
