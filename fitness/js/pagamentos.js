const $ = (id) => document.getElementById(id);

const planSelect = $('plan');
const plansBox = $('plans');
const messageBox = $('message');

const PAYMENT_CONTACTS = Object.freeze({
  MPESA: {
    label: 'M-Pesa',
    number: '844259502',
    formatted: '844 259 502'
  },
  EMOLA: {
    label: 'e-Mola',
    number: '862298940',
    formatted: '862 298 940'
  }
});

let availablePlans = [];

function money(value) {
  return `${Number(value).toLocaleString('pt-MZ')} MT`;
}

function message(text, error = false) {
  messageBox.textContent = text;
  messageBox.style.color = error ? '#ff7777' : '#70e3aa';
}

function requireSession() {
  if (!window.PGrowthSession?.read()?.access_token) {
    window.location.href = 'acesso.html';
    return false;
  }
  return true;
}

function updatePaymentInfo() {
  const method = $('method').value;
  const contact = PAYMENT_CONTACTS[method];

  if (!contact) return;

  $('contactTitle').textContent = `Pagar através de ${contact.label}`;
  $('methodTag').textContent = method === 'MPESA' ? 'M-PESA' : 'E-MOLA';
  $('paymentContact').textContent = contact.formatted;

  const selectedPlan = availablePlans.find(
    (plan) => plan.code === planSelect.value
  );

  $('selectedAmount').textContent = selectedPlan
    ? money(selectedPlan.price_mzn)
    : 'Seleccionar pacote';
}

async function copyContact() {
  const contact = PAYMENT_CONTACTS[$('method').value];
  if (!contact) return;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(contact.number);
    } else {
      const temporary = document.createElement('textarea');
      temporary.value = contact.number;
      temporary.style.position = 'fixed';
      temporary.style.opacity = '0';
      document.body.appendChild(temporary);
      temporary.select();

      if (!document.execCommand('copy')) {
        throw new Error('Não foi possível copiar automaticamente.');
      }

      temporary.remove();
    }

    $('copyContact').textContent = 'NÚMERO COPIADO ✓';
    message(`Contacto ${contact.label} copiado: ${contact.formatted}`);

    setTimeout(() => {
      $('copyContact').textContent = 'COPIAR NÚMERO';
    }, 2200);
  } catch (error) {
    message(`Copia manualmente este contacto: ${contact.formatted}`, true);
  }
}

function renderPlans(plans) {
  availablePlans = plans;
  plansBox.replaceChildren();
  planSelect.innerHTML = '<option value="">Seleccionar pacote</option>';

  for (const plan of plans) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'plan';
    card.dataset.code = plan.code;

    const name = document.createElement('strong');
    name.textContent = plan.name;

    const price = document.createElement('b');
    price.textContent = money(plan.price_mzn);

    const duration = document.createElement('small');
    duration.textContent = `${plan.duration_days} dias de acesso`;

    card.append(name, price, duration);

    card.addEventListener('click', () => {
      planSelect.value = plan.code;
      updatePaymentInfo();
      updateSelectedCard();
      $('orderForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    plansBox.appendChild(card);

    const option = document.createElement('option');
    option.value = plan.code;
    option.textContent = `${plan.name} — ${money(plan.price_mzn)}`;
    planSelect.appendChild(option);
  }

  updatePaymentInfo();
  updateSelectedCard();
}

function updateSelectedCard() {
  for (const card of plansBox.querySelectorAll('.plan')) {
    card.classList.toggle(
      'selected',
      card.dataset.code === planSelect.value
    );
  }
}

function renderStatus(pass) {
  const box = $('passStatus');

  if (!pass) {
    box.textContent =
      'Ainda não tens um Passe activo. Escolhe um pacote, efectua o pagamento e aguarda a confirmação administrativa.';
    return;
  }

  box.textContent =
    `PASSE ACTIVO · Válido até ${new Date(pass.valid_until).toLocaleString('pt-MZ')}`;
}

function statusLabel(status) {
  const labels = {
    PENDING: 'PENDENTE DE CONFIRMAÇÃO',
    APPROVED: 'PAGAMENTO APROVADO',
    REJECTED: 'PEDIDO REJEITADO'
  };

  return labels[status] || status || 'EM ANÁLISE';
}

function renderOrders(orders) {
  const box = $('orders');
  box.replaceChildren();

  if (!orders.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Ainda não existem pedidos registados.';
    box.appendChild(empty);
    return;
  }

  for (const order of orders) {
    const item = document.createElement('div');
    item.className = 'order';

    const title = document.createElement('strong');
    title.textContent =
      `${order.plan_name || 'Passe'} · ${money(order.requested_amount)}`;

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = statusLabel(order.payment_status);

    const details = document.createElement('div');
    details.className = 'muted';
    details.textContent =
      `${order.order_reference} · ${new Date(order.created_at).toLocaleString('pt-MZ')}`;

    item.append(title, badge, details);
    box.appendChild(item);
  }
}

async function loadPage() {
  const [plansData, statusData] = await Promise.all([
    window.PGrowthSession.request('plans'),
    window.PGrowthSession.request('status')
  ]);

  renderPlans(plansData.plans || []);
  renderStatus(statusData.activePass);
  renderOrders(statusData.orders || []);
}

$('method').addEventListener('change', updatePaymentInfo);
$('plan').addEventListener('change', () => {
  updatePaymentInfo();
  updateSelectedCard();
});
$('copyContact').addEventListener('click', copyContact);

$('orderForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  const selectedPlan = availablePlans.find(
    (plan) => plan.code === planSelect.value
  );

  if (!selectedPlan) {
    message('Selecciona primeiro um pacote válido.', true);
    planSelect.focus();
    return;
  }

  const transferCode = $('transferCode').value.trim();
  const paymentMessage = $('paymentMessage').value.trim();

  if (!transferCode && !paymentMessage) {
    message('Cola o SMS completo de confirmação ou o código da transferência.', true);
    $('paymentMessage').focus();
    return;
  }

  const button = $('submitOrder');
  button.disabled = true;
  button.textContent = 'A ENVIAR PEDIDO...';
  message('A registar o pedido de pagamento...');

  try {
    const result = await window.PGrowthSession.request(
      'create-order',
      'POST',
      {
        planCode: selectedPlan.code,
        buyerName: $('buyerName').value.trim(),
        phone: $('phone').value.trim(),
        paymentMethod: $('method').value,
        transferCode,
        paymentMessage
      }
    );

    message(
      `${result.message || 'Pedido registado com sucesso.'}\n` +
      `Referência: ${result.order?.reference || 'Consultar histórico'}\n` +
      'Estado: PENDENTE DE CONFIRMAÇÃO.\n' +
      'O Passe só será activado depois da aprovação administrativa.'
    );

    $('orderForm').reset();
    updatePaymentInfo();
    updateSelectedCard();
    await loadPage();
  } catch (error) {
    message(error.message || 'Não foi possível registar o pedido.', true);
  } finally {
    button.disabled = false;
    button.textContent = 'ENVIAR COMPROVATIVO PARA APROVAÇÃO';
  }
});

$('logout').addEventListener('click', () => {
  window.PGrowthSession.logout();
});

$('adminEntry').addEventListener('click', () => {
  window.location.href = 'admin-passes.html';
});

if (requireSession()) {
  updatePaymentInfo();
  loadPage().catch((error) => {
    message(error.message || 'Erro ao carregar os dados da conta.', true);
  });
}
