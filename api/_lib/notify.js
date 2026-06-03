// Dispara webhook pro n8n quando algo dá errado. O n8n manda email.

const N8N_WEBHOOK = process.env.N8N_ERROR_WEBHOOK ?? 'https://n8n.impacta.click/webhook/email-erro-bone-guerra';

async function post(body) {
  if (!N8N_WEBHOOK) return;
  try {
    const res = await fetch(N8N_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timestamp: new Date().toISOString(), ...body }),
    });
    if (!res.ok) console.error(`n8n webhook respondeu ${res.status}: ${await res.text()}`);
  } catch (err) {
    console.error('Falha enviando notificação ao n8n:', err.message);
  }
}

export async function notifyShipmentError(payload) {
  return post({ type: 'shipment_error', ...payload });
}

export async function notifyTokenError(payload) {
  return post({ type: 'me_token_error', ...payload });
}
