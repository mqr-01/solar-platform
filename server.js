const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PROJECT_ROOT = __dirname;
const PYTHON_DIR = path.join(PROJECT_ROOT, 'python');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

function resolvePythonCmd() {
  if (process.env.PYTHON_CMD) return process.env.PYTHON_CMD;
  const localVenv = path.join(PROJECT_ROOT, '.venv', 'bin', 'python');
  if (fs.existsSync(localVenv)) return localVenv;
  return 'python3';
}
const PYTHON_CMD = resolvePythonCmd();

// Política de zero persistência de cálculo: nenhuma simulação é cacheada em
// memória ou disco — cada requisição recalcula do zero com os dados fornecidos.
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');

async function geocodeCEP(cep) {
  const cleanCep = cep.replace(/\D/g, '');
  if (cleanCep.length !== 8) {
    throw new Error('CEP deve ter 8 dígitos');
  }

  const timeoutSignal = (ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  };

  console.log(`[geocodeCEP] Consultando ViaCEP para ${cleanCep}`);
  let viaCepRes;
  try {
    viaCepRes = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`, {
      signal: timeoutSignal(10000)
    });
  } catch (err) {
    throw new Error('Timeout ao consultar serviço de geocodificação');
  }
  if (!viaCepRes.ok) {
    throw new Error('Falha ao consultar ViaCEP');
  }
  const viaCepData = await viaCepRes.json();
  if (viaCepData.erro) {
    throw new Error('CEP não encontrado');
  }
  console.log(`[geocodeCEP] ViaCEP OK: ${viaCepData.localidade}/${viaCepData.uf}`);

  const city = viaCepData.localidade?.split('-')[0] || viaCepData.localidade;
  const state = viaCepData.uf;

  const nominatimParams = new URLSearchParams({
    city,
    state,
    country: 'Brazil',
    format: 'json',
    limit: '1'
  });

  console.log(`[geocodeCEP] Consultando Nominatim para ${city}/${state}`);
  let nominatimRes;
  try {
    nominatimRes = await fetch(
      `https://nominatim.openstreetmap.org/search?${nominatimParams}`,
      {
        headers: {
          'User-Agent': 'SolarDimensionamentoPlatform/1.0 (+https://github.com/solar-platform)'
        },
        signal: timeoutSignal(10000)
      }
    );
  } catch (err) {
    throw new Error('Timeout ao consultar serviço de geocodificação');
  }
  if (!nominatimRes.ok) {
    throw new Error('Falha ao consultar Nominatim');
  }

  const results = await nominatimRes.json();
  if (!results.length) {
    throw new Error('Não foi possível obter coordenadas para este CEP');
  }
  console.log(`[geocodeCEP] Nominatim OK: lat=${results[0].lat}, lon=${results[0].lon}`);

  return {
    cep: viaCepData.cep,
    logradouro: viaCepData.logradouro,
    bairro: viaCepData.bairro,
    localidade: viaCepData.localidade,
    uf: viaCepData.uf,
    latitude: parseFloat(results[0].lat),
    longitude: parseFloat(results[0].lon)
  };
}

function runPythonScript(scriptName, inputData) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(PYTHON_DIR, scriptName);
    console.log(`[runPythonScript] Iniciando ${scriptName} com PYTHON_CMD=${PYTHON_CMD}`);
    const python = spawn(PYTHON_CMD, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    const timeout = setTimeout(() => {
      console.error(`[runPythonScript] TIMEOUT após 60s para ${scriptName}`);
      python.kill('SIGKILL');
      reject(new Error(`Timeout ao executar ${scriptName} (60s)`));
    }, 60000);

    python.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    python.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    python.on('close', (code) => {
      clearTimeout(timeout);
      console.log(`[runPythonScript] ${scriptName} finalizado com código ${code}`);
      if (stderr) console.log(`[runPythonScript] stderr: ${stderr.trim()}`);
      if (code !== 0) {
        try {
          const errorResult = JSON.parse(stdout.trim());
          if (errorResult.error) {
            return reject(new Error(errorResult.error));
          }
        } catch {
          return reject(new Error(`Python script exited with code ${code}: ${stderr || stdout}`));
        }
      }

      try {
        const result = JSON.parse(stdout.trim());
        if (result && result.error) {
          return reject(new Error(result.error));
        }
        console.log(`[runPythonScript] ${scriptName} resultado OK`);
        resolve(result);
      } catch (e) {
        console.error(`[runPythonScript] Erro ao parsear stdout: ${stdout}`);
        reject(new Error(`Falha ao parsear saída do Python: ${stdout}`));
      }
    });

    python.on('error', (err) => {
      clearTimeout(timeout);
      console.error(`[runPythonScript] Erro no spawn: ${err.message}`);
      reject(new Error(`Falha ao executar script Python: ${err.message}. Verifique se o Python e as dependências estão instalados (npm run install:python)`));
    });

    python.stdin.write(JSON.stringify(inputData));
    python.stdin.end();
  });
}

const RATE_LIMIT = { windowMs: 60 * 1000, max: 30 };
const rateBuckets = new Map();

function rateLimit(req, res, next) {
  const key = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const bucket = rateBuckets.get(key);

  if (!bucket || now - bucket.resetAt > RATE_LIMIT.windowMs) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT.windowMs });
    return next();
  }

  bucket.count += 1;
  if (bucket.count > RATE_LIMIT.max) {
    return res.status(429).json({ error: 'Muitas requisições. Tente novamente em instantes.' });
  }
  next();
}

app.post('/api/dimensionar/ongrid', rateLimit, async (req, res) => {
  try {
    const { cep, consumo_mensal_kwh } = req.body;

    if (!cep || !consumo_mensal_kwh) {
      return res.status(400).json({ error: 'CEP e consumo mensal (kWh) são obrigatórios' });
    }

    const consumo = parseFloat(consumo_mensal_kwh);
    if (isNaN(consumo) || consumo <= 0) {
      return res.status(400).json({ error: 'Consumo mensal deve ser um número maior que zero' });
    }

    const areaDisponivel = req.body.area_disponivel_m2;
    const sombreamento = req.body.sombreamento_pct;
    if (areaDisponivel !== undefined && areaDisponivel !== null && areaDisponivel !== '') {
      if (isNaN(parseFloat(areaDisponivel)) || parseFloat(areaDisponivel) <= 0) {
        return res.status(400).json({ error: 'Área disponível deve ser um número maior que zero (m²)' });
      }
    }
    if (sombreamento !== undefined && sombreamento !== null && sombreamento !== '') {
      const s = parseFloat(sombreamento);
      if (isNaN(s) || s < 0 || s > 30) {
        return res.status(400).json({ error: 'Sombreamento deve ser entre 0 e 30%' });
      }
    }

    const tensaoRede = req.body.tensao_rede;
    let tensaoRedeVal = 220;
    if (tensaoRede !== undefined && tensaoRede !== null && tensaoRede !== '') {
      tensaoRedeVal = parseFloat(tensaoRede);
      if (![110, 127, 220, 380].includes(tensaoRedeVal)) {
        return res.status(400).json({ error: 'Tensão da rede deve ser 110, 127, 220 ou 380V' });
      }
    }

    const distanciaCabo = req.body.distancia_cabo_m;
    let distanciaCaboVal = 10;
    if (distanciaCabo !== undefined && distanciaCabo !== null && distanciaCabo !== '') {
      distanciaCaboVal = parseFloat(distanciaCabo);
      if (isNaN(distanciaCaboVal) || distanciaCaboVal <= 0 || distanciaCaboVal > 200) {
        return res.status(400).json({ error: 'Distância do cabo deve ser entre 0 e 200 metros' });
      }
    }

    const margemExpansao = req.body.margem_expansao_pct;
    let margemExpansaoVal = 0;
    if (margemExpansao !== undefined && margemExpansao !== null && margemExpansao !== '') {
      margemExpansaoVal = parseFloat(margemExpansao);
      if (isNaN(margemExpansaoVal) || margemExpansaoVal < 0 || margemExpansaoVal > 100) {
        return res.status(400).json({ error: 'Margem de expansão deve ser entre 0 e 100%' });
      }
    }

    const tarifa = req.body.tarifa_rpkwh;
    let tarifaVal = 0.85;
    if (tarifa !== undefined && tarifa !== null && tarifa !== '') {
      tarifaVal = parseFloat(tarifa);
      if (isNaN(tarifaVal) || tarifaVal < 0.3 || tarifaVal > 3.0) {
        return res.status(400).json({ error: 'Tarifa deve ser entre 0,30 e 3,00 R$/kWh' });
      }
    }

    const autoconsumo = req.body.autoconsumo_pct;
    let autoconsumoVal = 85;
    if (autoconsumo !== undefined && autoconsumo !== null && autoconsumo !== '') {
      autoconsumoVal = parseFloat(autoconsumo);
      if (isNaN(autoconsumoVal) || autoconsumoVal < 10 || autoconsumoVal > 100) {
        return res.status(400).json({ error: 'Autoconsumo deve ser entre 10 e 100%' });
      }
    }

    const azimute = req.body.azimute_graus;
    let azimuteVal = null;
    if (azimute !== undefined && azimute !== null && azimute !== '') {
      azimuteVal = parseFloat(azimute);
      if (isNaN(azimuteVal) || azimuteVal < 0 || azimuteVal > 360) {
        return res.status(400).json({ error: 'Azimute deve ser entre 0 e 360 graus' });
      }
    }

    const inclinacao = req.body.inclinacao_graus;
    let inclinacaoVal = null;
    if (inclinacao !== undefined && inclinacao !== null && inclinacao !== '') {
      inclinacaoVal = parseFloat(inclinacao);
      if (isNaN(inclinacaoVal) || inclinacaoVal < 0 || inclinacaoVal > 90) {
        return res.status(400).json({ error: 'Inclinação deve ser entre 0 e 90 graus' });
      }
    }

    const hspManual = req.body.hsp_manual;
    let hspManualVal = null;
    if (hspManual !== undefined && hspManual !== null && hspManual !== '') {
      hspManualVal = parseFloat(hspManual);
      if (isNaN(hspManualVal) || hspManualVal < 1.0 || hspManualVal > 8.0) {
        return res.status(400).json({ error: 'HSP manual deve ser entre 1,0 e 8,0 h/dia' });
      }
    }

    const geo = await geocodeCEP(cep);

    const pythonInput = {
      latitude: geo.latitude,
      longitude: geo.longitude,
      consumo_mensal_kwh: consumo,
      cep: geo.cep,
      area_disponivel_m2: areaDisponivel !== undefined && areaDisponivel !== '' ? parseFloat(areaDisponivel) : undefined,
      sombreamento_pct: sombreamento !== undefined && sombreamento !== '' ? parseFloat(sombreamento) : 0,
      tensao_rede: tensaoRedeVal,
      distancia_cabo_m: distanciaCaboVal,
      margem_expansao_pct: margemExpansaoVal,
      tarifa_rpkwh: tarifaVal,
      autoconsumo_pct: autoconsumoVal,
      azimute_graus: azimuteVal ?? undefined,
      inclinacao_graus: inclinacaoVal ?? undefined,
      hsp_manual: hspManualVal ?? undefined
    };

    const result = await runPythonScript('ongrid_calc.py', pythonInput);
    res.json(result);
  } catch (err) {
    console.error('Erro on-grid:', err.message);
    const status = err.message.includes('CEP') || err.message.includes('consumo') ? 400 :
                   err.message.includes('ViaCEP') || err.message.includes('Nominatim') || err.message.includes('PVGIS') ? 503 : 500;
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/dimensionar/offgrid', rateLimit, async (req, res) => {
  try {
    const { equipamentos, bateria_tipo, dias_autonomia, cep, hsp } = req.body;

    if (!equipamentos || !Array.isArray(equipamentos) || equipamentos.length === 0) {
      return res.status(400).json({ error: 'Lista de equipamentos é obrigatória' });
    }

    const validBaterias = ['chumbo_acido', 'gel', 'litio_lifepo4'];
    if (!bateria_tipo || !validBaterias.includes(bateria_tipo)) {
      return res.status(400).json({ error: `Tipo de bateria inválido. Use: ${validBaterias.join(', ')}` });
    }

    const autonomia = parseInt(dias_autonomia) || 2;
    if (autonomia < 1 || autonomia > 10) {
      return res.status(400).json({ error: 'Dias de autonomia deve ser entre 1 e 10' });
    }

    let hspManual = null;
    if (hsp !== undefined && hsp !== null && hsp !== '') {
      hspManual = parseFloat(hsp);
      if (isNaN(hspManual) || hspManual < 1.0 || hspManual > 8.0) {
        return res.status(400).json({ error: 'HSP manual deve ser entre 1,0 e 8,0 h/dia' });
      }
    }

    const hspCritico = req.body.hsp_critico;
    let hspCriticoVal = null;
    if (hspCritico !== undefined && hspCritico !== null && hspCritico !== '') {
      hspCriticoVal = parseFloat(hspCritico);
      if (isNaN(hspCriticoVal) || hspCriticoVal <= 0 || hspCriticoVal > 10) {
        return res.status(400).json({ error: 'HSP crítico deve ser um número entre 0 e 10 (kWh/m²/dia)' });
      }
    }

    const distanciaCabo = req.body.distancia_cabo_m;
    let distanciaCaboVal = 10;
    if (distanciaCabo !== undefined && distanciaCabo !== null && distanciaCabo !== '') {
      distanciaCaboVal = parseFloat(distanciaCabo);
      if (isNaN(distanciaCaboVal) || distanciaCaboVal <= 0 || distanciaCaboVal > 200) {
        return res.status(400).json({ error: 'Distância do cabo deve ser entre 0 e 200 metros' });
      }
    }

    const areaDisponivel = req.body.area_disponivel_m2;
    let areaDisponivelVal = null;
    if (areaDisponivel !== undefined && areaDisponivel !== null && areaDisponivel !== '') {
      areaDisponivelVal = parseFloat(areaDisponivel);
      if (isNaN(areaDisponivelVal) || areaDisponivelVal <= 0) {
        return res.status(400).json({ error: 'Área disponível deve ser um número maior que zero (m²)' });
      }
    }

    const margemExpansao = req.body.margem_expansao_pct;
    let margemExpansaoVal = 0;
    if (margemExpansao !== undefined && margemExpansao !== null && margemExpansao !== '') {
      margemExpansaoVal = parseFloat(margemExpansao);
      if (isNaN(margemExpansaoVal) || margemExpansaoVal < 0 || margemExpansaoVal > 100) {
        return res.status(400).json({ error: 'Margem de expansão deve ser entre 0 e 100%' });
      }
    }

    const sombreamento = req.body.sombreamento_pct;
    let sombreamentoVal = 0;
    if (sombreamento !== undefined && sombreamento !== null && sombreamento !== '') {
      sombreamentoVal = parseFloat(sombreamento);
      if (isNaN(sombreamentoVal) || sombreamentoVal < 0 || sombreamentoVal > 30) {
        return res.status(400).json({ error: 'Sombreamento deve ser entre 0 e 30%' });
      }
    }

    const tensaoSistema = req.body.tensao_sistema_v;
    let tensaoSistemaVal = 48;
    if (tensaoSistema !== undefined && tensaoSistema !== null && tensaoSistema !== '') {
      tensaoSistemaVal = parseFloat(tensaoSistema);
      if (![12, 24, 48].includes(tensaoSistemaVal)) {
        return res.status(400).json({ error: 'Tensão do sistema deve ser 12, 24 ou 48V' });
      }
    }

    const tensaoInversor = req.body.tensao_inversor_ac;
    let tensaoInversorVal = 220;
    if (tensaoInversor !== undefined && tensaoInversor !== null && tensaoInversor !== '') {
      tensaoInversorVal = parseFloat(tensaoInversor);
      if (![127, 220].includes(tensaoInversorVal)) {
        return res.status(400).json({ error: 'Tensão do inversor AC deve ser 127 ou 220V' });
      }
    }

    const azimute = req.body.azimute_graus;
    let azimuteVal = null;
    if (azimute !== undefined && azimute !== null && azimute !== '') {
      azimuteVal = parseFloat(azimute);
      if (isNaN(azimuteVal) || azimuteVal < 0 || azimuteVal > 360) {
        return res.status(400).json({ error: 'Azimute deve ser entre 0 e 360 graus' });
      }
    }

    const inclinacao = req.body.inclinacao_graus;
    let inclinacaoVal = null;
    if (inclinacao !== undefined && inclinacao !== null && inclinacao !== '') {
      inclinacaoVal = parseFloat(inclinacao);
      if (isNaN(inclinacaoVal) || inclinacaoVal < 0 || inclinacaoVal > 90) {
        return res.status(400).json({ error: 'Inclinação deve ser entre 0 e 90 graus' });
      }
    }

    for (const eq of equipamentos) {
      if (!eq.nome || !eq.potencia_w || !eq.horas_dia) {
        return res.status(400).json({ error: 'Cada equipamento deve ter nome, potencia_w e horas_dia' });
      }
      if (eq.potencia_w <= 0 || eq.horas_dia <= 0 || eq.horas_dia > 24) {
        return res.status(400).json({ error: 'Potência deve ser > 0 e horas/dia entre 0.1 e 24' });
      }
    }

    let geo = null;
    if (cep) {
      try {
        geo = await geocodeCEP(cep);
      } catch (err) {
        console.warn(`[offgrid] Geocodificação falhou (${err.message}). Usando HSP padrão.`);
      }
    }

    const pythonInput = {
      equipamentos,
      bateria_tipo,
      dias_autonomia: autonomia,
      latitude: geo?.latitude,
      longitude: geo?.longitude,
      hsp_manual: hspManual,
      hsp_critico: hspCriticoVal,
      distancia_cabo_m: distanciaCaboVal,
      area_disponivel_m2: areaDisponivelVal,
      margem_expansao_pct: margemExpansaoVal,
      sombreamento_pct: sombreamentoVal,
      tensao_sistema_v: tensaoSistemaVal,
      tensao_inversor_ac: tensaoInversorVal,
      azimute_graus: azimuteVal ?? undefined,
      inclinacao_graus: inclinacaoVal ?? undefined
    };

    const result = await runPythonScript('offgrid_calc.py', pythonInput);
    res.json({ ...result, cep_geocodificado: !!geo });
  } catch (err) {
    console.error('Erro off-grid:', err.message);
    const status = err.message.includes('inválido') || err.message.includes('obrigatório') ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/orcamento', rateLimit, async (req, res) => {
  try {
    const { nome, email, whatsapp, sistema, resumo } = req.body;

    if (!nome || !nome.trim() || !email || !whatsapp) {
      return res.status(400).json({ error: 'Nome, email e WhatsApp são obrigatórios' });
    }
    if (!String(email).includes('@') || !String(whatsapp).replace(/\D/g, '').length) {
      return res.status(400).json({ error: 'Email ou WhatsApp inválidos' });
    }

    let leads = [];
    try {
      leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf-8'));
      if (!Array.isArray(leads)) leads = [];
    } catch {
      leads = [];
    }

    const resumoSanitizado = typeof resumo === 'string'
      ? resumo.replace(/[<>]/g, '').slice(0, 2000)
      : null;

    const lead = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      nome: nome.trim(),
      email: email.trim(),
      whatsapp: String(whatsapp).trim(),
      sistema: sistema || null,
      resumo: resumoSanitizado,
      criado_em: new Date().toISOString()
    };

    leads.push(lead);
    fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));

    res.json({ ok: true, message: 'Solicitação registrada com sucesso' });
  } catch (err) {
    console.error('Erro orçamento:', err.message);
    res.status(500).json({ error: 'Falha ao registrar solicitação' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', cache: 'disabled', python: PYTHON_CMD });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  console.log(`PYTHON_CMD: ${PYTHON_CMD}`);
  console.log(`Frontend: http://localhost:${PORT}`);
  console.log(`API On-Grid: POST http://localhost:${PORT}/api/dimensionar/ongrid`);
  console.log(`API Off-Grid: POST http://localhost:${PORT}/api/dimensionar/offgrid`);
});