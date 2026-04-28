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
