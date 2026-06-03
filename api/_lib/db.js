// Cliente Supabase pras serverless functions. Usa a service_role key (bypassa RLS).
//
// REGRA: toda função aqui engole o próprio erro e loga. NUNCA lança.
// O banco é aditivo — se falhar, o fluxo de etiqueta (dinheiro/cliente real)
// segue normal. Persistência é secundária ao fulfillment.

import { createClient } from '@supabase/supabase-js';

let _client = null;
function db() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('[db] SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados');
    return null;
  }
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

// Insere ou atualiza um pedido (idempotente por stripe_session_id).
export async function upsertOrder(record) {
  const c = db();
  if (!c) return null;
  try {
    const { data, error } = await c
      .from('orders')
      .upsert(record, { onConflict: 'stripe_session_id' })
      .select()
      .single();
    if (error) { console.error('[db] upsertOrder:', error.message); return null; }
    return data;
  } catch (err) {
    console.error('[db] upsertOrder exceção:', err.message);
    return null;
  }
}

// Atualiza campos de um pedido existente.
export async function updateOrder(stripeSessionId, patch) {
  const c = db();
  if (!c) return null;
  try {
    const { data, error } = await c
      .from('orders')
      .update(patch)
      .eq('stripe_session_id', stripeSessionId)
      .select()
      .single();
    if (error) { console.error('[db] updateOrder:', error.message); return null; }
    return data;
  } catch (err) {
    console.error('[db] updateOrder exceção:', err.message);
    return null;
  }
}

// Grava uma linha no log de eventos técnicos.
export async function logEvent(record) {
  const c = db();
  if (!c) return null;
  try {
    const { error } = await c.from('event_log').insert(record);
    if (error) console.error('[db] logEvent:', error.message);
  } catch (err) {
    console.error('[db] logEvent exceção:', err.message);
  }
}

// Salva inscrição na waitlist (idempotente por email+cor).
export async function saveWaitlist(record) {
  const c = db();
  if (!c) return null;
  try {
    const { error } = await c
      .from('waitlist')
      .upsert(record, { onConflict: 'email,color', ignoreDuplicates: true });
    if (error) console.error('[db] saveWaitlist:', error.message);
  } catch (err) {
    console.error('[db] saveWaitlist exceção:', err.message);
  }
}

// Desconta 1 do estoque da cor (idempotente por pedido). Engole erro.
export async function registerSale(stripeSessionId, color) {
  const c = db();
  if (!c || !color) return;
  try {
    const { error } = await c.rpc('register_sale', { p_session_id: stripeSessionId, p_color: color });
    if (error) console.error('[db] registerSale:', error.message);
  } catch (err) {
    console.error('[db] registerSale exceção:', err.message);
  }
}

// Grava uma requisição no log de requisições. Engole erro.
export async function logRequest(record) {
  const c = db();
  if (!c) return;
  try {
    const { error } = await c.from('request_log').insert(record);
    if (error) console.error('[db] logRequest:', error.message);
  } catch (err) {
    console.error('[db] logRequest exceção:', err.message);
  }
}

export async function listRequests({ source } = {}) {
  const c = db();
  if (!c) throw new Error('banco indisponível');
  let query = c.from('request_log').select('*').order('created_at', { ascending: false }).limit(200);
  if (source && source !== 'all') query = query.eq('source', source);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

// Lê o estado dos drops (disponibilidade por cor).
export async function getDrops() {
  const c = db();
  if (!c) return null;
  try {
    const { data, error } = await c.from('drops').select('*').order('sort');
    if (error) { console.error('[db] getDrops:', error.message); return null; }
    return data;
  } catch (err) {
    console.error('[db] getDrops exceção:', err.message);
    return null;
  }
}

// ─── Leituras/ações do painel (lançam erro pra mostrar no front) ───

export async function listOrders({ status, q } = {}) {
  const c = db();
  if (!c) throw new Error('banco indisponível');
  let query = c.from('orders').select('*').order('created_at', { ascending: false }).limit(500);
  if (status && status !== 'all') query = query.eq('status', status);
  if (q) query = query.or(`buyer_name.ilike.%${q}%,buyer_email.ilike.%${q}%,tracking_code.ilike.%${q}%`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

export async function setOrderStatus(stripeSessionId, status, extra = {}) {
  const c = db();
  if (!c) throw new Error('banco indisponível');
  const patch = { status, ...extra };
  if (status === 'shipped' && !patch.shipped_at) patch.shipped_at = new Date().toISOString();
  if (status === 'delivered' && !patch.delivered_at) patch.delivered_at = new Date().toISOString();
  const { data, error } = await c.from('orders').update(patch).eq('stripe_session_id', stripeSessionId).select().single();
  if (error) throw new Error(error.message);
  return data;
}

// Atualiza campos avulsos (ex.: só o rastreio) — lança erro pro painel mostrar.
export async function patchOrder(stripeSessionId, patch) {
  const c = db();
  if (!c) throw new Error('banco indisponível');
  const { data, error } = await c.from('orders').update(patch).eq('stripe_session_id', stripeSessionId).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function listWaitlist() {
  const c = db();
  if (!c) throw new Error('banco indisponível');
  const { data, error } = await c.from('waitlist').select('*').order('created_at', { ascending: false }).limit(1000);
  if (error) throw new Error(error.message);
  return data;
}

export async function listEvents() {
  const c = db();
  if (!c) throw new Error('banco indisponível');
  const { data, error } = await c.from('event_log').select('*').order('created_at', { ascending: false }).limit(300);
  if (error) throw new Error(error.message);
  return data;
}

export async function setDropAvailable(color, available) {
  const c = db();
  if (!c) throw new Error('banco indisponível');
  const { data, error } = await c.from('drops').update({ available }).eq('color', color).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function setDropStock(color, stock) {
  const c = db();
  if (!c) throw new Error('banco indisponível');
  // stock null = ilimitado; número = quantidade
  const value = (stock === null || stock === '' || stock === undefined) ? null : Math.max(0, parseInt(stock, 10));
  const { data, error } = await c.from('drops').update({ stock: value }).eq('color', color).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function getStats() {
  const c = db();
  if (!c) throw new Error('banco indisponível');
  const { data, error } = await c.from('orders').select('status, color, amount_total');
  if (error) throw new Error(error.message);
  const stats = { total: data.length, revenue: 0, by_status: {}, by_color: {} };
  for (const o of data) {
    stats.revenue += o.amount_total ?? 0;
    stats.by_status[o.status] = (stats.by_status[o.status] ?? 0) + 1;
    if (o.color) stats.by_color[o.color] = (stats.by_color[o.color] ?? 0) + 1;
  }
  return stats;
}
