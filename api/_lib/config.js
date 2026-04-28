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

// CPF de teste usado só em sandbox (passa no checksum do algoritmo). NUNCA usar em prod.
const SANDBOX_TEST_CPF = '11144477735';

// Extrai CPF do destinatário do Stripe Checkout Session via custom_fields.
// Em sandbox, cai em CPF fake pra permitir testar antes de configurar o custom field nos Payment Links.
export function getRecipientCpf(session) {
  const fields = session.custom_fields ?? [];
  const cpfField = fields.find(f =>
    f.key?.toLowerCase().includes('cpf') ||
    f.label?.custom?.toLowerCase().includes('cpf')
  );
  if (cpfField) {
    const raw = cpfField.numeric?.value ?? cpfField.text?.value;
    if (raw) return raw.replace(/\D/g, '');
  }
  if (ME_ENV !== 'production') return SANDBOX_TEST_CPF;
  throw new Error('CPF do destinatário não encontrado em session.custom_fields. Adicione um Custom Field "CPF" aos Payment Links no Stripe Dashboard.');
}
