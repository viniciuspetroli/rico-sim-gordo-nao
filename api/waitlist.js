// Endpoint da waitlist — recebe POST do modal "me avise quando voltar".
// Grava no Supabase E repassa pro n8n (planilha/email). Os dois são
// independentes: se um falhar, o outro ainda registra o lead.

import { saveWaitlist, logEvent } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'use POST' });

  const { name, email, color } = req.body ?? {};
  if (!name || !email) return res.status(400).json({ error: 'nome e email obrigatórios' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'email inválido' });

  const cleanName = String(name).trim().slice(0, 120);
  const cleanEmail = String(email).trim().toLowerCase().slice(0, 200);
  const cleanColor = color ?? 'verde';
  const userAgent = req.headers['user-agent'] ?? '';
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ?? '';

  // 1) Grava no banco (fonte da verdade)
  await saveWaitlist({ name: cleanName, email: cleanEmail, color: cleanColor, user_agent: userAgent, ip });
  await logEvent({ type: 'waitlist_signup', source: 'waitlist', status: 'ok', payload: { name: cleanName, email: cleanEmail, color: cleanColor } });

  // 2) Repassa pro n8n (planilha + email), se configurado. Não bloqueia o lead.
  const url = process.env.N8N_WAITLIST_WEBHOOK;
  if (url) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'waitlist_signup',
          timestamp: new Date().toISOString(),
          source: 'landing-page',
          name: cleanName, email: cleanEmail, color: cleanColor, user_agent: userAgent, ip,
        }),
      });
      if (!r.ok) console.error(`n8n waitlist respondeu ${r.status}: ${await r.text()}`);
    } catch (err) {
      console.error('Falha repassando waitlist pro n8n:', err.message);
    }
  }

  console.log(`Waitlist signup: ${cleanEmail} (${cleanColor})`);
  return res.status(200).json({ ok: true });
}
