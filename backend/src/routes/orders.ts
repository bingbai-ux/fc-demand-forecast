import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { sendOrderEmail } from '../services/mailer';

const router = Router();

console.log('=== Orders Router 初期化開始 ===');

// ===== テストエンドポイント（問題の切り分け用） =====
router.get('/test', (req: Request, res: Response) => {
  console.log('=== テストエンドポイント呼び出し ===');
  res.json({ success: true, message: 'Orders API is working', timestamp: new Date().toISOString() });
});

router.post('/test-post', (req: Request, res: Response) => {
  console.log('=== POSTテストエンドポイント呼び出し ===');
  res.json({ success: true, message: 'POST is working', body: req.body });
});

// スマレジAPI最小限テストエンドポイント
router.get('/test-smaregi-minimal', async (req: Request, res: Response) => {
  try {
    console.log('=== スマレジ最小限テスト ===');
    
    const { getAccessTokenWithScopes } = await import('../services/smaregi/tokenManager');
    const accessToken = await getAccessTokenWithScopes();
    const contractId = process.env.SMAREGI_CONTRACT_ID;
    
    if (!accessToken) {
      return res.status(500).json({ error: 'アクセストークン取得失敗' });
    }
    
    // ★★★ 正しいAPI仕様に従ったリクエスト ★★★
    const requestBody = {
      recipientOrderId: "1",  // 発注先（仕入先ID）
      orderSourceStoreId: "1",  // 発注元店舗ID
      orderedDate: new Date().toISOString().split('T')[0],  // 発注日
      status: "2",  // 2:発注済
      products: [
        {
          productId: "1",
          cost: "100",
          deliveryStore: [
            {
              storeId: "1",
              quantity: "1"
            }
          ]
        }
      ],
      stores: [
        {
          storageStoreId: "1",
          storageExpectedDateFrom: new Date().toISOString().split('T')[0],
          storageExpectedDateTo: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        }
      ]
    };
    
    console.log('テストリクエスト:', JSON.stringify(requestBody, null, 2));
    
    // ★★★ 正しいエンドポイント: /purchase_orders（pos/なし） ★★★
    const apiUrl = `https://api.smaregi.jp/${contractId}/pos/purchase_orders`;
    console.log('API URL:', apiUrl);
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(requestBody),
    });
    
    const text = await response.text();
    console.log('Status:', response.status);
    console.log('Response:', text);
    
    res.json({ status: response.status, body: text });
  } catch (error: any) {
    console.error('テストエラー:', error);
    res.status(500).json({ error: error.message });
  }
});

// 発注番号を生成――タイムスタンプベースで一意性を保証
async function generateUniqueOrderNumber(): Promise<string> {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  
  // 今日の発注数を取得
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const { count } = await supabase
    .from('order_history')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', todayStart);
  
  const sequence = String((count || 0) + 1).padStart(3, '0');
  return `ORD-${dateStr}-${sequence}`;
}

// 後方互換性のための同期版（ランダム）
function generateOrderNumber(): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const timestamp = now.getTime().toString(36).slice(-4).toUpperCase();
  const random = Math.floor(Math.random() * 100).toString().padStart(2, '0');
  return `ORD-${dateStr}-${timestamp}${random}`;
}

// PDF生成をバッファとして返す関数
const generatePdfBuffer = async (order: any, items: any[], storeSettings?: any): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ 
      size: 'A4', 
      margin: 50,
      info: {
        Title: `発注書 ${order.order_number}`,
        Author: 'FOOD&COMPANY',
      }
    });
    
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    
    // 日本語フォントを試みる（なければデフォルト）
    const fontPath = path.join(__dirname, '../../fonts/NotoSansJP-Regular.otf');
    if (fs.existsSync(fontPath)) {
      doc.registerFont('Japanese', fontPath);
      doc.font('Japanese');
    }
    
    // ページ幅
    const pageWidth = 595; // A4 width in points
    const leftMargin = 50;
    const rightMargin = 545;
    
    // === 右上：発注日・発注番号 ===
    doc.fontSize(9).fillColor('#000000');
    doc.text(`発注日: ${order.order_date}`, 380, 40, { width: 165, align: 'right' });
    doc.text(`発注番号: ${order.order_number}`, 380, 55, { width: 165, align: 'right' });
    
    // === 中央：発注書タイトル ===
    doc.fontSize(24).fillColor('#000000');
    doc.text('発注書', leftMargin, 85, { width: pageWidth - 100, align: 'center' });
    
    // 区切り線（タイトルの下にスペースを追加）
    doc.moveTo(leftMargin, 120).lineTo(rightMargin, 120).stroke('#000000');
    
    // === 左側：宛名（仕入先） ===
    const displayName = order.display_name || order.supplier_name;
    doc.fontSize(14).fillColor('#000000');
    doc.text(`${displayName}`, leftMargin, 140);
    doc.fontSize(10).text('御中', leftMargin, 160);
    
    // === 右側：発注者情報 ===
    const rightInfoX = 350;
    doc.fontSize(9).fillColor('#000000');
    doc.text('株式会社FOOD&COMPANY', rightInfoX, 140);
    doc.text(`${order.store_name}`, rightInfoX, 155);
    if (storeSettings?.phone) {
      doc.text(`TEL: ${storeSettings.phone}`, rightInfoX, 170);
    }
    if (storeSettings?.contact_person) {
      doc.text(`担当: ${storeSettings.contact_person}`, rightInfoX, 185);
    }
    
    // === 挨拶文 ===
    doc.fontSize(9).fillColor('#000000');
    doc.text('平素は格別のお引き立てを賭り、厚く御礼申し上げます。', leftMargin, 210);
    doc.text('下記の通り発注いたしますので、ご手配のほどよろしくお願い申し上げます。', leftMargin, 223);
    
    // === 納品希望日 ===
    const deliveryY = 240;
    doc.fontSize(10);
    doc.rect(leftMargin, deliveryY, 80, 20).fill('#333333');
    doc.fillColor('#ffffff').text('納品希望日', leftMargin + 8, deliveryY + 5);
    doc.fillColor('#000000');
    doc.fontSize(12).text(order.expected_arrival || '指定なし', leftMargin + 90, deliveryY + 4);
    
    // === お届け先情報 ===
    const deliveryInfoY = 280;
    doc.fontSize(10);
    doc.rect(leftMargin, deliveryInfoY, 70, 18).fill('#333333');
    doc.fillColor('#ffffff').text('お届け先', leftMargin + 8, deliveryInfoY + 4);
    doc.fillColor('#000000');
    
    doc.fontSize(9);
    let infoY = deliveryInfoY + 25;
    doc.text(`(株)FOOD&COMPANY ${order.store_name}`, leftMargin, infoY);
    infoY += 13;
    if (storeSettings?.postal_code) {
      doc.text(`〒${storeSettings.postal_code}`, leftMargin, infoY);
      infoY += 13;
    }
    if (storeSettings?.address) {
      // 住所が長い場合は折り返し
      const address = storeSettings.address;
      if (address.length > 40) {
        doc.text(address.substring(0, 40), leftMargin, infoY);
        infoY += 13;
        doc.text(address.substring(40), leftMargin, infoY);
        infoY += 13;
      } else {
        doc.text(address, leftMargin, infoY);
        infoY += 13;
      }
    }
    if (storeSettings?.phone) {
      doc.text(`TEL: ${storeSettings.phone}`, leftMargin, infoY);
      infoY += 13;
    }
    if (storeSettings?.contact_person) {
      doc.text(`担当: ${storeSettings.contact_person}`, leftMargin, infoY);
    }
    
    // === 明細テーブル ===
    const tableTop = 400;
    const tableLeft = leftMargin;
    const colWidths = {
      no: 35,
      brand: 100,
      name: 280,
      qty: 50,
    };
    const tableWidth = colWidths.no + colWidths.brand + colWidths.name + colWidths.qty;
    
    // テーブルヘッダー背景
    doc.rect(tableLeft, tableTop, tableWidth, 22).fill('#333333');
    
    // テーブルヘッダーテキスト
    doc.fillColor('#ffffff').fontSize(9);
    let x = tableLeft;
    doc.text('No.', x + 5, tableTop + 6, { width: colWidths.no });
    x += colWidths.no;
    doc.text('ブランド', x + 5, tableTop + 6, { width: colWidths.brand });
    x += colWidths.brand;
    doc.text('商品名', x + 5, tableTop + 6, { width: colWidths.name });
    x += colWidths.name;
    doc.text('数量', x, tableTop + 6, { width: colWidths.qty, align: 'center' });
    
    // テーブル行
    let y = tableTop + 27;
    let totalQuantity = 0;
    
    items?.forEach((item: any, index: number) => {
      // 行の背景（交互）
      doc.fillColor('#000000');
      if (index % 2 === 1) {
        doc.rect(tableLeft, y - 3, tableWidth, 20).fill('#f5f5f5');
      }
      doc.fillColor('#000000');
      
      x = tableLeft;
      doc.fontSize(9).text(String(index + 1), x + 5, y, { width: colWidths.no });
      x += colWidths.no;
      
      // ブランド名
      const brandName = item.brand_name || '-';
      doc.text(brandName.length > 12 ? brandName.substring(0, 12) + '...' : brandName, x + 5, y, { width: colWidths.brand });
      x += colWidths.brand;
      
      // 商品名（長い場合は省略）
      const productName = item.product_name.length > 40 
        ? item.product_name.substring(0, 40) + '...' 
        : item.product_name;
      doc.text(productName, x + 5, y, { width: colWidths.name });
      x += colWidths.name;
      
      doc.text(String(item.quantity), x, y, { width: colWidths.qty, align: 'center' });
      
      totalQuantity += item.quantity;
      y += 20;
      
      // ページをまたぐ場合
      if (y > 750) {
        doc.addPage();
        y = 50;
      }
    });
    
    // テーブル下線
    doc.moveTo(tableLeft, y + 2).lineTo(tableLeft + tableWidth, y + 2).stroke('#cccccc');
    
    // === 合計数量 ===
    y += 15;
    doc.fontSize(11);
    doc.text('合計数量:', tableLeft + tableWidth - 150, y);
    doc.text(`${totalQuantity} 個`, tableLeft + tableWidth - 50, y, { width: 50, align: 'right' });
    
    // === 備考 ===
    if (order.notes) {
      y += 40;
      doc.fontSize(10).text('【備考】', 50, y);
      doc.fontSize(9).text(order.notes, 50, y + 15, { width: 450 });
    }
    
    // === フッター ===
    doc.fontSize(8).fillColor('#999999');
    doc.text('この発注書はFOOD&COMPANY需要予測システムから発行されました', 50, 780, { align: 'center', width: 500 });
    
    doc.end();
  });
};

// 発注を作成
router.post('/', async (req: Request, res: Response) => {
  try {
    const { 
      supplierCode, 
      supplierName,
      storeId, 
      storeName, 
      orderDate, 
      expectedArrival, 
      items, 
      notes,
      orderMethod 
    } = req.body;

    if (!supplierCode || !items || items.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: '仕入先コードと商品が必要です' 
      });
    }

    console.log(`個別発注処理中: ${supplierName || supplierCode}`);
    console.log('items数:', items.length);

    // 合計金額と合計数量を計算（null/undefined対策）
    const totalQuantity = items.reduce((sum: number, item: any) => {
      const qty = Number(item.quantity) || 0;
      return sum + qty;
    }, 0);
    
    const totalAmount = items.reduce((sum: number, item: any) => {
      // amountがあれば使用、なければquantity * unitPriceで計算
      if (item.amount !== undefined && item.amount !== null) {
        return sum + Number(item.amount);
      }
      const qty = Number(item.quantity) || 0;
      const price = Number(item.unitPrice) || 0;
      return sum + (qty * price);
    }, 0);
    
    console.log(`totalQuantity: ${totalQuantity}, totalAmount: ${totalAmount}`);

    // 発注番号を生成
    const orderNumber = generateOrderNumber();

    // 発注履歴を作成
    const supplierNameValue = supplierName || supplierCode || 'Unknown';
    const { data: order, error: orderError } = await supabase
      .from('order_history')
      .insert({
        order_number: orderNumber,
        supplier_code: supplierCode,
        supplier_name: supplierNameValue,
        store_id: storeId,
        store_name: storeName,
        order_date: orderDate,
        expected_arrival: expectedArrival,
        total_amount: totalAmount,
        total_quantity: totalQuantity,
        item_count: items.length,
        status: 'ordered',
        notes: notes || null,
        order_method: orderMethod || 'manual',
      })
      .select()
      .single();

    if (orderError) {
      console.error('発注履歴作成エラー:', orderError);
      throw orderError;
    }

    // 発注明細を作成（amountがnullの場合は計算）
    const orderItems = items.map((item: any) => {
      const qty = Number(item.quantity) || 0;
      const price = Number(item.unitPrice) || 0;
      const amount = (item.amount !== undefined && item.amount !== null) 
        ? Number(item.amount) 
        : qty * price;
      return {
        order_id: order.id,
        product_id: String(item.productId || ''),
        product_name: item.productName || '',
        brand_name: item.brandName || null,
        quantity: qty,
        unit_price: price,
        amount: amount,
      };
    });

    const { error: itemsError } = await supabase
      .from('order_history_items')
      .insert(orderItems);

    if (itemsError) {
      console.error('発注明細作成エラー:', itemsError);
      throw itemsError;
    }

    // レスポンスにorderNumberを明示的に含める（複数の形式で）
    res.json({
      success: true,
      order: {
        id: order.id,
        order_number: orderNumber,
        orderNumber: orderNumber,  // フロントエンド用に両方の形式で返す
        totalAmount: order.total_amount,
        itemCount: order.item_count,
      },
      orderNumber: orderNumber,  // トップレベルにも追加
    });

  } catch (error: any) {
    console.error('発注作成エラー:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 発注書PDFプレビュー（サンプルデータで生成）- ルート順序のためここに配置
router.get('/pdf-preview', async (req, res) => {
  try {
    const sampleOrder = {
      order_number: 'ORD-PREVIEW-001',
      order_date: new Date().toISOString().slice(0, 10),
      expected_arrival: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      supplier_name: 'Sample Supplier',
      display_name: 'Sample Company Inc.',
      store_name: 'FOOD&COMPANY Daikanyama T-SITE',
    };
    
    const sampleItems = [
      { product_name: 'Organic Milk 1000ml', brand_name: 'North Plain Farm', quantity: 10 },
      { product_name: 'Organic Yogurt 400g', brand_name: 'North Plain Farm', quantity: 15 },
      { product_name: 'Japanese Honey 250g', brand_name: 'Yamada Apiary', quantity: 5 },
      { product_name: 'Organic Olive Oil 500ml', brand_name: 'Italian', quantity: 8 },
      { product_name: 'Natural Yeast Bread', brand_name: 'Homemade', quantity: 20 },
    ];
    
    const sampleStoreSettings = {
      postal_code: '150-0033',
      address: 'Tokyo Shibuya-ku Sarugakucho 16-15',
      phone: '03-5990-4783',
      contact_person: 'Ikeda',
    };
    
    const pdfBuffer = await generatePdfBuffer(sampleOrder, sampleItems, sampleStoreSettings);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="preview.pdf"');
    res.send(pdfBuffer);
    
  } catch (error: any) {
    console.error('PDF Preview Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 一括発注を作成（固定パスなので先に定義）
router.post('/bulk-create', async (req: Request, res: Response) => {
  console.log('=== 一括発注API呼び出し ===');
  try {
    const { orders } = req.body;

    if (!orders || !Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: '発注データが必要です' 
      });
    }

    const results = [];
    const errors = [];

    for (const orderData of orders) {
      try {
        const { 
          supplierCode, 
          supplierName,
          storeId, 
          storeName, 
          orderDate, 
          expectedArrival, 
          items, 
          notes,
          orderMethod,
          sendEmail 
        } = orderData;

        if (!supplierCode || !items || items.length === 0) {
          errors.push({ supplierCode, error: '仕入先コードと商品が必要です' });
          continue;
        }

        console.log(`処理中: ${supplierName || supplierCode}`);

        // 合計金額と合計数量を計算
        const totalQuantity = items.reduce((sum: number, item: any) => {
          const qty = Number(item.quantity) || 0;
          return sum + qty;
        }, 0);
        
        const totalAmount = items.reduce((sum: number, item: any) => {
          if (item.amount !== undefined && item.amount !== null) {
            return sum + Number(item.amount);
          }
          const qty = Number(item.quantity) || 0;
          const price = Number(item.unitPrice) || 0;
          return sum + (qty * price);
        }, 0);
        
        if (totalAmount === 0 || isNaN(totalAmount)) {
          errors.push({ supplierCode, error: '発注金額が計算できません' });
          continue;
        }

        const orderNumber = await generateUniqueOrderNumber();
        const supplierNameValue = supplierName || supplierCode || 'Unknown';
        
        const { data: order, error: orderError } = await supabase
          .from('order_history')
          .insert({
            order_number: orderNumber,
            supplier_code: supplierCode,
            supplier_name: supplierNameValue,
            store_id: storeId,
            store_name: storeName,
            order_date: orderDate,
            expected_arrival: expectedArrival,
            total_amount: totalAmount,
            total_quantity: totalQuantity,
            item_count: items.length,
            status: 'ordered',
            notes: notes || null,
            order_method: orderMethod || 'manual',
          })
          .select()
          .single();

        if (orderError) {
          errors.push({ supplierCode, error: orderError.message });
          continue;
        }

        const orderItems = items.map((item: any) => {
          const qty = Number(item.quantity) || 0;
          const price = Number(item.unitPrice) || 0;
          const amount = (item.amount !== undefined && item.amount !== null) 
            ? Number(item.amount) 
            : qty * price;
          return {
            order_id: order.id,
            product_id: String(item.productId || ''),
            product_name: item.productName || '',
            brand_name: item.brandName || null,
            quantity: qty,
            unit_price: price,
            amount: amount,
          };
        });

        const { error: itemsError } = await supabase
          .from('order_history_items')
          .insert(orderItems);

        if (itemsError) {
          errors.push({ supplierCode, error: itemsError.message });
          continue;
        }

        // メール送信が必要な場合
        if (sendEmail && orderMethod === 'email') {
          try {
            const { data: supplier } = await supabase
              .from('suppliers')
              .select('email, company_name')
              .eq('supplier_code', supplierCode)
              .single();

            if (supplier?.email) {
              const { data: storeSettings } = await supabase
                .from('store_settings')
                .select('*')
                .eq('store_name', storeName)
                .single();

              const orderWithDisplayName = {
                ...order,
                display_name: supplier.company_name || supplierNameValue
              };

              const pdfBuffer = await generatePdfBuffer(orderWithDisplayName, orderItems.map((item: any, index: number) => ({
                ...item,
                product_name: items[index].productName,
                brand_name: items[index].brandName || null,
              })), storeSettings);

              await sendOrderEmail({
                to: supplier.email,
                orderNumber: order.order_number,
                supplierName: supplierNameValue,
                companyName: supplier.company_name || '',
                storeName: storeName,
                orderDate: orderDate,
                expectedArrival: expectedArrival,
                totalAmount: totalAmount,
                itemCount: items.length,
                pdfBuffer,
              });

              await supabase
                .from('order_history')
                .update({ status: 'sent' })
                .eq('id', order.id);
            }
          } catch (emailError: any) {
            console.error('メール送信エラー:', emailError);
          }
        }

        results.push({
          success: true,
          id: order.id,
          orderId: order.id,
          orderNumber: order.order_number,
          order_number: order.order_number,
          supplierCode,
          supplierName: supplierNameValue,
          totalAmount: order.total_amount,
          totalQuantity: order.total_quantity,
          itemCount: order.item_count,
          orderMethod: orderMethod || 'manual',
        });

      } catch (err: any) {
        errors.push({ supplierCode: orderData.supplierCode, error: err.message });
      }
    }

    res.json({
      success: true,
      results,
      errors: errors.length > 0 ? errors : undefined,
      summary: {
        total: orders.length,
        success: results.length,
        succeeded: results.length,
        failed: errors.length,
      },
    });

  } catch (error: any) {
    console.error('一括発注作成エラー:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 発注履歴を取得
router.get('/', async (req: Request, res: Response) => {
  try {
    const { supplierCode, status, from, to, storeId, startDate, endDate } = req.query;

    let query = supabase
      .from('order_history')
      .select('*')
      .order('created_at', { ascending: false });

    if (supplierCode) {
      query = query.eq('supplier_code', supplierCode);
    }
    if (status) {
      query = query.eq('status', status);
    }
    if (storeId) {
      query = query.eq('store_id', storeId);
    }
    if (from || startDate) {
      query = query.gte('order_date', from || startDate);
    }
    if (to || endDate) {
      query = query.lte('order_date', to || endDate);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json({ success: true, orders: data || [] });

  } catch (error: any) {
    console.error('発注履歴取得エラー:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// スマレジAPIレスポンスの型定義
interface SmaregiPurchaseOrderResponse {
  purchaseOrderId?: string;
  id?: string;
  message?: string;
  error?: string;
  title?: string;
  type?: string;
}

// スマレジに発注情報を連携（入荷予定として登録）
// ※重要: /:orderId より前に定義する必要がある
router.post('/:id/sync-smaregi', async (req: Request, res: Response) => {
  console.log('=== スマレジ連携API呼び出し ===');
  console.log('発注ID:', req.params.id);
  
  try {
    const { id } = req.params;
    
    // 1. 発注データを取得
    const { data: order, error: orderError } = await supabase
      .from('order_history')
      .select('*')
      .eq('id', id)
      .single();
    
    if (orderError || !order) {
      console.log('発注が見つかりません:', orderError);
      return res.status(404).json({ 
        success: false, 
        error: '発注が見つかりません' 
      });
    }
    
    // 既に連携済みの場合はエラー
    if (order.smaregi_synced) {
      return res.status(400).json({ 
        success: false, 
        error: '既にスマレジに連携済みです' 
      });
    }
    
    // 2. 発注明細を取得
    const { data: items, error: itemsError } = await supabase
      .from('order_history_items')
      .select('*')
      .eq('order_id', id);
    
    if (itemsError || !items || items.length === 0) {
      console.log('発注明細がありません:', itemsError);
      return res.status(400).json({ 
        success: false, 
        error: '発注明細がありません' 
      });
    }
    
    console.log('発注データ:', order);
    console.log('明細件数:', items.length);
    
    // 3. スマレジAPIのアクセストークンを取得（pos.orders:writeスコープを含む）
    const { getAccessTokenWithScopes } = await import('../services/smaregi/tokenManager');
    const accessToken = await getAccessTokenWithScopes();
    
    if (!accessToken) {
      return res.status(500).json({ 
        success: false, 
        error: 'スマレジのアクセストークンを取得できませんでした' 
      });
    }
    
    // 4. 発注登録APIを呼び出し
    const contractId = process.env.SMAREGI_CONTRACT_ID;
    const apiUrl = `https://api.smaregi.jp/${contractId}/pos/purchase_orders`;
    
    // ★★★ 店舗IDの確認（必須） ★★★
    if (!order.store_id) {
      console.error('店舗IDが設定されていません:', order);
      return res.status(400).json({ 
        success: false, 
        error: '発注に店舗IDが設定されていません。発注時に店舗を選択してください。' 
      });
    }
    
    // ★★★ 商品データを変換（正しいAPI仕様に従う） ★★★
    const storeId = String(order.store_id);
    const products = items.map((item: any) => ({
      productId: String(item.product_id),
      cost: String(Math.round(item.unit_price)),
      deliveryStore: [
        {
          storeId: storeId,
          quantity: String(item.quantity)
        }
      ]
    }));
    
    const orderedDate = order.order_date || new Date().toISOString().split('T')[0];
    const expectedDate = order.expected_arrival || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    // ★★★ リクエストボディ（正しいAPI仕様に従う）★★★
    const requestBody = {
      recipientOrderId: "1",  // 発注先（仕入先ID）- デフォルトで1
      orderSourceStoreId: storeId,  // 発注元店舗ID
      orderedDate: orderedDate,  // 発注日
      memo: `${order.supplier_name || ''} - FC管理システムより連携`,
      identificationNo: order.order_number || '',  // 識別番号
      status: "2",  // 2:発注済
      products: products,
      stores: [
        {
          storageStoreId: storeId,
          storageExpectedDateFrom: orderedDate,
          storageExpectedDateTo: expectedDate
        }
      ]
    };
    
    console.log('=== スマレジAPIリクエスト ===');
    console.log('URL:', apiUrl);
    console.log('発注店舗:', order.store_name, '(ID:', order.store_id, ')');
    console.log('Body:', JSON.stringify(requestBody, null, 2));
    
    // ★★★ JSON形式で直接送信 ★★★
    const smaregiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(requestBody),
    });
    
    const responseText = await smaregiResponse.text();
    console.log('=== スマレジAPIレスポンス ===');
    console.log('Status:', smaregiResponse.status);
    console.log('Body:', responseText);
    
    let smaregiData: SmaregiPurchaseOrderResponse;
    try {
      smaregiData = JSON.parse(responseText);
    } catch (e) {
      return res.status(500).json({ 
        success: false, 
        error: `スマレジAPIエラー: ${responseText}` 
      });
    }
    
    if (!smaregiResponse.ok) {
      const errorDetail = smaregiData.message || smaregiData.title || JSON.stringify(smaregiData);
      console.error('スマレジAPIエラー:', errorDetail);
      return res.status(500).json({ 
        success: false, 
        error: `スマレジAPIエラー: ${errorDetail}` 
      });
    }
    
    // 6. 連携ステータスを更新
    await supabase
      .from('order_history')
      .update({ 
        smaregi_synced: true,
        smaregi_synced_at: new Date().toISOString(),
        smaregi_purchase_order_id: smaregiData.purchaseOrderId || smaregiData.id || null,
      })
      .eq('id', id);
    
    res.json({
      success: true,
      message: 'スマレジに入荷予定を登録しました',
      smaregiPurchaseOrderId: smaregiData.purchaseOrderId || smaregiData.id || null,
    });
    
  } catch (error: any) {
    console.error('スマレジ連携エラー:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// 一括スマレジ連携エンドポイント
router.post('/bulk-sync-smaregi', async (req: Request, res: Response) => {
  console.log('=== 一括スマレジ連携API呼び出し ===');
  
  try {
    const { orderIds } = req.body;
    
    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: '連携する発注IDを指定してください' 
      });
    }
    
    console.log('連携対象発注ID:', orderIds);
    
    // アクセストークンを取得
    const { getAccessTokenWithScopes } = await import('../services/smaregi/tokenManager');
    const accessToken = await getAccessTokenWithScopes();
    
    if (!accessToken) {
      return res.status(500).json({ 
        success: false, 
        error: 'スマレジのアクセストークンを取得できませんでした' 
      });
    }
    
    const contractId = process.env.SMAREGI_CONTRACT_ID;
    const apiUrl = `https://api.smaregi.jp/${contractId}/pos/purchase_orders`;
    
    const results: { orderId: number; success: boolean; message: string; smaregiPurchaseOrderId?: string }[] = [];
    
    for (const orderId of orderIds) {
      try {
        // 発注データを取得
        const { data: order, error: orderError } = await supabase
          .from('order_history')
          .select('*')
          .eq('id', orderId)
          .single();
        
        if (orderError || !order) {
          results.push({ orderId, success: false, message: '発注が見つかりません' });
          continue;
        }
        
        // 既に連携済みの場合はスキップ
        if (order.smaregi_synced) {
          results.push({ orderId, success: false, message: '既に連携済みです' });
          continue;
        }
        
        // 発注明細を取得
        const { data: items, error: itemsError } = await supabase
          .from('order_history_items')
          .select('*')
          .eq('order_id', orderId);
        
        if (itemsError || !items || items.length === 0) {
          results.push({ orderId, success: false, message: '発注明細がありません' });
          continue;
        }
        
        // 店舗IDの確認
        if (!order.store_id) {
          results.push({ orderId, success: false, message: '店舗IDが設定されていません' });
          continue;
        }
        
        // 商品データを変換
        const storeId = String(order.store_id);
        const products = items.map((item: any) => ({
          productId: String(item.product_id),
          cost: String(Math.round(item.unit_price)),
          deliveryStore: [
            {
              storeId: storeId,
              quantity: String(item.quantity)
            }
          ]
        }));
        
        const orderedDate = order.order_date || new Date().toISOString().split('T')[0];
        const expectedDate = order.expected_arrival || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        
        const requestBody = {
          recipientOrderId: "1",
          orderSourceStoreId: storeId,
          orderedDate: orderedDate,
          memo: `${order.supplier_name || ''} - FC管理システムより連携`,
          identificationNo: order.order_number || '',
          status: "2",
          products: products,
          stores: [
            {
              storageStoreId: storeId,
              storageExpectedDateFrom: orderedDate,
              storageExpectedDateTo: expectedDate
            }
          ]
        };
        
        // スマレジAPIを呼び出し
        const smaregiResponse = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify(requestBody),
        });
        
        const responseText = await smaregiResponse.text();
        let smaregiData: SmaregiPurchaseOrderResponse;
        
        try {
          smaregiData = JSON.parse(responseText);
        } catch (e) {
          results.push({ orderId, success: false, message: `APIエラー: ${responseText}` });
          continue;
        }
        
        if (!smaregiResponse.ok) {
          const errorDetail = smaregiData.message || smaregiData.title || JSON.stringify(smaregiData);
          results.push({ orderId, success: false, message: `APIエラー: ${errorDetail}` });
          continue;
        }
        
        // 連携ステータスを更新
        await supabase
          .from('order_history')
          .update({ 
            smaregi_synced: true,
            smaregi_synced_at: new Date().toISOString(),
            smaregi_purchase_order_id: smaregiData.purchaseOrderId || smaregiData.id || null,
          })
          .eq('id', orderId);
        
        results.push({ 
          orderId, 
          success: true, 
          message: '連携成功',
          smaregiPurchaseOrderId: smaregiData.purchaseOrderId || smaregiData.id || undefined
        });
        
      } catch (err: any) {
        results.push({ orderId, success: false, message: err.message });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    
    res.json({
      success: true,
      message: `${successCount}件連携成功、${failCount}件失敗`,
      results,
      summary: {
        total: orderIds.length,
        success: successCount,
        failed: failCount
      }
    });
    
  } catch (error: any) {
    console.error('一括スマレジ連携エラー:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// PDF発注書を生成してダウンロード
router.get('/:orderId/pdf', async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    
    // 発注情報を取得
    const { data: order, error: orderError } = await supabase
      .from('order_history')
      .select('*')
      .eq('id', orderId)
      .single();
    
    if (orderError) throw orderError;
    
    // 発注明細を取得
    const { data: items, error: itemsError } = await supabase
      .from('order_history_items')
      .select('*')
      .eq('order_id', orderId)
      .order('id');
    
    // 店舗設定を取得
    const { data: storeSettings } = await supabase
      .from('store_settings')
      .select('*')
      .eq('store_name', order.store_name)
      .single();
    
    // 仕入先情報を取得（会社名用）
    const { data: supplier } = await supabase
      .from('suppliers')
      .select('company_name')
      .eq('supplier_code', order.supplier_code)
      .single();
    
    // 会社名があれば使用、なければ仕入先名
    const orderWithDisplayName = {
      ...order,
      display_name: supplier?.company_name || order.supplier_name
    };
    
    const pdfBuffer = await generatePdfBuffer(orderWithDisplayName, items || [], storeSettings);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="order-${order.order_number}.pdf"`);
    res.send(pdfBuffer);
    
  } catch (error: any) {
    console.error('PDF生成エラー:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 発注をキャンセル
router.put('/:orderId/cancel', async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;

    const { data, error } = await supabase
      .from('order_history')
      .update({ status: 'cancelled' })
      .eq('id', orderId)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, order: data });

  } catch (error: any) {
    console.error('発注キャンセルエラー:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 発注ステータスを更新
router.put('/:orderId/status', async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, error: 'ステータスが必要です' });
    }

    const { data, error } = await supabase
      .from('order_history')
      .update({ status })
      .eq('id', orderId)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, order: data });

  } catch (error: any) {
    console.error('ステータス更新エラー:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// メールで発注書を送信
router.post('/:orderId/send-email', async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    
    // 発注情報を取得
    const { data: order, error: orderError } = await supabase
      .from('order_history')
      .select('*')
      .eq('id', orderId)
      .single();
    
    if (orderError) throw orderError;
    
    // 発注明細を取得
    const { data: items, error: itemsError } = await supabase
      .from('order_history_items')
      .select('*')
      .eq('order_id', orderId)
      .order('id');
    
    if (itemsError) throw itemsError;
    
    // 仕入先情報を取得（supplier_codeまたはsupplier_nameで検索）
    console.log('仕入先検索:', { supplier_code: order.supplier_code, supplier_name: order.supplier_name });
    
    // まずsupplier_codeで検索
    let { data: supplier, error: supplierError } = await supabase
      .from('suppliers')
      .select('email, company_name')
      .eq('supplier_code', order.supplier_code)
      .single();
    
    // supplier_codeで見つからない場合、supplier_nameで検索
    if (supplierError || !supplier) {
      console.log('supplier_codeで見つからないため、supplier_nameで検索:', order.supplier_name);
      const result = await supabase
        .from('suppliers')
        .select('email, company_name')
        .eq('supplier_name', order.supplier_name)
        .single();
      supplier = result.data;
      supplierError = result.error;
    }
    
    console.log('仕入先検索結果:', supplier);
    
    if (supplierError || !supplier?.email) {
      return res.status(400).json({ 
        success: false, 
        error: `仕入先のメールアドレスが設定されていません（仕入先: ${order.supplier_name}）` 
      });
    }
    
    // 店舗設定を取得
    const { data: storeSettings } = await supabase
      .from('store_settings')
      .select('*')
      .eq('store_name', order.store_name)
      .single();
    
    // 会社名があれば使用
    const orderWithDisplayName = {
      ...order,
      display_name: supplier.company_name || order.supplier_name
    };
    
    // PDF生成
    const pdfBuffer = await generatePdfBuffer(orderWithDisplayName, items || [], storeSettings);
    
    // メール送信
    await sendOrderEmail({
      to: supplier.email,
      orderNumber: order.order_number,
      supplierName: order.supplier_name,
      companyName: supplier.company_name || '',
      storeName: order.store_name,
      orderDate: order.order_date,
      expectedArrival: order.expected_arrival,
      totalAmount: order.total_amount || 0,
      itemCount: items?.length || 0,
      pdfBuffer,
    });
    
    // ステータスを更新
    await supabase
      .from('order_history')
      .update({ status: 'sent' })
      .eq('id', orderId);
    
    res.json({ success: true, message: 'メールを送信しました' });
    
  } catch (error: any) {
    console.error('メール送信エラー:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== 汎用パラメータルート（最後に配置） =====
// 発注詳細を取得
router.get('/:orderId', async (req: Request, res: Response) => {
  console.log('=== 発注詳細取得 ===');
  console.log('orderId:', req.params.orderId);
  
  try {
    const { orderId } = req.params;

    // 発注履歴を取得
    const { data: order, error: orderError } = await supabase
      .from('order_history')
      .select('*')
      .eq('id', orderId)
      .single();

    if (orderError) throw orderError;

    // 発注明細を取得
    const { data: items, error: itemsError } = await supabase
      .from('order_history_items')
      .select('*')
      .eq('order_id', orderId)
      .order('id');

    if (itemsError) throw itemsError;

    res.json({
      success: true,
      order: {
        ...order,
        items: items || [],
      },
    });

  } catch (error: any) {
    console.error('発注詳細取得エラー:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 発注履歴を削除
router.delete('/:orderId', async (req: Request, res: Response) => {
  console.log('=== 発注履歴削除 ===');
  console.log('orderId:', req.params.orderId);
  
  try {
    const { orderId } = req.params;

    // 発注履歴を取得して存在確認
    const { data: order, error: orderError } = await supabase
      .from('order_history')
      .select('*')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return res.status(404).json({ 
        success: false, 
        error: '発注が見つかりません' 
      });
    }

    // スマレジ連携済みの場合は削除不可
    if (order.smaregi_synced) {
      return res.status(400).json({ 
        success: false, 
        error: 'スマレジ連携済みの発注は削除できません' 
      });
    }

    // 発注明細を削除
    const { error: itemsDeleteError } = await supabase
      .from('order_history_items')
      .delete()
      .eq('order_id', orderId);

    if (itemsDeleteError) {
      console.error('発注明細削除エラー:', itemsDeleteError);
      throw itemsDeleteError;
    }

    // 発注履歴を削除
    const { error: orderDeleteError } = await supabase
      .from('order_history')
      .delete()
      .eq('id', orderId);

    if (orderDeleteError) {
      console.error('発注履歴削除エラー:', orderDeleteError);
      throw orderDeleteError;
    }

    console.log('発注削除完了:', order.order_number);
    res.json({
      success: true,
      message: '発注を削除しました',
      deletedOrderNumber: order.order_number,
    });

  } catch (error: any) {
    console.error('発注削除エラー:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

console.log('=== Orders Router 初期化完了 ===');

export default router;
