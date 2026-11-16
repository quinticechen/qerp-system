import { SEO } from '@/components/SEO';
import { DEFAULT_DESCRIPTION, SITE_NAME, SITE_TAGLINE } from '@/lib/siteMeta';
import { HomeHeader } from './HomeHeader';
import { HomeHero } from './HomeHero';
import { HomeFlowSection } from './HomeFlowSection';
import { HomeFeatureSection } from './HomeFeatureSection';
import { HomeQuerySection } from './HomeQuerySection';
import { HomeRolesSection } from './HomeRolesSection';
import { HomeFaqSection } from './HomeFaqSection';
import { HomeCallToAction } from './HomeCallToAction';
import { HomeFooter } from './HomeFooter';
import { HOME_JSON_LD } from './homeContent';

/** Public Home page for signed-out visitors (docs/requirements/HOME_PAGE.md). */
export function HomePage() {
  return (
    <div className="min-h-screen bg-white text-left text-slate-900">
      <SEO
        title="首頁"
        fullTitle={`${SITE_NAME}｜${SITE_TAGLINE}`}
        description={DEFAULT_DESCRIPTION}
        keywords="紡織業 ERP, 紡織 ERP, 布行管理系統, 布料庫存管理, 訂單管理系統, 採購管理, 出貨管理, AI 助理, QERP"
        canonicalPath="/"
        jsonLd={HOME_JSON_LD}
      />
      <HomeHeader />
      <main>
        <HomeHero />
        <HomeFlowSection />
        <HomeFeatureSection />
        <HomeQuerySection />
        <HomeRolesSection />
        <HomeFaqSection />
        <HomeCallToAction />
      </main>
      <HomeFooter />
    </div>
  );
}
