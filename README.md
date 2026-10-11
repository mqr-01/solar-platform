
<h1 align="center">Plataforma de Dimensionamento Solar Fotovoltaico</h1>

<p align="center">
  Plataforma web para dimensionamento de sistemas solares <strong>on-grid</strong> e <strong>off-grid</strong> com cálculos baseados em dados reais de irradiação — PVGIS-SARAH2, bases CEC e referências CRESESB.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="Licença MIT"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node.js >= 18">
  <img src="https://img.shields.io/badge/python-3.10%2B-blue" alt="Python 3.10+">
  <img src="https://img.shields.io/badge/docker-ready-2496ED" alt="Docker">
  <img src="https://img.shields.io/badge/testes-39%2F39-8A2BE2" alt="39/39 testes">
</p>

<p align="center">
  <a href="PRD.md">📄 Documento do Produto (PRD)</a> ·
  <a href="#passo-a-passo-de-execução">🚀 Executar</a> ·
  <a href="#stack">🧱 Stack</a>
</p>

---

## Visão geral

Aplicação full-stack que simula e dimensiona sistemas fotovoltaicos:

- **On-grid:** simulação anual horária com `pvlib.ModelChain`, módulos e inversores reais das bases CEC, validação de string (tensão, range MPPT), perdas físicas, sombra, orientação/azimute e ajuste por referência CRESESB.
- **Off-grid:** dimensionamento por consumo diário com banco de baterias (12/24/48 V), C-rate, DoD/eficiência por tecnologia e inversor dimensionado pela carga de pico (127/220 V).

O cálculo é **determinístico e sem cache**: cada requisição executa o engine Python do zero (`RNF-01`). Nenhum dado de cálculo é persistido.

> **Escopo:** plataforma técnica de dimensionamento e estudo. Preço, orçamento comercial e payback **não fazem parte** deste projeto (decisão registrada no PRD §12).

<p align="center">
  <img src="./imagem/Image.png" alt="Tela da plataforma de dimensionamento solar fotovoltaico" width="100%" height="400">
</p>
     

## Stack

| Camada | Tecnologias |
|---|---|
| **Backend** | Node.js 22 + Express 4 · `child_process.spawn` por requisição (isolamento) · validações e rate limit · zero cache |
| **Engine de cálculo** | Python 3.10+ · [pvlib](https://pvlib-python.readthedocs.io/) ≥ 0.10.2 (ModelChain, SAPM, CEC) · numpy · pandas · requests |
| **Frontend** | HTML5 / CSS3 / JavaScript puro (sem framework) · Chart.js via CDN · sem `localStorage`/`sessionStorage` |
| **Dados climáticos** | PVGIS-SARAH2 (TMY) via `pvlib.get_pvgis_tmy` · base CRESESB de HSP por UF/cidade (`public/data-cresesb-hsp.js`) |
| **Geocodificação** | ViaCEP (CEP → endereço) · Nominatim/OpenStreetMap (endereço → lat/lon) |
| **Infra / entrega** | Docker (`node:22-slim`) + Docker Compose · npm scripts |
| **Testes** | `node:test` (API, 20 testes) + `python-runner` (cálculo on-grid/off-grid, 19 testes) — **39 no total** |

## Funcionalidades

### On-grid (`POST /api/dimensionar/ongrid`)
- Entrada: CEP + consumo mensal (kWh) + inclinação, azimute, sombra e margem de segurança.
- Saída: nº de painéis, potência DC, geração anual estimada, performance ratio, fator de carga, memorial de cálculo completo.
- HSP por **fonte selecionável**: PVGIS (automático via CEP) ou tabela CRESESB (27 UF, ~200 cidades), com `fator = HSP_cresesb/HSP_pvgis` aplicado a sizing/geração/POA.
- Validação elétrica: string em série (Vmp/Voc), range do MPPT, fusível 1,56 × Isc, √3 em 380 V.

### Off-grid (`POST /api/dimensionar/offgrid`)
- Entrada: equipamentos (potência × horas/dia) + autonomia, tipo de bateria, tensão do banco (12/24/48 V) e tensão do inversor AC (127/220 V).
- Saída: array real (série × strings), Ah/dia e Ah totais, C-rate da bateria, disjuntor do inversor, autonomia, memorial de cálculo.
- HSP via PVGIS quando o CEP é informado.

## Requisitos e sistemas suportados

| Sistema | Suporte | Observação |
|---|---|---|
| **Linux** (Ubuntu 22.04+, etc.) | ✅ Nativo | Caminho oficial — `install:python` cria `.venv` automaticamente |
| **macOS** (12+) | ✅ Nativo | Mesmo fluxo do Linux (requer `python3` no PATH) |
| **Windows** 10/11 | ⚠️ Docker recomendado | O `install:python` usa caminhos Unix (`.venv/bin/python`). Use **Docker** (abaixo) ou, alternativamente, rode nativamente definindo `PYTHON_CMD=.venv\Scripts\python.exe` após criar o venv manualmente com `py -3 -m venv .venv` |

Requisitos de software:

- **Node.js** ≥ 18 (testado com 22)
- **Python** 3.10+ (não necessário no caminho Docker)
- **Docker + Docker Compose** (opcional no Linux/macOS, recomendado no Windows)
- Acesso à internet no primeiro cálculo (PVGIS, ViaCEP, Nominatim)

## Passo a-passo de execução

### Opção A — Nativa (Linux/macOS)

```bash
# 1. Dependências do projeto
npm install

# 2. Criar .venv e instalar o engine Python (pvlib, numpy, pandas, requests)
npm run install:python

# 3. Subir o servidor
npm start              # produção
# ou
npm run dev            # desenvolvimento (node --watch)

# 4. Abrir no navegador
# http://localhost:3000
```

### Opção B — Docker (recomendado no Windows)

```bash
docker compose up --build
# http://localhost:3000
```

O build instala Node, Python 3 e o `requirements.txt` dentro da imagem — nenhum pré-requisito local além do Docker.

### Testes

```bash
npm test               # 39 testes: 20 de API (node:test) + 19 de cálculo (Python)
npm run test:api       # apenas API
npm run test:calc      # apenas engines de cálculo
```

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta HTTP |
| `PYTHON_CMD` | `.venv/bin/python` ou `python3` | Interpretador Python usado pelo spawn. No Windows: `.venv\Scripts\python.exe` |

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/dimensionar/ongrid` | Dimensionamento on-grid (CEP + consumo mensal) |
| POST | `/api/dimensionar/offgrid` | Dimensionamento off-grid (equipamentos) |
| POST | `/api/orcamento` | Registra lead de orçamento (`data/leads.json`) |
| GET | `/api/health` | Healthcheck (`cache: "disabled"`) |

## Estrutura do projeto

```
server.js                  API Express: validações, geocodificação, spawn, zero cache
public/index.html          Frontend (markup)
public/styles.css          Estilos
public/app.js              Lógica do frontend + memorial de cálculo
public/data-cresesb-hsp.js Base CRESESB de HSP (27 UF, ~200 cidades)
python/ongrid_calc.py      Engine on-grid (pvlib ModelChain)
python/offgrid_calc.py     Engine off-grid
python/requirements.txt    Dependências Python
scripts/python-runner.js   Runner dos testes Python
test/                      Testes de API (node:test) + testes de cálculo
imagem/Image.png           Captura de tela da plataforma
data/                      Leads de orçamento (gerado em runtime, fora do git)
PRD.md                     Documento do produto (requisitos, metodologia, sprints)
```

## Metodologia de cálculo

- **On-grid:** simulação anual horária com `pvlib.ModelChain` (transposição física, modelo SAPM de temperatura), módulo e inversor reais selecionados das bases CEC. O dimensionamento usa geração anual por painel e valida a matriz contra o inversor (tensão de string, range MPPT).
- **Off-grid:** dimensionamento por consumo diário, HSP via PVGIS quando há CEP, DoD/eficiência por tipo de bateria e inversor dimensionado pela carga de pico.

> A metodologia completa, fórmulas, constantes, requisitos (17 RF / 9 RNF), sprints e backlog estão documentados no **[PRD — Documento do Produto](PRD.md)**.

## Roadmap

- **Entregue:** sprints S0–S6 — fundação, perdas, precisão on-grid/off-grid, frontend + memorial, CRESESB/tensão do inversor/zero cache, correções de layout (PRD §9).
- **Backlog:** preço/payback (fora de escopo atual), perfil horário de consumo, LGPD/HTTPS, acessibilidade/PWA, engenharia extra, i18n (PRD §10).

## Licença

Distribuído sob a licença [MIT](LICENSE) — © 2026 Miqueias Rodrigues Ribeiro (miqueias).
