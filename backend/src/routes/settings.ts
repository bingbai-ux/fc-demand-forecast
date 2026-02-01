import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import nodemailer from 'nodemailer';

const router = Router();

// メール設定のキー一覧
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

// メール設定を取得
router.get('/email', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('key, value, description, is_secret')
      .in('key', EMAIL_SETTING_KEYS);

    if (error) {
      console.error('メール設定取得エラー:', error);
      return res.status(500).json({ success: false, error: error.message });
    }

    // シークレット値はマスク
    const settings: Record<string, any> = {};
    data?.forEach((item) => {
      if (item.is_secret && item.value) {
        settings[item.key] = '********'; // パスワードはマスク
      } else {
        settings[item.key] = item.value || '';
      }
    });

    // 設定済みかどうかのフラグ
    const isConfigured = !!(settings.smtp_host && settings.smtp_user && settings.smtp_pass !== '');

    res.json({
      success: true,
      settings,
      isConfigured,
    });
  } catch (error: any) {
    console.error('メール設定取得エラー:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// メール設定を保存
router.post('/email', async (req: Request, res: Response) => {
  try {
    const { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_from_name } = req.body;

    // 更新するデータを準備
    const updates = [
      { key: 'smtp_host', value: smtp_host || '', is_secret: false },
      { key: 'smtp_port', value: smtp_port?.toString() || '587', is_secret: false },
      { key: 'smtp_user', value: smtp_user || '', is_secret: false },
      { key: 'smtp_from', value: smtp_from || '', is_secret: false },
      { key: 'smtp_from_name', value: smtp_from_name || 'FOOD&COMPANY', is_secret: false },
    ];

    // パスワードは空でなければ更新（マスク値の場合は更新しない）
    if (smtp_pass && smtp_pass !== '********') {
      updates.push({ key: 'smtp_pass', value: smtp_pass, is_secret: true });
    }

    // 各設定をupsert
    for (const update of updates) {
      const { error } = await supabase
        .from('system_settings')
        .upsert(
          {
            key: update.key,
            value: update.value,
            is_secret: update.is_secret,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'key' }
        );

      if (error) {
        console.error(`設定保存エラー (${update.key}):`, error);
        throw error;
      }
    }

    res.json({ success: true, message: 'メール設定を保存しました' });
  } catch (error: any) {
    console.error('メール設定保存エラー:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// テストメールを送信
router.post('/email/test', async (req: Request, res: Response) => {
  try {
    const { to } = req.body;

    if (!to) {
      return res.status(400).json({ success: false, error: '送信先メールアドレスを指定してください' });
    }

    // データベースからSMTP設定を取得
    const { data: settingsData, error: settingsError } = await supabase
      .from('system_settings')
      .select('key, value')
      .in('key', EMAIL_SETTING_KEYS);

    if (settingsError) {
      throw settingsError;
    }

    const settings: Record<string, string> = {};
    settingsData?.forEach((item) => {
      settings[item.key] = item.value || '';
    });

    // 設定チェック
    if (!settings.smtp_host || !settings.smtp_user || !settings.smtp_pass) {
      return res.status(400).json({
        success: false,
        error: 'SMTP設定が不完全です。ホスト、ユーザー、パスワードを設定してください。',
      });
    }

    // トランスポーターを作成
    const transporter = nodemailer.createTransport({
      host: settings.smtp_host,
      port: Number(settings.smtp_port) || 587,
      secure: Number(settings.smtp_port) === 465,
      auth: {
        user: settings.smtp_user,
        pass: settings.smtp_pass,
      },
    });

    // テストメールを送信
    const fromName = settings.smtp_from_name || 'FOOD&COMPANY';
    const fromEmail = settings.smtp_from || settings.smtp_user;

    await transporter.sendMail({
      from: `${fromName} <${fromEmail}>`,
      to,
      subject: '【テスト】FOOD&COMPANY 需要予測システム メール設定確認',
      text: `このメールはFOOD&COMPANY需要予測システムからのテストメールです。

このメールが届いていれば、メール設定は正しく構成されています。

━━━━━━━━━━━━━━━━━━━━━━━━━━
設定情報:
SMTPホスト: ${settings.smtp_host}
SMTPポート: ${settings.smtp_port}
送信元: ${fromName} <${fromEmail}>
━━━━━━━━━━━━━━━━━━━━━━━━━━

このメールは自動送信されています。
`,
    });

    res.json({ success: true, message: `テストメールを ${to} に送信しました` });
  } catch (error: any) {
    console.error('テストメール送信エラー:', error);
    
    // エラーメッセージを分かりやすく
    let errorMessage = error.message;
    if (error.code === 'EAUTH') {
      errorMessage = '認証エラー: ユーザー名またはパスワードが正しくありません';
    } else if (error.code === 'ECONNREFUSED') {
      errorMessage = '接続エラー: SMTPサーバーに接続できません';
    } else if (error.code === 'ETIMEDOUT') {
      errorMessage = 'タイムアウト: SMTPサーバーからの応答がありません';
    }
    
    res.status(500).json({ success: false, error: errorMessage });
  }
});

// メールテンプレートを取得
router.get('/email/template', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('key, value')
      .in('key', EMAIL_TEMPLATE_KEYS);

    if (error) {
      console.error('メールテンプレート取得エラー:', error);
      return res.status(500).json({ success: false, error: error.message });
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

    res.json({
      success: true,
      templates: {
        subject: templates.email_subject_template || defaultSubject,
        body: templates.email_body_template || defaultBody,
      },
      defaultTemplates: {
        subject: defaultSubject,
        body: defaultBody,
      },
    });
  } catch (error: any) {
    console.error('メールテンプレート取得エラー:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// メールテンプレートを保存
router.post('/email/template', async (req: Request, res: Response) => {
  try {
    const { subject, body } = req.body;

    // 更新するデータを準備
    const updates = [
      { key: 'email_subject_template', value: subject || '' },
      { key: 'email_body_template', value: body || '' },
    ];

    // 各設定をupsert
    for (const update of updates) {
      const { error } = await supabase
        .from('system_settings')
        .upsert(
          {
            key: update.key,
            value: update.value,
            is_secret: false,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'key' }
        );

      if (error) {
        console.error(`テンプレート保存エラー (${update.key}):`, error);
        throw error;
      }
    }

    res.json({ success: true, message: 'メールテンプレートを保存しました' });
  } catch (error: any) {
    console.error('メールテンプレート保存エラー:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 店舗情報を取得（スマレジから店舗を取得して設定とマージ）
router.get('/stores', async (req: Request, res: Response) => {
  try {
    // スマレジから店舗一覧を取得
    const { getStores } = await import('../services/smaregi/stores');
    const smaregiStores = await getStores();

    // スマレジの店舗データを変換
    const uniqueStores = smaregiStores.map((store: any) => ({
      store_id: store.storeId,
      store_name: store.storeName,
    }));

    // 店舗設定を取得
    const { data: storeSettings, error: settingsError } = await supabase
      .from('store_settings')
      .select('*');

    if (settingsError && settingsError.code !== '42P01') {
      console.error('店舗設定取得エラー:', settingsError);
    }

    // 設定をマップ化（store_nameで検索）
    const settingsMap = new Map(
      (storeSettings || []).map((s: any) => [s.store_name, s])
    );

    // 店舗データと設定をマージ
    const stores = uniqueStores.map((store: any) => {
      const settings = settingsMap.get(store.store_name) || {};
      return {
        store_id: store.store_id,
        store_name: store.store_name,
        postal_code: settings.postal_code || '',
        address: settings.address || '',
        phone: settings.phone || '',
        contact_person: settings.contact_person || '',
      };
    });

    res.json({ success: true, stores });
  } catch (error: any) {
    console.error('店舗情報取得エラー:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 店舗情報を保存（配列または単一）
router.post('/stores', async (req: Request, res: Response) => {
  try {
    const { stores } = req.body;

    if (!stores || !Array.isArray(stores)) {
      return res.status(400).json({ success: false, error: '店舗データが必要です' });
    }

    for (const store of stores) {
      const { error } = await supabase
        .from('store_settings')
        .upsert(
          {
            store_id: store.store_id,
            store_name: store.store_name,
            postal_code: store.postal_code || '',
            address: store.address || '',
            phone: store.phone || '',
            contact_person: store.contact_person || '',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'store_id' }
        );

      if (error) {
        console.error(`店舗情報保存エラー (${store.store_id}):`, error);
        throw error;
      }
    }

    res.json({ success: true, message: `${stores.length}件の店舗情報を保存しました` });
  } catch (error: any) {
    console.error('店舗情報一括保存エラー:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 特定の店舗情報を取得（店舗名で検索）
router.get('/stores/by-name/:storeName', async (req: Request, res: Response) => {
  try {
    const { storeName } = req.params;

    const { data, error } = await supabase
      .from('store_settings')
      .select('*')
      .eq('store_name', storeName)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // 見つからない場合
        return res.json({ success: true, store: null });
      }
      console.error('店舗情報取得エラー:', error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, store: data });
  } catch (error: any) {
    console.error('店舗情報取得エラー:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
