import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { config } from '../../config/env';
import { getAccessToken, refreshAccessToken, ensureValidToken } from './auth';

// ══════════════════════════════════════════════════════════════
// リトライ設定
// ══════════════════════════════════════════════════════════════
const RETRY_STATUS_CODES = [429, 502, 503, 504]; // リトライ対象のHTTPステータス
const MAX_RETRIES = 5;                            // 最大リトライ回数
const BASE_DELAY_MS = 1000;                       // 初回待機時間（ミリ秒）
const MAX_DELAY_MS = 32000;                       // 最大待機時間（ミリ秒）

/** リクエスト設定の拡張型 */
interface ExtendedAxiosRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
  _retryCount?: number;
}

/**
 * 指数バックオフ付きスリープ
 * @param retryCount 現在のリトライ回数（0始まり）
 * @param retryAfter Retry-Afterヘッダーの値（秒）
 */
const sleep = (retryCount: number, retryAfter?: number): Promise<void> => {
  let delay: number;
  if (retryAfter) {
    delay = retryAfter * 1000;
  } else {
    // 指数バックオフ: 1s, 2s, 4s, 8s, 16s (+ ジッター)
    delay = Math.min(BASE_DELAY_MS * Math.pow(2, retryCount), MAX_DELAY_MS);
    delay += Math.random() * 500; // 0-500ms のジッター追加
  }
  console.log(`⏳ リトライ待機: ${Math.round(delay)}ms (試行 ${retryCount + 1}/${MAX_RETRIES})`);
  return new Promise(resolve => setTimeout(resolve, delay));
};

const createClient = (): AxiosInstance => {
  const client = axios.create({
    baseURL: `https://api.smaregi.jp/${config.smaregi.contractId}/pos`,
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: 30000, // 30秒タイムアウト
    // カスタムパラメータシリアライザー（ハイフン付きパラメータ名を正しくエンコード）
    paramsSerializer: {
      serialize: (params) => {
        const searchParams = new URLSearchParams();
        for (const key in params) {
          if (params[key] !== undefined && params[key] !== null) {
            searchParams.append(key, params[key]);
          }
        }
        return searchParams.toString();
      },
    },
  });

  // リクエスト時にアクセストークンを設定（期限切れの場合は自動更新）
  client.interceptors.request.use(async (requestConfig) => {
    try {
      // トークンが期限切れの場合は自動更新
      await ensureValidToken();
      requestConfig.headers.Authorization = `Bearer ${getAccessToken()}`;
    } catch (error) {
      console.error('トークン取得エラー:', error);
    }
    return requestConfig;
  });

  // エラー時のリトライ処理（401認証エラー + 429/5xxリトライ）
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config as ExtendedAxiosRequestConfig;
      if (!originalRequest) {
        return Promise.reject(error);
      }

      const status = error.response?.status;
      const retryCount = originalRequest._retryCount || 0;

      // 401 Unauthorized: トークン更新してリトライ
      if (status === 401 && !originalRequest._retry) {
        originalRequest._retry = true;
        try {
          console.log('🔄 401エラー: トークンを更新してリトライ');
          await refreshAccessToken();
          originalRequest.headers.Authorization = `Bearer ${getAccessToken()}`;
          return client(originalRequest);
        } catch (refreshError) {
          console.error('❌ トークン更新失敗');
          return Promise.reject(refreshError);
        }
      }

      // 429/502/503/504: 指数バックオフでリトライ
      if (status && RETRY_STATUS_CODES.includes(status) && retryCount < MAX_RETRIES) {
        const retryAfter = error.response?.headers?.['retry-after']
          ? parseInt(error.response.headers['retry-after'], 10)
          : undefined;

        console.log(`⚠️ ${status}エラー検出: リトライ実行 (${retryCount + 1}/${MAX_RETRIES})`);
        await sleep(retryCount, retryAfter);

        originalRequest._retryCount = retryCount + 1;
        return client(originalRequest);
      }

      // ネットワークエラー（ECONNRESET, ETIMEDOUT等）: リトライ
      if (!error.response && retryCount < MAX_RETRIES) {
        const errorCode = (error as any).code;
        if (['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED'].includes(errorCode)) {
          console.log(`⚠️ ネットワークエラー (${errorCode}): リトライ実行 (${retryCount + 1}/${MAX_RETRIES})`);
          await sleep(retryCount);
          originalRequest._retryCount = retryCount + 1;
          return client(originalRequest);
        }
      }

      // リトライ上限超過またはその他のエラー
      if (retryCount >= MAX_RETRIES) {
        console.error(`❌ リトライ上限超過 (${MAX_RETRIES}回): ${error.message}`);
      }

      return Promise.reject(error);
    }
  );

  return client;
};

export const smaregiClient = createClient();
