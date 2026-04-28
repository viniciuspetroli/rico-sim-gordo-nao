// Dispara webhook pro n8n quando algo dá errado no fluxo de etiqueta.
// O n8n manda email com os dados pra ação manual.

const N8N_WEBHOOK = process.env.N8N_ERROR_WEBHOOK ?? 'https://n8n.impacta.click/webhook/email-erro-bone-guerra';

export async function notifyShipmentError(payload) {
  if (!N8N_WEBHOOK) return;
  const body = {
    type: 'shipment_error',
    timestamp: new Date().toISOString(),
    ...payload,
  };
  try {
    const res = await fetch(N8N_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.error(`n8n webhook respondeu ${res.status}: ${await res.text()}`);
  } catch (err) {
    // Erro mandando notificação não pode derrubar o webhook principal.
    console.error('Falha enviando notificação ao n8n:', err.message);
  }
}
