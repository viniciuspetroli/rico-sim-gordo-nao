// Webhook do Stripe — dispara quando uma compra é finalizada.
// Pega endereço do cliente do checkout session, gera etiqueta no ME automaticamente.

import Stripe from 'stripe';
import { pickCheapestService, addToCart, checkoutAndGenerate, getPrintUrl, getTracking } from './_lib/melhor-envio.js';
import { PRODUCT_BY_COLOR, detectColorFromProductName } from './_lib/config.js';

export const config = {
  api: { bodyParser: false }, // Stripe valida assinatura no body cru
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
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

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true, ignored: event.type });
  }

  const session = event.data.object;

  try {
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 10, expand: ['data.price.product'] });
    const productName = lineItems.data[0]?.price?.product?.name;
    const color = detectColorFromProductName(productName);
    if (!color) throw new Error(`Não consegui identificar a cor do produto: ${productName}`);
    const product = PRODUCT_BY_COLOR[color];

    const shipping = session.shipping_details ?? session.collected_information?.shipping_details;
    if (!shipping?.address) throw new Error('Sessão sem endereço de entrega — confira que o Payment Link tá coletando endereço');

    const destinationCep = shipping.address.postal_code.replace(/\D/g, '');
    const recipient = {
      name: shipping.name,
      phone: session.customer_details?.phone ?? '',
      email: session.customer_details?.email,
    };
    const destinationAddress = {
      address: shipping.address.line1,
      complement: shipping.address.line2 ?? '',
      district: '', // Stripe não coleta bairro separado — fica no line1
      city: shipping.address.city,
      state_abbr: shipping.address.state,
      country_id: shipping.address.country,
      postal_code: destinationCep,
    };

    const service = await pickCheapestService({
      destination: { postal_code: destinationCep },
      insuranceValue: product.unitary_value,
    });
    console.log(`Stripe ${session.id}: serviço escolhido ${service.name} R$${service.price}`);

    const cartItem = await addToCart({
      service,
      destination: destinationAddress,
      recipient,
      product,
    });
    const orderId = cartItem.id;

    const generated = await checkoutAndGenerate([orderId]);
    const printResult = await getPrintUrl([orderId]);
    const tracking = await getTracking([orderId]);

    console.log(`Stripe ${session.id}: etiqueta gerada`, {
      me_order_id: orderId,
      tracking_code: tracking[orderId]?.tracking,
      print_url: printResult.url,
    });

    return res.status(200).json({
      received: true,
      me_order_id: orderId,
      tracking_code: tracking[orderId]?.tracking,
      print_url: printResult.url,
    });
  } catch (err) {
    console.error(`Falha processando ${session.id}:`, err.response ?? err.message);
    // Retorna 200 pra Stripe não ficar reentregando — log fica no Vercel pra reprocessar manual.
    return res.status(200).json({ received: true, error: err.message, manual_action_required: true });
  }
}
