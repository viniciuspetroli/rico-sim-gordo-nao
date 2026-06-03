// Configuração central. Endereço de origem, dimensões do pacote, mapeamento Stripe → ME.

export const ME_ENV = process.env.ME_ENV ?? 'sandbox';

export const ME_BASE_URL =
  ME_ENV === 'production'
    ? 'https://www.melhorenvio.com.br'
    : 'https://sandbox.melhorenvio.com.br';

export const ME_USER_AGENT = `Rico Sim Gordo Não (${process.env.ME_CONTACT_EMAIL ?? 'sem-email-configurado'})`;

// Endereço de origem (de onde sai o boné). Usado no remetente da etiqueta.
export const ORIGIN_ADDRESS = {
  name: 'João Pedro Vieira Ribeiro Guerra',
  phone: '+5513992078849',
  email: process.env.ME_CONTACT_EMAIL ?? 'guerraagencia@gmail.com',
  document: '', // CPF do João — preencher antes de produção (sem pontos/traços)
  address: 'Rua Kansas',
  number: '1700',
  complement: 'Apt 135 Texas',
  district: 'Brooklin',
  city: 'São Paulo',
  state_abbr: 'SP',
  country_id: 'BR',
  postal_code: '04558005',
};

// Dimensões do pacote (boné embalado em caixa). cm e gramas.
export const PACKAGE_DIMENSIONS = {
  height: 12,
  width: 20,
  length: 25,
  weight: 0.5, // 500g — ME usa kg
};

// Mapeia metadata.cor (vinda do Payment Link / Product no Stripe) para o produto declarado na etiqueta.
export const PRODUCT_BY_COLOR = {
  verde: {
    name: 'Boné rico sim, gordo não — Verde militar',
    quantity: 1,
    unitary_value: 50.0,
  },
  marrom: {
    name: 'Boné rico sim, gordo não — Marrom terra',
    quantity: 1,
    unitary_value: 50.0,
  },
};

// Detecta cor a partir do nome do produto Stripe quando metadata não tá disponível.
export function detectColorFromProductName(name) {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (lower.includes('verde')) return 'verde';
  if (lower.includes('marrom') || lower.includes('terra')) return 'marrom';
  return null;
}

// Extrai uma mensagem de erro legível (do ME ou genérica) pra mostrar no painel.
export function describeError(err) {
  const r = err?.response;
  if (r) {
    if (typeof r === 'string') return r;
    if (r.error) return r.error;
    if (r.message) return r.message;
    if (r.errors && typeof r.errors === 'object') {
      const msgs = Object.values(r.errors).flat().filter(Boolean);
      if (msgs.length) return msgs.join(' · ');
    }
    try { return `${err.message}: ${JSON.stringify(r)}`; } catch { /* ignore */ }
  }
  return err?.message ?? 'erro desconhecido';
}

// Monta itens/quantidades a partir dos line items do Stripe.
// Lida com quantidade > 1 e (defensivamente) com mais de uma cor no mesmo pedido.
export function buildOrderItems(lineItems) {
  const qtyByColor = {};
  for (const li of lineItems) {
    const name = li.price?.product?.name;
    const color = detectColorFromProductName(name);
    if (!color) continue;
    qtyByColor[color] = (qtyByColor[color] ?? 0) + (li.quantity ?? 1);
  }
  const colors = Object.keys(qtyByColor);
  if (!colors.length) return null;

  const totalQty = colors.reduce((s, c) => s + qtyByColor[c], 0);
  const products = colors.map(c => ({
    name: PRODUCT_BY_COLOR[c].name,
    quantity: qtyByColor[c],
    unitary_value: PRODUCT_BY_COLOR[c].unitary_value,
  }));
  const insuranceValue = products.reduce((s, p) => s + p.unitary_value * p.quantity, 0);
  const pkg = { ...PACKAGE_DIMENSIONS, weight: +(PACKAGE_DIMENSIONS.weight * totalQty).toFixed(3) };
  const summary = colors.map(c => `${qtyByColor[c]}× ${c}`).join(', ');

  return { qtyByColor, products, totalQty, primaryColor: colors[0], multiColor: colors.length > 1, insuranceValue, pkg, summary };
}

const BR_STATE_TO_UF = {
  'acre': 'AC', 'alagoas': 'AL', 'amapá': 'AP', 'amapa': 'AP',
  'amazonas': 'AM', 'bahia': 'BA', 'ceará': 'CE', 'ceara': 'CE',
  'distrito federal': 'DF', 'espírito santo': 'ES', 'espirito santo': 'ES',
  'goiás': 'GO', 'goias': 'GO', 'maranhão': 'MA', 'maranhao': 'MA',
  'mato grosso': 'MT', 'mato grosso do sul': 'MS',
  'minas gerais': 'MG', 'pará': 'PA', 'para': 'PA',
  'paraíba': 'PB', 'paraiba': 'PB', 'paraná': 'PR', 'parana': 'PR',
  'pernambuco': 'PE', 'piauí': 'PI', 'piaui': 'PI',
  'rio de janeiro': 'RJ', 'rio grande do norte': 'RN', 'rio grande do sul': 'RS',
  'rondônia': 'RO', 'rondonia': 'RO', 'roraima': 'RR',
  'santa catarina': 'SC', 'são paulo': 'SP', 'sao paulo': 'SP',
  'sergipe': 'SE', 'tocantins': 'TO',
};

// ME exige UF de 2 letras. Stripe pode mandar o nome completo dependendo de como o cliente preencheu.
export function normalizeStateUf(state) {
  if (!state) return state;
  const trimmed = state.trim();
  if (trimmed.length === 2) return trimmed.toUpperCase();
  return BR_STATE_TO_UF[trimmed.toLowerCase()] ?? trimmed;
}

// CPF fallback — usado quando o cliente errou o dígito ou não preencheu.
// Evita pedido travar; etiqueta sai mesmo assim.
const FALLBACK_CPF = '52768084069';

// Valida CPF: 11 dígitos + checksum oficial. Rejeita sequências repetidas (000..., 111...).
export function isValidCpf(input) {
  const digits = String(input ?? '').replace(/\D/g, '');
  if (digits.length !== 11) return false;
  if (/^(\d)\1+$/.test(digits)) return false;
  const compute = (slice, weightStart) => {
    let sum = 0;
    for (let i = 0; i < slice.length; i++) sum += parseInt(slice[i], 10) * (weightStart - i);
    const mod = (sum * 10) % 11;
    return mod === 10 ? 0 : mod;
  };
  if (compute(digits.slice(0, 9), 10) !== parseInt(digits[9], 10)) return false;
  if (compute(digits.slice(0, 10), 11) !== parseInt(digits[10], 10)) return false;
  return true;
}

// Extrai CPF do Stripe Checkout Session. Se faltar ou for inválido, cai no fallback.
// Sempre retorna um CPF válido — etiqueta nunca falha por causa disso.
export function getRecipientCpf(session) {
  const fields = session.custom_fields ?? [];
  const cpfField = fields.find(f =>
    f.key?.toLowerCase().includes('cpf') ||
    f.label?.custom?.toLowerCase().includes('cpf')
  );
  const raw = cpfField?.numeric?.value ?? cpfField?.text?.value ?? '';
  const cleaned = raw.replace(/\D/g, '');
  if (isValidCpf(cleaned)) return cleaned;
  console.warn(`CPF inválido ou ausente na sessão ${session.id} (recebido: "${raw}"). Usando fallback.`);
  return FALLBACK_CPF;
}
