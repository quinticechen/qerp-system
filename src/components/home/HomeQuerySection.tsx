import { MessageSquareText, ShieldCheck, MousePointerClick } from 'lucide-react';
import { HomeSectionHeading } from './HomeSectionHeading';
import { HomeQueryChatSample } from './HomeQueryChatSample';
import { QUERY_EXAMPLES } from './homeContent';

const QUERY_POINTS = [
  { icon: MessageSquareText, title: '用中文說就好', body: '查庫存、查訂單、建客戶、開採購單、安排出貨，每個畫面能做的事都能用說的。' },
  { icon: ShieldCheck, title: '先確認，才寫入', body: '任何新增、修改、停用或取消，都先出現確認卡片，按下「確認」才會存檔。' },
  { icon: MousePointerClick, title: '存好就幫你打開', body: '確認後，ERP 直接切到那筆資料，讓你馬上檢查；權限與畫面操作完全相同。' },
];

export function HomeQuerySection() {
  return (
    <section id="query" className="scroll-mt-20 bg-white py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <HomeSectionHeading
          eyebrow="AI 助理 Query"
          title="不想點一堆畫面？直接問 Query"
          description="每一頁右下角都有 Query。用平常講話的方式交代，它會查資料、整理答案，或幫你把單據草稿準備好。"
        />
        <div className="mt-14 grid items-center gap-12 lg:grid-cols-2">
          <div className="space-y-8">
            {QUERY_POINTS.map((point) => (
              <div key={point.title} className="flex gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
                  <point.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">{point.title}</h3>
                  <p className="mt-1 leading-relaxed text-slate-600">{point.body}</p>
                </div>
              </div>
            ))}
            <div>
              <p className="text-sm font-medium text-slate-500">試試這樣問：</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {QUERY_EXAMPLES.map((example) => (
                  <li key={example} className="rounded-full bg-indigo-50 px-3 py-1.5 text-sm text-indigo-700">「{example}」</li>
                ))}
              </ul>
            </div>
          </div>
          <HomeQueryChatSample />
        </div>
      </div>
    </section>
  );
}
