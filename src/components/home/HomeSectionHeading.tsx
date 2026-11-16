interface HomeSectionHeadingProps {
  eyebrow: string;
  title: string;
  description?: string;
}

export function HomeSectionHeading({ eyebrow, title, description }: HomeSectionHeadingProps) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm font-semibold tracking-wide text-indigo-600">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-bold text-slate-900 sm:text-4xl">{title}</h2>
      {description && <p className="mt-4 text-lg leading-relaxed text-slate-600">{description}</p>}
    </div>
  );
}
