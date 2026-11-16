import { HomeSectionHeading } from './HomeSectionHeading';
import { FEATURES } from './homeContent';

export function HomeFeatureSection() {
  return (
    <section id="features" className="scroll-mt-20 bg-slate-50 py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <HomeSectionHeading eyebrow="功能" title="紡織業每天要管的事，都在這裡" />
        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <article key={feature.title} className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70">
              <feature.icon className="h-6 w-6 text-indigo-600" aria-hidden="true" />
              <h3 className="mt-4 text-lg font-semibold text-slate-900">{feature.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{feature.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
