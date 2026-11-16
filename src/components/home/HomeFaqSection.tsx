import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { HomeSectionHeading } from './HomeSectionHeading';
import { FAQS } from './homeContent';

export function HomeFaqSection() {
  return (
    <section id="faq" className="scroll-mt-20 bg-white py-20">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <HomeSectionHeading eyebrow="常見問題" title="試用前，你可能想知道" />
        <Accordion type="single" collapsible className="mt-12">
          {FAQS.map((faq, index) => (
            <AccordionItem key={faq.question} value={`faq-${index}`}>
              <AccordionTrigger className="text-left text-base font-medium text-slate-900">{faq.question}</AccordionTrigger>
              <AccordionContent className="text-base leading-relaxed text-slate-600">{faq.answer}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
