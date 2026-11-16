import { MantaRayIcon } from '@/components/query/MantaRayIcon';

const SAMPLE_CARD_FIELDS = [
  ['客戶', '永泰布行'],
  ['產品', '尼龍彈性布・雲朵白'],
  ['數量', '500 kg・20 卷'],
  ['單價', 'NT$ 120 / kg'],
];

/** Static picture of a Query conversation; nothing here is interactive. */
export function HomeQueryChatSample() {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-2xl shadow-indigo-500/20 ring-1 ring-slate-200" aria-label="Query 對話範例">
      <div className="flex items-center gap-3 bg-gradient-to-r from-indigo-600 to-purple-600 px-5 py-4 text-white">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20">
          <MantaRayIcon size={24} />
        </span>
        <div>
          <p className="font-semibold">Query</p>
          <p className="text-xs text-white/80">你的 AI 助理</p>
        </div>
      </div>
      <div className="space-y-4 bg-gray-50/80 p-5 text-sm">
        <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-indigo-600 px-4 py-2.5 text-white">
          幫永泰布行建立訂單：尼龍彈性布雲朵白 500 公斤、20 卷，單價 120
        </p>
        <div className="max-w-[90%] space-y-3 rounded-2xl rounded-bl-md bg-white p-4 shadow-sm ring-1 ring-slate-100">
          <p className="text-slate-700">好的，請確認這張訂單：</p>
          <div className="rounded-xl border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-slate-800">建立訂單</p>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">待確認</span>
            </div>
            <dl className="mt-2 space-y-1">
              {SAMPLE_CARD_FIELDS.map(([label, value]) => (
                <div key={label} className="flex gap-3">
                  <dt className="w-10 shrink-0 text-slate-400">{label}</dt>
                  <dd className="text-slate-700">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 flex gap-2" aria-hidden="true">
              <span className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white">確認</span>
              <span className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600">取消</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
