import { notFound } from 'next/navigation';
import { quoteStore } from '@/infra/repositories';
import { renderQuoteXlsx } from '@/infra/documents/quote-xlsx';
import { requireReadForDocument } from '../../guard';

export const dynamic = 'force-dynamic';

/** The quote as a workbook: the customer sheet, and the cost build-up behind it. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ number: string }> },
) {
  const denied = await requireReadForDocument();
  if (denied instanceof Response) return denied;

  const { number } = await params;
  const quote = await quoteStore.byNumber(number);
  if (quote === undefined) notFound();

  return new Response(renderQuoteXlsx(quote) as BodyInit, {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${quote.number}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
