// Endpoint temporário pra reprocessar a compra da Kelly Giarola com o CEP correto.
// Será removido no próximo commit após confirmação do sucesso.

import Stripe from 'stripe';
import { pickCheapestService, addToCart, checkoutAndGenerate, getPrintUrl, getTracking } from './_lib/melhor-envio.js';
import { PRODUCT_BY_COLOR, detectColorFromProductName, normalizeStateUf, getRecipientCpf } from './_lib/config.js';
import { notifyShipmentError } from './_lib/notify.js';

const SESSION_ID = 'cs_live_a1BjgqllBHmBipEbVMuEJnx76GwQzsQ9W51vl5HarMskl2YHU3DpjLfYO3';
const CEP_OVERRIDE = '11742502';

export default async function handler(req, res) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const context = { source: 'rescue-kelly', stripe_session_id: SESSION_ID, cep_override: CEP_OVERRIDE };

  try {
    const session = await stripe.checkout.sessions.retrieve(SESSION_ID);
    const lineItems = await stripe.checkout.sessions.listLineItems(SESSION_ID, { limit: 10, expand: ['data.price.product'] });
    const productName = lineItems.data[0]?.price?.product?.name;
    const color = detectColorFromProductName(productName);
    context.product = { name: productName, color };
    if (!color) throw new Error(`Não consegui identificar a cor: ${productName}`);
    const product = PRODUCT_BY_COLOR[color];

    const shipping = session.shipping_details ?? session.collected_information?.shipping_details;
    if (!shipping?.address) throw new Error('Sessão sem endereço');

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
    context.stripe_dashboard_url = `https://dashboard.stripe.com/payments/${session.payment_intent}`;

    const destinationAddress = {
      address: shipping.address.line1,
      complement: shipping.address.line2 ?? '',
      district: '',
      city: shipping.address.city,
      state_abbr: normalizeStateUf(shipping.address.state),
      country_id: shipping.address.country,
      postal_code: CEP_OVERRIDE,
    };

    const service = await pickCheapestService({
      destination: { postal_code: CEP_OVERRIDE },
      insuranceValue: product.unitary_value,
    });
    console.log(`rescue-kelly: serviço ${service.name} R$${service.price} pra CEP ${CEP_OVERRIDE}`);

    const cartItem = await addToCart({ service, destination: destinationAddress, recipient: context.buyer, product });
    const orderId = cartItem.id;

    await checkoutAndGenerate([orderId]);
    const printResult = await getPrintUrl([orderId]);
    const tracking = await getTracking([orderId]);

    console.log(`rescue-kelly OK: order=${orderId} tracking=${tracking[orderId]?.tracking}`);

    return res.status(200).json({
      ok: true,
      buyer: context.buyer.name,
      cep_used: CEP_OVERRIDE,
      service: service.name,
      price: service.price,
      me_order_id: orderId,
      tracking_code: tracking[orderId]?.tracking,
      print_url: printResult.url,
    });
  } catch (err) {
    console.error('rescue-kelly erro:', err.response ?? err.message);
    await notifyShipmentError({
      ...context,
      error: { message: err.message, details: err.response ?? null },
    });
    return res.status(500).json({ error: err.message, me_response: err.response });
  }
}
