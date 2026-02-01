import axios, { AxiosInstance, AxiosError } from 'axios';
import { config } from '../../config/env';
import { getAccessToken, refreshAccessToken, ensureValidToken } from './auth';

const createClient = (): AxiosInstance => {
  const client = axios.create({
    baseURL: `https://api.smaregi.jp/${config.smaregi.contractId}/pos`,
    headers: {
      'Content-Type': 'application/json',
    },
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

  // 401エラー時にトークンを更新してリトライ
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config as any;

      if (error.response?.status === 401 && !originalRequest._retry) {
        originalRequest._retry = true;

        try {
          await refreshAccessToken();
          originalRequest.headers.Authorization = `Bearer ${getAccessToken()}`;
          return client(originalRequest);
        } catch (refreshError) {
          return Promise.reject(refreshError);
        }
      }

      return Promise.reject(error);
    }
  );

  return client;
};

export const smaregiClient = createClient();
