#!/usr/bin/env python3
"""
加重移動平均法（Weighted Moving Average）の検証

【加重移動平均法の特徴】
- 直近のデータに大きな重みを付ける
- 過去のデータほど重みが小さくなる
- トレンドの変化に素早く反応できる

【検証する重み付けパターン】
1. 単純平均（現行）: 全ての日に同じ重み
2. 線形加重: 1, 2, 3, 4, 5, 6, 7（直近が最大）
3. 指数加重: 0.5^(n-1)（直近が最大、急速に減衰）
4. 直近重視: 直近3日に50%、残り4日に50%
"""

import json
import pandas as pd
import numpy as np
from pathlib import Path

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
            
            # 日次売上データを取得（週次の場合は日次に変換）
            daily_sales = []
            past_type = product.get("pastSales", {}).get("type", "daily")
            
            if past_type == "daily":
                daily_sales = [s.get("qty", 0) for s in past_sales]
            else:
                # 週次データの場合、各週を7で割って日次に近似
                for s in past_sales:
                    weekly_qty = s.get("qty", 0)
                    daily_avg = weekly_qty / 7
                    daily_sales.extend([daily_avg] * 7)
            
            # 7日分のデータを確保
            while len(daily_sales) < 7:
                daily_sales.insert(0, 0)
            daily_sales = daily_sales[-7:]  # 直近7日分
            
            products.append({
                "product_id": product.get("productId"),
                "product_name": product.get("productName"),
                "supplier": product.get("supplierName"),
                "current_stock": product.get("currentStock", 0),
                "daily_sales": daily_sales,
                "avg_daily_sales": product.get("avgDailySales", 0),
                "rank": product.get("rank", "E"),
                "cv": product.get("coefficientOfVariation", 0),
                "cost": float(product.get("cost", 0)),
                "recommended_order": product.get("recommendedOrder", 0),
                "lead_time": lead_time,
            })
    
    return pd.DataFrame(products)

# ============================================
# 加重移動平均の計算関数
# ============================================

def simple_average(daily_sales):
    """単純平均（現行）"""
    return sum(daily_sales) / len(daily_sales) if daily_sales else 0

def linear_weighted_average(daily_sales):
    """
    線形加重移動平均
    重み: 1, 2, 3, 4, 5, 6, 7（直近が7）
    """
    if not daily_sales:
        return 0
    n = len(daily_sales)
    weights = list(range(1, n + 1))  # [1, 2, 3, 4, 5, 6, 7]
    weighted_sum = sum(s * w for s, w in zip(daily_sales, weights))
    return weighted_sum / sum(weights)

def exponential_weighted_average(daily_sales, alpha=0.3):
    """
    指数加重移動平均
    直近のデータに指数的に大きな重みを付ける
    alpha: 平滑化係数（大きいほど直近を重視）
    """
    if not daily_sales:
        return 0
    n = len(daily_sales)
    weights = [(1 - alpha) ** (n - 1 - i) for i in range(n)]
    weighted_sum = sum(s * w for s, w in zip(daily_sales, weights))
    return weighted_sum / sum(weights)

def recent_focused_average(daily_sales):
    """
    直近重視平均
    直近3日に50%、残り4日に50%の重み
    """
    if not daily_sales or len(daily_sales) < 7:
        return simple_average(daily_sales)
    
    recent_3 = daily_sales[-3:]  # 直近3日
    older_4 = daily_sales[:-3]   # 残り4日
    
    recent_avg = sum(recent_3) / 3 if recent_3 else 0
    older_avg = sum(older_4) / 4 if older_4 else 0
    
    return recent_avg * 0.5 + older_avg * 0.5

def double_weighted_average(daily_sales):
    """
    二重加重移動平均
    重み: 1, 1, 2, 2, 3, 3, 4（直近が4）
    より滑らかな変化
    """
    if not daily_sales:
        return 0
    weights = [1, 1, 2, 2, 3, 3, 4][:len(daily_sales)]
    weighted_sum = sum(s * w for s, w in zip(daily_sales, weights))
    return weighted_sum / sum(weights)

# ============================================
# 発注ロジック
# ============================================

def calculate_order(row, avg_func, forecast_days=7, safety_factor=0.5):
    """
    発注数を計算
    
    発注数 = 予測売数 + 安全在庫 - 現在庫
    予測売数 = 日平均売上 × 予測日数
    安全在庫 = 日平均売上 × √予測日数 × 安全在庫係数
    """
    daily_sales = row["daily_sales"]
    current_stock = row["current_stock"]
    cv = row["cv"]
    
    # 加重平均で日販を計算
    avg_daily = avg_func(daily_sales)
    
    # 変動係数による安全在庫係数調整（現行ロジックと同じ）
    if cv >= 0.6:
        variability_factor = 1.0
    elif cv >= 0.3:
        variability_factor = 0.7
    else:
        variability_factor = safety_factor
    
    # 予測売数
    forecast_qty = avg_daily * forecast_days
    
    # 安全在庫
    safety_stock = avg_daily * np.sqrt(forecast_days) * variability_factor
    
    # 発注数
    order_qty = max(0, np.ceil(forecast_qty + safety_stock - current_stock))
    
    return order_qty, avg_daily

# ============================================
# 評価関数
# ============================================

def evaluate_method(df, avg_func, method_name):
    """加重平均法を評価"""
    results = df.copy()
    
    # 発注数と予測日販を計算
    order_data = results.apply(lambda row: calculate_order(row, avg_func), axis=1)
    results["order_qty"] = [d[0] for d in order_data]
    results["predicted_daily"] = [d[1] for d in order_data]
    
    results["order_amount"] = results["order_qty"] * results["cost"]
    results["stock_after_order"] = results["current_stock"] + results["order_qty"]
    
    # 予測精度（実際の日販との比較）
    results["prediction_error"] = abs(results["predicted_daily"] - results["avg_daily_sales"])
    results["mape"] = np.where(
        results["avg_daily_sales"] > 0,
        results["prediction_error"] / results["avg_daily_sales"] * 100,
        0
    )
    
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
        "method": method_name,
        "total_order_qty": int(results["order_qty"].sum()),
        "total_order_amount": int(results["order_amount"].sum()),
        "total_stock_value": int(results["stock_value"].sum()),
        "avg_days_covered": round(active["days_covered"].mean(), 1) if len(active) > 0 else 0,
        "avg_mape": round(active["mape"].mean(), 1) if len(active) > 0 else 0,
        "stockout_risk": stockout_risk,
        "stockout_rate": round(stockout_risk / len(active) * 100, 1) if len(active) > 0 else 0,
        "overstock_risk": overstock_risk,
        "overstock_rate": round(overstock_risk / len(active) * 100, 1) if len(active) > 0 else 0,
        "optimal_count": optimal,
        "optimal_rate": round(optimal / len(active) * 100, 1) if len(active) > 0 else 0,
        "active_products": len(active),
    }

# ============================================
# メイン分析
# ============================================

print("=" * 80)
print("加重移動平均法 検証")
print("=" * 80)

print("""
【検証する平均法】

1. 単純平均（現行）
   - 全ての日に同じ重み
   - 計算: (d1 + d2 + ... + d7) / 7

2. 線形加重平均
   - 直近ほど重みが大きい（1, 2, 3, 4, 5, 6, 7）
   - 計算: (d1×1 + d2×2 + ... + d7×7) / 28

3. 指数加重平均（α=0.3）
   - 直近に指数的に大きな重み
   - 計算: Σ(di × (1-α)^(n-i)) / Σ重み

4. 直近重視平均
   - 直近3日に50%、残り4日に50%
   - 計算: (直近3日平均 × 0.5) + (残り4日平均 × 0.5)

5. 二重加重平均
   - より滑らかな重み（1, 1, 2, 2, 3, 3, 4）
   - 計算: (d1×1 + d2×1 + d3×2 + ... + d7×4) / 16
""")

# 各期間のデータを分析
all_results = []

methods = [
    ("単純平均（現行）", simple_average),
    ("線形加重平均", linear_weighted_average),
    ("指数加重平均", exponential_weighted_average),
    ("直近重視平均", recent_focused_average),
    ("二重加重平均", double_weighted_average),
]

for period_name, filename in periods.items():
    print(f"\n{'='*60}")
    print(f"期間: {period_name}")
    print(f"{'='*60}")
    
    df = load_period_data(filename)
    active_count = len(df[df["avg_daily_sales"] > 0])
    print(f"商品数: {len(df)} (アクティブ: {active_count})")
    
    # 各手法を評価
    period_results = []
    for name, func in methods:
        result = evaluate_method(df, func, name)
        result["period"] = period_name
        period_results.append(result)
        all_results.append(result)
    
    # 結果表示
    summary = pd.DataFrame([{
        "手法": r["method"],
        "発注数": r["total_order_qty"],
        "発注金額": f"¥{r['total_order_amount']:,}",
        "在庫金額": f"¥{r['total_stock_value']:,}",
        "カバー日数": f"{r['avg_days_covered']}日",
        "MAPE": f"{r['avg_mape']}%",
        "欠品リスク": f"{r['stockout_rate']}%",
        "適正在庫率": f"{r['optimal_rate']}%",
    } for r in period_results])
    
    print("\n" + summary.to_string(index=False))

# ============================================
# 期間横断分析
# ============================================

print("\n\n" + "=" * 80)
print("期間横断分析: 各手法の安定性")
print("=" * 80)

results_df = pd.DataFrame(all_results)

comparison_data = []
for method_name in results_df["method"].unique():
    method_data = results_df[results_df["method"] == method_name]
    comparison_data.append({
        "手法": method_name,
        "平均適正在庫率": f"{method_data['optimal_rate'].mean():.1f}%",
        "適正在庫率SD": f"{method_data['optimal_rate'].std():.1f}%",
        "平均欠品リスク": f"{method_data['stockout_rate'].mean():.1f}%",
        "平均MAPE": f"{method_data['avg_mape'].mean():.1f}%",
        "平均在庫金額": f"¥{int(method_data['total_stock_value'].mean()):,}",
        "平均発注金額": f"¥{int(method_data['total_order_amount'].mean()):,}",
    })

comparison_df = pd.DataFrame(comparison_data)
print("\n" + comparison_df.to_string(index=False))

# ============================================
# 商品別の予測比較
# ============================================

print("\n\n" + "=" * 80)
print("商品別の予測日販比較（2026年1月）")
print("=" * 80)

df_jan = load_period_data("period_2026_01.json")
active_jan = df_jan[df_jan["avg_daily_sales"] > 0]

comparison = []
for _, row in active_jan.iterrows():
    daily_sales = row["daily_sales"]
    comp = {
        "商品名": row["product_name"][:12],
        "実績日販": f"{row['avg_daily_sales']:.1f}",
        "単純平均": f"{simple_average(daily_sales):.1f}",
        "線形加重": f"{linear_weighted_average(daily_sales):.1f}",
        "指数加重": f"{exponential_weighted_average(daily_sales):.1f}",
        "直近重視": f"{recent_focused_average(daily_sales):.1f}",
        "二重加重": f"{double_weighted_average(daily_sales):.1f}",
    }
    comparison.append(comp)

comp_df = pd.DataFrame(comparison)
print("\n" + comp_df.to_string(index=False))

# ============================================
# 最終推奨
# ============================================

print("\n\n" + "=" * 80)
print("★ 分析結果と推奨")
print("=" * 80)

# CSVに保存
results_df.to_csv("/home/ubuntu/fc-demand-forecast/analysis/weighted_average_results.csv", index=False)
print("\n結果ファイル: /home/ubuntu/fc-demand-forecast/analysis/weighted_average_results.csv")
