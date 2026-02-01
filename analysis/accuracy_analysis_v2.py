#!/usr/bin/env python3
"""
需要予測ロジックの精度検証スクリプト v2

予測APIのレスポンスに含まれる過去売上データを使用して、
予測精度を検証します。
"""

import requests
import json
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List
import warnings
warnings.filterwarnings('ignore')

# APIエンドポイント
API_BASE_URL = "https://fc-demand-forecast-production.up.railway.app/api"

# 検証対象の店舗と仕入先
STORE_ID = "1"  # FOOD&COMPANY代官山T-SITE店
SUPPLIERS = ["ノースプレインファーム", "渋谷CHEESE STAND", "金沢大地"]

def get_forecast_data(store_id: str, supplier_names: List[str], order_date: str, 
                      forecast_days: int, lookback_days: int) -> dict:
    """需要予測APIを呼び出してデータを取得"""
    url = f"{API_BASE_URL}/forecast/calculate"
    payload = {
        "storeId": store_id,
        "supplierNames": supplier_names,
        "orderDate": order_date,
        "forecastDays": forecast_days,
        "lookbackDays": lookback_days
    }
    
    try:
        response = requests.post(url, json=payload, timeout=60)
        if response.status_code == 200:
            return response.json()
        else:
            print(f"API Error: {response.status_code}")
            return None
    except Exception as e:
        print(f"Request Error: {e}")
        return None

def analyze_forecast_accuracy(store_id: str, supplier_names: List[str],
                              lookback_days: int = 14) -> Dict:
    """
    過去売上データを使用した予測精度の検証
    
    方法: 
    - 過去売上データの前半を使って後半を予測し、実績と比較
    """
    today = datetime.now().strftime("%Y-%m-%d")
    
    # 予測データを取得
    forecast_data = get_forecast_data(store_id, supplier_names, today, 7, lookback_days)
    
    if not forecast_data or not forecast_data.get("success"):
        return {"error": "データ取得失敗", "results": []}
    
    results = []
    
    for group in forecast_data.get("supplierGroups", []):
        supplier_name = group.get("supplierName", "Unknown")
        
        for product in group.get("products", []):
            product_id = product.get("productId")
            product_name = product.get("productName", "Unknown")
            avg_daily_sales = product.get("avgDailySales", 0)
            forecast_qty = product.get("forecastQuantity", 0)
            current_stock = product.get("currentStock", 0)
            safety_stock = product.get("safetyStock", 0)
            recommended_order = product.get("recommendedOrder", 0)
            rank = product.get("rank", "E")
            cv = product.get("coefficientOfVariation", 0)
            
            # 過去売上データを取得（pastSalesはオブジェクト形式）
            past_sales_obj = product.get("pastSales", {})
            past_sales_data = past_sales_obj.get("data", [])
            
            if len(past_sales_data) >= 4:
                # 前半と後半に分割
                half = len(past_sales_data) // 2
                first_half = past_sales_data[:half]
                second_half = past_sales_data[half:]
                
                # 前半の平均で後半を予測
                first_half_total = sum([s.get("qty", 0) for s in first_half])
                first_half_avg = first_half_total / len(first_half)
                predicted_second_half = first_half_avg * len(second_half)
                
                # 後半の実績
                actual_second_half = sum([s.get("qty", 0) for s in second_half])
                
                # 誤差計算
                error = predicted_second_half - actual_second_half
                abs_error = abs(error)
                pct_error = (abs_error / actual_second_half * 100) if actual_second_half > 0 else 0
                
                results.append({
                    "supplier": supplier_name,
                    "product_id": product_id,
                    "product_name": product_name,
                    "rank": rank,
                    "cv": cv,
                    "avg_daily_sales": avg_daily_sales,
                    "first_half_avg": first_half_avg,
                    "predicted": predicted_second_half,
                    "actual": actual_second_half,
                    "error": error,
                    "abs_error": abs_error,
                    "pct_error": pct_error,
                    "current_stock": current_stock,
                    "safety_stock": safety_stock,
                    "recommended_order": recommended_order,
                    "is_stockout": current_stock <= 0 and avg_daily_sales > 0
                })
    
    return {
        "results": results,
        "lookback_days": lookback_days
    }

def compare_lookback_periods(store_id: str, supplier_names: List[str]) -> pd.DataFrame:
    """異なる参照期間での精度を比較"""
    lookback_options = [7, 14, 21, 30, 60, 90]
    comparison_results = []
    
    for lookback in lookback_options:
        print(f"  参照期間: {lookback}日間を分析中...")
        
        analysis = analyze_forecast_accuracy(store_id, supplier_names, lookback)
        
        if "error" in analysis and analysis["error"]:
            continue
        
        results = analysis.get("results", [])
        
        if len(results) == 0:
            continue
        
        df = pd.DataFrame(results)
        
        # 売上がある商品のみで精度計算
        df_with_sales = df[df["actual"] > 0]
        
        if len(df_with_sales) > 0:
            mape = df_with_sales["pct_error"].mean()
            mae = df_with_sales["abs_error"].mean()
            rmse = np.sqrt((df_with_sales["error"] ** 2).mean())
            bias = df_with_sales["error"].mean()
            accuracy_rate = max(0, 100 - mape)
        else:
            mape = mae = rmse = bias = accuracy_rate = np.nan
        
        # 欠品率
        stockout_rate = df["is_stockout"].sum() / len(df) * 100 if len(df) > 0 else 0
        
        comparison_results.append({
            "参照期間（日）": lookback,
            "サンプル数": len(df_with_sales),
            "MAPE (%)": round(mape, 1) if not np.isnan(mape) else "-",
            "精度率 (%)": round(accuracy_rate, 1) if not np.isnan(accuracy_rate) else "-",
            "MAE (個)": round(mae, 2) if not np.isnan(mae) else "-",
            "RMSE (個)": round(rmse, 2) if not np.isnan(rmse) else "-",
            "Bias (個)": round(bias, 2) if not np.isnan(bias) else "-",
            "欠品率 (%)": round(stockout_rate, 1)
        })
    
    return pd.DataFrame(comparison_results)

def analyze_by_rank(store_id: str, supplier_names: List[str], lookback_days: int = 14) -> pd.DataFrame:
    """ランク別の精度分析"""
    analysis = analyze_forecast_accuracy(store_id, supplier_names, lookback_days)
    
    if "error" in analysis and analysis["error"]:
        return pd.DataFrame()
    
    results = analysis.get("results", [])
    
    if len(results) == 0:
        return pd.DataFrame()
    
    df = pd.DataFrame(results)
    
    # ランク別に集計
    rank_analysis = []
    
    for rank in ["A", "B", "C", "D", "E"]:
        rank_df = df[df["rank"] == rank]
        rank_with_sales = rank_df[rank_df["actual"] > 0]
        
        if len(rank_df) > 0:
            mape = rank_with_sales["pct_error"].mean() if len(rank_with_sales) > 0 else np.nan
            mae = rank_with_sales["abs_error"].mean() if len(rank_with_sales) > 0 else np.nan
            stockout_rate = rank_df["is_stockout"].sum() / len(rank_df) * 100
            avg_cv = rank_df["cv"].mean()
            
            rank_analysis.append({
                "ランク": rank,
                "商品数": len(rank_df),
                "売上あり": len(rank_with_sales),
                "MAPE (%)": round(mape, 1) if not np.isnan(mape) else "-",
                "MAE (個)": round(mae, 2) if not np.isnan(mae) else "-",
                "欠品率 (%)": round(stockout_rate, 1),
                "平均CV": round(avg_cv, 2)
            })
    
    return pd.DataFrame(rank_analysis)

def analyze_cv_effect(store_id: str, supplier_names: List[str], lookback_days: int = 14) -> pd.DataFrame:
    """変動係数（CV）による精度への影響分析"""
    analysis = analyze_forecast_accuracy(store_id, supplier_names, lookback_days)
    
    if "error" in analysis and analysis["error"]:
        return pd.DataFrame()
    
    results = analysis.get("results", [])
    
    if len(results) == 0:
        return pd.DataFrame()
    
    df = pd.DataFrame(results)
    
    # CV区分別に集計
    cv_bins = [(0, 0.3, "安定 (CV<0.3)"), (0.3, 0.6, "中程度 (0.3≤CV<0.6)"), (0.6, float('inf'), "不安定 (CV≥0.6)")]
    cv_analysis = []
    
    for low, high, label in cv_bins:
        cv_df = df[(df["cv"] >= low) & (df["cv"] < high)]
        cv_with_sales = cv_df[cv_df["actual"] > 0]
        
        if len(cv_df) > 0:
            mape = cv_with_sales["pct_error"].mean() if len(cv_with_sales) > 0 else np.nan
            mae = cv_with_sales["abs_error"].mean() if len(cv_with_sales) > 0 else np.nan
            stockout_rate = cv_df["is_stockout"].sum() / len(cv_df) * 100
            
            cv_analysis.append({
                "変動係数区分": label,
                "商品数": len(cv_df),
                "売上あり": len(cv_with_sales),
                "MAPE (%)": round(mape, 1) if not np.isnan(mape) else "-",
                "MAE (個)": round(mae, 2) if not np.isnan(mae) else "-",
                "欠品率 (%)": round(stockout_rate, 1)
            })
    
    return pd.DataFrame(cv_analysis)

def generate_recommendations(lookback_df: pd.DataFrame, rank_df: pd.DataFrame, cv_df: pd.DataFrame) -> List[str]:
    """分析結果に基づく改善提案を生成"""
    recommendations = []
    
    # 参照期間の最適化
    if len(lookback_df) > 0:
        # 精度率が数値の行のみ抽出
        numeric_df = lookback_df[lookback_df["精度率 (%)"].apply(lambda x: isinstance(x, (int, float)))]
        if len(numeric_df) > 0:
            best_idx = numeric_df["精度率 (%)"].idxmax()
            best_lookback = lookback_df.loc[best_idx]
            recommendations.append(
                f"**参照期間の最適化**: 現在のデフォルト14日間に対し、{int(best_lookback['参照期間（日）'])}日間が最も精度が高い（精度率: {best_lookback['精度率 (%)']}%）"
            )
    
    # ランク別の対策
    if len(rank_df) > 0:
        high_stockout = rank_df[rank_df["欠品率 (%)"] > 10]
        if len(high_stockout) > 0:
            ranks = ", ".join(high_stockout["ランク"].tolist())
            recommendations.append(
                f"**欠品リスク対策**: ランク{ranks}の商品は欠品率が10%を超えているため、安全在庫係数の引き上げを検討"
            )
    
    # CV別の対策
    if len(cv_df) > 0:
        unstable = cv_df[cv_df["変動係数区分"].str.contains("不安定")]
        if len(unstable) > 0 and unstable["欠品率 (%)"].iloc[0] > 10:
            recommendations.append(
                f"**変動が大きい商品への対策**: CV≥0.6の不安定な商品は欠品率が高いため、安全在庫係数を現在の1.0から1.5に引き上げることを検討"
            )
    
    # 一般的な改善提案
    recommendations.append(
        "**データ蓄積の継続**: より長期間のデータが蓄積されることで、季節性や曜日パターンの分析が可能になり、予測精度が向上する可能性がある"
    )
    
    return recommendations

def main():
    """メイン実行関数"""
    print("=" * 70)
    print("需要予測ロジック精度検証レポート")
    print("=" * 70)
    print(f"分析日時: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"対象店舗: FOOD&COMPANY代官山T-SITE店")
    print(f"対象仕入先: {', '.join(SUPPLIERS)}")
    print()
    
    # 1. 参照期間別の精度比較
    print("\n" + "=" * 50)
    print("1. 売上参照期間別の予測精度比較")
    print("=" * 50)
    
    lookback_df = compare_lookback_periods(STORE_ID, SUPPLIERS)
    
    if len(lookback_df) > 0:
        print("\n" + lookback_df.to_string(index=False))
        lookback_df.to_csv("/home/ubuntu/fc-demand-forecast/analysis/lookback_comparison.csv", index=False)
    else:
        print("\nデータが不足しています")
    
    # 2. ランク別の精度分析
    print("\n" + "=" * 50)
    print("2. ABCランク別の予測精度分析")
    print("=" * 50)
    
    rank_df = analyze_by_rank(STORE_ID, SUPPLIERS, 14)
    
    if len(rank_df) > 0:
        print("\n" + rank_df.to_string(index=False))
        rank_df.to_csv("/home/ubuntu/fc-demand-forecast/analysis/rank_analysis.csv", index=False)
    else:
        print("\nデータが不足しています")
    
    # 3. 変動係数別の精度分析
    print("\n" + "=" * 50)
    print("3. 変動係数（CV）別の予測精度分析")
    print("=" * 50)
    
    cv_df = analyze_cv_effect(STORE_ID, SUPPLIERS, 14)
    
    if len(cv_df) > 0:
        print("\n" + cv_df.to_string(index=False))
        cv_df.to_csv("/home/ubuntu/fc-demand-forecast/analysis/cv_analysis.csv", index=False)
    else:
        print("\nデータが不足しています")
    
    # 4. 改善提案
    print("\n" + "=" * 50)
    print("4. 改善提案")
    print("=" * 50)
    
    recommendations = generate_recommendations(lookback_df, rank_df, cv_df)
    
    for i, rec in enumerate(recommendations, 1):
        print(f"\n{i}. {rec}")
    
    # 結果をJSONで保存
    results_summary = {
        "analysis_date": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "store": "FOOD&COMPANY代官山T-SITE店",
        "suppliers": SUPPLIERS,
        "lookback_comparison": lookback_df.to_dict(orient="records") if len(lookback_df) > 0 else [],
        "rank_analysis": rank_df.to_dict(orient="records") if len(rank_df) > 0 else [],
        "cv_analysis": cv_df.to_dict(orient="records") if len(cv_df) > 0 else [],
        "recommendations": recommendations
    }
    
    with open("/home/ubuntu/fc-demand-forecast/analysis/analysis_results.json", "w") as f:
        json.dump(results_summary, f, indent=2, ensure_ascii=False)
    
    print("\n\n" + "=" * 70)
    print("分析完了！")
    print("結果ファイル: /home/ubuntu/fc-demand-forecast/analysis/")
    print("=" * 70)

if __name__ == "__main__":
    main()
