import { notFound } from 'next/navigation';
import { quoteStore } from '@/infra/repositories';
import { renderQuotePdf } from '@/infra/documents/quote-pdf';
import { requireReadForDocument } from '../../guard';

export const dynamic = 'force-dynamic';

/**
 * The quote as a PDF, generated on demand rather than stored.
 *
 * A stored file would drift from the record the moment anything about the
 * quote changed. Regenerating from the frozen cost snapshot means the document
 * is always exactly what the database says — and an approved quote's lines are
 * immutable at the database level, so "always" is a guarantee, not a hope.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ number: string }> },
) {
  const denied = await requireReadForDocument();
  if (denied instanceof Response) return denied;

  const { number } = await params;
  const quote = await quoteStore.byNumber(number);
  if (quote === undefined) notFound();

  const pdf = await renderQuotePdf(quote);

  return new Response(pdf as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${quote.number}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
