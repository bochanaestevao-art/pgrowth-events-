const FITNESS_API = 'https://pgrowth-events-fitness-api.vercel.app/api/pass';
const FITNESS_SESSION_KEY = 'pgrowth_fitness_auth_session';

function fitnessReadSession() {
  try {
    return JSON.parse(sessionStorage.getItem(FITNESS_SESSION_KEY) || 'null');
  } catch {
    sessionStorage.removeItem(FITNESS_SESSION_KEY);
    return null;
  }
}

async function fitnessAuthRequest(path, payload) {
  const response = await fetch(`${FITNESS_API}?action=config`, {
    cache: 'no-store'
  });
  const config = await response.json();

  if (!response.ok || !config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error(config.error || 'Configuração de acesso indisponível.');
  }

  const result = await fetch(
    `${config.supabaseUrl.replace(/\/$/, '')}/auth/v1/${path}`,
    {
      method: 'POST',
      headers: {
        apikey: config.supabaseAnonKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }
  );

  const data = await result.json().catch(() => ({}));
  if (!result.ok) {
    throw new Error(data.message || data.msg || 'Não foi possível renovar a sessão.');
  }
  return data;
}

async function fitnessToken() {
  let session = fitnessReadSession();

  if (!session?.access_token) {
    throw new Error('Inicie sessão para continuar.');
  }

  if (session.expires_at && session.expires_at <= Math.floor(Date.now() / 1000) + 60) {
    session = await fitnessAuthRequest('token?grant_type=refresh_token', {
      refresh_token: session.refresh_token
    });
    sessionStorage.setItem(FITNESS_SESSION_KEY, JSON.stringify(session));
  }

  return session.access_token;
}

async function fitnessRequest(action, method = 'GET', payload = {}) {
  const token = await fitnessToken();
  const url = method === 'GET'
    ? `${FITNESS_API}?action=${encodeURIComponent(action)}`
    : FITNESS_API;

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {})
    },
    ...(method === 'POST' ? { body: JSON.stringify({ action, ...payload }) } : {})
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    sessionStorage.removeItem(FITNESS_SESSION_KEY);
    throw new Error('A sessão expirou. Entre novamente.');
  }

  if (!response.ok) {
    throw new Error(data.error || 'Não foi possível concluir a operação.');
  }

  return data;
}

function fitnessLogout() {
  sessionStorage.removeItem(FITNESS_SESSION_KEY);
  window.location.href = 'acesso.html';
}

window.PGrowthSession = {
  read: fitnessReadSession,
  token: fitnessToken,
  request: fitnessRequest,
  logout: fitnessLogout
};
