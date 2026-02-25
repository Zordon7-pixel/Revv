const PAYMENT_META = {
  unpaid: {
    label: 'Unpaid',
    cls: 'text-slate-300 bg-slate-800/60 border-slate-600/60',
  },
  pending: {
    label: 'Payment Pending',
    cls: 'text-amber-300 bg-amber-900/30 border-amber-700/40',
  },
  requires_payment_method: {
    label: 'Action Required',
    cls: 'text-orange-300 bg-orange-900/30 border-orange-700/40',
  },
  failed: {
    label: 'Payment Failed',
    cls: 'text-red-300 bg-red-900/30 border-red-700/40',
  },
  canceled: {
    label: 'Payment Canceled',
    cls: 'text-slate-300 bg-slate-900/60 border-slate-700/60',
  },
  succeeded: {
    label: 'Paid',
    cls: 'text-emerald-300 bg-emerald-900/30 border-emerald-700/40',
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
    <span className={`inline-flex items-center border rounded-lg px-2 py-1 text-[10px] font-semibold ${meta.cls}`}>
      {meta.label}
    </span>
  );
}
