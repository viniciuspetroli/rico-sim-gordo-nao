// Disponibilidade dos drops — lido pela landing page pra mostrar/esconder
// o "ESGOTADO" e o botão de comprar sem precisar de deploy.
//
// GET /api/availability  →  { verde: {...}, marrom: {...} }
//
// Se o banco não responder, retorna {} e a página mantém o estado padrão
// (hardcoded no HTML) — nunca quebra a página de venda.

import { getDrops } from './_lib/db.js';

export default async function handler(req, res) {
  const drops = await getDrops();
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
  if (!drops) return res.status(200).json({});

  const map = {};
  for (const d of drops) {
    map[d.color] = {
      label: d.label,
      available: d.available,
      stripe_payment_link: d.stripe_payment_link,
    };
  }
  return res.status(200).json(map);
}
