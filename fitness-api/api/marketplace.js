import { randomBytes } from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL
  ? new URL(process.env.SUPABASE_URL).origin : '';
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORIGIN = 'https://pgrowth-events.vercel.app';

function send(res, status, data) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(data);
}

function cors(req, res) {
  if (req.headers.origin === ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function clean(value, max = 5000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

async function db(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }

  if (!response.ok) {
    throw new Error(
      data?.message || data?.msg || data?.hint ||
      `Erro de base de dados (${response.status}).`
    );
  }
  return data;
}

async function authenticate(req) {
  const match = String(req.headers.authorization || '')
    .match(/^Bearer\s+(.+)$/i);

  if (!match) fail('Inicie sessão para continuar.', 401);

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${match[1]}`
    }
  });

  if (!response.ok) fail('Sessão inválida ou expirada.', 401);

  const user = await response.json();
  if (!user?.id) fail('Utilizador não autenticado.', 401);
  return user;
}

async function isAdmin(userId) {
  const q = new URLSearchParams({
    select: 'user_id',
    user_id: `eq.${userId}`,
    limit: '1'
  });
  const rows = await db(`/rest/v1/fitness_admins?${q}`);
  return Array.isArray(rows) && rows.length > 0;
}

async function requireAdmin(user) {
  if (!(await isAdmin(user.id))) {
    fail('Acesso reservado à administração PGrowth.', 403);
  }
}

function reference() {
  return `PGM-${Date.now()}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

function eventFields(body) {
  const title = clean(body.title, 160);
  if (title.length < 3) fail('Introduza o título do evento.');

  const status = clean(body.status || 'DRAFT', 20).toUpperCase();
  if (!['DRAFT', 'PUBLISHED', 'ARCHIVED'].includes(status)) {
    fail('Estado do evento inválido.');
  }

  return {
    title,
    description: clean(body.description, 10000),
    category: clean(body.category || 'EVENTO', 80),
    location: clean(body.location, 250),
    start_at: body.start_at || null,
    end_at: body.end_at || null,
    poster_url: clean(body.poster_url, 2000) || null,
    contact_info: clean(body.contact_info, 300),
    registration_url: clean(body.registration_url, 2000) || null,
    status,
    updated_at: new Date().toISOString()
  };
}

function productFields(body) {
  const name = clean(body.name, 160);
  if (name.length < 2) fail('Introduza o nome do produto.');

  const price = Number(body.price_mzn);
  const stock = Number(body.stock_quantity);
  if (!Number.isFinite(price) || price < 0) fail('Preço inválido.');
  if (!Number.isInteger(stock) || stock < 0) fail('Stock inválido.');

  const status = clean(body.status || 'DRAFT', 20).toUpperCase();
  if (!['DRAFT', 'PUBLISHED', 'ARCHIVED'].includes(status)) {
    fail('Estado do produto inválido.');
  }

  return {
    name,
    description: clean(body.description, 10000),
    category: clean(body.category || 'DESPORTO', 80),
    image_url: clean(body.image_url, 2000) || null,
    price_mzn: price,
    stock_quantity: stock,
    status,
    updated_at: new Date().toISOString()
  };
}

export default async function handler(req, res) {
  cors(req, res);

  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
    return send(res, 500, { error: 'Configuração do servidor incompleta.' });
  }

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!['GET', 'POST'].includes(req.method)) {
    return send(res, 405, { error: 'Método não permitido.' });
  }

  try {
    const url = new URL(req.url, 'https://localhost');
    const body = req.method === 'POST' && req.body &&
      typeof req.body === 'object' ? req.body : {};
    const action = req.method === 'GET'
      ? url.searchParams.get('action')
      : body.action;

    // Catálogos públicos: apenas conteúdo publicado.
    if (req.method === 'GET' && action === 'events') {
      const q = new URLSearchParams({
        select: 'id,title,description,category,location,start_at,end_at,poster_url,contact_info,registration_url',
        status: 'eq.PUBLISHED',
        order: 'start_at.asc.nullslast'
      });
      const events = await db(`/rest/v1/pg_marketplace_events?${q}`);
      return send(res, 200, { events: events || [] });
    }

    if (req.method === 'GET' && action === 'products') {
      const q = new URLSearchParams({
        select: 'id,name,description,category,image_url,price_mzn,stock_quantity',
        status: 'eq.PUBLISHED',
        order: 'created_at.desc'
      });
      const products = await db(`/rest/v1/pg_marketplace_products?${q}`);
      return send(res, 200, { products: products || [] });
    }

    // Todas as restantes operações exigem uma sessão válida.
    const user = await authenticate(req);

    if (req.method === 'POST' && action === 'create-order') {
      const productId = clean(body.productId, 80);
      const buyerName = clean(body.buyerName, 120);
      const phone = clean(body.phone, 30);
      const paymentMethod = clean(body.paymentMethod, 20).toUpperCase();
      const transferCode = clean(body.transferCode, 150);
      const paymentMessage = clean(body.paymentMessage, 10000);
      const quantity = Number(body.quantity);

      if (!productId) fail('Produto inválido.');
      if (buyerName.length < 3) fail('Introduza o nome completo.');
      if (phone.length < 8) fail('Introduza um telefone válido.');
      if (!['MPESA', 'EMOLA'].includes(paymentMethod)) {
        fail('Método de pagamento inválido.');
      }
      if (!transferCode && !paymentMessage) {
        fail('Introduza o código ou SMS de confirmação.');
      }
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
        fail('Quantidade inválida.');
      }

      const pq = new URLSearchParams({
        select: 'id,name,price_mzn,stock_quantity,status',
        id: `eq.${productId}`,
        limit: '1'
      });
      const products = await db(`/rest/v1/pg_marketplace_products?${pq}`);
      const product = products?.[0];

      if (!product || product.status !== 'PUBLISHED') {
        fail('Este produto já não está disponível.');
      }
      if (product.stock_quantity < quantity) {
        fail('Stock insuficiente. Actualize a quantidade.');
      }

      // O preço vem sempre da base de dados, nunca do navegador.
      const unitPrice = Number(product.price_mzn);
      const total = Math.round(unitPrice * quantity * 100) / 100;

      const order = {
        order_reference: reference(),
        user_id: user.id,
        product_id: product.id,
        product_name: product.name,
        unit_price_mzn: unitPrice,
        quantity,
        total_amount_mzn: total,
        buyer_name: buyerName,
        phone,
        payment_method: paymentMethod,
        transfer_code: transferCode || null,
        payment_message: paymentMessage || null,
        payment_status: 'PENDING'
      };

      const created = await db('/rest/v1/pg_marketplace_orders', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(order)
      });

      const saved = created?.[0];
      return send(res, 201, {
        success: true,
        order: saved ? {
          id: saved.id,
          order_reference: saved.order_reference,
          total_amount_mzn: saved.total_amount_mzn,
          payment_status: saved.payment_status
        } : null
      });
    }

    if (req.method === 'GET' && action === 'my-orders') {
      const q = new URLSearchParams({
        select: 'id,order_reference,product_name,unit_price_mzn,quantity,total_amount_mzn,payment_method,payment_status,admin_note,created_at,reviewed_at',
        user_id: `eq.${user.id}`,
        order: 'created_at.desc',
        limit: '50'
      });
      const orders = await db(`/rest/v1/pg_marketplace_orders?${q}`);
      return send(res, 200, { orders: orders || [] });
    }

    // A partir daqui, todas as operações são exclusivas do administrador.
    await requireAdmin(user);

    if (req.method === 'GET' && action === 'admin-events') {
      const q = new URLSearchParams({
        select: '*',
        order: 'created_at.desc'
      });
      return send(res, 200, {
        events: await db(`/rest/v1/pg_marketplace_events?${q}`)
      });
    }

    if (req.method === 'GET' && action === 'admin-products') {
      const q = new URLSearchParams({
        select: '*',
        order: 'created_at.desc'
      });
      return send(res, 200, {
        products: await db(`/rest/v1/pg_marketplace_products?${q}`)
      });
    }

    if (req.method === 'GET' && action === 'admin-orders') {
      const q = new URLSearchParams({
        select: '*',
        order: 'created_at.desc',
        limit: '200'
      });
      return send(res, 200, {
        orders: await db(`/rest/v1/pg_marketplace_orders?${q}`)
      });
    }

    if (req.method === 'POST' && action === 'admin-save-event') {
      const id = clean(body.id, 80);
      const fields = eventFields(body);
      if (id) {
        const q = new URLSearchParams({ id: `eq.${id}` });
        const rows = await db(`/rest/v1/pg_marketplace_events?${q}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(fields)
        });
        if (!rows?.length) fail('Evento não encontrado.', 404);
        return send(res, 200, { success: true, event: rows[0] });
      }

      const rows = await db('/rest/v1/pg_marketplace_events', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ ...fields, created_by: user.id })
      });
      return send(res, 201, { success: true, event: rows?.[0] });
    }

    if (req.method === 'POST' && action === 'admin-save-product') {
      const id = clean(body.id, 80);
      const fields = productFields(body);
      if (id) {
        const q = new URLSearchParams({ id: `eq.${id}` });
        const rows = await db(`/rest/v1/pg_marketplace_products?${q}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(fields)
        });
        if (!rows?.length) fail('Produto não encontrado.', 404);
        return send(res, 200, { success: true, product: rows[0] });
      }

      const rows = await db('/rest/v1/pg_marketplace_products', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ ...fields, created_by: user.id })
      });
      return send(res, 201, { success: true, product: rows?.[0] });
    }

    if (req.method === 'POST' && action === 'admin-archive-event') {
      const id = clean(body.id, 80);
      if (!id) fail('Evento inválido.');
      const q = new URLSearchParams({ id: `eq.${id}` });
      const rows = await db(`/rest/v1/pg_marketplace_events?${q}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          status: 'ARCHIVED',
          updated_at: new Date().toISOString()
        })
      });
      if (!rows?.length) fail('Evento não encontrado.', 404);
      return send(res, 200, { success: true });
    }

    if (req.method === 'POST' && action === 'admin-archive-product') {
      const id = clean(body.id, 80);
      if (!id) fail('Produto inválido.');
      const q = new URLSearchParams({ id: `eq.${id}` });
      const rows = await db(`/rest/v1/pg_marketplace_products?${q}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          status: 'ARCHIVED',
          updated_at: new Date().toISOString()
        })
      });
      if (!rows?.length) fail('Produto não encontrado.', 404);
      return send(res, 200, { success: true });
    }

    if (req.method === 'POST' && action === 'admin-review-order') {
      const orderId = clean(body.orderId, 80);
      const decision = clean(body.decision, 20).toUpperCase();
      const adminNote = clean(body.adminNote, 1000);
      if (!orderId) fail('Encomenda inválida.');
      if (!['APPROVED', 'REJECTED'].includes(decision)) {
        fail('Decisão inválida.');
      }

      const result = await db('/rest/v1/rpc/pg_marketplace_admin_review_order', {
        method: 'POST',
        body: JSON.stringify({
          p_order_id: orderId,
          p_admin_user_id: user.id,
          p_decision: decision,
          p_admin_note: adminNote || null
        })
      });
      return send(res, 200, result || { success: true });
    }

    return send(res, 400, { error: 'Operação Marketplace desconhecida.' });
  } catch (error) {
    const status = Number(error.status) || 500;
    return send(res, status, {
      error: status === 500
        ? 'Não foi possível concluir a operação. Verifique os dados e tente novamente.'
        : error.message
    });
  }
}
