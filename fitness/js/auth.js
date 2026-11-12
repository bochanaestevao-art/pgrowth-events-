const API = '/api/fitness/pass';
const SESSION_KEY = 'pgrowth_fitness_auth_session';

let config = null;
let mode = 'signup';

const form = document.getElementById('accessForm');
const nameField = document.getElementById('nameField');
const nameInput = document.getElementById('fullName');
const phoneInput = document.getElementById('phone');
const passwordInput = document.getElementById('password');
const submitButton = document.getElementById('submitButton');
const modeButton = document.getElementById('modeButton');
const message = document.getElementById('message');

function showMessage(text, error = false) {
  message.textContent = text;
  message.style.color = error ? '#b42318' : '#087f55';
}

function normalizePhone(value) {
  let phone = String(value || '').replace(/[\s().-]/g, '');

  if (phone.startsWith('00258')) {
    phone = phone.slice(2);
  }

  if (phone.startsWith('+258')) {
    phone = phone.slice(4);
  } else if (phone.startsWith('258')) {
    phone = phone.slice(3);
  }

  if (!/^8\d{8}$/.test(phone)) {
    throw new Error(
      'Introduza um número moçambicano válido com 9 dígitos, por exemplo 841234567.'
    );
  }

  return '+258' + phone;
}

function internalEmail(phone) {
  const digits = phone.replace(/\D/g, '');
  return `${digits}@pgrowth-events.vercel.app`;
}

async function loadConfig() {
  if (config) return config;

  const response = await fetch(`${API}?action=config`, {
    cache: 'no-store'
  });

  const data = await response.json();

  if (!response.ok || !data.supabaseUrl || !data.supabaseAnonKey) {
    throw new Error(data.error || 'Não foi possível carregar a configuração.');
  }

  config = {
    url: data.supabaseUrl.replace(/\/$/, ''),
    key: data.supabaseAnonKey
  };

  return config;
}

async function authRequest(path, payload) {
  const settings = await loadConfig();

  const response = await fetch(`${settings.url}/auth/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: settings.key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = data.msg || data.message || data.error_description ||
      data.error || 'Não foi possível autenticar.';

    throw new Error(error);
  }

  return data;
}

function saveSession(session) {
  if (!session?.access_token || !session?.refresh_token) {
    throw new Error(
      'O Supabase não devolveu uma sessão. Confirme se a confirmação de email está desactivada.'
    );
  }

  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function readSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
}

async function refreshSession() {
  const session = readSession();

  if (!session?.refresh_token) {
    throw new Error('A sessão terminou. Entre novamente.');
  }

  const updated = await authRequest('token?grant_type=refresh_token', {
    refresh_token: session.refresh_token
  });

  saveSession(updated);
  return updated;
}

async function getAccessToken() {
  let session = readSession();

  if (!session?.access_token) {
    throw new Error('Inicie sessão para continuar.');
  }

  const expiresAt = Number(session.expires_at || 0);

  if (expiresAt && expiresAt <= Math.floor(Date.now() / 1000) + 60) {
    session = await refreshSession();
  }

  return session.access_token;
}

async function apiRequest(action, payload = {}) {
  const token = await getAccessToken();

  const response = await fetch(API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ action, ...payload })
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    sessionStorage.removeItem(SESSION_KEY);
    throw new Error('A sessão expirou. Entre novamente.');
  }

  if (!response.ok) {
    throw new Error(data.error || 'O pedido não pôde ser concluído.');
  }

  return data;
}

function setMode(nextMode) {
  mode = nextMode;

  const registering = mode === 'signup';

  nameField.hidden = !registering;
  nameInput.required = registering;
  phoneInput.previousElementSibling.textContent = registering
    ? 'Número de telefone'
    : 'Telefone ou email da conta administrativa';
  phoneInput.placeholder = registering ? '+258 84 123 4567' : 'Telefone ou email';
  passwordInput.autocomplete = registering ? 'new-password' : 'current-password';

  submitButton.textContent = registering ? 'CRIAR CONTA' : 'ENTRAR';
  modeButton.textContent = registering
    ? 'JÁ TENHO CONTA — ENTRAR'
    : 'AINDA NÃO TENHO CONTA — REGISTAR';

  showMessage('');
}

modeButton.addEventListener('click', () => {
  setMode(mode === 'signup' ? 'login' : 'signup');
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  submitButton.disabled = true;
  modeButton.disabled = true;
  showMessage('A processar...');

  try {
    const loginValue = phoneInput.value.trim();
    const phone = mode === 'signup'
      ? normalizePhone(loginValue)
      : (loginValue.includes('@') ? '' : normalizePhone(loginValue));
    const password = passwordInput.value;

    if (password.length < 8) {
      throw new Error('A palavra-passe deve ter pelo menos 8 caracteres.');
    }

    const email = mode === 'login' && loginValue.includes('@')
      ? loginValue.toLowerCase()
      : internalEmail(phone);
    let result;

    if (mode === 'signup') {
      const fullName = nameInput.value.trim();

      if (fullName.length < 3) {
        throw new Error('Introduza o nome completo.');
      }

      result = await authRequest('signup', {
        email,
        password,
        data: {
          full_name: fullName,
          phone,
          account_type: 'fitness_athlete'
        }
      });

      if (!result.access_token) {
        throw new Error(
          'A conta foi criada, mas o Supabase não iniciou a sessão. Confirme que a confirmação de email está desactivada.'
        );
      }

      saveSession(result);
      showMessage('Conta criada com sucesso! A abrir o PGrowth Fitness...');
    } else {
      result = await authRequest('token?grant_type=password', {
        email,
        password
      });

      saveSession(result);
      showMessage('Sessão iniciada! A abrir o PGrowth Fitness...');
    }

    window.dispatchEvent(new CustomEvent('pgrowth:auth', {
      detail: { user: result.user }
    }));

    window.location.href = 'index.html';

  } catch (error) {
    showMessage(error.message || 'Ocorreu um erro.', true);
  } finally {
    submitButton.disabled = false;
    modeButton.disabled = false;
  }
});

window.PGrowthAuth = {
  getAccessToken,
  apiRequest,
  readSession,
  logout() {
    sessionStorage.removeItem(SESSION_KEY);
    window.location.href = 'acesso.html';
  }
};

setMode('signup');
