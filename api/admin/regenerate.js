// "Regerar etiqueta" do painel. Verifica a sessão do admin e chama o
// endpoint /api/admin-generate-etiqueta (já testado) server-side, com o
// token interno. Aceita cep_override opcional pra corrigir CEP errado.

import { requireAuth } from './_auth.js';

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'use POST' });

  const { session_id, cep_override } = req.body ?? {};
  if (!session_id) return res.status(400).json({ error: 'session_id obrigatório' });

  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  const proto = req.headers['x-forwarded-proto'] ?? 'https';

  try {
    const r = await fetch(`${proto}://${host}/api/admin-generate-etiqueta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': process.env.STRIPE_WEBHOOK_SECRET },
      body: JSON.stringify({ session_id, ...(cep_override ? { cep_override } : {}) }),
    });
    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
