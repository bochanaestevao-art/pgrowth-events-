const ordersBox = document.getElementById('orders');
const messageBox = document.getElementById('message');

function showMessage(text, error = false) {
  messageBox.textContent = text;
  messageBox.style.color = error ? '#b42318' : '#087f55';
}

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

async function loadOrders() {
  ordersBox.replaceChildren();
  showMessage('A verificar permissões e a carregar pedidos...');

  try {
    const result = await window.PGrowthSession.request('admin-orders');
    const orders = result.orders || [];

    showMessage(`${orders.length} pedido(s) pendente(s).`);

    if (!orders.length) {
      ordersBox.appendChild(node('p', 'Não existem pedidos pendentes.'));
      return;
    }

    for (const order of orders) {
      const card = node('section', undefined, 'order');
      const heading = node('h3', `${order.plan_name || 'Passe'} · ${Number(order.requested_amount).toLocaleString('pt-MZ')} MT`);
      const info = node('p',
        `Referência: ${order.order_reference}\nEstado: ${order.payment_status}\nPacote: ${order.duration_days} dias\nComprador: ${order.buyer_name}\nTelefone: ${order.phone}\nMétodo: ${order.payment_method}\nData: ${new Date(order.created_at).toLocaleString('pt-MZ')}`,
        'muted'
      );
      const evidence = node('div');
      evidence.appendChild(node('strong', 'Comprovativo / código'));
      evidence.appendChild(node('pre',
        [order.transfer_code ? `Código: ${order.transfer_code}` : '',
         order.payment_message ? `SMS: ${order.payment_message}` : ''].filter(Boolean).join('\n') || 'Sem comprovativo textual.'
      ));

      const noteLabel = node('label', 'Nota administrativa (opcional)');
      const note = node('input');
      note.maxLength = 1000;
      note.placeholder = 'Observação privada do administrador';

      const actions = node('div', undefined, 'actions');
      const approve = node('button', 'APROVAR E ACTIVAR PASSE');
      const reject = node('button', 'REJEITAR', 'reject');

      async function review(decision, button) {
        if (!confirm(
          decision === 'APPROVED'
            ? 'Confirmas o pagamento e a activação do Passe?'
            : 'Confirmas a rejeição deste pedido?'
        )) return;

        approve.disabled = true;
        reject.disabled = true;

        try {
          await window.PGrowthSession.request('admin-review', 'POST', {
            orderId: order.id,
            decision,
            adminNote: note.value.trim()
          });
          showMessage(decision === 'APPROVED'
            ? 'Pagamento aprovado. Passe activado.'
            : 'Pedido rejeitado.');
          await loadOrders();
        } catch (error) {
          showMessage(error.message, true);
          approve.disabled = false;
          reject.disabled = false;
        }
      }

      approve.addEventListener('click', () => review('APPROVED', approve));
      reject.addEventListener('click', () => review('REJECTED', reject));

      card.append(heading, info, evidence, noteLabel, note, actions);
      actions.append(approve, reject);
      ordersBox.appendChild(card);
    }
  } catch (error) {
    showMessage(error.message, true);

    if (/inicie sessão|sessão expirou/i.test(error.message)) {
      setTimeout(() => { window.location.href = 'acesso.html'; }, 1200);
    }
  }
}

document.getElementById('refresh').addEventListener('click', loadOrders);
document.getElementById('logout').addEventListener('click', () => window.PGrowthSession.logout());

if (!window.PGrowthSession?.read()?.access_token) {
  window.location.href = 'acesso.html';
} else {
  loadOrders();
}
