import { createClient } from '@supabase/supabase-js';
import { config } from './env';

// 環境変数からSupabase設定を取得
const supabaseUrl = config.supabase.url;
const supabaseServiceRoleKey = config.supabase.serviceRoleKey;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('❌ Supabase環境変数が設定されていません');
}

// service_roleキーを使用（サーバーサイドのみ）
export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// 接続テスト関数
export const testSupabaseConnection = async (): Promise<boolean> => {
  try {
    const { data, error } = await supabase
      .from('sync_status')
      .select('sync_type')
      .limit(1);
    
    if (error) {
      console.error('❌ Supabase接続エラー:', error.message);
      return false;
    }
    
    console.log('✅ Supabase接続成功');
    return true;
  } catch (err) {
    console.error('❌ Supabase接続エラー:', err);
    return false;
  }
};
