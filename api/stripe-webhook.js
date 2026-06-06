// Webhook do Stripe — dispara quando uma compra é finalizada.
// Persiste o pedido no Supabase e gera a etiqueta no ME automaticamente.
// O banco é aditivo: se a persistência falhar, a etiqueta sai do mesmo jeito.

import Stripe from 'stripe';
import { pickCheapestService, addToCart, checkoutAndGenerate, getPrintUrl, getTracking } from './_lib/melhor-envio.js';
import { normalizeStateUf, getRecipientCpf, buildOrderItems, describeError } from './_lib/config.js';
import { notifyShipmentError } from './_lib/notify.js';
import { upsertOrder, updateOrder, logEvent, registerSale, getOrderBySession } from './_lib/db.js';
import { withRequestLog } from './_lib/reqlog.js';
import { sendTrackingEmail } from './_lib/mail.js';

export const config = {
  api: { bodyParser: false }, // Stripe valida assinatura no body cru
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];
  const rawBody = await readRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Falha validando assinatura Stripe:', err.message);
    return res.status(400).send(`Webhook signature error: ${err.message}`);
  }

  req._logBody = { type: event.type, id: event.id }; // pro request log (body é cru)

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true, ignored: event.type });
  }

  const session = event.data.object;
  req._logBody = { type: event.type, id: event.id, session_id: session.id, amount: session.amount_total };
  const context = { source: 'stripe-webhook', stripe_session_id: session.id };

  try {
    // Idempotência: se esse pedido já tem etiqueta gerada, NÃO gera de novo
    // (evita etiqueta + cobrança duplicada quando o webhook é reenviado).
    const existing = await getOrderBySession(session.id);
    if (existing?.me_order_id) {
      console.log(`Stripe ${session.id}: já tem etiqueta (${existing.me_order_id}) — pulando geração.`);
      await logEvent({ type: 'duplicate_skipped', source: 'stripe-webhook', stripe_session_id: session.id, status: 'ok', payload: { me_order_id: existing.me_order_id } });
      return res.status(200).json({ received: true, already_fulfilled: true, me_order_id: existing.me_order_id, tracking_code: existing.tracking_code });
    }

    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 10, expand: ['data.price.product'] });
    const items = buildOrderItems(lineItems.data);
    context.product = items ? { summary: items.summary, color: items.primaryColor, qty: items.totalQty, qtyByColor: items.qtyByColor } : { raw: lineItems.data[0]?.price?.product?.name };
    if (!items) throw new Error(`Não consegui identificar a cor do produto: ${lineItems.data[0]?.price?.product?.name}`);

    const shipping = session.shipping_details ?? session.collected_information?.shipping_details;
    if (!shipping?.address) throw new Error('Sessão sem endereço de entrega — confira que o Payment Link tá coletando endereço');

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

    // Persiste o pedido como "paid" ANTES de tentar o ME — nunca perdemos uma venda.
    await upsertOrder({
      stripe_session_id: session.id,
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
      status: 'paid',
    });

    // Desconta o estoque por cor/quantidade (idempotente — não desconta 2x no mesmo pedido).
    await registerSale(session.id, items.qtyByColor);

    const destinationCep = shipping.address.postal_code.replace(/\D/g, '');
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
    console.log(`Stripe ${session.id}: serviço escolhido ${service.name} R$${service.price} (${items.summary})`);

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

    console.log(`Stripe ${session.id}: etiqueta gerada`, {
      me_order_id: orderId,
      tracking_code: tracking[orderId]?.tracking,
      print_url: printResult.url,
    });

    await updateOrder(session.id, {
      status: 'label_generated',
      me_order_id: orderId,
      tracking_code: tracking[orderId]?.tracking ?? null,
      label_url: printResult.url ?? null,
      shipping_service: service.name,
      shipping_price: parseFloat(service.price),
      error_message: null,
    });
    await logEvent({
      type: 'checkout.session.completed',
      source: 'stripe-webhook',
      stripe_session_id: session.id,
      status: 'ok',
      payload: { me_order_id: orderId, tracking_code: tracking[orderId]?.tracking, service: service.name, price: service.price },
    });

    // Avisa o cliente com o código de rastreio (não bloqueia em caso de falha).
    const emailed = await sendTrackingEmail({
      to: context.buyer.email,
      name: context.buyer.name,
      trackingCode: tracking[orderId]?.tracking,
      summary: items.summary,
    });
    if (emailed) await logEvent({ type: 'tracking_email', source: 'stripe-webhook', stripe_session_id: session.id, status: 'ok', payload: { to: context.buyer.email } });

    return res.status(200).json({
      received: true,
      me_order_id: orderId,
      tracking_code: tracking[orderId]?.tracking,
      print_url: printResult.url,
    });
  } catch (err) {
    console.error(`Falha processando ${session.id}:`, err.response ?? err.message);

    // Garante que o pedido existe no banco mesmo se falhou cedo, e marca o erro.
    await upsertOrder({
      stripe_session_id: session.id,
      stripe_payment_intent: session.payment_intent ?? null,
      buyer_name: context.buyer?.name ?? null,
      buyer_email: context.buyer?.email ?? null,
      buyer_phone: context.buyer?.phone ?? null,
      buyer_cpf: context.buyer?.document ?? null,
      color: context.product?.color ?? null,
      product_name: context.product?.summary ?? context.product?.raw ?? null,
      quantity: context.product?.qty ?? 1,
      items: context.product?.qtyByColor ?? null,
      amount_total: context.amount_total ?? session.amount_total ?? null,
      currency: context.currency ?? session.currency ?? 'brl',
      ship_line1: context.shipping_address?.line1 ?? null,
      ship_line2: context.shipping_address?.line2 ?? null,
      ship_city: context.shipping_address?.city ?? null,
      ship_state: context.shipping_address?.state ?? null,
      ship_postal_code: context.shipping_address?.postal_code ?? null,
      ship_country: context.shipping_address?.country ?? null,
      status: 'label_failed',
      error_message: describeError(err),
    });
    await logEvent({
      type: 'shipment_error',
      source: 'stripe-webhook',
      stripe_session_id: session.id,
      status: 'error',
      error: describeError(err),
      payload: { details: err.response ?? null, buyer: context.buyer ?? null, shipping_address: context.shipping_address ?? null },
    });
    await notifyShipmentError({
      ...context,
      error: { message: err.message, details: err.response ?? null },
    });
    return res.status(200).json({ received: true, error: err.message, details: err.response ?? null, manual_action_required: true });
  }
}

export default withRequestLog('stripe-webhook', handler);
