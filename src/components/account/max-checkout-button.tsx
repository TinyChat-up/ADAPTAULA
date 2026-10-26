'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

const FALLBACK = 'No hemos podido abrir el pago. Inténtalo de nuevo en unos minutos.';

/** Opens Stripe Checkout prepared by the server; the plan changes only when the signed webhook confirms the payment. */
export function MaxCheckoutButton({ className }: { className?: string }) {
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  async function open() {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/stripe/checkout', { method: 'POST', credentials: 'same-origin' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message ?? FALLBACK);
      const url = new URL(data.url);
      if (url.origin !== 'https://checkout.stripe.com') throw new Error(FALLBACK);
      window.location.assign(url.href);
    } catch (error) {
      setMessage(error instanceof Error && error.message ? error.message : FALLBACK);
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <Button type="button" variant="primary" className={className} disabled={busy} aria-describedby={message ? 'max-checkout-error' : undefined} onClick={open}>
        {busy ? 'Abriendo el pago…' : 'Contratar Max'}
      </Button>
      {message ? <p id="max-checkout-error" role="alert" className="text-center text-sm text-danger">{message}</p> : null}
    </div>
  );
}
