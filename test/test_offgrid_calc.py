#!/usr/bin/env python3
"""
Teste de regressão dos cálculos off-grid — roda offgrid_calc.py via subprocess
com HSP manual (sem rede / sem PVGIS).

Cobre:
- Array real é múltiplo do config. de série (5 necessários → 2S×1P = 2... até
  2S×P): quantidade reportada == modules_series × strings_parallel e a potência
  instalada == quantidade × 550 W.
- Tensão do banco: Ah escala com 1/tensão (12 V = 4× Ah de 48 V, mesma energia).
- C-rate: banco ampliado quando a energia não sustenta a corrente contínua.
- Validação de tensão inválida.
"""
import json
import math
import os
import subprocess
import sys

PYTHON = sys.executable
SCRIPT = os.path.join(os.path.dirname(__file__), '..', 'python', 'offgrid_calc.py')


def run_offgrid(payload):
    proc = subprocess.run(
        [PYTHON, SCRIPT],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        timeout=30
    )
    try:
        return json.loads(proc.stdout.strip())
    except json.JSONDecodeError:
        raise AssertionError(f'saída inválida: {proc.stdout!r} stderr={proc.stderr!r}')


def base_payload(**overrides):
    payload = {
        'equipamentos': [
            {'nome': 'Geladeira', 'potencia_w': 120, 'horas_dia': 24, 'quantidade': 1, 'tipo': 'ac', 'tensao': 220},
            {'nome': 'Iluminação', 'potencia_w': 60, 'horas_dia': 5, 'quantidade': 4, 'tipo': 'ac', 'tensao': 127},
        ],
        'bateria_tipo': 'litio_lifepo4',
        'dias_autonomia': 2,
        'hsp_manual': 4.5,
        'tensao_sistema_v': 48
    }
    payload.update(overrides)
    return payload


def test_array_multiplo_de_serie():
    for consumo_extra_w, horas in [(300, 2), (800, 3), (1500, 4)]:
        eqs = base_payload()['equipamentos'] + [
            {'nome': 'Carga extra', 'potencia_w': consumo_extra_w, 'horas_dia': horas, 'quantidade': 1, 'tipo': 'ac', 'tensao': 220}
        ]
        r = run_offgrid(base_payload(equipamentos=eqs))
        assert 'error' not in r, r.get('error')
        assert r['quantidade_paineis'] == r['modules_series'] * r['strings_parallel'], (
            f"quantidade {r['quantidade_paineis']} != {r['modules_series']}S×{r['strings_parallel']}P"
        )
        assert r['potencia_paineis_w'] == r['quantidade_paineis'] * 550, (
            f"potência {r['potencia_paineis_w']} != {r['quantidade_paineis']}×550"
        )
        min_paineis = math.ceil(r['wp_necessarios'] / 550)
        assert r['quantidade_paineis'] >= min_paineis, (
            f"array {r['quantidade_paineis']} menor que o mínimo necessário {min_paineis}"
        )


def test_consumo_baixo_arredonda_para_cima():
    # Consumo baixo pede 1 painel; o config. 2S força 2 instalados (antes: reportava 1).
    r = run_offgrid(base_payload(equipamentos=[
        {'nome': 'Rádio', 'potencia_w': 20, 'horas_dia': 4, 'quantidade': 1, 'tipo': 'ac', 'tensao': 127}
    ]))
    assert 'error' not in r, r.get('error')
    assert r['wp_necessarios'] <= 550, f"esperava pedido ≤1 painel, veio {r['wp_necessarios']} W"
    assert r['quantidade_paineis'] == r['modules_series'] * r['strings_parallel']
    assert r['quantidade_paineis'] % 2 == 0, 'com 2 em série o array real deve ser par'


def test_tensao_escala_ah_e_corrente():
    r48 = run_offgrid(base_payload(tensao_sistema_v=48))
    r12 = run_offgrid(base_payload(tensao_sistema_v=12))
    assert 'error' not in r48 and 'error' not in r12

    assert r48['tensao_sistema_v'] == 48 and r12['tensao_sistema_v'] == 12

    # Mesma energia armazenada, Ah escala com 1/V.
    ratio = r12['capacidade_bateria_ah'] / r48['capacidade_bateria_ah']
    assert 3.9 <= ratio <= 4.1, f'Ah 12V/48V = {ratio:.2f} (esperado ~4)'
    stored_ratio = r12['energia_armazenada_kwh'] / r48['energia_armazenada_kwh']
    assert 0.98 <= stored_ratio <= 1.02, f'energia armazenada divergiu: {stored_ratio:.2f}'

    # Menor tensão => maior corrente => fiação de bateria mais grossa.
    assert r12['fio_bateria_mm2'] > r48['fio_bateria_mm2'], (
        f"fiação 12V ({r12['fio_bateria_mm2']}) deveria ser maior que 48V ({r48['fio_bateria_mm2']})"
    )


def test_crate_amplia_banco_chumbo():
    # Carga AC grande com poucas horas: energia pede pouco Ah, mas a corrente
    # contínua do inversor excede 0,25C do chumbo-ácido -> banco deve ampliar.
    r = run_offgrid(base_payload(
        bateria_tipo='chumbo_acido',
        equipamentos=[
            {'nome': 'Ar-condicionado', 'potencia_w': 3000, 'horas_dia': 1, 'quantidade': 1, 'tipo': 'ac', 'tensao': 220}
        ]
    ))
    assert 'error' not in r, r.get('error')
    assert r['bateria_ampliada_corrente'] is True, 'banco deveria ter sido ampliado pela corrente'
    assert r['bateria_crate_max'] == 0.25
    ah_energia = (3000 * 2) / (48 * 0.5 * 0.85)
    assert r['capacidade_bateria_ah'] > ah_energia, (
        f"capacidade {r['capacidade_bateria_ah']} Ah deveria superar a base de energia {ah_energia:.1f} Ah"
    )
    assert any('corrente' in a for a in r['avisos']), 'deveria emitir aviso de C-rate'


def test_litio_nao_amplia_no_mesmo_caso():
    r = run_offgrid(base_payload(
        bateria_tipo='litio_lifepo4',
        equipamentos=[
            {'nome': 'Ar-condicionado', 'potencia_w': 3000, 'horas_dia': 1, 'quantidade': 1, 'tipo': 'ac', 'tensao': 220}
        ]
    ))
    assert 'error' not in r, r.get('error')
    assert r['bateria_crate_max'] == 1.0
    assert r['bateria_ampliada_corrente'] is False, 'lítio 1,0C não deveria precisar ampliar'


def test_tensao_invalida():
    r = run_offgrid(base_payload(tensao_sistema_v=110))
    assert 'error' in r, 'tensão inválida deveria retornar erro'
    assert '12, 24 ou 48' in r['error']


def test_hsp_manual_aplicado():
    r = run_offgrid(base_payload(hsp_manual=5.2))
    assert 'error' not in r, r.get('error')
    assert r['hsp_usado'] == 5.2
    assert 'manual' in r['hsp_origem']


def test_tensao_inversor_ac_127_vs_220():
    payload = {'equipamentos': [
        {'nome': 'Ar-condicionado', 'potencia_w': 2000, 'horas_dia': 4, 'quantidade': 1, 'tipo': 'ac', 'tensao': 220}
    ]}
    r220 = run_offgrid(base_payload(tensao_inversor_ac=220, **payload))
    r127 = run_offgrid(base_payload(tensao_inversor_ac=127, **payload))
    assert 'error' not in r220 and 'error' not in r127
    assert r220['tensao_inversor_ac'] == 220
    assert r127['tensao_inversor_ac'] == 127
    # Mesmo inversor: corrente AC 127V ≈ √3... não — 220/127 ≈ 1,73×
    ratio = (r127['inversor_minimo_w'] / 127) / (r220['inversor_minimo_w'] / 220)
    assert 1.70 <= ratio <= 1.76, f'corrente 127/220 = {ratio:.3f} (esperado ~1,732)'
    assert r127['disjuntor_ac_a'] >= r220['disjuntor_ac_a'], (
        f"disjuntor 127V ({r127['disjuntor_ac_a']}A) deveria ser ≥ 220V ({r220['disjuntor_ac_a']}A)"
    )


def test_tensao_inversor_ac_padrao_220():
    r = run_offgrid(base_payload())
    assert 'error' not in r, r.get('error')
    assert r['tensao_inversor_ac'] == 220


def test_tensao_inversor_ac_invalida():
    r = run_offgrid(base_payload(tensao_inversor_ac=15))
    assert 'error' in r, 'tensão de inversor inválida deveria retornar erro'
    assert '127 ou 220' in r['error']


if __name__ == '__main__':
    test_array_multiplo_de_serie()
    test_consumo_baixo_arredonda_para_cima()
    test_tensao_escala_ah_e_corrente()
    test_crate_amplia_banco_chumbo()
    test_litio_nao_amplia_no_mesmo_caso()
    test_tensao_invalida()
    test_hsp_manual_aplicado()
    test_tensao_inversor_ac_127_vs_220()
    test_tensao_inversor_ac_padrao_220()
    test_tensao_inversor_ac_invalida()
    print('OK — cálculos off-grid: array, tensão, C-rate, HSP e tensão AC do inversor verificados.')
