import { Link } from 'react-router-dom';

/** QERP wordmark; links to the top of the Home page. */
export function HomeLogo() {
  return (
    <Link to="/" className="flex items-center gap-2" aria-label="QERP 首頁">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 text-lg font-bold text-white shadow-md shadow-blue-500/30">
        Q
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-lg font-bold text-slate-900">QERP</span>
        <span className="text-[11px] text-slate-500">紡織業 ERP</span>
      </span>
    </Link>
  );
}
