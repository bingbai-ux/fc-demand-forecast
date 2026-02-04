/**
 * カスタムエラークラス
 *
 * アプリケーション全体で統一されたエラーハンドリングを実現する。
 * HTTPステータスコードとエラーコードを含み、
 * ルートハンドラーで適切なレスポンスを返せるようにする。
 */

import { AxiosError } from 'axios';

// ══════════════════════════════════════════════════════════════
// 基底エラークラス
// ══════════════════════════════════════════════════════════════

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number = 500,
    errorCode: string = 'INTERNAL_ERROR',
    isOperational: boolean = true,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

// ══════════════════════════════════════════════════════════════
// スマレジAPI関連エラー
// ══════════════════════════════════════════════════════════════

export class SmaregiAPIError extends AppError {
  public readonly originalError?: AxiosError;
  public readonly retryCount?: number;

  constructor(
    message: string,
    statusCode: number,
    originalError?: AxiosError,
    retryCount?: number,
  ) {
    const errorCode = getSmaregiErrorCode(statusCode);
    super(message, statusCode, errorCode);
    this.originalError = originalError;
    this.retryCount = retryCount;
    Object.setPrototypeOf(this, SmaregiAPIError.prototype);
  }

  static fromAxiosError(error: AxiosError, context?: string): SmaregiAPIError {
    const status = error.response?.status || 500;
    const responseData = error.response?.data as any;
    const apiMessage = responseData?.message || responseData?.error || error.message;
    const message = context ? `${context}: ${apiMessage}` : apiMessage;

    return new SmaregiAPIError(message, status, error);
  }
}

function getSmaregiErrorCode(status: number): string {
  switch (status) {
    case 401: return 'SMAREGI_UNAUTHORIZED';
    case 403: return 'SMAREGI_FORBIDDEN';
    case 404: return 'SMAREGI_NOT_FOUND';
    case 429: return 'SMAREGI_RATE_LIMITED';
    case 500: return 'SMAREGI_SERVER_ERROR';
    case 502: return 'SMAREGI_BAD_GATEWAY';
    case 503: return 'SMAREGI_SERVICE_UNAVAILABLE';
    default: return 'SMAREGI_UNKNOWN_ERROR';
  }
}

// ══════════════════════════════════════════════════════════════
// Supabase関連エラー
// ══════════════════════════════════════════════════════════════

export class DatabaseError extends AppError {
  public readonly query?: string;
  public readonly table?: string;

  constructor(
    message: string,
    table?: string,
    query?: string,
  ) {
    super(message, 500, 'DATABASE_ERROR');
    this.table = table;
    this.query = query;
    Object.setPrototypeOf(this, DatabaseError.prototype);
  }

  static fromSupabaseError(
    error: { message: string; code?: string },
    table?: string,
  ): DatabaseError {
    return new DatabaseError(
      `Supabase error: ${error.message} (code: ${error.code || 'unknown'})`,
      table,
    );
  }
}

// ══════════════════════════════════════════════════════════════
// バリデーションエラー
// ══════════════════════════════════════════════════════════════

export class ValidationError extends AppError {
  public readonly field?: string;

  constructor(message: string, field?: string) {
    super(message, 400, 'VALIDATION_ERROR');
    this.field = field;
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

// ══════════════════════════════════════════════════════════════
// 同期エラー
// ══════════════════════════════════════════════════════════════

export class SyncError extends AppError {
  public readonly syncType: 'sales' | 'products' | 'stock';
  public readonly failedDate?: string;

  constructor(
    message: string,
    syncType: 'sales' | 'products' | 'stock',
    failedDate?: string,
  ) {
    super(message, 500, 'SYNC_ERROR');
    this.syncType = syncType;
    this.failedDate = failedDate;
    Object.setPrototypeOf(this, SyncError.prototype);
  }
}

// ══════════════════════════════════════════════════════════════
// エラーハンドラーユーティリティ
// ══════════════════════════════════════════════════════════════

/**
 * Express用エラーレスポンス生成
 */
export function toErrorResponse(error: unknown): {
  statusCode: number;
  body: {
    success: false;
    error: string;
    errorCode: string;
    details?: Record<string, unknown>;
  };
} {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      body: {
        success: false,
        error: error.message,
        errorCode: error.errorCode,
        details: getErrorDetails(error),
      },
    };
  }

  if (error instanceof Error) {
    return {
      statusCode: 500,
      body: {
        success: false,
        error: error.message,
        errorCode: 'INTERNAL_ERROR',
      },
    };
  }

  return {
    statusCode: 500,
    body: {
      success: false,
      error: 'Unknown error occurred',
      errorCode: 'UNKNOWN_ERROR',
    },
  };
}

function getErrorDetails(error: AppError): Record<string, unknown> | undefined {
  const details: Record<string, unknown> = {};

  if (error instanceof SmaregiAPIError) {
    if (error.retryCount) details.retryCount = error.retryCount;
    return Object.keys(details).length > 0 ? details : undefined;
  }

  if (error instanceof DatabaseError) {
    if (error.table) details.table = error.table;
    return Object.keys(details).length > 0 ? details : undefined;
  }

  if (error instanceof ValidationError) {
    if (error.field) details.field = error.field;
    return Object.keys(details).length > 0 ? details : undefined;
  }

  if (error instanceof SyncError) {
    details.syncType = error.syncType;
    if (error.failedDate) details.failedDate = error.failedDate;
    return details;
  }

  return undefined;
}

/**
 * unknown型のエラーを安全にメッセージに変換
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error occurred';
}

/**
 * Axiosエラーかどうかを判定
 */
export function isAxiosError(error: unknown): error is AxiosError {
  return (error as AxiosError)?.isAxiosError === true;
}
