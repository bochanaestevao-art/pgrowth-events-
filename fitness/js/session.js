const FITNESS_API = "https://" + "pgrowth-events-fitness-api.vercel.app/api/pass";
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

async function fitnessRefreshToken() {
  const session = fitnessReadSession();

  if (!session?.refresh_token) {
    throw new Error('A sessão terminou. Entre novamente.');
  }

  const updated = await fitnessAuthRequest('token?grant_type=refresh_token', {
    refresh_token: session.refresh_token
  });

  if (!updated?.access_token || !updated?.refresh_token) {
    throw new Error('Não foi possível renovar a sessão.');
  }

  sessionStorage.setItem(FITNESS_SESSION_KEY, JSON.stringify(updated));
  return updated.access_token;
}

async function fitnessToken(forceRefresh = false) {
  const session = fitnessReadSession();

  if (!session?.access_token) {
    throw new Error('Inicie sessão para continuar.');
  }

  const expiresAt = Number(session.expires_at || 0);

  if (forceRefresh || (expiresAt && expiresAt <= Math.floor(Date.now() / 1000) + 60)) {
    return await fitnessRefreshToken();
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


async function fitnessSyncActivities(activities) {
  const token = await fitnessToken();
  const endpoint = FITNESS_API.replace(/\/api\/pass(?:\?.*)?$/, "/api/activities");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ activities })
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    sessionStorage.removeItem(FITNESS_SESSION_KEY);
    throw new Error("A sessão expirou. Entre novamente.");
  }

  if (!response.ok) {
    throw new Error(data.error || "Não foi possível sincronizar as corridas.");
  }

  return data;
}

async function fitnessLogout() {
  const session = fitnessReadSession();

  try {
    if (session?.access_token) {
      const response = await fetch(`${FITNESS_API}?action=config`, {
        cache: 'no-store'
      });
      const config = await response.json();

      if (response.ok && config.supabaseUrl && config.supabaseAnonKey) {
        await fetch(
          `${config.supabaseUrl.replace(/\/$/, '')}/auth/v1/logout?scope=local`,
          {
            method: 'POST',
            headers: {
              apikey: config.supabaseAnonKey,
              Authorization: `Bearer ${session.access_token}`
            }
          }
        );
      }
    }
  } catch (error) {
    console.warn('Não foi possível confirmar o encerramento remoto da sessão.');
  } finally {
    sessionStorage.removeItem(FITNESS_SESSION_KEY);
    window.location.href = 'acesso.html';
  }
}

window.PGrowthSession = {
  read: fitnessReadSession,
  token: fitnessToken,
  refresh: fitnessRefreshToken,
  request: fitnessRequest,
  syncActivities: fitnessSyncActivities,
  logout: fitnessLogout
};


const fitnessLogoutButton = document.getElementById('fitness-logout');

if (fitnessLogoutButton) {
  fitnessLogoutButton.addEventListener('click', async () => {
    if (!window.confirm('Tens a certeza de que pretendes terminar a sessão?')) {
      return;
    }

    fitnessLogoutButton.disabled = true;
    fitnessLogoutButton.textContent = 'A TERMINAR...';
    await fitnessLogout();
  });
}
