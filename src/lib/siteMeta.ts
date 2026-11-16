/** Public site identity, used for canonical URLs, Open Graph and structured data. */
export const SITE_URL = 'https://qerp.qwizai.com';
export const SITE_NAME = 'QERP';
export const SITE_TAGLINE = '紡織業 ERP 與 AI 助理';
export const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.png`;
export const DEFAULT_DESCRIPTION =
  'QERP 是給紡織業的雲端 ERP：訂單、向工廠採購、布卷入庫、庫存與出貨串成一條流程，並有 AI 助理 Query 用中文對話查詢與建立資料。免費試用。';

/** Absolute canonical URL for a path on the production site (never a preview domain). */
export const canonicalUrl = (path: string): string => `${SITE_URL}${path === '/' ? '/' : path.replace(/\/+$/, '')}`;
