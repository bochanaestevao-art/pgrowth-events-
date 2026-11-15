const FITNESS_API = 'https://' + 'pgrowth-events-fitness-api.vercel.app/api/pass';
const FITNESS_SESSION_KEY = 'pgrowth_fitness_auth_session';
const FITNESS_LOCK_KEY = 'pgrowth_fitness_refresh_lock';
let fitnessRefreshPromise = null;

function fitnessReadSession() {
  try {
    let value = localStorage.getItem(FITNESS_SESSION_KEY);

    if (!value) {
      value = sessionStorage.getItem(FITNESS_SESSION_KEY);

      if (value) {
        localStorage.setItem(FITNESS_SESSION_KEY, value);
      }
    }

    return value ? JSON.parse(value) : null;
  } catch {
    try {
      return JSON.parse(sessionStorage.getItem(FITNESS_SESSION_KEY) || 'null');
    } catch {
      return null;
    }
  }
}

function fitnessSaveSession(session) {
  if (!session?.access_token || !session?.refresh_token) {
    throw new Error('O Supabase não devolveu uma sessão válida.');
  }

  const normalized = {
    ...session,
    expires_at: Number(session.expires_at) ||
      Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600)
  };

  const serialized = JSON.stringify(normalized);
  localStorage.setItem(FITNESS_SESSION_KEY, serialized);
  sessionStorage.setItem(FITNESS_SESSION_KEY, serialized);

  return normalized;
}

async function fitnessAuthRequest(path, payload) {
  const response = await fetch(FITNESS_API + '?action=config', {
    cache: 'no-store'
  });

  const config = await response.json().catch(() => ({}));

  if (!response.ok || !config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error(config.error || 'Configuração de acesso indisponível.');
  }

  const result = await fetch(
    config.supabaseUrl.replace(/\/$/, '') + '/auth/v1/' + path,
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
    throw new Error(data.message || data.msg || data.error ||
      'Não foi possível renovar a sessão.');
  }

  return data;
}

function fitnessWait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fitnessWithRefreshLock(callback) {
  if (navigator.locks?.request) {
    return navigator.locks.request(
      'pgrowth-fitness-refresh-token',
      { mode: 'exclusive' },
      callback
    );
  }

  const owner = Date.now().toString(36) +
    Math.random().toString(36).slice(2);

  const started = Date.now();

  while (Date.now() - started < 30000) {
    let current = null;

    try {
      current = JSON.parse(localStorage.getItem(FITNESS_LOCK_KEY) || 'null');
    } catch {}

    if (!current || Number(current.expires) < Date.now()) {
      try {
        localStorage.setItem(FITNESS_LOCK_KEY, JSON.stringify({
          owner,
          expires: Date.now() + 20000
        }));

        await fitnessWait(60 + Math.floor(Math.random() * 100));

        const confirmed = JSON.parse(
          localStorage.getItem(FITNESS_LOCK_KEY) || 'null'
        );

        if (confirmed?.owner === owner) {
          try {
            return await callback();
          } finally {
            const latest = JSON.parse(
              localStorage.getItem(FITNESS_LOCK_KEY) || 'null'
            );

            if (latest?.owner === owner) {
              localStorage.removeItem(FITNESS_LOCK_KEY);
            }
          }
        }
      } catch (error) {
        if (error?.message) throw error;
      }
    }

    await fitnessWait(100 + Math.floor(Math.random() * 100));
  }

  throw new Error('Não foi possível coordenar a renovação da sessão. Tenta novamente.');
}

async function fitnessRefreshToken() {
  if (fitnessRefreshPromise) return fitnessRefreshPromise;

  const initial = fitnessReadSession();

  if (!initial?.refresh_token) {
    throw new Error('A sessão terminou. Entre novamente.');
  }

  fitnessRefreshPromise = fitnessWithRefreshLock(async () => {
    const latest = fitnessReadSession();

    if (!latest?.refresh_token) {
      throw new Error('A sessão terminou. Entre novamente.');
    }

    if (latest.refresh_token !== initial.refresh_token &&
        latest.access_token) {
      return latest.access_token;
    }

    try {
      const updated = await fitnessAuthRequest(
        'token?grant_type=refresh_token',
        { refresh_token: latest.refresh_token }
      );

      return fitnessSaveSession(updated).access_token;
    } catch (error) {
      const recovered = fitnessReadSession();

      if (recovered?.access_token &&
          recovered.refresh_token &&
          recovered.refresh_token !== latest.refresh_token) {
        return recovered.access_token;
      }

      throw error;
    }
  });

  try {
    return await fitnessRefreshPromise;
  } finally {
    fitnessRefreshPromise = null;
  }
}

async function fitnessToken(forceRefresh = false) {
  const session = fitnessReadSession();

  if (!session?.access_token) {
    throw new Error('Inicie sessão para continuar.');
  }

  const expiresAt = Number(session.expires_at || 0);

  if (forceRefresh || !expiresAt ||
      expiresAt <= Math.floor(Date.now() / 1000) + 60) {
    return fitnessRefreshToken();
  }

  return session.access_token;
}

async function fitnessRequest(action, method = 'GET', payload = {}) {
  let token = await fitnessToken();

  const url = method === 'GET'
    ? FITNESS_API + '?action=' + encodeURIComponent(action)
    : FITNESS_API;

  const sendRequest = () => fetch(url, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {})
    },
    ...(method === 'POST'
      ? { body: JSON.stringify({ action, ...payload }) }
      : {})
  });

  let response = await sendRequest();

  if (response.status === 401) {
    token = await fitnessRefreshToken();
    response = await sendRequest();
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Não foi possível concluir a operação.');
  }

  return data;
}

async function fitnessSyncActivities(activities) {
  let token = await fitnessToken();

  const endpoint = FITNESS_API.replace(
    /\/api\/pass(?:\?.*)?$/,
    '/api/activities'
  );

  const sendRequest = () => fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ activities })
  });

  let response = await sendRequest();

  if (response.status === 401) {
    token = await fitnessRefreshToken();
    response = await sendRequest();
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Não foi possível sincronizar as corridas.');
  }

  return data;
}

async function fitnessLogout() {
  const session = fitnessReadSession();

  try {
    if (session?.access_token) {
      const response = await fetch(FITNESS_API + '?action=config', {
        cache: 'no-store'
      });

      const config = await response.json().catch(() => ({}));

      if (response.ok && config.supabaseUrl && config.supabaseAnonKey) {
        await fetch(
          config.supabaseUrl.replace(/\/$/, '') + '/auth/v1/logout?scope=local',
          {
            method: 'POST',
            headers: {
              apikey: config.supabaseAnonKey,
              Authorization: 'Bearer ' + session.access_token
            }
          }
        );
      }
    }
  } catch {
    console.warn('Não foi possível confirmar o encerramento remoto da sessão.');
  } finally {
    localStorage.removeItem(FITNESS_SESSION_KEY);
    sessionStorage.removeItem(FITNESS_SESSION_KEY);
    window.location.href = 'acesso.html';
  }
}

window.PGrowthSession = {
  read: fitnessReadSession,
  save: fitnessSaveSession,
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
