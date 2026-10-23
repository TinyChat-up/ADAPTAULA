'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function StripePilot({ state, expires }: { state: string | null; expires: string | null }) {
  const [busy,setBusy] = useState(false); const [message,setMessage] = useState('');
  async function open() {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/stripe/checkout', { method:'POST', credentials:'same-origin' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? 'No se ha podido preparar la prueba.');
      const url = new URL(data.url);
      if (url.origin !== 'https://checkout.stripe.com') throw new Error('No se ha podido abrir Stripe.');
      window.location.assign(url.href);
    } catch(error) { setMessage(error instanceof Error ? error.message : 'No se ha podido preparar la prueba.'); setBusy(false); }
  }
  return <section aria-labelledby="piloto-privado" className="space-y-3 border-t border-border pt-6">
    <h2 id="piloto-privado" className="text-xl font-semibold">Prueba privada de Max</h2>
    <p className="text-sm text-muted-foreground">Stripe está en modo prueba: no introduzcas tarjetas reales. Este proceso no activa contratación pública. Las llamadas de IA sí pueden tener coste real y requieren habilitación independiente.</p>
    <p className="text-sm">El acceso de prueba dura como máximo siete días desde su preparación. El regreso desde Stripe no confirma la activación: debe recibirse y verificarse el evento.</p>
    {expires && <p className="text-sm">Finaliza: {expires}.</p>}
    {state === 'active' ? <p role="status">Piloto registrado. Consulta arriba el plan y las cuotas efectivas; recarga tras confirmar en Stripe.</p> : state === 'canceled' ? <p role="status">Piloto finalizado.</p> :
      <Button type="button" variant="secondary" disabled={busy} onClick={open}>{busy ? 'Preparando Stripe de prueba…' : 'Abrir Stripe de prueba'}</Button>}
    <p role="status" className="text-sm text-muted-foreground">{message}</p>
  </section>;
}
