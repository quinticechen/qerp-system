import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { HomeLogo } from './HomeLogo';
import { HOME_SECTIONS } from './homeContent';

interface HomeHeaderProps {
  onStartTrial: () => void;
}

export function HomeHeader({ onStartTrial }: HomeHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <HomeLogo />
        <nav aria-label="頁面區塊" className="hidden items-center gap-6 md:flex">
          {HOME_SECTIONS.map((section) => (
            <a key={section.id} href={`#${section.id}`} className="text-sm text-slate-600 transition-colors hover:text-indigo-600">
              {section.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/login">登入</Link>
          </Button>
          <Button size="sm" onClick={onStartTrial} className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700">
            免費試用
          </Button>
        </div>
      </div>
    </header>
  );
}
