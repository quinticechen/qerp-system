import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { COMPANY_SIZES, TrialRequestError, useTrialRequest } from '@/hooks/useTrialRequest';

const COMPANY_SIZE_LABELS: Record<(typeof COMPANY_SIZES)[number], string> = {
  '1-10': '1–10 人',
  '11-50': '11–50 人',
  '51-200': '51–200 人',
  '201+': '201 人以上',
};

// Mirrors the checks on public.trial_requests.
const trialRequestSchema = z.object({
  contactName: z.string().trim().min(1, '請輸入姓名').max(50, '姓名最多 50 字'),
  phone: z.string().trim().regex(/^[0-9+()\- ]{8,20}$/, '請輸入正確的電話號碼'),
  companyName: z.string().trim().min(1, '請輸入公司名稱').max(100, '公司名稱最多 100 字'),
  email: z.union([z.literal(''), z.string().trim().email('Email 格式不正確').max(254)]),
  companySize: z.enum(COMPANY_SIZES).optional(),
  note: z.string().max(1000, '備註最多 1000 字'),
  /** Honeypot: hidden from people, filled in by bots. */
  website: z.string(),
});

type TrialRequestValues = z.infer<typeof trialRequestSchema>;

interface TrialRequestFormProps {
  onSubmitted: () => void;
}

export function TrialRequestForm({ onSubmitted }: TrialRequestFormProps) {
  const trialRequest = useTrialRequest();
  const form = useForm<TrialRequestValues>({
    resolver: zodResolver(trialRequestSchema),
    defaultValues: { contactName: '', phone: '', companyName: '', email: '', companySize: undefined, note: '', website: '' },
  });

  const onSubmit = async (values: TrialRequestValues) => {
    if (values.website) {
      onSubmitted();
      return;
    }
    try {
      await trialRequest.mutateAsync({
        contactName: values.contactName ?? '',
        phone: values.phone ?? '',
        companyName: values.companyName ?? '',
        email: values.email,
        companySize: values.companySize,
        note: values.note,
      });
      onSubmitted();
    } catch (error) {
      form.setError('root', { message: error instanceof TrialRequestError ? error.message : '送出失敗，請稍後再試' });
    }
  };

  const isSubmitting = form.formState.isSubmitting;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="contactName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>姓名 *</FormLabel>
                <FormControl>
                  <Input autoComplete="name" placeholder="王小明" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>電話 *</FormLabel>
                <FormControl>
                  <Input type="tel" inputMode="tel" autoComplete="tel" placeholder="0912-345-678" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="companyName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>公司名稱 *</FormLabel>
              <FormControl>
                <Input autoComplete="organization" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input type="email" autoComplete="email" placeholder="name@company.com" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="companySize"
            render={({ field }) => (
              <FormItem>
                <FormLabel>公司人數</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="請選擇" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {COMPANY_SIZES.map((size) => (
                      <SelectItem key={size} value={size}>{COMPANY_SIZE_LABELS[size]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="note"
          render={({ field }) => (
            <FormItem>
              <FormLabel>備註</FormLabel>
              <FormControl>
                <Textarea rows={3} placeholder="例如：方便聯絡的時段、想先了解的功能" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden="true">
          <label>
            網站
            <input tabIndex={-1} autoComplete="off" {...form.register('website')} />
          </label>
        </div>

        {form.formState.errors.root && (
          <p role="alert" className="text-sm font-medium text-destructive">{form.formState.errors.root.message}</p>
        )}

        <Button
          type="submit"
          disabled={isSubmitting}
          className="w-full h-11 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold"
        >
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          建立
        </Button>
        <p className="text-center text-xs text-slate-500">送出後，我們會致電與您確認並開通帳號。</p>
      </form>
    </Form>
  );
}
