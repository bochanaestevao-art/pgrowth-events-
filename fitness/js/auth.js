const API = "https://" + "pgrowth-events-fitness-api.vercel.app/api/pass";
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
  return window.PGrowthSession.save(session);
}

function readSession() {
  return window.PGrowthSession.read();
}

async function refreshSession() {
  await window.PGrowthSession.refresh();
  return readSession();
}

async function getAccessToken() {
  return window.PGrowthSession.token();
}

async function apiRequest(action, payload = {}) {
  let token = await getAccessToken();

  const sendRequest = () => fetch(API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ action, ...payload })
  });

  let response = await sendRequest();

  if (response.status === 401) {
    const updated = await refreshSession();
    token = updated.access_token;
    response = await sendRequest();
  }

  const data = await response.json().catch(() => ({}));

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

    const requestedNext = new URLSearchParams(window.location.search).get('next');
  window.location.href = requestedNext === 'admin.html' ? 'admin.html' : requestedNext === 'treinadores.html' ? 'treinadores.html' : 'index.html';

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
  logout() { window.PGrowthSession.logout(); }
};

setMode('signup');
