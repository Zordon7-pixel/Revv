const PAYMENT_META = {
  unpaid: {
    label: 'Unpaid',
    cls: 'border-line-2 bg-raised text-muted',
  },
  pending: {
    label: 'Payment Pending',
    cls: 'border-gold/30 bg-gold/10 text-gold',
  },
  requires_payment_method: {
    label: 'Action Required',
    cls: 'border-gold/30 bg-gold/10 text-gold',
  },
  failed: {
    label: 'Payment Failed',
    cls: 'border-crit/30 bg-crit/10 text-crit',
  },
  canceled: {
    label: 'Payment Canceled',
    cls: 'border-line-2 bg-raised text-muted',
  },
  succeeded: {
    label: 'Paid',
    cls: 'border-good/30 bg-good/10 text-good',
  },
  paid: {
    label: 'Paid',
    cls: 'border-good/30 bg-good/10 text-good',
  },
};

export function normalizePaymentStatus(status, paymentReceived) {
  if (status) return status;
  if (paymentReceived) return 'succeeded';
  return 'unpaid';
}

export default function PaymentStatusBadge({ status, paymentReceived }) {
  const normalized = normalizePaymentStatus(status, paymentReceived);
  const meta = PAYMENT_META[normalized] || PAYMENT_META.unpaid;

  return (
    <span className={`inline-flex min-h-6 items-center rounded-full border px-2.5 py-1 text-xs font-medium ${meta.cls}`}>
      {meta.label}
    </span>
  );
}
