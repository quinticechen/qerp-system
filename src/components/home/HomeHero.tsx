import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const HIGHLIGHTS = ['訂單到出貨一條龍', '布卷、等級、貨架逐卷追蹤', '中文 AI 助理'];

// A sample order, to show what "progress computed for you" looks like.
const SAMPLE_PROGRESS = [
  { label: '向工廠採購', value: 100, bar: 'w-full bg-indigo-500' },
  { label: '已入庫', value: 80, bar: 'w-4/5 bg-blue-500' },
  { label: '已出貨', value: 40, bar: 'w-2/5 bg-emerald-500' },
];

export function HomeHero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100">
      <div className="absolute -top-24 right-0 h-96 w-96 rounded-full bg-indigo-400/20 blur-3xl" aria-hidden="true" />
      <div className="absolute bottom-0 left-0 h-80 w-80 rounded-full bg-blue-400/20 blur-3xl" aria-hidden="true" />

      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-2">
        <div>
          <Badge variant="secondary" className="mb-5 bg-white/80 text-indigo-700">給紡織業的雲端 ERP</Badge>
          <h1 className="text-4xl font-bold leading-tight text-slate-900 sm:text-5xl">
            訂單、採購、庫存、出貨
            <br />
            <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">一個系統串到底</span>
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-slate-600">
            QERP 把每一張訂單從接單、向工廠下單、布卷入庫到出貨連在一起，進度與庫存自動更新。
            忙的時候，直接用中文問 AI 助理 Query。
          </p>
          <ul className="mt-6 space-y-2">
            {HIGHLIGHTS.map((item) => (
              <li key={item} className="flex items-center gap-2 text-slate-700">
                <CheckCircle2 className="h-5 w-5 text-indigo-600" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg" className="h-12 bg-gradient-to-r from-blue-600 to-indigo-600 px-8 text-base text-white shadow-lg shadow-blue-500/25 hover:from-blue-700 hover:to-indigo-700">
              <Link to="/pricing">
                免費試用
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 bg-white/70 px-8 text-base">
              <Link to="/login">已有帳號，登入</Link>
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border border-white/60 bg-white/90 p-6 shadow-2xl shadow-indigo-500/10" aria-label="訂單進度範例">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-slate-500">訂單 B20261116001</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">永泰布行</p>
            </div>
            <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">部分出貨</Badge>
          </div>
          <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm">
            <div className="flex justify-between text-slate-700">
              <span>尼龍彈性布・雲朵白</span>
              <span className="font-medium">500 kg・20 卷</span>
            </div>
            <div className="mt-2 flex justify-between text-slate-700">
              <span>棉麻混紡・眠藍</span>
              <span className="font-medium">300 kg・12 卷</span>
            </div>
          </div>
          <div className="mt-5 space-y-4">
            {SAMPLE_PROGRESS.map((step) => (
              <div key={step.label}>
                <div className="mb-1.5 flex justify-between text-sm">
                  <span className="text-slate-600">{step.label}</span>
                  <span className="font-medium text-slate-900">{step.value}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100">
                  <div className={`h-2 rounded-full ${step.bar}`} />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-5 text-xs text-slate-400">進度依採購、入庫與出貨紀錄自動計算</p>
        </div>
      </div>
    </section>
  );
}
