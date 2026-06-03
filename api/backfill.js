// Importa pedidos históricos do Stripe pra tabela `orders`.
// Roda uma vez (ou quantas quiser — é idempotente por stripe_session_id).
//
// Auth: header x-admin-token (= STRIPE_WEBHOOK_SECRET).
// GET/POST /api/backfill   (opcional ?limit=500)
//
// Importa os dados do comprador/endereço/valor. O status fica 'paid' —
// a reconciliação de quais já têm etiqueta você faz no painel, e dali
// pra frente o webhook já grava o status certo sozinho.

import Stripe from 'stripe';
import { detectColorFromProductName, getRecipientCpf } from './_lib/config.js';
import { upsertOrder } from './_lib/db.js';
import { withRequestLog } from './_lib/reqlog.js';

async function handler(req, res) {
  const token = req.headers['x-admin-token'];
  if (!token || token !== process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const limit = Math.min(parseInt(req.query?.limit ?? '500', 10), 1000);

  let imported = 0, skipped = 0, errors = 0;
  let startingAfter = undefined;
  const details = [];

  try {
    while (imported + skipped + errors < limit) {
      const page = await stripe.checkout.sessions.list({
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      if (!page.data.length) break;

      for (const session of page.data) {
        startingAfter = session.id;
        if (session.payment_status !== 'paid' && session.status !== 'complete') { skipped++; continue; }
        try {
          const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 5, expand: ['data.price.product'] });
          const productName = lineItems.data[0]?.price?.product?.name ?? null;
          const color = detectColorFromProductName(productName);
          const shipping = session.shipping_details ?? session.collected_information?.shipping_details ?? {};
          const addr = shipping.address ?? {};

          await upsertOrder({
            stripe_session_id: session.id,
            stripe_payment_intent: session.payment_intent ?? null,
            buyer_name: shipping.name ?? session.customer_details?.name ?? null,
            buyer_email: session.customer_details?.email ?? null,
            buyer_phone: session.customer_details?.phone ?? null,
            buyer_cpf: getRecipientCpf(session),
            color,
            product_name: productName,
            amount_total: session.amount_total ?? null,
            currency: session.currency ?? 'brl',
            ship_line1: addr.line1 ?? null,
            ship_line2: addr.line2 ?? null,
            ship_city: addr.city ?? null,
            ship_state: addr.state ?? null,
            ship_postal_code: addr.postal_code ?? null,
            ship_country: addr.country ?? null,
            status: 'paid',
          });
          imported++;
          details.push({ session: session.id, buyer: shipping.name ?? null, color });
        } catch (e) {
          errors++;
          details.push({ session: session.id, error: e.message });
        }
      }
      if (!page.has_more) break;
    }

    return res.status(200).json({ ok: true, imported, skipped, errors, details });
  } catch (err) {
    console.error('backfill erro:', err.message);
    return res.status(500).json({ error: err.message, imported, skipped, errors });
  }
}

export default withRequestLog('backfill', handler);
