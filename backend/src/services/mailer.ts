import nodemailer from 'nodemailer';
import { supabase } from '../config/supabase';

// SMTP設定のキー一覧
const EMAIL_SETTING_KEYS = [
  'smtp_host',
  'smtp_port',
  'smtp_user',
  'smtp_pass',
  'smtp_from',
  'smtp_from_name',
];

// メールテンプレート設定のキー一覧
const EMAIL_TEMPLATE_KEYS = [
  'email_subject_template',
  'email_body_template',
];

// データベースからSMTP設定を取得
const getSmtpSettings = async (): Promise<Record<string, string>> => {
  const { data, error } = await supabase
    .from('system_settings')
    .select('key, value')
    .in('key', EMAIL_SETTING_KEYS);

  if (error) {
    console.error('SMTP設定取得エラー:', error);
    throw new Error('SMTP設定の取得に失敗しました');
  }

  const settings: Record<string, string> = {};
  data?.forEach((item) => {
    settings[item.key] = item.value || '';
  });

  return settings;
};

// データベースからメールテンプレートを取得
const getEmailTemplates = async (): Promise<{ subject: string; body: string }> => {
  const { data, error } = await supabase
    .from('system_settings')
    .select('key, value')
    .in('key', EMAIL_TEMPLATE_KEYS);

  if (error) {
    console.error('メールテンプレート取得エラー:', error);
  }

  const templates: Record<string, string> = {};
  data?.forEach((item) => {
    templates[item.key] = item.value || '';
  });

  // デフォルトテンプレート
  const defaultSubject = '【発注書】{{store_name}} → {{supplier_name}}（{{order_number}}）';
  const defaultBody = `いつもお世話になっております。
FOOD&COMPANYの{{store_name}}です。

下記の通り発注いたします。
ご確認のほどよろしくお願いいたします。

━━━━━━━━━━━━━━━━━━━━━━━━━━
発注番号: {{order_number}}
発注日: {{order_date}}
届け先: {{store_name}}
届け予定日: {{expected_arrival}}
商品数: {{item_count}}件
合計金額: ¥{{total_amount}}
━━━━━━━━━━━━━━━━━━━━━━━━━━

【配送先】
〒{{store_postal_code}}
{{store_address}}
TEL: {{store_phone}}
担当: {{store_contact}}

詳細は添付の発注書をご確認ください。

何卒よろしくお願いいたします。

──────────────────────────
FOOD&COMPANY {{store_name}}
──────────────────────────`;

  return {
    subject: templates.email_subject_template || defaultSubject,
    body: templates.email_body_template || defaultBody,
  };
};

// 店舗情報を取得
const getStoreInfo = async (storeName: string): Promise<Record<string, string>> => {
  try {
    const { data, error } = await supabase
      .from('store_settings')
      .select('*')
      .eq('store_name', storeName)
      .single();

    if (error || !data) {
      console.log(`店舗情報が見つかりません: ${storeName}`);
      return {
        postal_code: '',
        address: '',
        phone: '',
        contact_person: '',
      };
    }

    return {
      postal_code: data.postal_code || '',
      address: data.address || '',
      phone: data.phone || '',
      contact_person: data.contact_person || '',
    };
  } catch (error) {
    console.error('店舗情報取得エラー:', error);
    return {
      postal_code: '',
      address: '',
      phone: '',
      contact_person: '',
    };
  }
};

// テンプレート変数を置換
const replaceTemplateVariables = (template: string, variables: Record<string, string>): string => {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`{{${key}}}`, 'g');
    result = result.replace(regex, value);
  }
  return result;
};

// 環境変数またはデータベースからSMTP設定を取得してトランスポーターを作成
const createTransporter = async () => {
  // まずデータベースから設定を取得
  const dbSettings = await getSmtpSettings();
  
  // データベースに設定があればそれを使用、なければ環境変数にフォールバック
  const host = dbSettings.smtp_host || process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(dbSettings.smtp_port || process.env.SMTP_PORT) || 587;
  const user = dbSettings.smtp_user || process.env.SMTP_USER;
  const pass = dbSettings.smtp_pass || process.env.SMTP_PASS;

  if (!user || !pass) {
    throw new Error('SMTP認証情報が設定されていません。設定画面でメール設定を行ってください。');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass,
    },
  });
};

// 送信元アドレスを取得
const getFromAddress = async (): Promise<string> => {
  const dbSettings = await getSmtpSettings();
  
  const fromName = dbSettings.smtp_from_name || 'FOOD&COMPANY';
  const fromEmail = dbSettings.smtp_from || dbSettings.smtp_user || process.env.SMTP_FROM || 'noreply@foodandcompany.co.jp';
  
  return `${fromName} <${fromEmail}>`;
};

interface SendOrderEmailParams {
  to: string;
  supplierName: string;
  companyName?: string;  // 会社名（テンプレート変数用）
  orderNumber: string;
  storeName: string;
  orderDate: string;
  expectedArrival: string;
  totalAmount: number;
  itemCount: number;
  pdfBuffer: Buffer;
  customMessage?: string;
}

export const sendOrderEmail = async (params: SendOrderEmailParams) => {
  const {
    to,
    supplierName,
    companyName,
    orderNumber,
    storeName,
    orderDate,
    expectedArrival,
    totalAmount,
    itemCount,
    pdfBuffer,
    customMessage,
  } = params;
  
  // 店舗情報を取得
  const storeInfo = await getStoreInfo(storeName);
  
  // テンプレート変数
  const templateVariables: Record<string, string> = {
    supplier_name: supplierName,
    company_name: companyName || supplierName,  // 会社名（未設定の場合は仕入先名）
    order_number: orderNumber,
    store_name: storeName,
    order_date: orderDate,
    expected_arrival: expectedArrival,
    total_amount: totalAmount.toLocaleString(),
    item_count: itemCount.toString(),
    store_postal_code: storeInfo.postal_code,
    store_address: storeInfo.address,
    store_phone: storeInfo.phone,
    store_contact: storeInfo.contact_person,
  };
  
  // テンプレートを取得
  const templates = await getEmailTemplates();
  
  // 件名と本文を生成
  const subject = replaceTemplateVariables(templates.subject, templateVariables);
  const body = customMessage || replaceTemplateVariables(templates.body, templateVariables);
  
  // トランスポーターを動的に作成
  const transporter = await createTransporter();
  const fromAddress = await getFromAddress();
  
  const mailOptions = {
    from: fromAddress,
    to,
    subject,
    text: body,
    attachments: [
      {
        filename: `発注書_${orderNumber}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  };
  
  return transporter.sendMail(mailOptions);
};

// SMTP設定が有効かどうかをチェック
export const isEmailConfigured = async (): Promise<boolean> => {
  try {
    const dbSettings = await getSmtpSettings();
    
    // データベースに設定があるか
    if (dbSettings.smtp_host && dbSettings.smtp_user && dbSettings.smtp_pass) {
      return true;
    }
    
    // 環境変数に設定があるか
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      return true;
    }
    
    return false;
  } catch {
    return false;
  }
};
