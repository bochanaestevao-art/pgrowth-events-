const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function send(res, status, data) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(data);
}

async function authenticate(req) {
  const match = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
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

async function database(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
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
    throw new Error(data?.message || data?.hint || 'Erro na base de dados.');
  }
  return data;
}

/* PGROWTH_PRIVATE_CHALLENGE_VIDEO_V1 */
const CHALLENGE_BUCKET = 'fitness-challenge-videos';

function challengeError(message, status) {
  return Object.assign(new Error(message), { status });
}

async function hasActiveCompletePass(userId) {
  const now = new Date().toISOString();
  const query = new URLSearchParams({
    select: 'id,status,valid_from,valid_until,approved_order_id',
    user_id: 'eq.' + userId,
    status: 'eq.ACTIVE',
    valid_until: 'gt.' + now,
    order: 'valid_until.desc',
    limit: '1'
  });
  const rows = await database('fitness_passes?' + query.toString());
  return Array.isArray(rows) && rows.length > 0;
}

async function getChallengeCatalog() {
  const rows = await database(
    'fitness_challenge_catalog?active=eq.true&select=id,category,title,description,target,unit,kind,symbol,guide_steps,guide_tip,guide_safety,video_path,sort_order,active&order=sort_order.asc'
  );

  return (Array.isArray(rows) ? rows : []).map(row => {
    const { video_path, ...challenge } = row;
    return { ...challenge, has_video: Boolean(video_path) };
  });
}

async function getChallengeVideoUrl(userId, challengeId) {
  const id = String(challengeId || '');

  if (!/^[a-z0-9-]{2,70}$/.test(id)) {
    throw challengeError('Identificador de desafio inválido.', 400);
  }

  if (!(await hasActiveCompletePass(userId))) {
    throw challengeError(
      'É necessário ter um Passe Completo activo para assistir aos vídeos.',
      403
    );
  }

  const rows = await database(
    'fitness_challenge_catalog?id=eq.' +
    encodeURIComponent(id) +
    '&active=eq.true&select=id,video_path&limit=1'
  );

  const videoPath = rows?.[0]?.video_path;
  if (!videoPath) {
    throw challengeError('Este desafio ainda não tem vídeo.', 404);
  }

  let cleanPath = String(videoPath);
  while (cleanPath.startsWith('/')) cleanPath = cleanPath.slice(1);

  if (!cleanPath || cleanPath.split('/').includes('..')) {
    throw challengeError('Caminho do vídeo inválido.', 400);
  }

  const encodedPath = cleanPath.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(
    SUPABASE_URL + '/storage/v1/object/sign/' +
    CHALLENGE_BUCKET + '/' + encodedPath,
    {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: 'Bearer ' + SERVICE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ expiresIn: 3600 })
    }
  );

  const raw = await response.text();
  let signed = {};
  try { signed = raw ? JSON.parse(raw) : {}; } catch {}

  if (!response.ok) {
    throw challengeError(
      signed.message || signed.error || 'Não foi possível preparar o vídeo.',
      response.status
    );
  }

  const signedURL = signed.signedURL || signed.signedUrl;
  if (!signedURL) {
    throw challengeError('O armazenamento não devolveu o endereço do vídeo.', 502);
  }

  return {
    videoUrl: signedURL.startsWith('http')
      ? signedURL
      : SUPABASE_URL + '/storage/v1' + signedURL,
    expiresIn: 3600
  };
}

export default async function handler(req, res) {
  res.setHeader('Vary', 'Origin');
res.setHeader("Access-Control-Allow-Origin", "https://" + "pgrowth-events.vercel.app");
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!['GET', 'POST'].includes(req.method)) {
    return send(res, 405, { error: 'Método não permitido.' });
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_KEY) {
    return send(res, 500, { error: 'Configuração do servidor incompleta.' });
  }

  try {
    const user = await authenticate(req);

const requestUrl = new URL(req.url, "https://" + "localhost");
    const action = requestUrl.searchParams.get('action');

    if (req.method === 'GET' && action === 'catalog') {
      return send(res, 200, {
        challenges: await getChallengeCatalog()
      });
    }

    if (req.method === 'POST' && req.body?.action === 'video-url') {
      const result = await getChallengeVideoUrl(user.id, req.body.challengeId);
      return send(res, 200, result);
    }

    if (req.method === 'GET') {
      const rows = await database(
        `fitness_athlete_challenge_data?user_id=eq.${encodeURIComponent(user.id)}&select=challenge_data,updated_at&limit=1`
      );

      return send(res, 200, {
        challengeData: rows?.[0]?.challenge_data || {
          version: 1,
          challenges: {}
        },
        updatedAt: rows?.[0]?.updated_at || null
      });
    }

    const body = typeof req.body === 'object' && req.body ? req.body : {};
    const data = body.challengeData;

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return send(res, 400, { error: 'Dados dos desafios inválidos.' });
    }

    if (JSON.stringify(data).length > 200000) {
      return send(res, 413, { error: 'Os dados excedem o limite permitido.' });
    }

    if (data.version !== 1 || !data.challenges ||
        typeof data.challenges !== 'object' ||
        Array.isArray(data.challenges)) {
      return send(res, 400, { error: 'Estrutura dos desafios inválida.' });
    }

    const saved = await database(
      'fitness_athlete_challenge_data?on_conflict=user_id',
      {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({
          user_id: user.id,
          challenge_data: data,
          updated_at: new Date().toISOString()
        })
      }
    );

    return send(res, 200, {
      success: true,
      updatedAt: saved?.[0]?.updated_at || null
    });
  } catch (error) {
    const message = error?.message || 'Erro interno.';
    const status = error.status || (/sessão|autenticado|expirada/i.test(message) ? 401 : 500);
    return send(res, status, { error: message });
  }
}
