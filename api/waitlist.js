// Endpoint da waitlist — recebe POST do modal "me avise quando voltar"
// e repassa pro webhook do n8n configurado em N8N_WAITLIST_WEBHOOK.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'use POST' });

  const url = process.env.N8N_WAITLIST_WEBHOOK;
  if (!url) {
    console.error('N8N_WAITLIST_WEBHOOK não configurado nas env vars');
    return res.status(500).json({ error: 'webhook não configurado no servidor' });
  }

  const { name, email, color } = req.body ?? {};
  if (!name || !email) return res.status(400).json({ error: 'nome e email obrigatórios' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'email inválido' });

  const payload = {
    type: 'waitlist_signup',
    timestamp: new Date().toISOString(),
    source: 'landing-page',
    name: String(name).trim().slice(0, 120),
    email: String(email).trim().toLowerCase().slice(0, 200),
    color: color ?? 'verde',
    user_agent: req.headers['user-agent'] ?? '',
    ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() ?? '',
  };

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const text = await r.text();
      console.error(`n8n waitlist respondeu ${r.status}: ${text}`);
      return res.status(502).json({ error: 'falha no webhook destino' });
    }
    console.log(`Waitlist signup: ${payload.email} (${payload.color})`);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Waitlist erro:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
