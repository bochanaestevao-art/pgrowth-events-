(() => {
  'use strict';

  const API = 'https://pgrowth-events-fitness-api.vercel.app/api/admin';
  const $ = id => document.getElementById(id);
  const state = { items: [], selected: null, busy: false, started: false };
  if (!$('challengeAdminPanel')) return;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])
  );

  async function token() {
    const session = window.PGrowthSession;
    if (!session || typeof session.token !== 'function') {
      throw new Error('A sessão PGrowth expirou. Entra novamente.');
    }
    const value = await session.token();
    if (!value) throw new Error('A sessão PGrowth expirou. Entra novamente.');
    return value;
  }

  async function request(action, method = 'GET', payload = {}) {
    const url = new URL(API);
    const options = {
      method,
      headers: {
        Authorization: `Bearer ${await token()}`,
        'Content-Type': 'application/json'
      }
    };

    if (method === 'GET') url.searchParams.set('action', action);
    else options.body = JSON.stringify({ ...payload, action });

    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.message || `Erro ${response.status}`);
    return data;
  }

  function notice(text, type = '') {
    const node = $('challengeAdminMessage');
    node.textContent = text;
    node.className = `notice ${type}`;
    node.hidden = false;
  }

  function render() {
    $('challengeAdminCount').textContent = `${state.items.length} desafios`;

    $('challengeAdminList').innerHTML = state.items.length
      ? state.items.map(item => `
        <button type="button"
          class="challenge-admin-item ${state.selected?.id === item.id ? 'selected' : ''}"
          data-id="${esc(item.id)}">
          <span>
            <strong>${esc(item.title)}</strong>
            <small>${esc(item.category)} · ${esc(item.id)}</small>
          </span>
          <span class="challenge-admin-status ${item.active ? 'is-active' : ''}">
            ${item.active ? 'ACTIVO' : 'ARQUIVADO'}
          </span>
        </button>`).join('')
      : '<div class="empty">Ainda não existem desafios no catálogo.</div>';
  }

  function clearForm() {
    state.selected = null;
    $('challengeForm').reset();
    $('challengeId').readOnly = false;
    $('challengeTarget').value = '1';
    $('challengeKind').value = 'manual';
    $('challengeSort').value = '0';
    $('challengeActive').checked = true;
    $('challengeVideoStatus').textContent = 'Nenhum vídeo associado.';
    $('challengeArchive').hidden = true;
    $('challengeRemoveVideo').hidden = true;
    $('challengeSave').textContent = 'GUARDAR DESAFIO';
    render();
  }

  function select(item) {
    state.selected = item;

    $('challengeId').value = item.id || '';
    $('challengeId').readOnly = true;
    $('challengeCategory').value = item.category || 'corrida';
    $('challengeTitle').value = item.title || '';
    $('challengeDescription').value = item.description || '';
    $('challengeTarget').value = item.target ?? 1;
    $('challengeUnit').value = item.unit || '';
    $('challengeKind').value = item.kind || 'manual';
    $('challengeSymbol').value = item.symbol || '';
    $('challengeSort').value = item.sort_order ?? 0;
    const guide = window.PGrowthChallengeGuideData?.[item.id] || [];
    const savedSteps = Array.isArray(item.guide_steps) ? item.guide_steps : [];
    $('challengeSteps').value = (savedSteps.length ? savedSteps : (guide[2] || [])).join('\n');
    $('challengeTip').value = item.guide_tip || guide[3] || '';
    $('challengeSafety').value = item.guide_safety || guide[4] || '';
    $('challengeActive').checked = item.active !== false;
    $('challengeVideoStatus').textContent = item.video_path
      ? `Vídeo associado: ${item.video_path}`
      : 'Nenhum vídeo associado.';
    $('challengeVideo').value = '';
    $('challengeArchive').hidden = false;
    $('challengeRemoveVideo').hidden = !item.video_path;
    $('challengeSave').textContent = 'GUARDAR ALTERAÇÕES';

    render();
  }

  async function load() {
    $('challengeAdminList').innerHTML =
      '<div class="loading">A carregar desafios...</div>';

    const data = await request('challenge-list');
    state.items = Array.isArray(data.challenges) ? data.challenges : [];
    render();

    if (state.selected) {
      const current = state.items.find(item => item.id === state.selected.id);
      if (current) select(current);
      else clearForm();
    }
  }

  function recordFromForm() {
    return {
      id: $('challengeId').value.trim().toLowerCase(),
      category: $('challengeCategory').value,
      title: $('challengeTitle').value.trim(),
      description: $('challengeDescription').value.trim(),
      target: Number($('challengeTarget').value),
      unit: $('challengeUnit').value.trim(),
      kind: $('challengeKind').value.trim(),
      symbol: $('challengeSymbol').value.trim(),
      sort_order: Number($('challengeSort').value || 0),
      guide_steps: $('challengeSteps').value
        .split('\n').map(x => x.trim()).filter(Boolean),
      guide_tip: $('challengeTip').value.trim(),
      guide_safety: $('challengeSafety').value.trim(),
      video_path: state.selected?.video_path || null,
      active: $('challengeActive').checked
    };
  }

  async function uploadVideo(record) {
    const file = $('challengeVideo').files?.[0];
    if (!file) return record.video_path;

    if (file.type !== 'video/mp4' &&
        !file.name.toLowerCase().endsWith('.mp4')) {
      throw new Error('Selecciona um ficheiro MP4.');
    }

    if (file.size > 524288000) {
      throw new Error('O vídeo ultrapassa o limite de 500 MB.');
    }

    notice('A preparar o carregamento seguro do vídeo...');

    const signed = await request(
      'challenge-video-upload-url',
      'POST',
      { id: record.id }
    );

    const response = await fetch(signed.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'x-upsert': 'true'
      },
      body: file
    });

    if (!response.ok) {
      throw new Error(
        (await response.text().catch(() => '')) ||
        'O carregamento do vídeo falhou.'
      );
    }

    return signed.path;
  }

  $('challengeAdminList').addEventListener('click', event => {
    const button = event.target.closest('[data-id]');
    if (!button) return;

    const item = state.items.find(row => row.id === button.dataset.id);
    if (item) select(item);
  });

  $('challengeNew').addEventListener('click', clearForm);

  $('challengeRefresh').addEventListener('click', () => {
    load().catch(error => notice(error.message, 'error'));
  });

  $('challengeForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (state.busy) return;

    state.busy = true;
    $('challengeSave').disabled = true;

    try {
      const record = recordFromForm();

      if (!/^[a-z0-9-]{2,70}$/.test(record.id) ||
          !record.title || !record.unit ||
          !Number.isFinite(record.target) || record.target <= 0) {
        throw new Error('Preenche o ID, título, unidade e uma meta válida.');
      }

      record.video_path = await uploadVideo(record);
      await request('challenge-save', 'POST', record);

      $('challengeVideo').value = '';
      notice('Desafio guardado com sucesso.', 'good');

      await load();

      const saved = state.items.find(item => item.id === record.id);
      if (saved) select(saved);

    } catch (error) {
      notice(error.message, 'error');
    } finally {
      state.busy = false;
      $('challengeSave').disabled = false;
    }
  });

  $('challengeArchive').addEventListener('click', async () => {
    if (!state.selected ||
        !confirm('Arquivar este desafio? O progresso dos atletas será preservado.')) return;

    try {
      await request('challenge-archive', 'POST', {
        id: state.selected.id
      });

      notice('Desafio arquivado. O progresso dos atletas foi preservado.', 'good');
      await load();
      clearForm();

    } catch (error) {
      notice(error.message, 'error');
    }
  });

  $('challengeRemoveVideo').addEventListener('click', async () => {
    if (!state.selected ||
        !confirm('Remover definitivamente o vídeo deste desafio?')) return;

    try {
      await request('challenge-video-remove', 'POST', {
        id: state.selected.id
      });

      notice('Vídeo removido do armazenamento privado.', 'good');
      await load();

    } catch (error) {
      notice(error.message, 'error');
    }
  });

  window.PGrowthAdminChallenges = {
    start() {
      if (state.started) return;
      state.started = true;
      load().catch(error =>
        notice(`Não foi possível carregar o catálogo: ${error.message}`, 'error')
      );
    }
  };
})();