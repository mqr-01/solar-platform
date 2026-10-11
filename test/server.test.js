const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 3199;
const BASE = `http://localhost:${PORT}`;
const LEADS_FILE = path.join(__dirname, '..', 'data', 'leads.json');

let server;

before(() => {
  return new Promise((resolve, reject) => {
    server = spawn('node', ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    server.stdout.on('data', (d) => {
      out += d.toString();
      if (out.includes('Servidor rodando')) resolve();
    });
    server.stderr.on('data', (d) => process.stderr.write(d));
    server.on('exit', (code) => {
      if (!out.includes('Servidor rodando')) reject(new Error(`servidor saiu com código ${code}`));
    });
  });
});

after(() => {
  server?.kill('SIGKILL');
});

async function post(endpoint, body) {
  const res = await fetch(`${BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: res.status, data: await res.json() };
}

function readLeads() {
  try {
    return JSON.parse(fs.readFileSync(LEADS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

test('health retorna ok sem cache de cálculo', async () => {
  const res = await fetch(`${BASE}/api/health`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.status, 'ok');
  assert.strictEqual(data.cache, 'disabled');
});

test('ongrid valida campos obrigatórios', async () => {
  const { status } = await post('/api/dimensionar/ongrid', {});
  assert.strictEqual(status, 400);
});

test('ongrid valida consumo', async () => {
  const { status } = await post('/api/dimensionar/ongrid', { cep: '70000-000', consumo_mensal_kwh: -5 });
  assert.strictEqual(status, 400);
});

test('ongrid valida tensão de rede', async () => {
  const { status } = await post('/api/dimensionar/ongrid', {
    cep: '70000-000', consumo_mensal_kwh: 300, tensao_rede: 999
  });
  assert.strictEqual(status, 400);
});

test('ongrid valida sombreamento', async () => {
  const { status } = await post('/api/dimensionar/ongrid', {
    cep: '70000-000', consumo_mensal_kwh: 300, sombreamento_pct: 50
  });
  assert.strictEqual(status, 400);
});

test('ongrid valida HSP manual CRESESB', async () => {
  const { status } = await post('/api/dimensionar/ongrid', {
    cep: '70000-000', consumo_mensal_kwh: 300, hsp_manual: 99
  });
  assert.strictEqual(status, 400);
});

test('ongrid valida distância do cabo', async () => {
  const { status } = await post('/api/dimensionar/ongrid', {
    cep: '70000-000', consumo_mensal_kwh: 300, distancia_cabo_m: 500
  });
  assert.strictEqual(status, 400);
});

test('offgrid valida equipamentos', async () => {
  const { status } = await post('/api/dimensionar/offgrid', { equipamentos: [] });
  assert.strictEqual(status, 400);
});

test('offgrid valida tipo de bateria', async () => {
  const { status } = await post('/api/dimensionar/offgrid', {
    equipamentos: [{ nome: 'Geladeira', potencia_w: 200, horas_dia: 10 }],
    bateria_tipo: 'nao_existe'
  });
  assert.strictEqual(status, 400);
});

test('offgrid valida equipamento incompleto', async () => {
  const { status } = await post('/api/dimensionar/offgrid', {
    equipamentos: [{ nome: 'Geladeira', potencia_w: 200 }],
    bateria_tipo: 'gel'
  });
  assert.strictEqual(status, 400);
});

test('offgrid valida dias de autonomia', async () => {
  const { status } = await post('/api/dimensionar/offgrid', {
    equipamentos: [{ nome: 'Geladeira', potencia_w: 200, horas_dia: 10 }],
    bateria_tipo: 'gel',
    dias_autonomia: 99
  });
  assert.strictEqual(status, 400);
});

test('offgrid valida HSP manual', async () => {
  const { status } = await post('/api/dimensionar/offgrid', {
    equipamentos: [{ nome: 'Geladeira', potencia_w: 200, horas_dia: 10 }],
    bateria_tipo: 'gel',
    hsp: 99
  });
  assert.strictEqual(status, 400);
});

test('offgrid valida sombreamento e margem', async () => {
  const { status } = await post('/api/dimensionar/offgrid', {
    equipamentos: [{ nome: 'Geladeira', potencia_w: 200, horas_dia: 10 }],
    bateria_tipo: 'gel',
    sombreamento_pct: 50
  });
  assert.strictEqual(status, 400);
});

test('offgrid valida tensão do inversor AC', async () => {
  const { status } = await post('/api/dimensionar/offgrid', {
    equipamentos: [{ nome: 'Geladeira', potencia_w: 200, horas_dia: 10 }],
    bateria_tipo: 'gel',
    tensao_inversor_ac: 15
  });
  assert.strictEqual(status, 400);
});

test('orcamento registra lead válido com resumo', async () => {
  const antes = readLeads().length;
  const { status, data } = await post('/api/orcamento', {
    nome: 'Teste',
    email: 'teste@example.com',
    whatsapp: '(11) 99999-0000',
    sistema: 'ongrid',
    resumo: 'Sistema: ongrid | Potência: 5.5 kWp | Painéis: 10 un (550W)'
  });
  assert.strictEqual(status, 200);
  assert.strictEqual(data.ok, true);

  const depois = readLeads();
  assert.strictEqual(depois.length, antes + 1);
  const lead = depois[depois.length - 1];
  assert.strictEqual(lead.sistema, 'ongrid');
  assert.ok(lead.resumo.includes('5.5 kWp'));
});

test('orcamento limita resumo a 2000 chars', async () => {
  const antes = readLeads().length;
  const { status } = await post('/api/orcamento', {
    nome: 'Teste Resumo',
    email: 'teste2@example.com',
    whatsapp: '(11) 99999-0001',
    resumo: 'x'.repeat(5000)
  });
  assert.strictEqual(status, 200);
  const lead = readLeads().pop();
  assert.strictEqual(lead.resumo.length, 2000);
  assert.strictEqual(readLeads().length, antes + 1);
});

test('orcamento sanitiza tags HTML no resumo', async () => {
  await post('/api/orcamento', {
    nome: 'Teste Sanitize',
    email: 'teste3@example.com',
    whatsapp: '(11) 99999-0002',
    resumo: 'Potência: 5 kWp <script>alert(1)</script>'
  });
  const lead = readLeads().pop();
  assert.ok(!lead.resumo.includes('<script>'));
  assert.ok(!lead.resumo.includes('<'));
});

test('orcamento valida dados', async () => {
  const { status } = await post('/api/orcamento', { nome: '', email: 'x' });
  assert.strictEqual(status, 400);
});

test('orcamento valida email', async () => {
  const { status } = await post('/api/orcamento', {
    nome: 'Teste', email: 'sem-arroba', whatsapp: '(11) 99999-0000'
  });
  assert.strictEqual(status, 400);
});

test('orcamento valida whatsapp', async () => {
  const { status } = await post('/api/orcamento', {
    nome: 'Teste', email: 't@t.com', whatsapp: ''
  });
  assert.strictEqual(status, 400);
});
