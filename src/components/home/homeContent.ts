import type { LucideIcon } from 'lucide-react';
import {
  ClipboardList,
  Factory,
  PackageCheck,
  Truck,
  Boxes,
  Palette,
  Users,
  LayoutDashboard,
  History,
  ShieldCheck,
} from 'lucide-react';
import { DEFAULT_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/siteMeta';

export interface HomeItem {
  icon: LucideIcon;
  title: string;
  body: string;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface RoleItem {
  name: string;
  body: string;
}

/** Section anchors used by the header links. */
export const HOME_SECTIONS = [
  { id: 'flow', label: '流程' },
  { id: 'features', label: '功能' },
  { id: 'query', label: 'AI 助理' },
  { id: 'roles', label: '角色' },
  { id: 'faq', label: '常見問題' },
] as const;

export const FLOW_STEPS: HomeItem[] = [
  { icon: ClipboardList, title: '接單', body: '記下客戶、布料與顏色、公斤數、單價與卷數，指定負責生產的工廠。' },
  { icon: Factory, title: '向工廠採購', body: '依訂單開採購單，訂單自動標示「已向工廠下單」，還沒到的貨一目了然。' },
  { icon: PackageCheck, title: '布卷入庫', body: '逐卷記錄重量、A／B／C 級與貨架位置，入庫單號與卷編號自動產生。' },
  { icon: Truck, title: '出貨', body: '挑選要出的布卷，庫存自動扣除，訂單的出貨進度即時更新。' },
];

export const FEATURES: HomeItem[] = [
  { icon: Boxes, title: '即時庫存', body: '每個產品、每個顏色的庫存與等級分布，加上待入庫、待出貨數量；低於安全庫存會提醒。' },
  { icon: Palette, title: '產品與顏色', body: '產品下管理多個顏色、色號與安全庫存；客戶、工廠、貨架資料集中維護。' },
  { icon: LayoutDashboard, title: '儀表板', body: '訂單數、庫存、客戶與待出貨一頁看完，常用操作一鍵直達。' },
  { icon: History, title: '編輯紀錄', body: '每張單據、每筆資料都看得到誰在什麼時候改了什麼；資料只停用、作廢，不會真的刪除。' },
  { icon: Users, title: '多組織、多成員', body: '邀請同事加入，一個帳號可以屬於多家公司，隨時切換。' },
  { icon: ShieldCheck, title: '資料隔離', body: '每家公司的資料彼此完全隔離，權限在資料庫層把關，不只是畫面上藏起來。' },
];

export const QUERY_EXAMPLES = [
  '目前有哪些庫存低於門檻？',
  '禾境紡研的訂單，現在的庫存夠不夠出貨？',
  '幫客戶王小姐建立新的訂單',
];

export const ROLES: RoleItem[] = [
  { name: '擁有者', body: '所有功能，並可轉移擁有權或刪除組織' },
  { name: '管理員', body: '所有業務功能，加上成員管理與組織設定' },
  { name: '編輯者', body: '查看、新增與修改業務資料' },
  { name: '檢視者', body: '只能查看業務資料' },
];

export const FAQS: FaqItem[] = [
  {
    question: 'QERP 適合什麼樣的公司？',
    answer: '以公斤、以卷買賣布料的紡織貿易商與布行，特別是業務、採購、倉管由不同人負責同一張訂單的團隊。',
  },
  {
    question: '免費試用要怎麼開始？',
    answer: '按「免費試用」填寫姓名、電話與公司名稱並送出，我們會盡快致電了解需求，為您開通帳號。',
  },
  {
    question: 'AI 助理 Query 會不會自己改掉我的資料？',
    answer: '不會。新增、修改、停用或取消前，Query 都會先顯示確認卡片，您按下「確認」後才會寫入，並直接打開那筆資料讓您檢查。',
  },
  {
    question: '同事可以只看到他該看的資料嗎？',
    answer: '可以。每位成員是擁有者、管理員、編輯者或檢視者其中一種角色，看得到、改得到的範圍依角色而定，AI 助理也遵守同樣的權限。',
  },
  {
    question: '其他公司看得到我們的資料嗎？',
    answer: '看不到。每個組織的資料彼此隔離，AI 助理也只會查詢您目前所在的組織。',
  },
  {
    question: '資料刪掉了還找得回來嗎？',
    answer: '業務資料不會真的刪除：主檔是停用、單據是作廢，並保留完整的編輯紀錄。',
  },
];

/** Structured data for the Home page (schema.org). */
export const HOME_JSON_LD: Record<string, unknown>[] = [
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    url: `${SITE_URL}/`,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    inLanguage: 'zh-TW',
    description: DEFAULT_DESCRIPTION,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'TWD', description: '免費試用' },
  },
  {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: `${SITE_URL}/`,
  },
  {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: `${SITE_URL}/`,
    inLanguage: 'zh-TW',
  },
  {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQS.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: { '@type': 'Answer', text: faq.answer },
    })),
  },
];
