import { HomeSectionHeading } from './HomeSectionHeading';
import { ROLES } from './homeContent';

export function HomeRolesSection() {
  return (
    <section id="roles" className="scroll-mt-20 bg-slate-50 py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <HomeSectionHeading
          eyebrow="團隊與權限"
          title="每個人只看到、只改到該管的"
          description="邀請同事加入，為每個人選一種角色。權限在資料庫把關，AI 助理也遵守同一套規則。"
        />
        <dl className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ROLES.map((role) => (
            <div key={role.name} className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200/70">
              <dt className="text-lg font-semibold text-slate-900">{role.name}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-slate-600">{role.body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
