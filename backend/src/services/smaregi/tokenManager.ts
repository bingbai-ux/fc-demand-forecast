import { supabase } from '../../config/supabase';

interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

// メモリキャッシュ
let cachedToken: TokenData | null = null;

// 必要なスコープ一覧（pos.orders:writeを含む）
const REQUIRED_SCOPES = [
  'pos.products:read',
  'pos.products:write',
  'pos.stock:read',
  'pos.stock:write',
  'pos.stores:read',
  'pos.suppliers:read',
  'pos.orders:read',
  'pos.orders:write',  // 発注/入荷の更新に必要
].join(' ');

/**
 * Client Credentials方式でアクセストークンを取得
 * スコープを明示的に指定して新しいトークンを取得
 */
export const getAccessTokenWithScopes = async (): Promise<string> => {
  console.log('=== Client Credentials方式でトークン取得 ===');
  
  const contractId = process.env.SMAREGI_CONTRACT_ID;
  const clientId = process.env.SMAREGI_CLIENT_ID;
  const clientSecret = process.env.SMAREGI_CLIENT_SECRET;
  
  if (!contractId || !clientId || !clientSecret) {
    throw new Error('スマレジの環境変数が設定されていません');
  }
  
  const tokenUrl = `https://id.smaregi.jp/app/${contractId}/token`;
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  
  console.log('Contract ID:', contractId);
  console.log('Token URL:', tokenUrl);
  console.log('Requesting scopes:', REQUIRED_SCOPES);
  
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: REQUIRED_SCOPES,
    }),
  });
  
  const data = await response.json() as TokenResponse;
  
  if (!response.ok || data.error) {
    console.error('❌ トークン取得エラー:', data);
    throw new Error(`トークン取得に失敗しました: ${data.error_description || data.error || response.status}`);
  }
  
  console.log('✅ トークン取得成功');
  console.log('付与されたスコープ:', data.scope);
  
  return data.access_token || '';
};

/**
 * 有効なアクセストークンを取得
 * - キャッシュが有効ならキャッシュを返す
 * - データベースにトークンがあれば検証して返す
 * - 期限切れならリフレッシュして返す
 */
export const getValidAccessToken = async (): Promise<string> => {
  // 1. キャッシュされたトークンが有効か確認（5分の余裕を持つ）
  if (cachedToken && new Date() < new Date(cachedToken.expiresAt.getTime() - 5 * 60 * 1000)) {
    return cachedToken.accessToken;
  }
  
  // 2. データベースからトークン情報を取得
  const { data: tokenData, error } = await supabase
    .from('api_tokens')
    .select('*')
    .eq('service', 'smaregi')
    .single();
  
  if (tokenData && !error) {
    const expiresAt = new Date(tokenData.expires_at);
    
    // トークンがまだ有効（5分の余裕を持つ）
    if (new Date() < new Date(expiresAt.getTime() - 5 * 60 * 1000)) {
      cachedToken = {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt,
      };
      console.log('✅ データベースからトークンを取得しました（有効期限:', expiresAt.toISOString(), '）');
      return tokenData.access_token;
    }
    
    // トークンが期限切れ → リフレッシュ
    console.log('⚠️ トークンが期限切れです。リフレッシュします...');
    return await refreshAccessToken(tokenData.refresh_token);
  }
  
  // 3. データベースにトークンがない場合は環境変数を使用
  console.log('⚠️ データベースにトークンがありません。環境変数を使用します。');
  const accessToken = process.env.SMAREGI_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error('スマレジAPIのアクセストークンが設定されていません');
  }
  
  return accessToken;
};

/**
 * リフレッシュトークンを使ってアクセストークンを更新
 */
export const refreshAccessToken = async (refreshToken: string): Promise<string> => {
  console.log('🔄 アクセストークンを更新中...');
  
  const clientId = process.env.SMAREGI_CLIENT_ID;
  const clientSecret = process.env.SMAREGI_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    throw new Error('スマレジAPIの認証情報（CLIENT_ID/CLIENT_SECRET）が設定されていません');
  }
  
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  
  const response = await fetch('https://id.smaregi.jp/authorize/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ トークン更新エラー:', errorText);
    throw new Error(`トークン更新に失敗しました: ${response.status}`);
  }
  
  const data = await response.json() as TokenResponse;
  
  // 新しいトークン情報
  const newAccessToken = data.access_token || '';
  const newRefreshToken = data.refresh_token || refreshToken;
  const expiresIn = data.expires_in || 21600; // デフォルト6時間
  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  
  // データベースに保存
  const { error: upsertError } = await supabase
    .from('api_tokens')
    .upsert({
      service: 'smaregi',
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
      expires_at: expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'service',
    });
  
  if (upsertError) {
    console.error('❌ トークン保存エラー:', upsertError);
  }
  
  // キャッシュを更新
  cachedToken = {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    expiresAt,
  };
  
  console.log('✅ アクセストークンを更新しました（有効期限:', expiresAt.toISOString(), '）');
  
  return newAccessToken;
};

/**
 * キャッシュをクリア（テスト用）
 */
export const clearTokenCache = (): void => {
  cachedToken = null;
};
