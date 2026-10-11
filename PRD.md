# PRD — Plataforma de Dimensionamento Solar Fotovoltaico

| Campo | Valor |
|---|---|
| **Documento** | Product Requirements Document (PRD) |
| **Versão** | 1.0 |
| **Data** | 11/10/2026 |
| **Status** | Produto ativo — cálculos validados (39 testes + E2E) |
| **Público** | Técnico / desenvolvedores |
| **Repositório** | `solar-dimensionamento-platform` |

---

## 1. Visão geral

### 1.1 Objetivo principal

A **Plataforma de Dimensionamento Solar Fotovoltaico** é uma aplicação web que calcula, com rigor de engenharia, o sistema solar ideal para duas configurações: **on-grid** (conectado à rede) e **off-grid** (isolado). O sistema emite como resultado:

1. **Dimensionamento técnico completo** — nº de painéis, inversor, banco de baterias, fiação, proteções;
2. **Memorial de cálculo** — documento com todos os parâmetros e fórmulas usados, imprimível;
3. **Captação de leads** — solicitação de orçamento com o resumo da simulação.

### 1.2 Problema que resolve

Orçamentos de sistemas solares são frequentemente baseados em estimativas aritméticas grosseiras ("kWp × constante"), que ignoram irradiância local, orientação do telhado, sombreamento, perdas reais e curvas de carga — resultando em sub ou superdimensionamento. A plataforma substitui a estimativa por **simulação horária com dados de satélite** e deixa o cálculo inteiro auditável no memorial.

### 1.3 Para que serve / Para quem

- **Usuário final (casa/comércio):** simulação gratuita que mostra painéis, geração, economia mensal e lista de equipamentos antes de contratar.
- **Técnico/integrador:** ferramenta de dimensionamento para embasar proposta comercial, com metodologia citável (PVGIS-SARAH2, Atlas CRESESB) e memorial gerado.

> **Limite declarado:** a plataforma é ferramenta de **dimensionamento e proposta**, não projeto executivo (não emite diagrama unifilar, cálculo estrutural ou ART). A vistoria em campo e o projeto final continuam responsabilidade do técnico.

---

## 2. Personas

| Persona | Necesidade | Uso principal |
|---|---|---|
| **Dono de casa** | Reduzir a conta de luz; saber se o telhado "aguenta" | Fluxo on-grid → economia + memorial |
| **Cliente remoto/interior** | Energia onde não há rede confiável | Fluxo off-grid → baterias + autonomia |
| **Técnico/integrador** | Número defensável para proposta e compra de materiais | Os dois fluxos + memorial + memorial impresso |

---

## 3. Escopo funcional

### 3.1 Fluxo UX (5 stages)

```
[Landing] → [Seleção de sistema] → [Formulário] → [Resultado] → [Memorial / Orçamento]
```

1. **Landing** — hero, "Como funciona" (3 etapas), estatísticas, botão *Ver Metodologia* (toast com a metodologia resumida).
2. **Seleção** — escolha On-Grid ou Off-Grid (cards acessíveis por teclado).
3. **Formulário** — inputs específicos do sistema escolhido (ver 3.2/3.3).
4. **Resultado** — 3 cards-resumo, grade "Detalhes Técnicos", avisos (warnings do motor), gráfico.
5. **Memorial / Orçamento** — memorial imprimível (modal) e/ou modal de solicitação de orçamento com resumo da simulação.

### 3.2 Funcionalidades — On-Grid

**Inputs**

| Campo | Tipo | Faixa/Default | Obrigatório |
|---|---|---|---|
| CEP | texto | 8 dígitos | ✅ |
| Consumo mensal | número (kWh) | > 0 | ✅ |
| Área disponível | número (m²) | opcional | ❌ |
| Sombreamento | número | 0–30%, def. 0 | ❌ |
| Tensão da rede | select | 110/127/220/380 V, def. 220 | ✅ |
| Distância do cabo | número (m) | 1–200, def. 10 | ✅ |
| Margem de expansão | número | 0–100%, def. 0 | ❌ |
| Tarifa elétrica | número (R$/kWh) | 0,30–3,00, def. 0,85 | ✅ |
| % Autoconsumo | número | 10–100%, def. 85 | ✅ |
| Orientação do telhado | select | 8 pontos cardeais, def. Sul (180°) | ❌ |
| Inclinação | número (°) | 0–90, def. latitude local | ❌ |
| Fonte do HSP | select | Automático (CEP/PVGIS) ou cidade CRESESB | ✅ |

**Outputs**

- Cards: nº de painéis (W), geração anual (kWh), economia mensal estimada (R$).
- Detalhes: potência kWp, inversor PACO + razão DC/AC, PR, área necessária, tensão da rede, orientação (inclinação + azimute), tarifa/autoconsumo, fonte do HSP (com fator de ajuste quando CRESESB), fusível da string, disjuntor AC, fiação DC/AC, chave seccionadora, DPS, sombra, margem.
- Gráfico: curva de geração × consumo do dia típico (24 h).
- Memorial: tabela completa + checklist de homologação + nota de responsabilidade técnica.

### 3.3 Funcionalidades — Off-Grid

**Inputs**

| Campo | Tipo | Faixa/Default |
|---|---|---|
| Dias de autonomia | número | 1–10, def. 2 |
| CEP | texto | opcional (→ HSP via PVGIS) |
| Fonte do HSP | select | Automático (CEP/PVGIS) ou cidade CRESESB (dropdown — sem digitação livre) |
| Distância do cabo | número (m) | 1–200, def. 10 |
| Área disponível | número (m²) | opcional |
| HSP crítico | texto (decimal) | opcional; def. 80% do HSP |
| Sombreamento | número | 0–30% |
| Margem de expansão | número | 0–100% |
| Tensão do banco (DC) | select | 12 / 24 / 48 V, def. 48 |
| Tensão do inversor AC | select | 127 / 220 V, def. 220 |
| Orientação do telhado | select | 8 pontos cardeais, def. Sul |
| Tipo de bateria | rádio | Chumbo-ácido / Gel / LiFePO₄ (DoD e eficiência por tipo) |
| Equipamentos | tabela dinâmica | nome, potência (W), h/dia, qtd, tipo AC/DC, tensão, indutiva |

**Outputs**

- Cards: potência dos painéis (W + qtd), banco de baterias (Ah/kWh), inversor mínimo (W + kVA).
- Detalhes: HSP (valor + origem), HSP crítico, HSP efetivo, tensões do banco e do inversor, cargas (pico, simultâneas, AC/DC, partida de indutivas), controlador MPPT, array (S×P, Isc), fiação bateria/array, fusíveis, disjuntor AC, DPS/aterramento, área necessária.
- **Avisos automáticos** (warnings do motor): banco ampliado por C-rate; array ajustado por limite de tensão do MPPT; inversor dimensionado pelo pico de partida; falha de geocodificação.
- Gráfico: barras do consumo diário por equipamento.
- Memorial: idem on-grid + linhas de tensões, química da bateria e HSP efetivo.

### 3.4 Orçamento (lead)

Modal com nome, email e WhatsApp + resumo automático da simulação (potência, painéis, geração, economia/inversor). Persiste em `data/leads.json` com sanitização de HTML e limite de 2.000 caracteres no resumo. Endpoint com rate limit.

---

## 4. Metodologia de cálculo (verdade de código)

### 4.1 On-Grid — `python/ongrid_calc.py`

- **Irradiância:** PVGIS-SARAH2 TMY horário via `pvlib.iotools.get_pvgis_tmy`, geocodificação CEP → ViaCEP + Nominatim.
- **Modelo:** `pvlib.modelchain.ModelChain` (AOI físico, sem perda espectral), temperatura SAPM *open-rack glass-glass*; módulo e inversor reais selecionados das bases **CECMod/CECInverter** (módulo-alvo 550 W).
- **Rendimento por painel (sizing):**
  `per_panel_kwh = DC(p_mp) × η_nominal_inversor(0,93) × fator_perdas × fator_sombra`
  onde `fator_perdas = (1 − 0,06 DC) × (1 − 0,03 AC) = 0,9118` (8,82%).
- **Alvo:** `consumo_mensal × 12 × 1,15 (cobertura) × (1 + margem)`.
- **Geração anual:** AC horário × sombra × perdas × fator HSP (se override).
- **Override CRESESB:** `fator = HSP_manual / HSP_equivalente_da_série (GHI médio)` aplicado a sizing, geração, POA e séries — mantém curva/temperatura e corrige a magnitude.
- **Economia:** `geração_anual × tarifa × autoconsumo% / 12` (sem multiplicadores ocultos).
- **Performance Ratio:** `geração / (kWp × POA)` — preservado sob override.
- **BOM:**
  - Fusível string: **1,56 × Isc** (NEC 690.8 / NBR 16274) arredondado para tabela comercial;
  - Corrente AC: monofásico `P/V`; trifásico 380 V **`P/(√3 × V)`**;
  - Disjuntor: `1,25 × I_ac` → tabela comercial;
  - Fiação DC/AC: fórmula de queda ≤ 2% (cobre 56) → seção comercial;
  - String: `mps ≤ Vdcmax/(Voc×1,2)` e `Vmp×mps ≤ Mppt_high`.

### 4.2 Off-Grid — `python/offgrid_calc.py`

- **Carga:** `Σ (W × h/dia)` + margem; picos separados AC/DC e partida indutiva (**surto 3×**).
- **HSP:** manual (dropdown CRESESB) > automático (PVGIS via CEP, com transposição ao plano do painel) > padrão 4,5 h; **HSP crítico** def. 80% do HSP, descontando sombra.
- **Bateria:** `Ah = (Wh_diário × autonomia) / (V × DoD × η)`; **C-rate:** `Ah_corrente = I_contínuo_inversor / C_max` (`chumbo/gel = 0,25C`, `lítio = 1,0C`); banco = **max(energia, corrente)** com aviso se ampliado. DoD/eficiência por química (0,5/0,85 · 0,6/0,85 · 0,9/0,95).
- **Inversor:** `max(Σ AC, pico_partida AC) × 1,1`.
- **Array:** painel genérico 550 W (Voc 49,5 V · Isc 14,2 A · Vmp 41,5 V); `série = ⌊150 V MPPT / (Voc×1,2)⌋`; strings = `⌈necessário/série⌉`; **quantidade reportada = série × strings** (múltiplo real, nunca o desejado).
- **Corrente do banco:** `I = P_inv / (V_banco × η)`; fiação/fusível por corrente com queda ≤ 2%; disjuntor AC = `1,25 × P_inv / V_inversorAC` (127/220 V).
- **Controlador:** `I_array = Isc × strings × 1,25` → tabela comercial; valida `Vmp_string ≤ 150 V`.

### 4.3 Constantes globais

| Constante | Valor | Uso |
|---|---|---|
| `DC_LOSS` / `CABLE_LOSS` | 6% / 3% | derate on-grid |
| `NOMINAL_INVERTER_EFF` | 0,93 | sizing on-grid (medido em campo) |
| `COBERTURA_MARGEM` | 1,15 | margem de cobertura on-grid |
| `DC_AC_RATIO` | 1,2 | seleção de inversor |
| `SURGE_FACTOR` | 3 | partida de motor indutivo |
| `MPPT_VMAX` | 150 V | limite de série do array |
| `RECARGA_FATOR` | 1,25 | sobrecarga de geração off-grid |
| `MARGEM_CRITICA` | 0,80 | HSP crítico default |
| `VOLTAGE_DROP` | 2% | dimensionamento de fiação |
| Tabelas comerciais | fusíveis, disjuntores, seções, controladores | arredondamento padrão de mercado |

---

## 5. Requisitos funcionais

| ID | Requisito | Status |
|---|---|---|
| RF-01 | Geocodificar CEP → coordenadas (ViaCEP + Nominatim) | ✅ |
| RF-02 | Simular geração on-grid anual horária (PVGIS + pvlib) | ✅ |
| RF-03 | Dimensionar painéis/inversor on-grid por geração líquida | ✅ |
| RF-04 | Calcular economia com tarifa e % autoconsumo informados | ✅ |
| RF-05 | Aplicar orientação (azimute/inclinação) nos dois sistemas | ✅ |
| RF-06 | Dimensionar off-grid por lista de equipamentos com autonomia | ✅ |
| RF-07 | Dimensionar banco por química (DoD/η) com limite de C-rate | ✅ |
| RF-08 | Recalcular Ah/fiação/fusível por tensão do banco (12/24/48 V) | ✅ |
| RF-09 | Dimensionar disjuntor/cabo AC pela tensão do inversor (127/220 V) | ✅ |
| RF-10 | BOM on-grid: fusível 1,56×Isc, √3 no 380 V, fiação por queda ≤2% | ✅ |
| RF-11 | Override de HSP via dropdown CRESESB (capitais + ~200 cidades) nos dois sistemas | ✅ |
| RF-12 | Emitir avisos quando ajustes conservadores alteram o resultado | ✅ |
| RF-13 | Gerar memorial de cálculo imprimível com checklist | ✅ |
| RF-14 | Registrar lead de orçamento com resumo da simulação | ✅ |
| RF-15 | Validar todos os inputs no servidor (400 + mensagem pt-BR) | ✅ |
| RF-16 | Exibir metodologia resumida no frontend | ✅ |
| RF-17 | Gráficos: curva horária (on-grid) e barras por equipamento (off-grid) | ✅ |

## 6. Requisitos não funcionais

| ID | Requisito | Status |
|---|---|---|
| RNF-01 | **Zero persistência de cálculo** — nenhum cache em memória/disco; cada requisição recalcula do zero | ✅ |
| RNF-02 | Rate limit: 30 req/min por IP | ✅ |
| RNF-03 | Timeouts: Python 60 s; fetch frontend 90 s; serviços externos 10 s | ✅ |
| RNF-04 | Testes automatizados em 3 camadas (`npm test` = 39 testes) | ✅ |
| RNF-05 | Deploy via Docker (`docker compose up --build`) | ✅ |
| RNF-06 | Acessibilidade básica: skip-link, `aria-*`, foco visível, navegação por teclado em cards | ✅ |
| RNF-07 | Sanitização de entrada de lead (HTML removido, resumo ≤ 2.000 chars) | ✅ |
| RNF-08 | Resposta pt-BR em todas as mensagens de erro | ✅ |
| RNF-09 | Mobile-first responsivo | ✅ |

---

## 7. Arquitetura

### 7.1 Diagrama

```
┌──────────────────────────── Browser ─────────────────────────────┐
│  public/index.html + styles.css + app.js + data-cresesb-hsp.js   │
│  (Chart.js via CDN)   ·  nenhum localStorage / sessionStorage     │
└──────────────────────────────┬───────────────────────────────────┘
                               │ POST /api/...
┌──────────────────────────────▼───────────────────────────────────┐
│                    server.js  (Node 22 + Express)                │
│  validações · rate limit · geocodificação · zero cache           │
│  ViaCEP ──► Nominatim (lat/lon)                                  │
│  spawn por requisição ──► .venv/bin/python                       │
└──────────────┬──────────────────────────────┬────────────────────┘
               │ stdin JSON                   │ stdout JSON
   ┌───────────▼───────────┐      ┌───────────▼────────────┐
   │  ongrid_calc.py       │      │  offgrid_calc.py       │
   │  pvlib ModelChain     │      │  dimensionamento       │
   │  CEC Mod/Inverter     │      │  por equipamentos      │
   └───────────┬───────────┘      └───────────┬────────────┘
               │ get_pvgis_tmy                │ (HSP: PVGIS se CEP)
               └──────────► PVGIS-SARAH2 ◄────┘
```

### 7.2 Estrutura de arquivos

```
server.js                 API + orquestração + validações (zero cache)
public/
  index.html              Markup (5 stages, modais, forms)
  app.js                  Lógica do frontend (coleta, render, memorial)
  styles.css              Tema escuro, responsivo
  data-cresesb-hsp.js     Tabela HSP por UF/cidade (CRESESB/INPE)
  logo.png
python/
  ongrid_calc.py          Engine on-grid (pvlib)
  offgrid_calc.py         Engine off-grid
  requirements.txt        pvlib, numpy, pandas, requests
test/
  server.test.js          20 testes de API (node:test)
  test_ongrid_losses.py    9 testes do motor on-grid
  test_offgrid_calc.py     10 testes do motor off-grid
scripts/python-runner.js  Resolve .venv e roda testes Python
data/                     leads.json (GITIGNORED — não versionar)
Dockerfile · docker-compose.yml · README.md · PRD.md
```

### 7.3 API

| Método | Rota | Entrada principal | Saída |
|---|---|---|---|
| POST | `/api/dimensionar/ongrid` | cep, consumo_mensal_kwh + opcionais (§3.2) | resultado completo on-grid |
| POST | `/api/dimensionar/offgrid` | equipamentos[], bateria_tipo + opcionais (§3.3) | resultado completo off-grid + `avisos[]` |
| POST | `/api/orcamento` | nome, email, whatsapp, sistema, resumo | `{ok:true}` (grava lead) |
| GET | `/api/health` | — | `{status, cache:"disabled", python}` |

### 7.4 Fontes de dados externas

| Fonte | Uso | Credencial |
|---|---|---|
| ViaCEP | CEP → cidade/UF | gratuita |
| Nominatim (OSM) | cidade → coordenadas | gratuita (User-Agent) |
| PVGIS-SARAH2 (JRC) | TMY horário de irradiância | gratuita |
| Tabelas CEC | módulos e inversores (on-grid) | via pvlib |
| Atlas CRESESB/INPE | HSP por cidade (tabela embutida) | — |

### 7.5 Stack tecnológico

| Camada | Tecnologia | Versão | Papel |
|---|---|---|---|
| Runtime backend | Node.js | ≥ 18 (testado 22) | Servidor, validações, orquestração |
| Framework HTTP | Express | ^4.19 | Rotas `/api/*`, rate limit |
| Engine de cálculo | Python | 3.10+ | Processo filho por requisição (`spawn` + stdin/stdout JSON) |
| Simulação solar | pvlib | ≥ 0.10.2 | `ModelChain`, SAPM, base CEC, `get_pvgis_tmy` |
| Numérico | numpy / pandas | ≥ 1.26 / ≥ 2.1 | Séries horárias e agregados |
| HTTP Python | requests | ≥ 2.31 | Clientes HTTP (PVGIS) |
| Frontend | HTML/CSS/JS puro | — | Sem framework, sem build step, sem storage do navegador |
| Gráficos | Chart.js | CDN | Geração × consumo, séries do memorial |
| Infra | Docker / Compose | `node:22-slim` | Imagem única com Node + Python + venv |
| Testes | `node:test` + `python-runner` | — | 20 API + 19 de cálculo = 39 |

---

## 8. Estratégia de testes

| Camada | Arquivo | Qtd | Cobre |
|---|---|---|---|
| API | `test/server.test.js` | 20 | validações 400, health, leads (sanitização/limite) |
| Motor on-grid | `test/test_ongrid_losses.py` | 9 | constantes de perda, sizing DC×η, economia, orientação, BOM (√3, 1,56×Isc), override CRESESB |
| Motor off-grid | `test/test_offgrid_calc.py` | 10 | array múltiplo de série, escala de tensão Ah/kWh/fiação, C-rate chumbo vs lítio, HSP manual, tensão inversor 127/220, validações |

- **Comando:** `npm test` (= `node --test` + 2 testes Python encadeados via `scripts/python-runner.js`).
- **Critério de pronto (DoD):** 39/39 verdes + `docker compose build` OK + verificação E2E ao vivo (cenários padronizados §10).
- **E2E de referência:** SP 01310-100 / 500 kWh/mês → 12 painéis, ~6.995 kWh, PR 0,837 (sul); 10 painéis (norte); CRESESB 4,8 h → fator 1,0408; 12 V = 4× Ah de 48 V; 127 V → disjuntor maior que 220 V.

---

## 9. Sprints — histórico (entregues)

> Ciclos de desenvolvimento com objetivo único e critério de aceite. Todas entregues e verificadas.

### S0 — Fundação
**Objetivo:** esqueleto funcional dos dois sistemas.
**Entregáveis:** stack Node+Express+pvlib; engines base on/off-grid; frontend 5 stages com dark theme; Docker; README; testes de API iniciais.
**Status:** ✅

### S1 — Correção das perdas + auditoria
**Objetivo:** eliminar erro sistemático de geração inflada.
**Entregáveis:** `fator_perdas = 8,82%` aplicado a geração e sizing; auditoria ponta a ponta (frontend → API → engines) com mapeamento de todos os bugs; E2E antes/depois (8.942 kWh, PR 0,856).
**Status:** ✅

### S2 — Precisão on-grid
**Objetivo:** dimensionamento e economia corretos.
**Entregáveis:** sizing por `DC × 0,93 × perdas × sombra` (fim do viés do inversor 8,2 kW); inputs de tarifa e %autoconsumo (fim do 0,85 oculto); orientação parametrizada; BOM com √3 (380 V) e fusível 1,56×Isc; testes 8→9.
**Status:** ✅

### S3 — Precisão off-grid
**Objetivo:** confiabilidade do sistema isolado.
**Entregáveis:** array reportado = série × strings real; tensão do banco 12/24/48 V recalculando Ah/corrente/fiação; check de **C-rate** com ampliação + aviso; avisos expostos no frontend; testes 7→10.
**Status:** ✅

### S4 — Frontend de entrada + memorial
**Objetivo:** todos os dados necessários coletados e auditáveis.
**Entregáveis:** selects de orientação nos dois formulários; tarifa/autoconsumo/tensões no HTML e validações no server; memorial com linhas novas; `METHODOLOGY_TEXT` verdadeiro; zero campos ocultos.
**Status:** ✅

### S5 — CRESESB, tensão do inversor e zero cache
**Objetivo:** fonte de HSP confiável + reprodutibilidade absoluta.
**Entregáveis:** tabela `data-cresesb-hsp.js` (27 UFs, ~200 cidades); dropdown CRESESB nos dois sistemas (elimina digitação livre de HSP); override on-grid com escalonamento `HSP_cresesb/HSP_pvgis`; tensão do inversor AC 127/220 V; **remoção total de cache** (Map + `cache.json` + flag `cached`); testes 20/9/10.
**Status:** ✅

### S6 — Correções de layout + verificação final
**Objetivo:** UI íntegra e veredito de qualidade.
**Entregáveis:** remoção de campo duplicado no off-grid, restauração do sombra/margem, inclusão do select de HSP no on-grid (IDs únicos, divs 100/100); verificação final E2E de todas as funcionalidades (39 testes + 10 cenários ao vivo).
**Status:** ✅

---

## 10. Sprints — backlog (futuras)

| ID | Sprint | Objetivo | Critério de aceite |
|---|---|---|---|
| **F1** | Bloco financeiro (preço/payback) | Input de preço do kit + calculadora de payback e financiamento | Payback bate com simulação manual em 3 cenários |
| **F2** | Perfil horário de consumo | Curva de consumo do cliente (12×24 h) → autoconsumo exato em vez de % estimado | Autoconsumo calculado por sobreposição geração×consumo |
| **F3** | LGPD / HTTPS / painel de leads | Aviso de privacidade no formulário, exclusão de dados, proxy HTTPS, tela administrativa de leads | Checklist LGPD aprovado; leads fora do disco crua |
| **F4** | Acessibilidade & PWA | Auditoria WCAG AA, service worker offline-ready, meta tags/SEO | Lighthouse ≥ 95 em acessibilidade |
| **F5** | Avanços de engenharia | Sombreamento por análise de horizonte, string sizing com temperatura mínima, cálculo de DAS/NBR 1510 | Revisto por engenheiro eletricista |
| **F6** | Multi-idioma / internacionalização | pt-BR + en-US | Chaveamento completo de strings |

---

## 11. Riscos e limitações conhecidas

1. **±5% na geração** — TMY é ano típico; o ano real varia. Inerente a qualquer simulação (inclusive PVsyst).
2. **Modelos CEC** — curvas médias de laboratório; unidade real varia.
3. **Economia simplificada** — `geração × tarifa × %autoconsumo`; não modela regras de banco de horas da concessionária (mitigação prevista: F2).
4. **Off-grid conservador** — dimensiona pelo HSP crítico (pior caso), sem perfil horário de carga; sai maior, nunca menor.
5. **Temperatura mínima (Voc frio)** — não modelada; absorvida pela margem de 20% no cálculo de string.
6. **Tabela CRESESB por UF** — cidades sem tabela municipal herdam o valor do estado (fallback documentado).
7. **Leads em arquivo** (`data/leads.json`) — adequado para uso local; em produção requer F3 (LGPD/painel).
8. **Sem autenticação/HTTPS nativos** — expor publicamente exige proxy reverso (F3).

## 12. Fora de escopo (decisões registradas)

- Preço de kit, orçamento formal e payback **na fase atual** (viram F1).
- Perfil horário de consumo on-grid (virou F2).
- Projeto executivo (diagrama, estrutura, ART) — responsabilidade do técnico.
- Cache opcional de irradiância (violaria o requisito RNF-01 de zero persistência — decisão do produto).

## 13. Critérios globais de aceite (Definition of Done)

- [ ] `npm test` → 39/39
- [ ] `docker compose build` → sucesso
- [ ] E2E de regressão (cenários §8) → resultados esperados
- [ ] HTML sem IDs duplicados, divs balanceadas
- [ ] Nenhum arquivo de cache criado em runtime
- [ ] Erros da API sempre em pt-BR com HTTP adequado

## 14. Glossário

| Termo | Definição |
|---|---|
| **HSP** | Horas de Sol Plico — energia solar diária expressa em horas a 1.000 W/m² |
| **DoD** | Depth of Charge — profundidade de descarga permitida da bateria |
| **C-rate** | Razão de corrente de carga/descarga em função da capacidade (0,25C = ¼ da capacidade/h) |
| **PR** | Performance Ratio — eficiência global do sistema (geração real / ideal) |
| **PACO** | Potência AC nominal de saída do inversor |
| **PVGIS** | Photovoltaic Geographical Information System (JRC/UE) — base de irradiância por satélite |
| **CRESESB** | Centro de Referência para Energia Solar e Eólica (CEPEL) — atlas solarimétrico brasileiro |
| **MPPT** | Maximum Power Point Tracking — rastreador de ponto de máxima potência do inversor/controlador |
| **String** | Conjunto de módulos em série; **matriz/array** = strings em paralelo |
| **Derate** | Fator multiplicativo que aplica perdas de sistema |
| **TMY** | Typical Meteorological Year — ano meteorológico típico |

## 15. Referências

- **pvlib-python** — ModelChain, SAPM, CEC database (docs.pvlib.org)
- **PVGIS-SARAH2** — JRC European Commission, service pvgis.eu
- **Atlas Brasileiro de Energia Solar / Atlas Solarimétrico** — CRESESB-CEPEL e INPE/LABSOLAR
- **NBR 16274** — Circuitos de tomada e derivação (seccionamento DC); **NEC 690.8** — dimensionamento de condutores por sobrecorrente
- **CEC** — California Energy Commission, bases de módulos e inversores (via pvlib `retrieve_sam`)
