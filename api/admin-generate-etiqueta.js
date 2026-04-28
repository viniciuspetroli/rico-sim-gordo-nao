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
import { PRODUCT_BY_COLOR, detectColorFromProductName, normalizeStateUf, getRecipientCpf } from './_lib/config.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'use POST' });

  const token = req.headers['x-admin-token'];
  if (!token || token !== process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { session_id, cep_override } = req.body ?? {};
  if (!session_id) return res.status(400).json({ error: 'session_id obrigatório' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    const lineItems = await stripe.checkout.sessions.listLineItems(session_id, { limit: 10, expand: ['data.price.product'] });
    const productName = lineItems.data[0]?.price?.product?.name;
    const color = detectColorFromProductName(productName);
    if (!color) throw new Error(`Não consegui identificar a cor do produto: ${productName}`);
    const product = PRODUCT_BY_COLOR[color];

    const shipping = session.shipping_details ?? session.collected_information?.shipping_details;
    if (!shipping?.address) throw new Error('Sessão sem endereço de entrega');

    const destinationCep = (cep_override ?? shipping.address.postal_code).replace(/\D/g, '');

    const recipient = {
      name: shipping.name,
      phone: session.customer_details?.phone ?? '',
      email: session.customer_details?.email,
      document: getRecipientCpf(session),
    };
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
      insuranceValue: product.unitary_value,
    });
    console.log(`admin-etiqueta ${session_id}: serviço ${service.name} R$${service.price} pra CEP ${destinationCep}`);

    const cartItem = await addToCart({ service, destination: destinationAddress, recipient, product });
    const orderId = cartItem.id;

    await checkoutAndGenerate([orderId]);
    const printResult = await getPrintUrl([orderId]);
    const tracking = await getTracking([orderId]);

    console.log(`admin-etiqueta ${session_id}: OK order=${orderId} tracking=${tracking[orderId]?.tracking}`);

    return res.status(200).json({
      ok: true,
      session_id,
      cep_used: destinationCep,
      cep_overridden: !!cep_override,
      color,
      service: service.name,
      price: service.price,
      me_order_id: orderId,
      tracking_code: tracking[orderId]?.tracking,
      print_url: printResult.url,
    });
  } catch (err) {
    console.error(`admin-etiqueta erro:`, err.response ?? err.message);
    return res.status(500).json({ error: err.message, me_response: err.response });
  }
}
