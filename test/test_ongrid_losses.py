#!/usr/bin/env python3
"""
Teste de regressão dos cálculos on-grid (sem rede: valida constantes e o
encadeamento via inspeção da fonte de main()).

Cobre:
- Perdas de sistema (DC_LOSS + CABLE_LOSS) aplicadas como derate explícito.
- Dimensionamento por painel: DC × eficiência nominal × perdas × sombra
  (elimina o viés do inversor de referência sobredimensionado).
- Economia: geração × tarifa_rpkwh × autoconsumo_pct (sem 0,85 oculto).
- Orientação: azimute/inclinação parametrizados em build_system.
- BOM: √3 para trifásico 380V e fusível 1,56×Isc.
"""
import inspect
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'python'))

import importlib.util

_spec = importlib.util.spec_from_file_location(
    'ongrid_calc',
    os.path.join(os.path.dirname(__file__), '..', 'python', 'ongrid_calc.py')
)
og = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(og)

EXPECTED_DC_LOSS = 0.06
EXPECTED_CABLE_LOSS = 0.03
EXPECTED_FATOR_PERDAS = (1 - EXPECTED_DC_LOSS) * (1 - EXPECTED_CABLE_LOSS)  # 0.9118


def test_constantes_de_perda():
    assert abs(og.DC_LOSS - EXPECTED_DC_LOSS) < 1e-9, (
        f'DC_LOSS mudou: {og.DC_LOSS} (esperado {EXPECTED_DC_LOSS})'
    )
    assert abs(og.CABLE_LOSS - EXPECTED_CABLE_LOSS) < 1e-9, (
        f'CABLE_LOSS mudou: {og.CABLE_LOSS} (esperado {EXPECTED_CABLE_LOSS})'
    )


def test_derate_calculado_corretamente():
    fator = (1 - og.DC_LOSS) * (1 - og.CABLE_LOSS)
    assert abs(fator - EXPECTED_FATOR_PERDAS) < 1e-9, (
        f'fator de perdas inesperado: {fator} (esperado {EXPECTED_FATOR_PERDAS})'
    )


def test_eficiencia_nominal_definida():
    assert abs(og.NOMINAL_INVERTER_EFF - 0.93) < 1e-9, (
        f'NOMINAL_INVERTER_EFF mudou: {og.NOMINAL_INVERTER_EFF} (esperado 0.93)'
    )


def test_derate_aplicado_na_geracao():
    src = inspect.getsource(og.main)
    assert 'fator_perdas = (1 - DC_LOSS) * (1 - CABLE_LOSS)' in src
    assert 'fator_sombra * fator_perdas' in src, (
        'fator_perdas não está aplicado sobre a geração em main()'
    )


def test_sizing_por_dc_com_perdas_e_sombra():
    """O rendimento de referência deve ser DC × η × perdas × sombra (líquido)."""
    src = inspect.getsource(og.main)
    assert 'select_inverter(cec_inverters, PANEL_TARGET_W)' in src, (
        'inversor de referência deve ser dimensionado ao módulo, não 10 kW'
    )
    assert "ref_dc['p_mp']" in src, 'sizing deve ler o DC do sistema de referência'
    assert 'NOMINAL_INVERTER_EFF * fator_perdas * fator_sombra' in src, (
        'per_panel_kwh deve incluir eficiência nominal, perdas e sombra'
    )


def test_economia_com_tarifa_e_autoconsumo():
    src = inspect.getsource(og.main)
    assert 'tarifa_rpkwh' in src and 'autoconsumo_pct' in src
    assert 'tarifa_rpkwh * (autoconsumo_pct / 100.0)' in src, (
        'economia deve ser geração × tarifa × %autoconsumo'
    )
    assert '* TARIFF ' not in src and '* 0.85 /' not in src, (
        'fórmula antiga da economia (TARIFF × 0,85 oculto) ainda está presente'
    )


def test_orientacao_parametrizada():
    src = inspect.getsource(og.main)
    assert 'surface_azimuth' in src and 'azimute_graus' in src
    assert 'surface_azimuth=surface_azimuth' in inspect.getsource(og.build_system), (
        'build_system deve aceitar o azimute recebido'
    )


def test_bom_trifasico_e_fusivel():
    src = inspect.getsource(og.main)
    assert 'np.sqrt(3)' in src, 'corrente de linha trifásica deve usar √3'
    assert 'I_sc_ref\') * 1.56' in src or 'I_sc_ref"]) * 1.56' in src or '* 1.56' in src, (
        'fusível de string deve usar 1,56×Isc'
    )


def test_override_hsp_cresesb():
    """Override CRESESB deve escalonar geração pela razão HSP_manual/HSP_PVGIS."""
    src = inspect.getsource(og.main)
    assert 'hsp_manual' in src, 'main() deve aceitar hsp_manual'
    assert 'fator_ajuste_hsp = hsp_manual / hsp_pvgis' in src, (
        'fator de ajuste deve ser razão CRESESB/PVGIS'
    )
    assert '* fator_ajuste_hsp' in src, 'fator_ajuste_hsp deve ser aplicado à geração'
    assert "'hsp_fonte': hsp_fonte" in src and "'fator_ajuste_hsp'" in src, (
        'result deve reportar fonte e fator do HSP'
    )
    # Validação de faixa
    assert '1.0 or hsp_manual > 8.0' in src, 'hsp_manual deve ser validado entre 1 e 8'


if __name__ == '__main__':
    test_constantes_de_perda()
    test_derate_calculado_corretamente()
    test_eficiencia_nominal_definida()
    test_derate_aplicado_na_geracao()
    test_sizing_por_dc_com_perdas_e_sombra()
    test_economia_com_tarifa_e_autoconsumo()
    test_orientacao_parametrizada()
    test_bom_trifasico_e_fusivel()
    test_override_hsp_cresesb()
    print('OK — cálculos on-grid: perdas, sizing DC×η, economia, orientação, BOM e override CRESESB verificados.')
