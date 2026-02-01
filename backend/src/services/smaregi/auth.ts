import axios from 'axios';
import { config } from '../../config/env';
import { supabase } from '../../config/supabase';

// メモリ上でトークンを管理
let currentAccessToken = config.smaregi.accessToken;
let currentRefreshToken = config.smaregi.refreshToken;
let tokenExpiresAt: Date | null = null;

// 新しいトークンテーブル名
const TOKEN_TABLE = 'api_tokens';

// 起動時にトークンを初期化
export const initializeTokens = async (): Promise<void> => {
  try {
    console.log('🔍 トークンを初期化中...');
    
    // 1. まずデータベースからトークンを取得
    const { data: tokenData, error } = await supabase
      .from(TOKEN_TABLE)
      .select('*')
      .eq('service', 'smaregi')
      .single();
    
    if (tokenData && !error) {
      const expiresAt = new Date(tokenData.expires_at);
      
      // トークンがまだ有効（5分の余裕を持つ）
      if (new Date() < new Date(expiresAt.getTime() - 5 * 60 * 1000)) {
        currentAccessToken = tokenData.access_token;
        currentRefreshToken = tokenData.refresh_token;
        tokenExpiresAt = expiresAt;
        console.log('✅ データベースからトークンを読み込みました');
        console.log(`   有効期限: ${expiresAt.toISOString()}`);
        return;
      }
      
      // トークンが期限切れ → リフレッシュ
      console.log('⚠️ データベースのトークンが期限切れです。リフレッシュします...');
      currentRefreshToken = tokenData.refresh_token;
      await refreshAccessToken();
      return;
    }
    
    // 2. データベースにトークンがない場合は.envを使用
    console.log('📝 データベースにトークンがないため、.envから読み込み...');
    currentAccessToken = config.smaregi.accessToken;
    currentRefreshToken = config.smaregi.refreshToken;
    
    console.log(`   .env ACCESS_TOKEN length: ${currentAccessToken?.length || 0}`);
    console.log(`   .env REFRESH_TOKEN length: ${currentRefreshToken?.length || 0}`);
    
    // .envにトークンがある場合はデータベースにも保存
    if (currentAccessToken && currentRefreshToken) {
      await saveTokensToDatabase();
      console.log('✅ .envのトークンをデータベースに保存しました');
    }
  } catch (error) {
    console.log('⚠️ トークン初期化エラー:', error);
  }
};

// データベースにトークンを保存
const saveTokensToDatabase = async (): Promise<void> => {
  try {
    // 有効期限が設定されていない場合は6時間後を設定
    const expiresAt = tokenExpiresAt || new Date(Date.now() + 6 * 60 * 60 * 1000);
    
    const { error } = await supabase
      .from(TOKEN_TABLE)
      .upsert({
        service: 'smaregi',
        access_token: currentAccessToken,
        refresh_token: currentRefreshToken,
        expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'service',
      });

    if (error) {
      console.error('⚠️ トークン保存エラー:', error.message);
    }
  } catch (error) {
    console.error('⚠️ トークン保存エラー:', error);
  }
};

export const getAccessToken = (): string => {
  return currentAccessToken;
};

// トークンが有効かどうかを確認
export const isTokenValid = (): boolean => {
  if (!tokenExpiresAt) return true; // 有効期限が不明な場合は有効とみなす
  // 5分の余裕を持つ
  return new Date() < new Date(tokenExpiresAt.getTime() - 5 * 60 * 1000);
};

// 必要に応じてトークンを更新
export const ensureValidToken = async (): Promise<string> => {
  if (!isTokenValid()) {
    console.log('⚠️ トークンが期限切れです。リフレッシュします...');
    return await refreshAccessToken();
  }
  return currentAccessToken;
};

export const refreshAccessToken = async (): Promise<string> => {
  console.log('🔄 アクセストークンを更新中...');
  console.log(`   現在のREFRESH_TOKEN length: ${currentRefreshToken?.length || 0}`);
  
  try {
    const response = await axios.post(
      'https://id.smaregi.jp/authorize/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: currentRefreshToken,
        client_id: config.smaregi.clientId,
        client_secret: config.smaregi.clientSecret,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    console.log('✅ トークン更新APIレスポンス受信');
    console.log(`   新しいACCESS_TOKEN length: ${response.data.access_token?.length || 0}`);
    console.log(`   新しいREFRESH_TOKEN length: ${response.data.refresh_token?.length || 0}`);

    currentAccessToken = response.data.access_token;
    
    // 新しいrefresh_tokenが発行された場合は更新
    if (response.data.refresh_token) {
      currentRefreshToken = response.data.refresh_token;
      console.log('📝 新しいリフレッシュトークンを受信');
    }
    
    // 有効期限を設定（デフォルト6時間）
    const expiresIn = response.data.expires_in || 21600;
    tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
    console.log(`   有効期限: ${tokenExpiresAt.toISOString()}`);

    // データベースにトークンを保存
    await saveTokensToDatabase();

    console.log('✅ アクセストークン更新成功');
    return currentAccessToken;
    
  } catch (error: any) {
    console.error('❌ アクセストークン更新失敗');
    console.error('   ステータス:', error.response?.status);
    console.error('   レスポンス:', JSON.stringify(error.response?.data || {}));
    console.error('   メッセージ:', error.message);
    throw new Error('トークン更新に失敗しました');
  }
};

// トークン状態を取得
export const getTokenStatus = async (): Promise<{
  hasToken: boolean;
  isExpired: boolean;
  expiresAt: string | null;
  remainingMinutes: number;
}> => {
  const { data: tokenData } = await supabase
    .from(TOKEN_TABLE)
    .select('expires_at')
    .eq('service', 'smaregi')
    .single();
  
  if (!tokenData) {
    return {
      hasToken: false,
      isExpired: true,
      expiresAt: null,
      remainingMinutes: 0,
    };
  }
  
  const expiresAt = new Date(tokenData.expires_at);
  const isExpired = new Date() > expiresAt;
  const remainingMinutes = isExpired ? 0 : Math.floor((expiresAt.getTime() - Date.now()) / 60000);
  
  return {
    hasToken: true,
    isExpired,
    expiresAt: tokenData.expires_at,
    remainingMinutes,
  };
};
