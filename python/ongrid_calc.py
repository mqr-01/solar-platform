#!/usr/bin/env python3
import sys
import json
import numpy as np
import pandas as pd
import pvlib
from pvlib import location, pvsystem, modelchain
from pvlib.iotools import get_pvgis_tmy
from pvlib.temperature import TEMPERATURE_MODEL_PARAMETERS

PANEL_TARGET_W = 550
DC_LOSS = 0.06
CABLE_LOSS = 0.03
TARIFF_PADRAO = 0.85
AUTOCONSUMO_PADRAO_PCT = 85
NOMINAL_INVERTER_EFF = 0.93
COBERTURA_MARGEM = 1.15
TEMP_MODEL = TEMPERATURE_MODEL_PARAMETERS['sapm']['open_rack_glass_glass']
DC_AC_RATIO = 1.2
AC_VOLTAGE = 220
COPPER_CONDUCTIVITY = 56

BREAKER_RATINGS = [10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250]
FUSE_RATINGS = [10, 15, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315]
CABLE_SECTIONS = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240]


def pick_standard(value, standards):
    for s in standards:
        if value <= s:
            return s
    return int(np.ceil(value / 10) * 10)


def load_weather(latitude, longitude):
    try:
        pvgis_data = get_pvgis_tmy(
            latitude=latitude,
            longitude=longitude,
            outputformat='json'
        )
        weather = pvgis_data[0]
    except Exception as e:
        raise RuntimeError(f'Falha ao obter dados PVGIS: {str(e)}')

    weather.index = pd.to_datetime(weather.index, utc=True)
    weather = weather[~weather.index.duplicated(keep='first')]

    if 'dhi' not in weather.columns:
        weather['dhi'] = weather.pop('IR(h)') if 'IR(h)' in weather.columns else weather['ghi']
    elif 'IR(h)' in weather.columns:
        weather = weather.drop(columns=['IR(h)'])

    weather['temp_air'] = weather.get('temp_air', 25)
    weather['wind_speed'] = weather.get('wind_speed', 2)
    return weather


def select_module(cec_modules, target_w):
    pmax = cec_modules.loc['V_mp_ref'] * cec_modules.loc['I_mp_ref']
    candidates = pmax[pmax > 0]
    best_name = (candidates - target_w).abs().idxmin()
    return cec_modules[best_name], float(candidates[best_name])


def select_inverter(cec_inverters, array_w):
    vdcmax = pd.to_numeric(cec_inverters.loc['Vdcmax'], errors='coerce')
    mppt_high = pd.to_numeric(cec_inverters.loc['Mppt_high'], errors='coerce')
    paco = pd.to_numeric(cec_inverters.loc['Paco'], errors='coerce')

    valid = paco.index[
        (vdcmax >= 300) &
        (paco > 0) &
        mppt_high.notna()
    ]
    if len(valid) == 0:
        valid = paco.index[paco > 0]

    sub_paco = paco[valid]
    best_name = (sub_paco - array_w / DC_AC_RATIO).abs().idxmin()
    return cec_inverters[best_name], float(paco[best_name])


def size_strings(inverter_params, module_params, panels):
    voc = float(module_params['V_oc_ref'])
    vmp = float(module_params['V_mp_ref'])
    vdcmax = float(inverter_params['Vdcmax'])
    mppt_high = float(inverter_params['Mppt_high'])

    mps = max(1, int(vdcmax // (voc * 1.2)))
    while mps > 1 and (vmp * mps > mppt_high or voc * 1.2 * mps > vdcmax):
        mps -= 1

    strings = max(1, int(np.ceil(panels / mps)))
    return mps, strings, mps * strings


def build_system(module_params, inverter_params, surface_tilt, mps, strings, surface_azimuth=180):
    # As perdas de sistema (DC_LOSS + CABLE_LOSS) NÃO são modeladas pelo pvlib:
    # são aplicadas como derate explícito em main() (fator_perdas), de forma
    # previsível (exatamente 6% DC × 3% AC) e à prova de mudança de API.
    return pvsystem.PVSystem(
        module_parameters=module_params,
        inverter_parameters=inverter_params,
        temperature_model_parameters=TEMP_MODEL,
        surface_tilt=surface_tilt,
        surface_azimuth=surface_azimuth,
        modules_per_string=mps,
        strings_per_inverter=strings
    )


def run_model(system, site, weather):
    mc = modelchain.ModelChain(system, site, aoi_model='physical', spectral_model='no_loss')
    mc.run_model(weather)
    return mc


def main():
    try:
        input_data = json.load(sys.stdin)
        latitude = float(input_data['latitude'])
        longitude = float(input_data['longitude'])
        consumo_mensal_kwh = float(input_data['consumo_mensal_kwh'])
        cep = input_data.get('cep', '')
        area_disponivel_m2 = input_data.get('area_disponivel_m2')
        sombreamento_pct = float(input_data.get('sombreamento_pct') or 0)
        tensao_rede = float(input_data.get('tensao_rede') or 220)
        distancia_cabo_m = float(input_data.get('distancia_cabo_m') or 10)
        margem_expansao_pct = float(input_data.get('margem_expansao_pct') or 0)
        tarifa_rpkwh = float(input_data.get('tarifa_rpkwh') or TARIFF_PADRAO)
        autoconsumo_pct = float(input_data.get('autoconsumo_pct') or AUTOCONSUMO_PADRAO_PCT)
        azimute_graus = input_data.get('azimute_graus')
        inclinacao_graus = input_data.get('inclinacao_graus')
        hsp_manual = input_data.get('hsp_manual')

        if sombreamento_pct < 0 or sombreamento_pct > 30:
            raise ValueError('Sombreamento deve ser entre 0 e 30%')
        if margem_expansao_pct < 0 or margem_expansao_pct > 100:
            raise ValueError('Margem de expansão deve ser entre 0 e 100%')
        if tensao_rede not in (110, 127, 220, 380):
            raise ValueError('Tensão da rede deve ser 110, 127, 220 ou 380V')
        if tarifa_rpkwh < 0.3 or tarifa_rpkwh > 3.0:
            raise ValueError('Tarifa deve ser entre 0,30 e 3,00 R$/kWh')
        if autoconsumo_pct < 10 or autoconsumo_pct > 100:
            raise ValueError('Autoconsumo deve ser entre 10 e 100%')
        if hsp_manual is not None and hsp_manual != '':
            hsp_manual = float(hsp_manual)
            if hsp_manual < 1.0 or hsp_manual > 8.0:
                raise ValueError('HSP manual deve ser entre 1,0 e 8,0 h/dia')
        else:
            hsp_manual = None
        if area_disponivel_m2 is not None:
            area_disponivel_m2 = float(area_disponivel_m2)
            if area_disponivel_m2 <= 0:
                raise ValueError('Área disponível deve ser maior que zero')

        surface_tilt = abs(latitude)
        if inclinacao_graus is not None and inclinacao_graus != '':
            surface_tilt = float(inclinacao_graus)
            if surface_tilt < 0 or surface_tilt > 90:
                raise ValueError('Inclinação deve ser entre 0 e 90 graus')
        surface_azimuth = 180.0
        if azimute_graus is not None and azimute_graus != '':
            surface_azimuth = float(azimute_graus)
            if surface_azimuth < 0 or surface_azimuth > 360:
                raise ValueError('Azimute deve ser entre 0 e 360 graus')

        fator_sombra = 1 - sombreamento_pct / 100.0
        # Perda fixa de sistema: 6% DC (cabos DC) × 3% AC (cabos/inversor) = 8,82%.
        fator_perdas = (1 - DC_LOSS) * (1 - CABLE_LOSS)

        site = location.Location(latitude, longitude, tz='America/Sao_Paulo')
        weather = load_weather(latitude, longitude)

        # HSP equivalente da série TMY (GHI kWh/m²/dia). Serve de referência
        # quando o usuário escolhe o HSP oficial do Atlas CRESESB.
        hsp_pvgis = float(weather['ghi'].sum()) / 1000 / max(len(weather.index.normalize().unique()), 1)
        hsp_fonte = 'pvgis'
        fator_ajuste_hsp = 1.0
        if hsp_manual is not None and hsp_pvgis > 0:
            hsp_fonte = 'cresesb'
            fator_ajuste_hsp = hsp_manual / hsp_pvgis

        cec_modules = pvsystem.retrieve_sam('CECMod')
        cec_inverters = pvsystem.retrieve_sam('CECInverter')

        module_params, module_pmax = select_module(cec_modules, PANEL_TARGET_W)

        # Rendimento por painel medido no DC (antes do inversor) e convertido
        # com eficiência nominal — evita o viés de um inversor sobredimensionado
        # em carga mínima, que subestimava o rendimento e inflava o nº de painéis.
        ref_inverter, _ = select_inverter(cec_inverters, PANEL_TARGET_W)
        ref_system = build_system(module_params, ref_inverter, surface_tilt, 1, 1, surface_azimuth)
        ref_mc = run_model(ref_system, site, weather)
        ref_dc = ref_mc.results.dc
        ref_dc_series = ref_dc['p_mp'] if hasattr(ref_dc, 'columns') else ref_dc
        per_panel_dc_kwh = float(ref_dc_series.fillna(0).clip(lower=0).sum()) / 1000 * fator_ajuste_hsp
        # Alvo em geração LÍQUIDA: eficiência do inversor + perdas de sistema + sombra.
        per_panel_kwh = per_panel_dc_kwh * NOMINAL_INVERTER_EFF * fator_perdas * fator_sombra

        if per_panel_kwh <= 0:
            raise RuntimeError('Geração anual por painel calculada como zero. Verifique os dados PVGIS.')

        target_annual_kwh = consumo_mensal_kwh * 12 * COBERTURA_MARGEM * (1 + margem_expansao_pct / 100.0)
        panels = max(1, int(np.ceil(target_annual_kwh / per_panel_kwh)))

        array_w = panels * module_pmax
        inverter_params, inverter_paco = select_inverter(cec_inverters, array_w)

        mps, strings, actual_panels = size_strings(inverter_params, module_params, panels)
        system = build_system(module_params, inverter_params, surface_tilt, mps, strings, surface_azimuth)

        mc = run_model(system, site, weather)
        ac_hourly = mc.results.ac.fillna(0).clip(lower=0)
        annual_generation_kwh = float(ac_hourly.sum()) / 1000 * fator_sombra * fator_perdas * fator_ajuste_hsp

        poa_annual_kwh = float(mc.results.total_irrad['poa_global'].sum()) / 1000 * fator_ajuste_hsp
        system_size_kw = round(actual_panels * module_pmax / 1000, 2)
        if poa_annual_kwh > 0:
            performance_ratio = round(annual_generation_kwh / (system_size_kw * poa_annual_kwh), 3)
        else:
            performance_ratio = 0.78

        ac_local = (ac_hourly * fator_sombra * fator_perdas * fator_ajuste_hsp).tz_convert('America/Sao_Paulo')
        monthly_full = ac_local.resample('ME').size() >= (24 * 25)
        monthly_generation_kwh = [round(float(v), 2) for v in (ac_local.resample('ME').sum() / 1000)[monthly_full].values]
        typical_day = ac_local.groupby(ac_local.index.hour).mean() / 1000
        typical_day_kwh = [round(float(typical_day.get(h, 0.0)), 4) for h in range(24)]

        daily_consumption_kwh = (consumo_mensal_kwh / 30) / 24
        consumo_horario = [round(daily_consumption_kwh, 4)] * 24

        # Economia = energia efetivamente autoconsumida × tarifa da concessionária.
        economia_mensal_estimada = round(
            annual_generation_kwh * tarifa_rpkwh * (autoconsumo_pct / 100.0) / 12, 2
        )

        dc_ac_ratio = round(array_w / inverter_paco, 2)
        array_isc_a = float(module_params['I_sc_ref']) * strings
        # 1,56×Isc evita queima do fusível por surto transiente (NEC 690.8 / NBR 16274).
        fusivel_string_a = pick_standard(float(module_params['I_sc_ref']) * 1.56, FUSE_RATINGS)
        if tensao_rede == 380:
            # Trifásico: corrente de linha = P / (√3 × V).
            inverter_ac_current = inverter_paco / (np.sqrt(3) * tensao_rede)
        else:
            inverter_ac_current = inverter_paco / tensao_rede
        disjuntor_ac_a = pick_standard(inverter_ac_current * 1.25, BREAKER_RATINGS)

        vmp_string = float(module_params['V_mp_ref']) * mps
        delta_v_dc = 0.02 * vmp_string
        cable_dc_mm2 = (2 * distancia_cabo_m * array_isc_a) / (COPPER_CONDUCTIVITY * delta_v_dc)
        cable_dc_mm2 = pick_standard(cable_dc_mm2, CABLE_SECTIONS)

        delta_v_ac = 0.02 * tensao_rede
        cable_ac_mm2 = (2 * distancia_cabo_m * inverter_ac_current) / (COPPER_CONDUCTIVITY * delta_v_ac)
        cable_ac_mm2 = pick_standard(cable_ac_mm2, CABLE_SECTIONS)

        module_area = float(module_params['A_c'])
        area_necessaria_m2 = round(actual_panels * module_area * 1.15, 1)
        area_info = None
        if area_disponivel_m2 is not None:
            area_suficiente = area_disponivel_m2 >= area_necessaria_m2
            area_info = {
                'area_disponivel_m2': area_disponivel_m2,
                'area_necessaria_m2': area_necessaria_m2,
                'area_suficiente': area_suficiente,
                'area_faltante_m2': round(max(0.0, area_necessaria_m2 - area_disponivel_m2), 1)
            }

        result = {
            'cep': cep,
            'latitude': latitude,
            'longitude': longitude,
            'system_size_kw': system_size_kw,
            'panels_count': actual_panels,
            'module_model': str(module_params.name),
            'module_w': round(module_pmax, 1),
            'inverter_model': str(inverter_params.name),
            'inverter_paco_w': round(inverter_paco, 1),
            'dc_ac_ratio': dc_ac_ratio,
            'annual_generation_kwh': round(annual_generation_kwh, 2),
            'monthly_generation_kwh': monthly_generation_kwh,
            'hourly_generation_kwh': typical_day_kwh,
            'consumo_horario_kwh': consumo_horario,
            'economia_mensal_estimada': economia_mensal_estimada,
            'tarifa_rpkwh': tarifa_rpkwh,
            'autoconsumo_pct': autoconsumo_pct,
            'performance_ratio': performance_ratio,
            'inclinacao': round(surface_tilt, 1),
            'azimute': round(surface_azimuth, 1),
            'hsp_usado': round(hsp_manual if hsp_manual is not None else hsp_pvgis, 2),
            'hsp_fonte': hsp_fonte,
            'hsp_pvgis': round(hsp_pvgis, 2),
            'fator_ajuste_hsp': round(fator_ajuste_hsp, 4),
            'sombreamento_pct': sombreamento_pct,
            'tensao_rede': tensao_rede,
            'margem_expansao_pct': margem_expansao_pct,
            'array_isc_a': round(array_isc_a, 1),
            'fusivel_string_a': fusivel_string_a,
            'disjuntor_ac_a': disjuntor_ac_a,
            'fio_array_mm2': cable_dc_mm2,
            'fio_ac_mm2': cable_ac_mm2,
            'chave_seccionadora': True,
            'dps_recomendado': True,
            'area_necessaria_m2': area_necessaria_m2,
            'area_info': area_info
        }

        print(json.dumps(result))

    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()