import { HomeSectionHeading } from './HomeSectionHeading';
import { FLOW_STEPS } from './homeContent';

export function HomeFlowSection() {
  return (
    <section id="flow" className="scroll-mt-20 bg-white py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <HomeSectionHeading
          eyebrow="一張訂單的流程"
          title="從接單到出貨，每一步都接得上"
          description="業務、採購、倉管各做各的事，卻看著同一張訂單。訂單隨時知道：下單了沒、到了多少、能不能出貨。"
        />
        <ol className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FLOW_STEPS.map((step, index) => (
            <li key={step.title} className="relative rounded-2xl border border-slate-200 bg-slate-50/60 p-6">
              <span className="absolute right-5 top-5 text-3xl font-bold text-slate-200" aria-hidden="true">{index + 1}</span>
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
                <step.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-lg font-semibold text-slate-900">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
