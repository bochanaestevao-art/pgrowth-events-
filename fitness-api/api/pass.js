import { randomBytes } from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).origin : "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;


const ALLOWED_ORIGINS = new Set([
  'https://pgrowth-events.vercel.app'
]);

function applyCors(req, res) {
  const origin = req.headers.origin || '';

  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function send(res, status, data) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(data);
}

function validEnv() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SERVICE_KEY);
}

async function supabase(path, options = {}, service = true) {
  const key = service ? SERVICE_KEY : SUPABASE_ANON_KEY;

  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${service ? SERVICE_KEY : options.token}`,
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
      data?.message || data?.msg || data?.hint || `Supabase HTTP ${response.status}`
    );
  }

  return data;
}

async function authenticate(req) {
  const authorization = req.headers.authorization || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) throw new Error('Inicie sessão para continuar.');

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${match[1]}`
    }
  });

  if (!response.ok) throw new Error('Sessão inválida ou expirada.');

  const user = await response.json();

  if (!user?.id) throw new Error('Utilizador não autenticado.');

  return user;
}

async function isAdmin(userId) {
  const query = new URLSearchParams({
    select: 'user_id',
    user_id: `eq.${userId}`,
    limit: '1'
  });

  const rows = await supabase(`/rest/v1/fitness_admins?${query}`);

  return Array.isArray(rows) && rows.length > 0;
}

function clean(value, max = 5000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (!validEnv()) {
    return send(res, 500, {
      error: 'Configuração do Supabase incompleta no servidor.'
    });
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (!['GET', 'POST'].includes(req.method)) {
    return send(res, 405, { error: 'Método não permitido.' });
  }

  try {
    const url = new URL(req.url, 'https://localhost');
    const body = req.method === 'POST'
      ? (typeof req.body === 'object' && req.body ? req.body : {})
      : {};

    const action = req.method === 'GET'
      ? url.searchParams.get('action')
      : body.action;

    // A chave pública pode ser entregue ao navegador.
    // A chave SERVICE_KEY nunca é devolvida.
    if (action === 'config' && req.method === 'GET') {
      return send(res, 200, {
        supabaseUrl: SUPABASE_URL,
        supabaseAnonKey: SUPABASE_ANON_KEY
      });
    }

    const user = await authenticate(req);

    if (action === 'plans' && req.method === 'GET') {
      const query = new URLSearchParams({
        select: 'id,code,name,duration_days,price_mzn',
        active: 'eq.true',
        order: 'duration_days.asc'
      });

      const plans = await supabase(`/rest/v1/fitness_pass_plans?${query}`);

      return send(res, 200, { plans });
    }

    if (action === 'status' && req.method === 'GET') {
      const now = new Date().toISOString();

      const passQuery = new URLSearchParams({
        select: 'id,status,valid_from,valid_until,approved_order_id',
        user_id: `eq.${user.id}`,
        status: 'eq.ACTIVE',
        valid_until: `gt.${now}`,
        order: 'valid_until.desc',
        limit: '1'
      });

      const orderQuery = new URLSearchParams({
        select: 'id,order_reference,plan_name,duration_days,requested_amount,payment_status,created_at,approved_at,rejected_at',
        user_id: `eq.${user.id}`,
        order: 'created_at.desc',
        limit: '10'
      });

      const [passes, orders] = await Promise.all([
        supabase(`/rest/v1/fitness_athlete_passes?${passQuery}`),
        supabase(`/rest/v1/fitness_pass_orders?${orderQuery}`)
      ]);

      return send(res, 200, {
        activePass: passes?.[0] || null,
        orders: orders || []
      });
    }

    if (action === 'create-order' && req.method === 'POST') {
      const planCode = clean(body.planCode, 30).toUpperCase();
      const buyerName = clean(body.buyerName, 120);
      const phone = clean(body.phone, 30);
      const paymentMethod = clean(body.paymentMethod, 20).toUpperCase();
      const paymentMessage = clean(body.paymentMessage, 10000);
      const transferCode = clean(body.transferCode, 150);

      if (!['DIARIO', 'SEMANAL', 'QUINZENAL', 'MENSAL'].includes(planCode)) {
        return send(res, 400, { error: 'Pacote inválido.' });
      }

      if (buyerName.length < 3) {
        return send(res, 400, { error: 'Introduza o nome completo.' });
      }

      if (phone.length < 8) {
        return send(res, 400, { error: 'Introduza um número de telefone válido.' });
      }

      if (!['MPESA', 'EMOLA'].includes(paymentMethod)) {
        return send(res, 400, { error: 'Método de pagamento inválido.' });
      }

      if (!paymentMessage && !transferCode) {
        return send(res, 400, {
          error: 'Introduza o SMS de confirmação ou o código da transferência.'
        });
      }

      const planQuery = new URLSearchParams({
        select: 'id,code,name,duration_days,price_mzn',
        code: `eq.${planCode}`,
        active: 'eq.true',
        limit: '1'
      });

      const plans = await supabase(`/rest/v1/fitness_pass_plans?${planQuery}`);
      const plan = plans?.[0];

      if (!plan) {
        return send(res, 400, { error: 'Este pacote não está disponível.' });
      }

      const orderReference =
        `PGF-${Date.now()}-${randomBytes(3).toString('hex').toUpperCase()}`;

      const order = {
        order_reference: orderReference,
        user_id: user.id,
        buyer_name: buyerName,
        phone,
        payment_method: paymentMethod,
        payment_message: paymentMessage || null,
        transfer_code: transferCode || null,
        plan_id: plan.id,
        plan_name: plan.name,
        duration_days: plan.duration_days,
        requested_amount: plan.price_mzn,
        payment_status: 'PENDING'
      };

      const created = await supabase(
        '/rest/v1/fitness_pass_orders',
        {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(order)
        }
      );

      return send(res, 201, {
        success: true,
        message: 'Pedido registado. Aguarde a confirmação do administrador.',
        order: {
          id: created?.[0]?.id,
          reference: orderReference,
          plan: plan.name,
          amount: plan.price_mzn,
          status: 'PENDING'
        }
      });
    }

    if (action === 'admin-orders' && req.method === 'GET') {
      if (!(await isAdmin(user.id))) {
        return send(res, 403, { error: 'Acesso administrativo não autorizado.' });
      }

      const query = new URLSearchParams({
        select: '*',
        payment_status: 'eq.PENDING',
        order: 'created_at.asc',
        limit: '100'
      });

      const orders = await supabase(`/rest/v1/fitness_pass_orders?${query}`);

      return send(res, 200, { orders: orders || [] });
    }

    if (action === 'admin-review' && req.method === 'POST') {
      if (!(await isAdmin(user.id))) {
        return send(res, 403, { error: 'Acesso administrativo não autorizado.' });
      }

      const orderId = clean(body.orderId, 50);
      const decision = clean(body.decision, 20).toUpperCase();
      const adminNote = clean(body.adminNote, 1000);

      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
        return send(res, 400, { error: 'Identificador do pedido inválido.' });
      }

      if (!['APPROVED', 'REJECTED'].includes(decision)) {
        return send(res, 400, { error: 'Decisão inválida.' });
      }

      const result = await supabase(
        '/rest/v1/rpc/fitness_admin_review_pass_order',
        {
          method: 'POST',
          body: JSON.stringify({
            p_order_id: orderId,
            p_admin_user_id: user.id,
            p_decision: decision,
            p_admin_note: adminNote || null
          })
        }
      );

      return send(res, 200, result);
    }

    return send(res, 400, { error: 'Acção desconhecida.' });

  } catch (error) {
    const message = error?.message || 'Erro interno.';
    const status = /sessão|autenticado|expirada/i.test(message) ? 401 : 500;

    return send(res, status, { error: message });
  }
}
