// Endpoint admin pra gerar etiqueta manualmente a partir de um Stripe session ID.
// Útil quando o webhook automático falhou (CEP errado, transportadora sem cobertura, etc.)
// e a gente precisa reprocessar com algum dado corrigido.
//
// Auth: header x-admin-token (= STRIPE_WEBHOOK_SECRET).
//
// POST /api/admin-generate-etiqueta
// Body JSON:
//   {
//     "session_id": "cs_live_...",
//     "cep_override": "11742502" (opcional)
//   }

import Stripe from 'stripe';
import { pickCheapestService, addToCart, checkoutAndGenerate, getPrintUrl, getTracking } from './_lib/melhor-envio.js';
import { normalizeStateUf, getRecipientCpf, buildOrderItems, describeError } from './_lib/config.js';
import { notifyShipmentError } from './_lib/notify.js';
import { upsertOrder, updateOrder, logEvent } from './_lib/db.js';
import { withRequestLog } from './_lib/reqlog.js';
import { sendTrackingEmail } from './_lib/mail.js';

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'use POST' });

  const token = req.headers['x-admin-token'];
  if (!token || token !== process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { session_id, cep_override } = req.body ?? {};
  if (!session_id) return res.status(400).json({ error: 'session_id obrigatório' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const context = { source: 'admin-generate-etiqueta', stripe_session_id: session_id, cep_override: cep_override ?? null };

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    const lineItems = await stripe.checkout.sessions.listLineItems(session_id, { limit: 10, expand: ['data.price.product'] });
    const items = buildOrderItems(lineItems.data);
    context.product = items ? { summary: items.summary, color: items.primaryColor, qty: items.totalQty } : null;
    if (!items) throw new Error(`Não consegui identificar a cor do produto: ${lineItems.data[0]?.price?.product?.name}`);

    const shipping = session.shipping_details ?? session.collected_information?.shipping_details;
    if (!shipping?.address) throw new Error('Sessão sem endereço de entrega');

    context.buyer = {
      name: shipping.name,
      email: session.customer_details?.email,
      phone: session.customer_details?.phone ?? '',
      document: getRecipientCpf(session),
    };
    context.shipping_address = {
      line1: shipping.address.line1,
      line2: shipping.address.line2 ?? '',
      city: shipping.address.city,
      state: shipping.address.state,
      postal_code: shipping.address.postal_code,
      country: shipping.address.country,
    };
    context.amount_total = session.amount_total;
    context.currency = session.currency;
    context.stripe_dashboard_url = `https://dashboard.stripe.com/payments/${session.payment_intent}`;

    const destinationCep = (cep_override ?? shipping.address.postal_code).replace(/\D/g, '');
    const destinationAddress = {
      address: shipping.address.line1,
      complement: shipping.address.line2 ?? '',
      district: '',
      city: shipping.address.city,
      state_abbr: normalizeStateUf(shipping.address.state),
      country_id: shipping.address.country,
      postal_code: destinationCep,
    };

    const service = await pickCheapestService({
      destination: { postal_code: destinationCep },
      insuranceValue: items.insuranceValue,
      pkg: items.pkg,
    });
    console.log(`admin-etiqueta ${session_id}: serviço ${service.name} R$${service.price} pra CEP ${destinationCep} (${items.summary})`);

    const cartItem = await addToCart({
      service,
      destination: destinationAddress,
      recipient: context.buyer,
      products: items.products,
      insuranceValue: items.insuranceValue,
      pkg: items.pkg,
    });
    const orderId = cartItem.id;

    await checkoutAndGenerate([orderId]);
    const printResult = await getPrintUrl([orderId]);
    const tracking = await getTracking([orderId]);

    console.log(`admin-etiqueta ${session_id}: OK order=${orderId} tracking=${tracking[orderId]?.tracking}`);

    // Garante que o pedido existe e atualiza com o resultado da etiqueta.
    await upsertOrder({
      stripe_session_id: session_id,
      stripe_payment_intent: session.payment_intent ?? null,
      buyer_name: context.buyer.name,
      buyer_email: context.buyer.email,
      buyer_phone: context.buyer.phone,
      buyer_cpf: context.buyer.document,
      color: items.primaryColor,
      product_name: items.summary,
      quantity: items.totalQty,
      items: items.qtyByColor,
      amount_total: session.amount_total,
      currency: session.currency,
      ship_line1: shipping.address.line1,
      ship_line2: shipping.address.line2 ?? '',
      ship_city: shipping.address.city,
      ship_state: shipping.address.state,
      ship_postal_code: shipping.address.postal_code,
      ship_country: shipping.address.country,
      status: 'label_generated',
      me_order_id: orderId,
      tracking_code: tracking[orderId]?.tracking ?? null,
      label_url: printResult.url ?? null,
      shipping_service: service.name,
      shipping_price: parseFloat(service.price),
      error_message: null,
    });
    await logEvent({
      type: 'label_generated',
      source: 'admin-generate-etiqueta',
      stripe_session_id: session_id,
      status: 'ok',
      payload: { me_order_id: orderId, tracking_code: tracking[orderId]?.tracking, cep_used: destinationCep, cep_overridden: !!cep_override },
    });

    // Avisa o cliente com o rastreio.
    const emailed = await sendTrackingEmail({
      to: context.buyer.email,
      name: context.buyer.name,
      trackingCode: tracking[orderId]?.tracking,
      summary: items.summary,
    });
    if (emailed) await logEvent({ type: 'tracking_email', source: 'admin-generate-etiqueta', stripe_session_id: session_id, status: 'ok', payload: { to: context.buyer.email } });

    return res.status(200).json({
      ok: true,
      session_id,
      cep_used: destinationCep,
      cep_overridden: !!cep_override,
      color: items.primaryColor,
      summary: items.summary,
      service: service.name,
      price: service.price,
      me_order_id: orderId,
      tracking_code: tracking[orderId]?.tracking,
      print_url: printResult.url,
    });
  } catch (err) {
    console.error(`admin-etiqueta erro:`, err.response ?? err.message);
    await updateOrder(session_id, { status: 'label_failed', error_message: describeError(err) });
    await logEvent({
      type: 'shipment_error',
      source: 'admin-generate-etiqueta',
      stripe_session_id: session_id,
      status: 'error',
      error: describeError(err),
      payload: { details: err.response ?? null, cep_override: cep_override ?? null },
    });
    await notifyShipmentError({
      ...context,
      error: { message: err.message, details: err.response ?? null },
    });
    return res.status(500).json({ error: err.message, me_response: err.response });
  }
}

export default withRequestLog('admin-generate-etiqueta', handler);
