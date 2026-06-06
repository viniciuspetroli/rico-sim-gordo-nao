// TEMPORÁRIO — simula uma venda rodando o MESMO pipeline interno do webhook,
// sem a trava de assinatura/Stripe. Cria pedido, baixa estoque, gera etiqueta
// real no ME e manda os e-mails. REMOVER após o teste.

import { pickCheapestService, addToCart, checkoutAndGenerate, getPrintUrl, getTracking } from './_lib/melhor-envio.js';
import { normalizeStateUf, buildOrderItems, PRODUCT_BY_COLOR } from './_lib/config.js';
import { upsertOrder, updateOrder, patchOrder, logEvent, registerSale } from './_lib/db.js';
import { sendConfirmationEmail, sendTrackingEmail } from './_lib/mail.js';

export default async function handler(req, res) {
  const sessionId = `test_${Date.now()}`;
  const buyer = { name: 'Vinicius Petroli Affonso', email: 'viniciuspetroli@gmail.com', phone: '11991234567', document: '42541504829' };
  const itemsMap = { verde: 1 };

  // Sintetiza os line items pra reusar o mesmo buildOrderItems do fluxo real.
  const fakeLineItems = Object.entries(itemsMap).map(([c, q]) => ({ quantity: q, price: { product: { name: PRODUCT_BY_COLOR[c].name } } }));
  const items = buildOrderItems(fakeLineItems);

  try {
    await upsertOrder({
      stripe_session_id: sessionId,
      stripe_payment_intent: null,
      buyer_name: buyer.name, buyer_email: buyer.email, buyer_phone: buyer.phone, buyer_cpf: buyer.document,
      color: items.primaryColor, product_name: items.summary, quantity: items.totalQty, items: items.qtyByColor,
      amount_total: 5000, currency: 'brl',
      ship_line1: 'Av Eng. Luis Carlos Berrini, 901', ship_line2: 'apto 403',
      ship_city: 'São Paulo', ship_state: 'SP', ship_postal_code: '04571-010', ship_country: 'BR',
      status: 'paid',
    });
    await registerSale(sessionId, items.qtyByColor);

    const confirmed = await sendConfirmationEmail({ to: buyer.email, name: buyer.name, summary: items.summary });
    if (confirmed) await patchOrder(sessionId, { confirmation_sent: true });

    const destinationAddress = {
      address: 'Av Eng. Luis Carlos Berrini, 901', complement: 'apto 403', district: 'Cidade Monções',
      city: 'São Paulo', state_abbr: normalizeStateUf('SP'), country_id: 'BR', postal_code: '04571010',
    };
    const service = await pickCheapestService({ destination: { postal_code: '04571010' }, insuranceValue: items.insuranceValue, pkg: items.pkg });
    const cartItem = await addToCart({ service, destination: destinationAddress, recipient: buyer, products: items.products, insuranceValue: items.insuranceValue, pkg: items.pkg });
    const orderId = cartItem.id;

    await checkoutAndGenerate([orderId]);
    const printResult = await getPrintUrl([orderId]);
    const tracking = await getTracking([orderId]);
    const code = tracking[orderId]?.tracking ?? null;

    await updateOrder(sessionId, {
      status: 'label_generated', me_order_id: orderId, tracking_code: code,
      label_url: printResult.url ?? null, shipping_service: service.name, shipping_price: parseFloat(service.price), error_message: null,
    });
    await logEvent({ type: 'label_generated', source: 'test-order', stripe_session_id: sessionId, status: 'ok', payload: { me_order_id: orderId, tracking: code } });

    let trackingEmail = false;
    if (code) {
      trackingEmail = await sendTrackingEmail({ to: buyer.email, name: buyer.name, trackingCode: code, summary: items.summary });
    }

    return res.status(200).json({
      ok: true, session_id: sessionId, confirmation_email: confirmed,
      service: service.name, price: service.price, me_order_id: orderId,
      tracking_code: code, tracking_email: trackingEmail, print_url: printResult.url,
    });
  } catch (err) {
    await updateOrder(sessionId, { status: 'label_failed', error_message: err.message }).catch(() => {});
    return res.status(500).json({ error: err.message, details: err.response ?? null });
  }
}
