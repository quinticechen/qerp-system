import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function HomeCallToAction() {
  return (
    <section className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 py-16">
      <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
        <h2 className="text-3xl font-bold text-white sm:text-4xl">讓下一張訂單，從 QERP 開始</h2>
        <p className="mt-4 text-lg text-indigo-100">免費方案由專人為您開通；付費方案付款後立即開通。</p>
        <Button asChild size="lg" className="mt-8 h-12 bg-white px-8 text-base font-semibold text-indigo-700 hover:bg-indigo-50">
          <Link to="/pricing">
            免費試用
            <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </section>
  );
}
