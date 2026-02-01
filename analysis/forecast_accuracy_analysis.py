#!/usr/bin/env python3
"""
需要予測ロジックの精度検証スクリプト

検証内容:
1. 売上予測の精度（MAPE、RMSE、MAE）
2. 欠品率の分析
3. 売上参照期間のバリエーション比較
4. 各ロジックの効果検証
"""

import requests
import json
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Tuple
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

def get_product_detail(product_id: str, store_id: str, days: int = 30) -> dict:
    """商品詳細APIを呼び出して売上履歴を取得"""
    url = f"{API_BASE_URL}/forecast/product-detail/{product_id}"
    params = {
        "storeId": store_id,
        "days": days
    }
    
    try:
        response = requests.get(url, params=params, timeout=30)
        if response.status_code == 200:
            return response.json()
        else:
            return None
    except Exception as e:
        return None

def calculate_accuracy_metrics(actual: np.ndarray, predicted: np.ndarray) -> Dict[str, float]:
    """予測精度指標を計算"""
    # ゼロ除算を避けるためのマスク
    mask = actual > 0
    
    if mask.sum() == 0:
        return {
            "mape": np.nan,
            "rmse": np.nan,
            "mae": np.nan,
            "bias": np.nan,
            "accuracy_rate": np.nan
        }
    
    # MAPE (Mean Absolute Percentage Error)
    mape = np.mean(np.abs((actual[mask] - predicted[mask]) / actual[mask])) * 100
    
    # RMSE (Root Mean Square Error)
    rmse = np.sqrt(np.mean((actual - predicted) ** 2))
    
    # MAE (Mean Absolute Error)
    mae = np.mean(np.abs(actual - predicted))
    
    # Bias (予測の偏り: 正=過大予測、負=過小予測)
    bias = np.mean(predicted - actual)
    
    # 精度率 (100% - MAPE)
    accuracy_rate = max(0, 100 - mape)
    
    return {
        "mape": mape,
        "rmse": rmse,
        "mae": mae,
        "bias": bias,
        "accuracy_rate": accuracy_rate
    }

def backtest_forecast(store_id: str, supplier_names: List[str], 
                      test_periods: int = 4, forecast_days: int = 7,
                      lookback_days: int = 14) -> pd.DataFrame:
    """
    バックテスト: 過去の期間で予測を行い、実績と比較
    
    例: 4週間前の時点で予測を行い、その後の実績と比較
    """
    results = []
    
    # 今日から遡って検証
    today = datetime.now()
    
    for period in range(1, test_periods + 1):
        # 予測を行う日（過去）
        prediction_date = today - timedelta(days=period * forecast_days)
        prediction_date_str = prediction_date.strftime("%Y-%m-%d")
        
        # 予測期間の終了日
        forecast_end_date = prediction_date + timedelta(days=forecast_days)
        
        print(f"\n=== 検証期間 {period}: {prediction_date_str} から {forecast_days}日間の予測 ===")
        
        # 予測を取得
        forecast_data = get_forecast_data(
            store_id, supplier_names, 
            prediction_date_str, forecast_days, lookback_days
        )
        
        if not forecast_data or not forecast_data.get("success"):
            print(f"予測データ取得失敗: {prediction_date_str}")
            continue
        
        # 各商品の予測と実績を比較
        for group in forecast_data.get("supplierGroups", []):
            for product in group.get("products", []):
                product_id = product.get("productId")
                product_name = product.get("productName", "Unknown")
                predicted_qty = product.get("forecastQuantity", 0)
                avg_daily_sales = product.get("avgDailySales", 0)
                rank = product.get("rank", "E")
                
                # 実績を取得（商品詳細APIから）
                detail = get_product_detail(product_id, store_id, 60)
                actual_qty = 0
                
                if detail and detail.get("success"):
                    sales_history = detail.get("data", {}).get("salesHistory", [])
                    # 予測期間内の実績を集計
                    for sale in sales_history:
                        sale_date = datetime.strptime(sale["date"], "%Y-%m-%d")
                        if prediction_date <= sale_date < forecast_end_date:
                            actual_qty += sale.get("quantity", 0)
                
                results.append({
                    "period": period,
                    "prediction_date": prediction_date_str,
                    "product_id": product_id,
                    "product_name": product_name,
                    "predicted": predicted_qty,
                    "actual": actual_qty,
                    "avg_daily_sales": avg_daily_sales,
                    "rank": rank,
                    "lookback_days": lookback_days,
                    "forecast_days": forecast_days
                })
    
    return pd.DataFrame(results)

def analyze_lookback_variations(store_id: str, supplier_names: List[str]) -> pd.DataFrame:
    """売上参照期間のバリエーションで精度を比較"""
    lookback_options = [7, 14, 21, 30, 60, 90]  # 1週間、2週間、3週間、1ヶ月、2ヶ月、3ヶ月
    
    all_results = []
    
    for lookback in lookback_options:
        print(f"\n=== 参照期間: {lookback}日間 ===")
        
        # バックテストを実行
        df = backtest_forecast(
            store_id, supplier_names,
            test_periods=3,  # 3期間で検証
            forecast_days=7,
            lookback_days=lookback
        )
        
        if len(df) > 0:
            # 精度指標を計算
            metrics = calculate_accuracy_metrics(
                df["actual"].values, 
                df["predicted"].values
            )
            
            all_results.append({
                "lookback_days": lookback,
                "sample_size": len(df),
                **metrics
            })
    
    return pd.DataFrame(all_results)

def analyze_stockout_rate(store_id: str, supplier_names: List[str]) -> Dict:
    """欠品率の分析"""
    # 現在の予測データを取得
    today = datetime.now().strftime("%Y-%m-%d")
    forecast_data = get_forecast_data(store_id, supplier_names, today, 7, 14)
    
    if not forecast_data or not forecast_data.get("success"):
        return {"error": "データ取得失敗"}
    
    total_products = 0
    stockout_products = 0
    stockout_by_rank = {"A": 0, "B": 0, "C": 0, "D": 0, "E": 0}
    total_by_rank = {"A": 0, "B": 0, "C": 0, "D": 0, "E": 0}
    
    for group in forecast_data.get("supplierGroups", []):
        for product in group.get("products", []):
            total_products += 1
            rank = product.get("rank", "E")
            total_by_rank[rank] = total_by_rank.get(rank, 0) + 1
            
            current_stock = product.get("currentStock", 0)
            avg_daily_sales = product.get("avgDailySales", 0)
            
            # 欠品判定: 在庫0かつ売上実績がある商品
            if current_stock <= 0 and avg_daily_sales > 0:
                stockout_products += 1
                stockout_by_rank[rank] = stockout_by_rank.get(rank, 0) + 1
    
    # 欠品率を計算
    stockout_rate = (stockout_products / total_products * 100) if total_products > 0 else 0
    
    stockout_rate_by_rank = {}
    for rank in ["A", "B", "C", "D", "E"]:
        if total_by_rank[rank] > 0:
            stockout_rate_by_rank[rank] = stockout_by_rank[rank] / total_by_rank[rank] * 100
        else:
            stockout_rate_by_rank[rank] = 0
    
    return {
        "total_products": total_products,
        "stockout_products": stockout_products,
        "stockout_rate": stockout_rate,
        "stockout_by_rank": stockout_by_rank,
        "total_by_rank": total_by_rank,
        "stockout_rate_by_rank": stockout_rate_by_rank
    }

def analyze_safety_stock_effect(df: pd.DataFrame) -> Dict:
    """安全在庫の効果を分析"""
    # 予測誤差を計算
    df["error"] = df["predicted"] - df["actual"]
    df["abs_error"] = np.abs(df["error"])
    
    # ランク別の誤差分析
    rank_analysis = df.groupby("rank").agg({
        "error": ["mean", "std"],
        "abs_error": "mean",
        "predicted": "mean",
        "actual": "mean"
    }).round(2)
    
    return {
        "rank_analysis": rank_analysis.to_dict(),
        "overall_bias": df["error"].mean(),
        "overall_mae": df["abs_error"].mean()
    }

def main():
    """メイン実行関数"""
    print("=" * 60)
    print("需要予測ロジック精度検証")
    print("=" * 60)
    
    # 1. 基本的な予測精度の検証
    print("\n\n### 1. 基本的な予測精度の検証 ###")
    print("参照期間: 14日間（デフォルト）、予測期間: 7日間")
    
    df_basic = backtest_forecast(
        STORE_ID, SUPPLIERS,
        test_periods=4,
        forecast_days=7,
        lookback_days=14
    )
    
    if len(df_basic) > 0:
        metrics = calculate_accuracy_metrics(
            df_basic["actual"].values,
            df_basic["predicted"].values
        )
        
        print(f"\n基本精度指標:")
        print(f"  MAPE (平均絶対誤差率): {metrics['mape']:.1f}%")
        print(f"  RMSE (二乗平均平方根誤差): {metrics['rmse']:.2f}")
        print(f"  MAE (平均絶対誤差): {metrics['mae']:.2f}")
        print(f"  Bias (予測バイアス): {metrics['bias']:.2f}")
        print(f"  精度率: {metrics['accuracy_rate']:.1f}%")
        
        # 結果を保存
        df_basic.to_csv("/home/ubuntu/fc-demand-forecast/analysis/basic_accuracy.csv", index=False)
    
    # 2. 売上参照期間のバリエーション比較
    print("\n\n### 2. 売上参照期間のバリエーション比較 ###")
    
    df_lookback = analyze_lookback_variations(STORE_ID, SUPPLIERS)
    
    if len(df_lookback) > 0:
        print("\n参照期間別の精度:")
        print(df_lookback.to_string(index=False))
        df_lookback.to_csv("/home/ubuntu/fc-demand-forecast/analysis/lookback_comparison.csv", index=False)
    
    # 3. 欠品率の分析
    print("\n\n### 3. 欠品率の分析 ###")
    
    stockout_analysis = analyze_stockout_rate(STORE_ID, SUPPLIERS)
    
    print(f"\n欠品率分析:")
    print(f"  総商品数: {stockout_analysis.get('total_products', 0)}")
    print(f"  欠品商品数: {stockout_analysis.get('stockout_products', 0)}")
    print(f"  欠品率: {stockout_analysis.get('stockout_rate', 0):.1f}%")
    print(f"\nランク別欠品率:")
    for rank in ["A", "B", "C", "D", "E"]:
        rate = stockout_analysis.get("stockout_rate_by_rank", {}).get(rank, 0)
        count = stockout_analysis.get("stockout_by_rank", {}).get(rank, 0)
        total = stockout_analysis.get("total_by_rank", {}).get(rank, 0)
        print(f"  ランク{rank}: {rate:.1f}% ({count}/{total})")
    
    # 4. 安全在庫の効果分析
    print("\n\n### 4. 安全在庫の効果分析 ###")
    
    if len(df_basic) > 0:
        safety_analysis = analyze_safety_stock_effect(df_basic)
        print(f"\n全体バイアス: {safety_analysis['overall_bias']:.2f}")
        print(f"全体MAE: {safety_analysis['overall_mae']:.2f}")
    
    # 結果をJSONで保存
    results_summary = {
        "basic_metrics": metrics if len(df_basic) > 0 else {},
        "stockout_analysis": stockout_analysis,
        "lookback_comparison": df_lookback.to_dict(orient="records") if len(df_lookback) > 0 else []
    }
    
    with open("/home/ubuntu/fc-demand-forecast/analysis/analysis_results.json", "w") as f:
        json.dump(results_summary, f, indent=2, ensure_ascii=False)
    
    print("\n\n分析完了！結果は /home/ubuntu/fc-demand-forecast/analysis/ に保存されました。")

if __name__ == "__main__":
    main()
