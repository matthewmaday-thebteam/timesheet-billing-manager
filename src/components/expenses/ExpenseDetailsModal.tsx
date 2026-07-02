/**
 * ExpenseDetailsModal — read-only "full data" view for a single expense.
 *
 * The review queue and accordion rows only surface a translated label, a date,
 * and the amounts; some bank charges are impossible to identify from that alone.
 * This modal shows EVERY stored field for one expense, grouped and labelled, so
 * an operator can tell exactly what a charge is before saving a categorisation.
 *
 * Purely presentational: it composes the existing Modal atom with label/value
 * rows (no new design-system primitive). It performs NO writes and renders every
 * bank-derived string as escaped React children — never dangerouslySetInnerHTML.
 *
 * @category Expenses (page-local)
 */

import type { ReactNode } from 'react';
import { Modal } from '../Modal';
import { Badge } from '../Badge';
import type { ExpenseRecord } from './expenseTypes';
import { formatEurCents, formatOriginalAmount, formatUsdCents, toCents } from './expenseTree';

interface ExpenseDetailsModalProps {
  expense: ExpenseRecord;
  /** Resolved category name for expense.category_id (stored value, not a draft). */
  categoryName: string;
  isOpen: boolean;
  onClose: () => void;
}

// Named STYLEGUIDE type styles (mirrors the pattern in ExpenseUploadModal).
const LABEL_FORM = 'text-xs font-medium text-vercel-gray-400 uppercase tracking-wider';
const BODY_SM = 'text-sm text-vercel-gray-600';
const MONO_VALUE = 'text-sm font-mono text-vercel-gray-600';
const SECTION_TITLE = 'text-sm font-semibold text-vercel-gray-600';

const EM_DASH = '—';

/** Present a nullable/blank string as an em-dash rather than empty space. */
function orDash(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : EM_DASH;
}

interface DetailFieldProps {
  label: string;
  value: ReactNode;
  /** Render the value in the monospace money/id style. */
  mono?: boolean;
  /** Span both columns (used for long free-text like the raw description). */
  wide?: boolean;
}

/**
 * One label-above-value cell. Values wrap (whitespace-normal + break-words) so
 * long untranslated Cyrillic descriptions never force horizontal scroll.
 */
function DetailField({ label, value, mono = false, wide = false }: DetailFieldProps) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className={LABEL_FORM}>{label}</dt>
      <dd className={`mt-1 whitespace-normal break-words ${mono ? MONO_VALUE : BODY_SM}`}>
        {value}
      </dd>
    </div>
  );
}

/** A titled group of fields laid out as a responsive two-column definition list. */
function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className={SECTION_TITLE}>{title}</h3>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">{children}</dl>
    </section>
  );
}

export function ExpenseDetailsModal({
  expense,
  categoryName,
  isOpen,
  onClose,
}: ExpenseDetailsModalProps) {
  const {
    reference,
    account,
    entry_type,
    value_date,
    booking_date,
    txn_datetime,
    source_file_name,
    row_hash,
    needs_review,
    original_amount,
    account_currency,
    operation_amount,
    operation_currency,
    eur_amount,
    conversion_rate,
    rate_source,
    rate_date,
    usd_amount,
    usd_rate,
    usd_rate_source,
    beneficiary,
    vendor,
    description_original,
    description_translated,
    translation_source,
    category_source,
  } = expense;

  const usdValue =
    usd_amount != null ? (
      formatUsdCents(toCents(usd_amount))
    ) : (
      <Badge variant="warning" size="sm">pending</Badge>
    );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Expense details" maxWidth="2xl">
      <div className="space-y-8">
        <DetailSection title="Identity">
          <DetailField label="Reference" value={orDash(reference)} mono />
          <DetailField label="Account" value={orDash(account)} />
          <DetailField label="Entry type" value={orDash(entry_type)} />
          <DetailField label="Value date" value={orDash(value_date)} mono />
          <DetailField label="Booking date" value={orDash(booking_date)} mono />
          <DetailField label="Transaction time" value={orDash(txn_datetime)} mono />
          <DetailField label="Source file" value={orDash(source_file_name)} />
          <DetailField
            label="Needs review"
            value={
              needs_review ? (
                <Badge variant="warning" size="sm">Yes</Badge>
              ) : (
                <Badge variant="success" size="sm">No</Badge>
              )
            }
          />
          <DetailField label="Row hash" value={orDash(row_hash)} mono wide />
        </DetailSection>

        <DetailSection title="Amounts">
          <DetailField
            label="Original amount"
            value={formatOriginalAmount(original_amount, account_currency)}
            mono
          />
          <DetailField
            label="Operation amount"
            value={
              operation_amount != null
                ? formatOriginalAmount(operation_amount, operation_currency ?? '')
                : EM_DASH
            }
            mono
          />
          <DetailField label="EUR amount" value={formatEurCents(toCents(eur_amount))} mono />
          <DetailField label="Conversion rate" value={String(conversion_rate)} mono />
          <DetailField label="Rate source" value={orDash(rate_source)} />
          <DetailField label="Rate date" value={orDash(rate_date)} mono />
          <DetailField label="USD amount" value={usdValue} mono />
          <DetailField label="USD rate" value={usd_rate != null ? String(usd_rate) : EM_DASH} mono />
          <DetailField label="USD rate source" value={orDash(usd_rate_source)} />
        </DetailSection>

        <DetailSection title="Parties">
          <DetailField label="Beneficiary" value={orDash(beneficiary)} />
          <DetailField label="Vendor" value={orDash(vendor)} />
        </DetailSection>

        <DetailSection title="Descriptions">
          <DetailField label="Original description" value={orDash(description_original)} wide />
          <DetailField label="Translated description" value={orDash(description_translated)} wide />
          <DetailField label="Translation source" value={orDash(translation_source)} />
        </DetailSection>

        <DetailSection title="Classification">
          <DetailField label="Category" value={orDash(categoryName)} />
          <DetailField label="Category source" value={orDash(category_source)} />
        </DetailSection>
      </div>
    </Modal>
  );
}

export default ExpenseDetailsModal;
