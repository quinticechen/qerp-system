import { Link } from 'react-router-dom';
import { HomeLogo } from './HomeLogo';
import { HOME_SECTIONS } from './homeContent';

export function HomeFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
        <HomeLogo />
        <nav aria-label="頁尾" className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
          {HOME_SECTIONS.map((section) => (
            <a key={section.id} href={`#${section.id}`} className="hover:text-indigo-600">{section.label}</a>
          ))}
          <Link to="/login" className="hover:text-indigo-600">登入</Link>
        </nav>
        <p className="text-sm text-slate-400">© {new Date().getFullYear()} QERP</p>
      </div>
    </footer>
  );
}
