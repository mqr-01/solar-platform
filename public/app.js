(function () {
  'use strict';

  const API_BASE = '/api';
  const API_TIMEOUT_MS = 90000;
  const METHODOLOGY_TEXT = 'Metodologia: pvlib ModelChain completo com dados PVGIS-SARAH2. Orientação conforme informado (padrão: inclinação da latitude, azimute sul). Perdas: temperatura (SAPM), inversor (modelo CEC), cabos DC/AC 3%, sistema 6% DC — total ~8,8% + sombra opcional. Dimensionamento alvo em geração líquida com margem de cobertura 15%. Economia = geração × tarifa × %autoconsumo. HSP pode ser ajustado ao Atlas CRESESB por cidade (opcional). Nenhum dado de simulação é armazenado — cada cálculo é independente.';

  const BATTERY_NAMES = {
    chumbo_acido: 'Chumbo-ácido',
    gel: 'Gel (AGM)',
    litio_lifepo4: 'LiFePO₄ (Lítio)'
  };

  const CHART_THEME = {
    legend: { labels: { color: '#8B9CB1', font: { size: 12 } }, position: 'top' },
    tooltip: { backgroundColor: '#16273A', titleColor: '#F0F4F8', bodyColor: '#F0F4F8', borderColor: '#2A425B', borderWidth: 1, padding: 12 },
    xGrid: { grid: { color: 'rgba(139, 156, 177, 0.1)' }, ticks: { color: '#8B9CB1', font: { size: 11 } } },
    yGrid: { grid: { color: 'rgba(139, 156, 177, 0.1)' }, ticks: { color: '#8B9CB1', font: { size: 11 } }, beginAtZero: true }
  };

  let currentSystem = null;
  let lastResult = null;
  let ongridChart = null;
  let offgridChart = null;
  let toastTimer = null;

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  function showLoading(text = 'Calculando...') {
    const overlay = $('#loadingOverlay');
    $('.loading-text', overlay).textContent = text;
    overlay.classList.add('active');
  }
  function hideLoading() {
    $('#loadingOverlay').classList.remove('active');
  }

  function showToast(message, type = 'info') {
    const el = $('#toast');
    el.textContent = message;
    el.className = 'toast' + (type === 'info' ? '' : ' ' + type);
    el.classList.add('active');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('active'), 4500);
  }

  function showStage(stageId) {
    $$('.stage').forEach(s => s.classList.remove('active'));
    $(`#${stageId}`)?.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showFormError(summaryId, formSelector, message, focusSelector) {
    const summary = $(`#${summaryId}`);
    if (summary) {
      summary.textContent = message;
      summary.classList.remove('hidden');
    }
    if (focusSelector) {
      const target = $(focusSelector);
      if (target) target.focus();
    }
  }

  function clearFormError(summaryId) {
    const summary = $(`#${summaryId}`);
    if (summary) {
      summary.textContent = '';
      summary.classList.add('hidden');
    }
  }

  function formatNumber(num, decimals = 0) {
    return Number(num).toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  function renderResultCards(containerId, cards) {
    const container = $(`#${containerId}`);
    container.textContent = '';
    const frag = document.createDocumentFragment();
    for (const card of cards) {
      const el = document.createElement('div');
      el.className = 'result-card';
      const icon = document.createElement('div');
      icon.className = 'result-icon';
      icon.textContent = card.icon || '';
      const label = document.createElement('div');
      label.className = 'result-label';
      label.textContent = card.label;
      const value = document.createElement('div');
      value.className = 'result-value';
      value.textContent = card.value;
      el.append(icon, label, value);
      frag.appendChild(el);
    }
    container.appendChild(frag);
  }

  function renderDetalhes(containerId, items, avisos = []) {
    const container = $(`#${containerId}`);
    if (!container) return;
    container.textContent = '';
    const card = document.createElement('div');
    card.className = 'card';
    card.style.marginTop = '24px';

    const h4 = document.createElement('h4');
    h4.textContent = 'Detalhes Técnicos';
    h4.style.cssText = 'margin-bottom: 4px; color: var(--text-muted); font-size: 0.95rem; text-transform: uppercase; letter-spacing: 0.5px;';
    card.appendChild(h4);

    const grid = document.createElement('div');
    grid.className = 'detalhes-grid';
    for (const item of items) {
      const it = document.createElement('div');
      it.className = 'detalhe-item';
      const l = document.createElement('div');
      l.className = 'detalhe-label';
      l.textContent = item.label;
      const v = document.createElement('div');
      v.className = 'detalhe-value';
      v.textContent = item.value;
      it.append(l, v);
      grid.appendChild(it);
    }
    card.appendChild(grid);

    if (avisos.length) {
      const warn = document.createElement('p');
      warn.className = 'aviso';
      warn.textContent = avisos.map(a => '⚠️ ' + a).join('\n');
      warn.style.whiteSpace = 'pre-line';
      card.appendChild(warn);
    }
    container.appendChild(card);
  }

  function chartOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: CHART_THEME.legend, tooltip: CHART_THEME.tooltip },
      scales: { x: CHART_THEME.xGrid, y: CHART_THEME.yGrid }
    };
  }

  function drawOngridChart(hourlyGen, hourlyCons) {
    const ctx = $('#ongrid-chart');
    if (!ctx) return;
    const gen = Array.isArray(hourlyGen) ? hourlyGen : [];
    const cons = Array.isArray(hourlyCons) ? hourlyCons : [];
    const labels = Array.from({ length: Math.max(gen.length, cons.length) }, (_, i) => `H${i + 1}`);
    if (ongridChart) ongridChart.destroy();
    ongridChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Geração (kWh)',
            data: gen,
            borderColor: '#F5A623',
            backgroundColor: 'rgba(245, 166, 35, 0.15)',
            tension: 0.3,
            fill: true,
            pointRadius: 3,
            pointHoverRadius: 5
          },
          {
            label: 'Consumo Estimado (kWh)',
            data: cons,
            borderColor: '#4A90E2',
            backgroundColor: 'rgba(74, 144, 226, 0.1)',
            tension: 0.3,
            borderDash: [6, 4],
            fill: false,
            pointRadius: 3,
            pointHoverRadius: 5
          }
        ]
      },
      options: chartOptions()
    });
  }

  function drawOffgridChart(curvaCarga) {
    const ctx = $('#offgrid-chart');
    if (!ctx) return;
    const items = Array.isArray(curvaCarga) ? curvaCarga : [];
    if (offgridChart) offgridChart.destroy();
    offgridChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: items.map(i => i.nome),
        datasets: [{
          label: 'Consumo diário (Wh)',
          data: items.map(i => i.wh_dia),
          backgroundColor: 'rgba(245, 166, 35, 0.65)',
          borderColor: '#F5A623',
          borderWidth: 1.5,
          borderRadius: 4
        }]
      },
      options: chartOptions()
    });
  }

  function setButtonLoading(btn, loading) {
    const text = $('.btn-text', btn);
    const load = $('.btn-loading', btn);
    btn.disabled = loading;
    text?.classList.toggle('hidden', loading);
    load?.classList.toggle('hidden', !loading);
  }

  function createEquipmentRow() {
    const row = document.createElement('div');
    row.className = 'equipment-row';
    row.innerHTML = `
      <input type="text" class="input eq-nome" placeholder="Nome" required aria-label="Nome do equipamento">
      <input type="number" class="input eq-potencia" placeholder="Potência (W)" min="1" step="1" required aria-label="Potência em Watts">
      <input type="number" class="input eq-horas" placeholder="Horas/dia" min="0.1" max="24" step="0.1" required aria-label="Horas de uso por dia">
      <div class="eq-field">
        <span class="eq-label">QUANTIDADE</span>
        <input type="number" class="input eq-quantidade" value="1" min="1" step="1" required aria-label="Quantidade">
      </div>
      <div class="eq-field">
        <span class="eq-label">Tensão</span>
        <select class="input eq-tensao" aria-label="Tensão e tipo do equipamento">
          <option value="ac_220" selected>AC 220V</option>
          <option value="ac_127">AC 127V</option>
          <option value="ac_380">AC 380V</option>
          <option value="dc_48">DC 48V</option>
          <option value="dc_24">DC 24V</option>
          <option value="dc_12">DC 12V</option>
        </select>
      </div>
      <label class="indutiva-check" title="Motor/compressor: puxa 3x na partida"><input type="checkbox" class="eq-indutiva" aria-label="Carga indutiva"><span>Motor</span></label>
      <button type="button" class="btn btn-secondary btn-remove" aria-label="Remover equipamento">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>`;
    row.querySelector('.btn-remove').addEventListener('click', () => row.remove());
    return row;
  }

  function addEquipmentRow() {
    $('#equipamentos-table').appendChild(createEquipmentRow());
  }

  async function apiPost(endpoint, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        throw new Error('O cálculo demorou mais que o esperado. Tente novamente.');
      }
      throw new Error('Falha de conexão com o servidor. Verifique sua internet.');
    }
    clearTimeout(timer);

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`Resposta inválida do servidor (HTTP ${res.status}).`);
    }
    if (!res.ok) throw new Error((data && data.error) || `Erro ${res.status}`);
    return data;
  }

  function fillCresesbSelect(selectEl) {
    if (!selectEl || !window.CRESESB_HSP) return;
    const ufs = Object.keys(window.CRESESB_HSP).sort((a, b) =>
      window.CRESESB_HSP[a].capital.localeCompare(window.CRESESB_HSP[b].capital, 'pt-BR')
    );
    for (const uf of ufs) {
      const info = window.CRESESB_HSP[uf];
      const group = document.createElement('optgroup');
      group.label = `${uf} — ${info.capital} (HSP ${String(info.hsp).replace('.', ',')})`;
      for (const cidade of info.cidades) {
        const opt = document.createElement('option');
        opt.value = `${uf}|${cidade}`;
        opt.textContent = `${cidade} — HSP ${String(info.hsp).replace('.', ',')} h`;
        opt.dataset.hsp = info.hsp;
        group.appendChild(opt);
      }
      selectEl.appendChild(group);
    }
  }

  function readCresesbHsp(selectEl) {
    const opt = selectEl?.selectedOptions[0];
    if (!opt || !opt.value) return undefined;
    const hsp = parseFloat(opt.dataset.hsp);
    return !isNaN(hsp) ? hsp : undefined;
  }

  function collectOffgridForm() {
    const equipamentos = [];
    $$('#equipamentos-table .equipment-row').forEach(row => {
      const nome = row.querySelector('.eq-nome').value.trim();
      const potencia = parseFloat(row.querySelector('.eq-potencia').value);
      const horas = parseFloat(row.querySelector('.eq-horas').value);
      const quantidade = parseInt(row.querySelector('.eq-quantidade').value) || 1;
      const tensaoSel = row.querySelector('.eq-tensao')?.value || 'ac_220';
      const [tipo, tensao] = tensaoSel.split('_');
      const indutiva = row.querySelector('.eq-indutiva')?.checked === true;
      if (nome && potencia && horas) {
        equipamentos.push({ nome, potencia_w: potencia, horas_dia: horas, quantidade, tipo, tensao: parseInt(tensao, 10), indutiva });
      }
    });
    const bateria_tipo = $('input[name="bateria-tipo"]:checked')?.value;
    const dias_autonomia = parseInt($('#dias-autonomia').value) || 2;
    const cep = $('#offgrid-cep').value.replace(/\D/g, '');
    const hsp = readCresesbHsp($('#hsp-fonte-offgrid'));
    const hspCriticoRaw = $('#offgrid-hsp-critico').value.replace(',', '.');
    const hspCritico = hspCriticoRaw ? parseFloat(hspCriticoRaw) : undefined;
    const distanciaCabo = parseFloat($('#offgrid-distancia').value) || 10;
    const areaDisponivel = parseFloat($('#offgrid-area').value) || undefined;
    const sombreamento = parseFloat($('#offgrid-sombra').value) || 0;
    const margemExpansao = parseFloat($('#offgrid-margem').value) || 0;
    const tensaoSistema = parseInt($('#tensao-sistema-offgrid').value, 10) || 48;
    const tensaoInversorAc = parseInt($('#tensao-inversor-ac').value, 10) || 220;
    const azimute = parseInt($('#orientacao-offgrid').value, 10);
    return {
      equipamentos, bateria_tipo, dias_autonomia, cep: cep || undefined, hsp,
      hsp_critico: hspCritico, distancia_cabo_m: distanciaCabo,
      area_disponivel_m2: areaDisponivel, sombreamento_pct: sombreamento,
      margem_expansao_pct: margemExpansao, tensao_sistema_v: tensaoSistema,
      tensao_inversor_ac: tensaoInversorAc,
      azimute_graus: azimute
    };
  }

  function applyCepMask(input) {
    input.addEventListener('input', (e) => {
      let v = e.target.value.replace(/\D/g, '');
      if (v.length > 5) v = v.slice(0, 5) + '-' + v.slice(5, 8);
      e.target.value = v;
    });
  }

  function buildOrcamentoResumo() {
    if (!lastResult) return null;
    const { result, tipo } = lastResult;
    const partes = [`Sistema: ${tipo}`];
    if (tipo === 'ongrid') {
      partes.push(`Potência: ${result.system_size_kw} kWp`);
      partes.push(`Painéis: ${result.panels_count} un (${result.module_w || '?'}W)`);
      partes.push(`Geração anual: ${result.annual_generation_kwh} kWh`);
      partes.push(`Economia mensal est.: R$ ${result.economia_mensal_estimada}`);
    } else {
      partes.push(`Potência painéis: ${result.potencia_paineis_w} W (${result.quantidade_paineis} un)`);
      partes.push(`Baterias: ${result.capacidade_bateria_ah} Ah / ${result.energia_armazenada_kwh} kWh`);
      partes.push(`Inversor: ${result.inversor_minimo_w} W (${result.inversor_recomendado})`);
      partes.push(`Consumo diário: ${result.consumo_diario_wh} Wh`);
      partes.push(`HSP efetivo: ${result.hsp_efetivo}`);
    }
    return partes.join(' | ').slice(0, 2000);
  }

  function memorialRow(label, value) {
    const tr = document.createElement('tr');
    const td1 = document.createElement('td');
    td1.style.cssText = 'padding:6px 8px;border-bottom:1px solid #2A425B;color:var(--text-muted);width:50%;';
    td1.textContent = label;
    const td2 = document.createElement('td');
    td2.style.cssText = 'padding:6px 8px;border-bottom:1px solid #2A425B;text-align:right;font-weight:600;';
    td2.textContent = value;
    tr.append(td1, td2);
    return tr;
  }

  function renderMemorial({ result, tipo }) {
    const body = $('#memorial-body');
    if (!result) return;
    body.textContent = '';
    const hoje = new Date().toLocaleDateString('pt-BR');

    const header = document.createElement('div');
    header.style.textAlign = 'center';
    header.style.marginBottom = '8px';
    const strong = document.createElement('strong');
    strong.textContent = 'Solar Dimensionamento';
    header.appendChild(strong);
    body.appendChild(header);

    const sub = document.createElement('div');
    sub.style.cssText = 'text-align:center;color:var(--text-muted);font-size:0.85rem;';
    sub.textContent = `${tipo === 'ongrid' ? 'Sistema On-Grid (Conectado à Rede)' : 'Sistema Off-Grid (Isolado)'} · ${hoje}`;
    body.appendChild(sub);

    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-top:12px;padding:10px;background:#12212F;border-radius:8px;';
    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;';
    const tbody = document.createElement('tbody');

    if (tipo === 'ongrid') {
      tbody.appendChild(memorialRow('Potência instalada', `${formatNumber(result.system_size_kw, 2)} kWp`));
      tbody.appendChild(memorialRow(`Nº de módulos (${result.module_w || '?'}W)`, `${result.panels_count} un`));
      tbody.appendChild(memorialRow('Geração anual estimada', `${formatNumber(result.annual_generation_kwh, 1)} kWh`));
      tbody.appendChild(memorialRow('Inversor (PACO)', `${formatNumber(result.inverter_paco_w, 0)} W`));
      tbody.appendChild(memorialRow('Razão DC/AC', `${result.dc_ac_ratio}`));
      tbody.appendChild(memorialRow('Performance Ratio', formatNumber(result.performance_ratio, 3)));
      tbody.appendChild(memorialRow('Tensão da rede', `${result.tensao_rede} V`));
      tbody.appendChild(memorialRow('Disjuntor AC', `${result.disjuntor_ac_a} A`));
      tbody.appendChild(memorialRow('Fiação DC / AC', `${result.fio_array_mm2} mm² / ${result.fio_ac_mm2} mm²`));
      tbody.appendChild(memorialRow('Sombreamento aplicado', `${result.sombreamento_pct}%`));
      tbody.appendChild(memorialRow('Margem de expansão', `${result.margem_expansao_pct}%`));
      tbody.appendChild(memorialRow('Orientação', `${formatNumber(result.inclinacao, 0)}° · azimute ${formatNumber(result.azimute, 0)}°`));
      tbody.appendChild(memorialRow('Fonte do HSP', result.hsp_fonte === 'cresesb'
        ? `CRESESB — ${formatNumber(result.hsp_usado, 2)} h (ajuste PVGIS × ${formatNumber(result.fator_ajuste_hsp, 3)})`
        : `PVGIS (CEP) — ${formatNumber(result.hsp_usado, 2)} h`));
      tbody.appendChild(memorialRow('Tarifa elétrica', `R$ ${formatNumber(result.tarifa_rpkwh, 2)}/kWh`));
      tbody.appendChild(memorialRow('Autoconsumo estimado', `${formatNumber(result.autoconsumo_pct, 0)}% da geração`));
      tbody.appendChild(memorialRow('Economia mensal estimada', `R$ ${formatNumber(result.economia_mensal_estimada, 2)}`));
    } else {
      tbody.appendChild(memorialRow('Consumo diário (c/ margem)', `${formatNumber(result.consumo_diario_wh, 1)} Wh`));
      tbody.appendChild(memorialRow('Cargas simultâneas', `${formatNumber(result.soma_cargas_w)} W (AC ${formatNumber(result.soma_cargas_ac_w)} / DC ${formatNumber(result.cargas_dc_w)})`));
      tbody.appendChild(memorialRow('Pico de partida (indutivas)', `${formatNumber(result.pico_partida_w)} W`));
      tbody.appendChild(memorialRow('Inversor', `${result.inversor_recomendado} (mín. ${formatNumber(result.inversor_minimo_w, 0)} W)`));
      tbody.appendChild(memorialRow('Banco de baterias', `${formatNumber(result.capacidade_bateria_ah, 1)} Ah · ${result.energia_armazenada_kwh} kWh @ ${result.tensao_sistema_v} V (${BATTERY_NAMES[result.tipo_bateria] || result.tipo_bateria})`));
      tbody.appendChild(memorialRow('Tensão do inversor AC', `${result.tensao_inversor_ac} V`));
      tbody.appendChild(memorialRow('Controlador MPPT', `${result.controlador_mppt_a} A`));
      tbody.appendChild(memorialRow('Array fotovoltaico', `${formatNumber(result.potencia_paineis_w, 0)} Wp (${result.modules_series}×${result.strings_parallel})`));
      tbody.appendChild(memorialRow('HSP efetivo', `${formatNumber(result.hsp_efetivo, 2)} (${result.hsp_origem})`));
      tbody.appendChild(memorialRow('Fiação bateria / array', `${result.fio_bateria_mm2} mm² / ${result.fio_array_mm2} mm²`));
      tbody.appendChild(memorialRow('Sombreamento aplicado', `${result.sombreamento_pct}%`));
      tbody.appendChild(memorialRow('Margem de expansão', `${result.margem_expansao_pct}%`));
      tbody.appendChild(memorialRow('Área necessária', `${formatNumber(result.area_necessaria_m2, 1)} m²`));
    }

    table.appendChild(tbody);
    wrap.appendChild(table);
    body.appendChild(wrap);

    const checklist = [
      'Inversor dimensionado (≥ carga)',
      'Banco de baterias p/ autonomia',
      'Controlador de carga compatível',
      'Seção de condutores adequada (queda ≤ 2%)',
      'Fusíveis/disjuntores de proteção',
      'Chave seccionadora DC',
      'DPS (proteção contra surtos)',
      'Sistema de aterramento',
      'Margem de expansão prevista'
    ];
    const h4 = document.createElement('h4');
    h4.textContent = 'Checklist de Dimensionamento e Homologação';
    h4.style.cssText = 'margin:16px 0 8px;';
    body.appendChild(h4);
    const ul = document.createElement('ul');
    ul.style.cssText = 'list-style:none;padding:0;margin:0;';
    for (const item of checklist) {
      const li = document.createElement('li');
      li.style.cssText = 'padding:5px 0;color:var(--text-muted);';
      li.textContent = `☑ ${item}`;
      ul.appendChild(li);
    }
    body.appendChild(ul);

    const note = document.createElement('p');
    note.style.cssText = 'margin-top:16px;color:var(--text-muted);font-size:0.8rem;';
    note.textContent = 'Documento gerado automaticamente pela plataforma. Valores sujeitos a confirmação técnica em campo e regras da concessionária local.';
    body.appendChild(note);

    openModal('#memorialModal');
  }

  let activeModal = null;
  let lastFocused = null;

  function openModal(sel) {
    const modal = $(sel);
    if (!modal) return;
    lastFocused = document.activeElement;
    modal.hidden = false;
    requestAnimationFrame(() => modal.classList.add('active'));
    activeModal = modal;
    const focusable = getFocusable(modal);
    if (focusable.length) focusable[0].focus();
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.classList.remove('active');
    setTimeout(() => { modal.hidden = true; }, 200);
    if (activeModal === modal) activeModal = null;
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  }

  function getFocusable(modal) {
    return $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', modal)
      .filter(el => !el.disabled && el.offsetParent !== null);
  }

  function trapFocus(e) {
    if (!activeModal || e.key !== 'Tab') return;
    const focusable = getFocusable(activeModal);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  async function handleOngridSubmit(e) {
    e.preventDefault();
    const btn = $('button[type="submit"]', e.target);
    const cep = $('#cep').value.replace(/\D/g, '');
    const consumo = parseFloat($('#consumo-mensal').value);

    clearFormError('ongrid-error');
    if (!cep || cep.length !== 8) {
      return showFormError('ongrid-error', '#form-ongrid', 'CEP inválido. Use formato 00000-000.', '#cep');
    }
    if (!consumo || consumo <= 0) {
      return showFormError('ongrid-error', '#form-ongrid', 'Consumo mensal deve ser maior que zero.', '#consumo-mensal');
    }

    setButtonLoading(btn, true);
    showLoading('Buscando coordenadas e dados de irradiância PVGIS...');

    try {
      const areaDisponivel = parseFloat($('#area-disponivel').value);
      const sombreamento = parseFloat($('#sombreamento').value);
      const tensaoRede = parseInt($('#tensao-rede').value) || 220;
      const distanciaCabo = parseFloat($('#distancia-cabo-ongrid').value) || 10;
      const margemExpansao = parseFloat($('#margem-expansao').value) || 0;
      const tarifa = parseFloat($('#tarifa').value.replace(',', '.')) || 0.85;
      const autoconsumo = parseFloat($('#autoconsumo').value) || 85;
      const azimute = parseInt($('#orientacao-ongrid').value, 10);
      const inclinacaoRaw = $('#inclinacao-ongrid').value;
      const inclinacao = inclinacaoRaw !== '' ? parseFloat(inclinacaoRaw) : undefined;
      const hspManual = readCresesbHsp($('#hsp-fonte-ongrid'));
      const result = await apiPost('/dimensionar/ongrid', {
        cep,
        consumo_mensal_kwh: consumo,
        area_disponivel_m2: areaDisponivel > 0 ? areaDisponivel : undefined,
        sombreamento_pct: sombreamento > 0 ? sombreamento : 0,
        tensao_rede: tensaoRede,
        distancia_cabo_m: distanciaCabo,
        margem_expansao_pct: margemExpansao,
        tarifa_rpkwh: tarifa,
        autoconsumo_pct: autoconsumo,
        azimute_graus: azimute,
        inclinacao_graus: inclinacao,
        hsp_manual: hspManual
      });
      hideLoading();
      setButtonLoading(btn, false);

      $('#form-ongrid').classList.add('hidden');

      renderResultCards('ongrid-cards', [
        { icon: '☀️', label: `Painéis (${result.module_w || '?'}W)`, value: `${result.panels_count} un` },
        { icon: '⚡', label: 'Geração Anual', value: `${formatNumber(result.annual_generation_kwh, 1)} kWh` },
        { icon: '💰', label: 'Economia Est. Mensal', value: `R$ ${formatNumber(result.economia_mensal_estimada, 2)}` }
      ]);

      const ongridDetalhes = [
        { label: 'Sistema', value: `${formatNumber(result.system_size_kw, 2)} kWp` },
        { label: 'Inversor', value: `${formatNumber(result.inverter_paco_w, 0)} W · DC/AC ${result.dc_ac_ratio}` },
        { label: 'Performance Ratio', value: formatNumber(result.performance_ratio, 3) },
        { label: 'Área necessária', value: `${formatNumber(result.area_necessaria_m2, 1)} m²` },
        { label: 'Tensão da rede', value: `${result.tensao_rede} V` },
        { label: 'Orientação', value: `${formatNumber(result.inclinacao, 0)}° · azimute ${formatNumber(result.azimute, 0)}°` },
        { label: 'Tarifa / autoconsumo', value: `R$ ${formatNumber(result.tarifa_rpkwh, 2)}/kWh · ${formatNumber(result.autoconsumo_pct, 0)}%` },
        { label: 'Fusível string (DC)', value: `${result.fusivel_string_a} A` },
        { label: 'Disjuntor AC', value: `${result.disjuntor_ac_a} A` },
        { label: 'Fiação DC', value: `${result.fio_array_mm2} mm²` },
        { label: 'Fiação AC', value: `${result.fio_ac_mm2} mm²` },
        { label: 'Chave seccionadora', value: result.chave_seccionadora ? 'Incluir' : '—' },
        { label: 'DPS (surto)', value: result.dps_recomendado ? 'Recomendado' : '—' },
        { label: 'Sombreamento', value: `${formatNumber(result.sombreamento_pct, 0)}%` },
        { label: 'Margem expansão', value: `${formatNumber(result.margem_expansao_pct, 0)}%` }
      ];
      const ongridAvisos = [];
      if (result.sombreamento_pct > 0) ongridAvisos.push(`Geração já ajustada para ${result.sombreamento_pct}% de sombreamento.`);
      if (result.area_info && !result.area_info.area_suficiente) {
        ongridAvisos.push(`Área disponível insuficiente: faltam ${formatNumber(result.area_info.area_faltante_m2, 1)} m².`);
      }
      renderDetalhes('ongrid-detalhes', ongridDetalhes, ongridAvisos);

      drawOngridChart(result.hourly_generation_kwh, result.consumo_horario_kwh);
      $('#ongrid-result').classList.remove('hidden');
      lastResult = { result, tipo: 'ongrid' };
    } catch (err) {
      hideLoading();
      setButtonLoading(btn, false);
      showFormError('ongrid-error', '#form-ongrid', err.message);
    }
  }

  async function handleOffgridSubmit(e) {
    e.preventDefault();
    const btn = $('button[type="submit"]', e.target);
    const data = collectOffgridForm();

    clearFormError('offgrid-error');
    if (data.equipamentos.length === 0) {
      return showFormError('offgrid-error', '#form-offgrid', 'Adicione pelo menos um equipamento.', '.eq-nome');
    }
    if (!data.bateria_tipo) {
      return showFormError('offgrid-error', '#form-offgrid', 'Selecione um tipo de bateria.');
    }

    setButtonLoading(btn, true);
    showLoading('Calculando dimensionamento off-grid...');

    try {
      const result = await apiPost('/dimensionar/offgrid', data);
      hideLoading();
      setButtonLoading(btn, false);

      $('#form-offgrid').classList.add('hidden');

      renderResultCards('offgrid-cards', [
        { icon: '☀️', label: 'Potência Painéis', value: `${formatNumber(result.potencia_paineis_w)} W (${result.quantidade_paineis} un)` },
        { icon: '🔋', label: 'Banco de Baterias', value: `${formatNumber(result.capacidade_bateria_ah)} Ah / ${result.energia_armazenada_kwh} kWh` },
        { icon: '🔌', label: 'Inversor (com surto)', value: `${formatNumber(result.inversor_minimo_w)} W (${result.inversor_recomendado})` }
      ]);

      const offgridDetalhes = [
        { label: 'HSP', value: `${formatNumber(result.hsp_usado, 2)} (${result.hsp_origem})` },
        { label: 'HSP crítico', value: `${formatNumber(result.hsp_critico, 2)}` },
        { label: 'HSP efetivo', value: `${formatNumber(result.hsp_efetivo, 2)}` },
        { label: 'Tensão do sistema', value: `${result.tensao_sistema_v} V` },
        { label: 'Tensão do inversor AC', value: `${result.tensao_inversor_ac} V` },
        { label: 'Carga pico', value: `${formatNumber(result.carga_pico_w)} W` },
        { label: 'Cargas totais (simultâneas)', value: `${formatNumber(result.soma_cargas_w)} W` },
        { label: 'Cargas AC / DC', value: `${formatNumber(result.soma_cargas_ac_w)} / ${formatNumber(result.cargas_dc_w)} W` },
        { label: 'Pico partida (indutivas)', value: `${formatNumber(result.pico_partida_w)} W` },
        { label: 'Controlador MPPT', value: `${result.controlador_mppt_a} A · ${result.controlador_mppt_vmax} V` },
        { label: 'Array DC', value: `${result.modules_series}×${result.strings_parallel} · ${formatNumber(result.array_isc_a, 1)} A` },
        { label: 'Fiação bateria', value: `${result.fio_bateria_mm2} mm²` },
        { label: 'Fiação array', value: `${result.fio_array_mm2} mm²` },
        { label: 'Fusível bateria', value: `${result.fusivel_bateria_a} A` },
        { label: 'Fusível array', value: `${result.fusivel_array_a} A` },
        { label: 'Disjuntor AC', value: `${result.disjuntor_ac_a} A` },
        { label: 'Proteções', value: `DPS ${result.dps_recomendado ? '✓' : '—'} · Aterramento ${result.aterramento_recomendado ? '✓' : '—'}` },
        { label: 'Sombreamento', value: `${formatNumber(result.sombreamento_pct, 0)}%` },
        { label: 'Margem expansão', value: `${formatNumber(result.margem_expansao_pct, 0)}%` },
        { label: 'Área necessária', value: `${formatNumber(result.area_necessaria_m2, 1)} m²` }
      ];
      const offgridAvisos = [];
      if (Array.isArray(result.avisos)) offgridAvisos.push(...result.avisos);
      if (data.cep && result.cep_geocodificado === false) {
        offgridAvisos.push('Não foi possível obter a irradiação da sua região via CEP — usando HSP padrão/CRESESB.');
      }
      if (result.cargas_indutivas > 0) {
        offgridAvisos.push(`Inversor dimensionado para o pico de partida (${result.surge_factor}x) das ${result.cargas_indutivas} carga(s) indutiva(s).`);
      }
      if (result.soma_cargas_ac_w > result.pico_partida_ac_w) {
        offgridAvisos.push('Inversor dimensionado pela soma das cargas AC simultâneas (pior caso com todas ligadas).');
      }
      if (result.cargas_dc_w > 0) {
        offgridAvisos.push(`Cargas DC (${formatNumber(result.cargas_dc_w)} W) ligadas direto no banco, sem passar pelo inversor.`);
      }
      if (result.area_info && !result.area_info.area_suficiente) {
        offgridAvisos.push(`Área disponível insuficiente: faltam ${formatNumber(result.area_info.area_faltante_m2, 1)} m².`);
      }
      renderDetalhes('offgrid-detalhes', offgridDetalhes, offgridAvisos);
      drawOffgridChart(result.curva_carga);

      $('#offgrid-result').classList.remove('hidden');
      lastResult = { result, tipo: 'offgrid' };
    } catch (err) {
      hideLoading();
      setButtonLoading(btn, false);
      showFormError('offgrid-error', '#form-offgrid', err.message);
    }
  }

  function resetForm(tipo) {
    const form = $(`#form-${tipo}`);
    const result = $(`#${tipo}-result`);
    result?.classList.add('hidden');
    clearFormError(`${tipo}-error`);
    form?.classList.remove('hidden');
    form?.reset();
    if (tipo === 'offgrid') {
      $('#equipamentos-table').textContent = '';
      addEquipmentRow();
    }
    lastResult = null;
  }

  function init() {
    $('#startBtn').addEventListener('click', () => showStage('stage-selection'));

    $$('.system-card').forEach(card => {
      card.addEventListener('click', () => {
        const system = card.dataset.system;
        showStage(system === 'ongrid' ? 'stage-ongrid' : 'stage-offgrid');
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.click(); }
      });
      card.setAttribute('tabindex', '0');
      card.setAttribute('role', 'button');
    });

    $('#methodologyBtn').addEventListener('click', () => showToast(METHODOLOGY_TEXT, 'info'));

    document.addEventListener('click', (e) => {
      const back = e.target.closest('[data-back]');
      if (back) { showStage(back.dataset.back); return; }

      const backForm = e.target.closest('[data-back-form]');
      if (backForm) {
        const tipo = backForm.dataset.backForm;
        $(`#${tipo}-result`)?.classList.add('hidden');
        $(`#form-${tipo}`)?.classList.remove('hidden');
        return;
      }

      const reset = e.target.closest('[data-reset-form]');
      if (reset) { resetForm(reset.dataset.resetForm); }
    });

    $('#form-ongrid').addEventListener('submit', handleOngridSubmit);
    $('#form-offgrid').addEventListener('submit', handleOffgridSubmit);

    $('#add-equipment-btn').addEventListener('click', addEquipmentRow);

    fillCresesbSelect($('#hsp-fonte-ongrid'));
    fillCresesbSelect($('#hsp-fonte-offgrid'));

    $('#memorialBtn-ongrid').addEventListener('click', () => {
      if (lastResult) renderMemorial(lastResult);
      else showToast('Calcule primeiro o dimensionamento para gerar o memorial.', 'error');
    });
    $('#memorialBtn-offgrid').addEventListener('click', () => {
      if (lastResult) renderMemorial(lastResult);
      else showToast('Calcule primeiro o dimensionamento para gerar o memorial.', 'error');
    });
    $('#memorialPrintBtn').addEventListener('click', () => window.print());
    $('#memorialCloseBtn').addEventListener('click', () => closeModal($('#memorialModal')));
    $('#memorialModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(e.currentTarget); });

    $('#orcamentoBtn-ongrid').addEventListener('click', () => {
      currentSystem = 'ongrid';
      clearFormError('orcamento-error');
      openModal('#orcamentoModal');
    });
    $('#orcamentoBtn-offgrid').addEventListener('click', () => {
      currentSystem = 'offgrid';
      clearFormError('orcamento-error');
      openModal('#orcamentoModal');
    });
    $('#orcamentoModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(e.currentTarget); });

    $('#orcamentoForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('button[type="submit"]', e.target);
      const submitBtnText = btn.textContent;
      clearFormError('orcamento-error');
      btn.disabled = true;
      btn.textContent = 'Enviando...';
      try {
        await apiPost('/orcamento', {
          nome: $('#orc-nome').value,
          email: $('#orc-email').value,
          whatsapp: $('#orc-whatsapp').value,
          sistema: currentSystem,
          resumo: buildOrcamentoResumo()
        });
        showToast('Solicitação enviada! Em breve entraremos em contato.', 'success');
        closeModal($('#orcamentoModal'));
        e.target.reset();
      } catch (err) {
        showFormError('orcamento-error', '#orcamentoForm', err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = submitBtnText;
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && activeModal) closeModal(activeModal);
      trapFocus(e);
    });

    applyCepMask($('#cep'));
    applyCepMask($('#offgrid-cep'));

    addEquipmentRow();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
