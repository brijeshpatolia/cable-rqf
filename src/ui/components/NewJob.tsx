'use client';

import { useActionState } from 'react';
import type { ActionResult } from '@/app/jobs/actions';

type Action = (p: ActionResult | null, f: FormData) => Promise<ActionResult>;

/**
 * The intake — paste, or hand over the file.
 *
 * The textarea comes first and stays plain, because the fastest path from an
 * email to a job is still paste-and-go and always will be. Uploading is the
 * same road with a reader in front of it: whatever comes out of a spreadsheet
 * or a PDF is ordinary RFQ text, which is why nothing downstream had to learn
 * that documents exist.
 */
export function NewJob({
  action,
  uploadAction,
}: {
  readonly action: Action;
  readonly uploadAction: Action;
}) {
  const [state, submit, pending] = useActionState(action, {});
  const [upload, sendFile, uploading] = useActionState(uploadAction, {});

  return (
    <>
    <form action={submit}>
      <textarea
        name="rfq"
        rows={5}
        required
        spellCheck={false}
        placeholder={
          '3C x 50mm2 Cu XLPE SWA PVC 1kV — 12,000 m\n' +
          '4C x 16 sq mm copper, XLPE, steel wire armoured, PVC, 0.6/1kV — 8,500 m'
        }
        className="numeric w-full"
        style={{
          display: 'block',
          margin: 0,
          padding: 16,
          textAlign: 'left',
          backgroundColor: 'transparent',
          border: 'none',
          outline: 'none',
          resize: 'vertical',
          color: 'var(--color-ink-primary)',
          fontSize: 'var(--text-micro)',
          lineHeight: '18px',
        }}
      />

      <div
        className="flex items-center gap-3"
        style={{
          padding: '8px 16px',
          borderTop: '1px solid var(--color-line-hairline)',
        }}
      >
        <input
          name="customer"
          placeholder="Customer (optional for now)"
          style={{
            backgroundColor: 'var(--color-surface-base)',
            border: '1px solid var(--color-line-strong)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-ink-primary)',
            padding: '5px 8px',
            fontSize: 'var(--text-body)',
            minHeight: 'var(--row-height)',
            flex: 1,
          }}
        />

        {state.error !== undefined ? (
          <span
            role="alert"
            style={{
              color: 'var(--color-status-manual)',
              fontSize: 'var(--text-micro)',
            }}
          >
            {state.error}
          </span>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          style={{
            backgroundColor: pending
              ? 'var(--color-surface-raised)'
              : 'var(--color-copper)',
            color: pending ? 'var(--color-ink-tertiary)' : 'var(--color-ink-on-copper)',
            borderRadius: 'var(--radius-md)',
            padding: '6px 14px',
            fontWeight: 550,
            minHeight: 'var(--row-height)',
          }}
        >
          {pending ? 'Reading…' : 'Price this enquiry'}
        </button>
      </div>
    </form>

    {/*
      Or hand over the file itself. What comes back is ordinary RFQ text in
      the box above — extraction ends exactly where paste begins, which is why
      the review screen never learns a document was involved.
    */}
    <form
      action={sendFile}
      className="flex flex-wrap items-center gap-3"
      style={{
        padding: '10px 16px',
        borderTop: '1px solid var(--color-line-hairline)',
      }}
    >
      <span
        style={{ color: 'var(--color-ink-tertiary)', fontSize: 'var(--text-micro)' }}
      >
        …or upload the enquiry
      </span>

      <input
        type="file"
        name="document"
        accept=".xlsx,.xlsm,.xls,.csv,.tsv,.pdf,.txt"
        required
        style={{
          color: 'var(--color-ink-secondary)',
          fontSize: 'var(--text-micro)',
          flex: 1,
          minWidth: 220,
        }}
      />

      <button type="submit" disabled={uploading} style={quietButton}>
        {uploading ? 'Reading the file…' : 'Read it'}
      </button>

      <span
        style={{
          width: '100%',
          color:
            upload.error === undefined
              ? 'var(--color-ink-tertiary)'
              : 'var(--color-status-manual)',
          fontSize: 'var(--text-micro)',
          lineHeight: 'var(--text-micro--line-height)',
        }}
        {...(upload.error === undefined ? {} : { role: 'alert' })}
      >
        {upload.error ??
          'Spreadsheets, PDFs and plain text. Scans are not read — a misread digit is a wrong price.'}
      </span>
    </form>
    </>
  );
}

const quietButton: React.CSSProperties = {
  border: '1px solid var(--color-line-strong)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-ink-primary)',
  padding: '5px 12px',
  fontSize: 'var(--text-micro)',
  minHeight: 'var(--row-height)',
  whiteSpace: 'nowrap',
};
