/**
 * 売上データ完全性チェックスクリプト
 * 2025年1月〜2026年1月のデータが完全に取得されているか確認
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkSalesData() {
  console.log('📊 売上データ完全性チェック開始...\n');

  // 1. 店舗一覧を取得
  const { data: stores, error: storesError } = await supabase
    .from('stores')
    .select('store_id, store_name')
    .eq('is_active', true);

  if (storesError) {
    console.error('店舗取得エラー:', storesError.message);
    return;
  }

  const storeCount = stores?.length || 0;
  console.log(`店舗数: ${storeCount}`);
  stores?.forEach(s => console.log(`  - ${s.store_id}: ${s.store_name}`));
  console.log('');

  // 2. 2025年1月〜2026年1月の売上データ確認
  const startDate = '2025-01-01';
  const endDate = '2026-01-31';

  // 全データ件数を取得（ページネーション対応）
  let allRecords: Array<{ sale_date: string; store_id: string }> = [];
  let offset = 0;
  const PAGE_SIZE = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('sales_daily_summary')
      .select('sale_date, store_id')
      .gte('sale_date', startDate)
      .lte('sale_date', endDate)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error('売上データ取得エラー:', error.message);
      return;
    }

    if (!data || data.length === 0) break;
    allRecords.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  console.log(`sales_daily_summary レコード数: ${allRecords.length}`);

  // 店舗別・月別のデータ件数をカウント
  const storeMonthCounts = new Map<string, Map<string, number>>();
  allRecords.forEach(record => {
    const storeId = record.store_id;
    const month = record.sale_date.slice(0, 7);
    if (!storeMonthCounts.has(storeId)) {
      storeMonthCounts.set(storeId, new Map());
    }
    const monthMap = storeMonthCounts.get(storeId)!;
    monthMap.set(month, (monthMap.get(month) || 0) + 1);
  });

  const months = [
    '2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06',
    '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01'
  ];

  console.log('\n📅 店舗別・月別レコード数:');
  console.log('店舗ID   | ' + months.map(m => m.slice(5)).join(' | '));
  console.log('-'.repeat(100));

  for (const store of stores || []) {
    const monthMap = storeMonthCounts.get(store.store_id) || new Map();
    const counts = months.map(m => {
      const count = monthMap.get(m) || 0;
      return count.toString().padStart(5);
    });
    console.log(`${store.store_id.padEnd(8)} | ${counts.join(' | ')}`);
  }

  // 3. 店舗別の欠損日を特定
  console.log('\n🔍 店舗別欠損日チェック...');

  const start = new Date(startDate);
  const end = new Date(endDate);
  const totalDays = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  for (const store of stores || []) {
    const storeDates = new Set(
      allRecords
        .filter(r => r.store_id === store.store_id)
        .map(r => r.sale_date)
    );

    const missingDates: string[] = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      if (!storeDates.has(dateStr)) {
        missingDates.push(dateStr);
      }
    }

    const existingDays = totalDays - missingDates.length;
    const percentage = ((existingDays / totalDays) * 100).toFixed(1);

    if (missingDates.length === 0) {
      console.log(`✅ ${store.store_id} (${store.store_name}): 完全 (${totalDays}日)`);
    } else {
      console.log(`⚠️ ${store.store_id} (${store.store_name}): ${existingDays}/${totalDays}日 (${percentage}%) - 欠損${missingDates.length}日`);
      if (missingDates.length <= 10) {
        console.log(`   欠損: ${missingDates.join(', ')}`);
      } else {
        console.log(`   最初: ${missingDates.slice(0, 5).join(', ')}`);
        console.log(`   最後: ${missingDates.slice(-5).join(', ')}`);
      }
    }
  }

  // 4. sync_statusを確認
  const { data: syncStatus } = await supabase
    .from('sync_status')
    .select('*')
    .eq('sync_type', 'sales')
    .single();

  console.log('\n📌 同期状態:');
  console.log(`   status: ${syncStatus?.status}`);
  console.log(`   last_synced_at: ${syncStatus?.last_synced_at}`);
  console.log(`   last_synced_date: ${syncStatus?.last_synced_date}`);
  console.log(`   error_message: ${syncStatus?.error_message || 'なし'}`);
}

checkSalesData().catch(console.error);
