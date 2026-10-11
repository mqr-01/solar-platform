#!/usr/bin/env python3
import sys
import json
import math

BATTERY_SPECS = {
    'chumbo_acido': {'dod': 0.5, 'eficiencia': 0.85, 'vida_anos': '2-3', 'custo': 'Baixo'},
    'gel': {'dod': 0.6, 'eficiencia': 0.85, 'vida_anos': '3-5', 'custo': 'Médio'},
    'litio_lifepo4': {'dod': 0.9, 'eficiencia': 0.95, 'vida_anos': '8-10', 'custo': 'Alto'}
}

PANEL_WATTAGE = 550
PANEL_VOC = 49.5
PANEL_ISC = 14.2
PANEL_VMP = 41.5
PANEL_AREA_M2 = 2.58

INVERTER_EFFICIENCY = 0.90
CABLE_LOSS = 0.03
SYSTEM_VOLTAGE = 48
HSP_PADRAO = 4.5

# Carga contínua máxima suportada pelo banco (por hora de capacidade nominal).
CRATE_MAX = {'chumbo_acido': 0.25, 'gel': 0.25, 'litio_lifepo4': 1.0}

SURGE_FACTOR = 3
MPPT_VMAX = 150
RECARGA_FATOR = 1.25
MARGEM_CRITICA = 0.80
VOLTAGE_DROP = 0.02
COPPER_CONDUCTIVITY = 56
DISTANCIA_CABO_PADRAO = 10

CABLE_SECTIONS = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240]
FUSE_RATINGS = [10, 15, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315]
BREAKER_RATINGS = [10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250]
CONTROLLER_RATINGS = [30, 40, 50, 60, 80, 100, 120, 150]
INVERTER_AC_VOLTAGES = (127, 220)


def pick_standard(value, standards):
    for s in standards:
        if value <= s:
            return s
    return int(math.ceil(value / 10) * 10)


def compute_hsp(latitude, longitude, surface_tilt, surface_azimuth):
    try:
        import pandas as pd
        from pvlib import solarposition, irradiance
        from pvlib.iotools import get_pvgis_tmy

        weather = get_pvgis_tmy(
            latitude=latitude,
            longitude=longitude,
            outputformat='json'
        )[0]
        weather.index = pd.to_datetime(weather.index, utc=True)
        weather = weather[~weather.index.duplicated(keep='first')]

        if 'dhi' not in weather.columns:
            weather['dhi'] = weather.pop('IR(h)') if 'IR(h)' in weather.columns else weather['ghi']
        elif 'IR(h)' in weather.columns:
            weather = weather.drop(columns=['IR(h)'])

        solar_pos = solarposition.get_solarposition(
            weather.index,
            latitude=latitude,
            longitude=longitude
        )

        total_irrad = irradiance.get_total_irradiance(
            surface_tilt=surface_tilt,
            surface_azimuth=surface_azimuth,
            solar_zenith=solar_pos['apparent_zenith'],
            solar_azimuth=solar_pos['azimuth'],
            dni=weather['dni'],
            ghi=weather['ghi'],
            dhi=weather['dhi']
        )

        daily_poa_kwh = total_irrad['poa_global'].resample('D').sum() / 1000
        hsp = float(daily_poa_kwh.mean())
        return min(max(hsp, 3.0), 7.0)
    except Exception:
        return HSP_PADRAO


def main():
    try:
        input_data = json.load(sys.stdin)
        equipamentos = input_data['equipamentos']
        bateria_tipo = input_data['bateria_tipo']
        dias_autonomia = input_data.get('dias_autonomia', 2)
        latitude = input_data.get('latitude')
        longitude = input_data.get('longitude')
        hsp_manual = input_data.get('hsp_manual')
        hsp_critico_input = input_data.get('hsp_critico')
        distancia_cabo_m = float(input_data.get('distancia_cabo_m') or DISTANCIA_CABO_PADRAO)
        area_disponivel_m2 = input_data.get('area_disponivel_m2')
        margem_expansao_pct = float(input_data.get('margem_expansao_pct') or 0)
        sombreamento_pct = float(input_data.get('sombreamento_pct') or 0)
        tensao_sistema_v = float(input_data.get('tensao_sistema_v') or SYSTEM_VOLTAGE)
        tensao_inversor_ac = float(input_data.get('tensao_inversor_ac') or 220)
        azimute_graus = input_data.get('azimute_graus')
        inclinacao_graus = input_data.get('inclinacao_graus')

        if margem_expansao_pct < 0 or margem_expansao_pct > 100:
            raise ValueError('Margem de expansão deve ser entre 0 e 100%')
        if sombreamento_pct < 0 or sombreamento_pct > 30:
            raise ValueError('Sombreamento deve ser entre 0 e 30%')
        if tensao_sistema_v not in (12, 24, 48):
            raise ValueError('Tensão do sistema deve ser 12, 24 ou 48V')
        if tensao_inversor_ac not in INVERTER_AC_VOLTAGES:
            raise ValueError('Tensão do inversor AC deve ser 127 ou 220V')
        if latitude is not None:
            latitude = float(latitude)
            longitude = float(longitude)
        surface_tilt = abs(latitude) if latitude is not None else 23.0
        if inclinacao_graus is not None and inclinacao_graus != '':
            surface_tilt = float(inclinacao_graus)
            if surface_tilt < 0 or surface_tilt > 90:
                raise ValueError('Inclinação deve ser entre 0 e 90 graus')
        surface_azimuth = 180.0
        if azimute_graus is not None and azimute_graus != '':
            surface_azimuth = float(azimute_graus)
            if surface_azimuth < 0 or surface_azimuth > 360:
                raise ValueError('Azimute deve ser entre 0 e 360 graus')

        if bateria_tipo not in BATTERY_SPECS:
            raise ValueError(f'Tipo de bateria inválido: {bateria_tipo}. Use: {list(BATTERY_SPECS.keys())}')

        specs = BATTERY_SPECS[bateria_tipo]
        dod = specs['dod']
        eficiencia = specs['eficiencia']

        total_daily_wh = 0.0
        peak_load_w = 0.0
        pico_partida_w = 0.0
        soma_cargas_w = 0.0
        soma_cargas_ac_w = 0.0
        pico_partida_ac_w = 0.0
        cargas_indutivas = 0
        curva_carga = []

        for eq in equipamentos:
            potencia = float(eq['potencia_w'])
            quantidade = int(eq.get('quantidade', 1) or 1)
            if quantidade < 1:
                raise ValueError('Quantidade deve ser no mínimo 1')
            horas = float(eq['horas_dia'])
            indutiva = bool(eq.get('indutiva'))
            tipo = str(eq.get('tipo', 'ac')).lower()
            if tipo not in ('ac', 'cc', 'dc'):
                tipo = 'ac'
            tensao = float(eq.get('tensao', 220) or 220)
            potencia_total = potencia * quantidade
            total_daily_wh += potencia_total * horas
            soma_cargas_w += potencia_total
            peak_load_w = max(peak_load_w, potencia_total)
            surge = potencia_total * SURGE_FACTOR if indutiva else potencia_total
            pico_partida_w = max(pico_partida_w, surge)
            if tipo == 'ac':
                soma_cargas_ac_w += potencia_total
                pico_partida_ac_w = max(pico_partida_ac_w, surge)
            if indutiva:
                cargas_indutivas += quantidade
            curva_carga.append({
                'nome': str(eq.get('nome', 'Equipamento')),
                'quantidade': quantidade,
                'potencia_w': potencia,
                'tensao': tensao,
                'tipo': tipo,
                'horas_dia': horas,
                'potencia_total_w': round(potencia_total, 1),
                'wh_dia': round(potencia_total * horas, 1)
            })

        curva_carga.sort(key=lambda c: c['wh_dia'], reverse=True)

        if total_daily_wh <= 0:
            raise ValueError('Consumo total diário deve ser maior que zero')

        fator_margem = 1 + margem_expansao_pct / 100.0
        total_daily_wh = total_daily_wh * fator_margem

        if hsp_manual is not None:
            hsp = min(max(float(hsp_manual), 1.0), 10.0)
            hsp_origem = 'manual (CRESESB)'
        elif latitude is not None and longitude is not None:
            hsp = compute_hsp(latitude, longitude, surface_tilt, surface_azimuth)
            hsp_origem = 'PVGIS'
        else:
            hsp = HSP_PADRAO
            hsp_origem = 'padrão'

        if hsp_critico_input is not None:
            hsp_critico = min(max(float(hsp_critico_input), 1.0), 10.0)
        else:
            hsp_critico = round(hsp * MARGEM_CRITICA, 2)

        hsp_efetivo = hsp_critico * (1 - sombreamento_pct / 100.0)

        system_eff = INVERTER_EFFICIENCY * (1 - CABLE_LOSS)

        energia_diaria_produzir = (total_daily_wh / eficiencia) * RECARGA_FATOR
        required_wp = energia_diaria_produzir / (hsp_efetivo * system_eff)
        required_wp = max(required_wp, 300)

        needed_panels = max(1, int((required_wp + PANEL_WATTAGE - 1) // PANEL_WATTAGE))
        modules_series = max(1, int(MPPT_VMAX // (PANEL_VOC * 1.2)))
        strings_parallel = max(1, int(math.ceil(needed_panels / modules_series)))
        # O array instalado é sempre múltiplo do config. de série — reportar o
        # valor REAL (ex.: 5 necessários → 2S×3P = 6 instalados), não o desejado.
        panel_count = modules_series * strings_parallel
        potencia_paineis_w = panel_count * PANEL_WATTAGE
        system_kw = round(potencia_paineis_w / 1000, 2)

        inverter_demanda_w = max(soma_cargas_ac_w, pico_partida_ac_w)
        min_inverter_w = round(inverter_demanda_w * 1.1)

        battery_current_max = min_inverter_w / (tensao_sistema_v * INVERTER_EFFICIENCY)

        battery_energy_wh = total_daily_wh * dias_autonomia
        ah_por_energia = battery_energy_wh / (tensao_sistema_v * dod * eficiencia)
        # C-rate: o banco precisa sustentar a corrente contínua do inversor.
        crate_max = CRATE_MAX[bateria_tipo]
        ah_por_corrente = battery_current_max / crate_max
        battery_capacity_ah = round(max(ah_por_energia, ah_por_corrente), 1)
        banco_ampliado_corrente = ah_por_corrente > ah_por_energia
        stored_kwh = round(battery_capacity_ah * tensao_sistema_v / 1000, 2)

        if min_inverter_w < 1000:
            inverter_recommendation = '1.5 kVA'
        elif min_inverter_w < 3000:
            inverter_recommendation = '3 kVA'
        elif min_inverter_w < 5000:
            inverter_recommendation = '5 kVA'
        elif min_inverter_w < 8000:
            inverter_recommendation = '8 kVA'
        elif min_inverter_w < 12000:
            inverter_recommendation = '12 kVA'
        else:
            inverter_recommendation = f'{round(min_inverter_w / 1000)} kVA'

        array_isc = PANEL_ISC * strings_parallel

        controller_current = round(array_isc * 1.25, 1)
        controller_recommendation = pick_standard(controller_current, CONTROLLER_RATINGS)

        delta_v_bat = VOLTAGE_DROP * tensao_sistema_v
        cable_battery_mm2 = (2 * distancia_cabo_m * battery_current_max) / (COPPER_CONDUCTIVITY * delta_v_bat)
        cable_battery_mm2 = pick_standard(cable_battery_mm2, CABLE_SECTIONS)

        vmp_string = PANEL_VMP * modules_series
        delta_v_arr = VOLTAGE_DROP * vmp_string
        cable_array_mm2 = (2 * distancia_cabo_m * array_isc) / (COPPER_CONDUCTIVITY * delta_v_arr)
        cable_array_mm2 = pick_standard(cable_array_mm2, CABLE_SECTIONS)

        fusivel_bateria_a = pick_standard(battery_current_max * 1.25, FUSE_RATINGS)
        fusivel_array_a = pick_standard(array_isc * 1.25, FUSE_RATINGS)
        inverter_ac_current = min_inverter_w / tensao_inversor_ac
        disjuntor_ac_a = pick_standard(inverter_ac_current * 1.25, BREAKER_RATINGS)

        area_necessaria_m2 = round(panel_count * PANEL_AREA_M2 * 1.15, 1)
        area_info = None
        if area_disponivel_m2 is not None:
            area_disponivel_m2 = float(area_disponivel_m2)
            area_suficiente = area_disponivel_m2 >= area_necessaria_m2
            area_info = {
                'area_disponivel_m2': area_disponivel_m2,
                'area_necessaria_m2': area_necessaria_m2,
                'area_suficiente': area_suficiente,
                'area_faltante_m2': round(max(0.0, area_necessaria_m2 - area_disponivel_m2), 1)
            }

        avisos = []
        if banco_ampliado_corrente:
            avisos.append(
                f'Banco ampliado para {battery_capacity_ah} Ah: a capacidade de energia '
                f'({round(ah_por_energia, 1)} Ah) não sustentaria a corrente contínua de '
                f'{round(battery_current_max, 1)} A do inversor no limite de {crate_max * 100:g}%C.'
            )
        if panel_count > needed_panels:
            avisos.append(
                f'Array ajustado para {panel_count} painéis ({modules_series}S×{strings_parallel}P) '
                f'para respeitar o limite de tensão do controlador; cálculo inicial pedia {needed_panels}.'
            )

        result = {
            'potencia_paineis_w': potencia_paineis_w,
            'wp_necessarios': round(required_wp),
            'quantidade_paineis': panel_count,
            'potencia_sistema_kw': system_kw,
            'capacidade_bateria_ah': battery_capacity_ah,
            'energia_armazenada_kwh': stored_kwh,
            'tensao_sistema_v': tensao_sistema_v,
            'tensao_inversor_ac': tensao_inversor_ac,
            'bateria_ampliada_corrente': banco_ampliado_corrente,
            'bateria_crate_max': crate_max,
            'inversor_minimo_w': min_inverter_w,
            'inversor_recomendado': inverter_recommendation,
            'autonomia_dias': dias_autonomia,
            'consumo_diario_wh': round(total_daily_wh, 1),
            'carga_pico_w': round(peak_load_w, 1),
            'soma_cargas_w': round(soma_cargas_w, 1),
            'soma_cargas_ac_w': round(soma_cargas_ac_w, 1),
            'cargas_dc_w': round(soma_cargas_w - soma_cargas_ac_w, 1),
            'pico_partida_w': round(pico_partida_w, 1),
            'pico_partida_ac_w': round(pico_partida_ac_w, 1),
            'cargas_indutivas': cargas_indutivas,
            'surge_factor': SURGE_FACTOR,
            'curva_carga': curva_carga,
            'tipo_bateria': bateria_tipo,
            'bateria_dod': dod,
            'bateria_eficiencia': eficiencia,
            'bateria_vida_anos': specs['vida_anos'],
            'bateria_custo': specs['custo'],
            'hsp_usado': round(hsp, 2),
            'hsp_origem': hsp_origem,
            'hsp_critico': round(hsp_critico, 2),
            'hsp_efetivo': round(hsp_efetivo, 2),
            'sombreamento_pct': sombreamento_pct,
            'margem_expansao_pct': margem_expansao_pct,
            'energia_diaria_produzir_wh': round(energia_diaria_produzir, 1),
            'modules_series': modules_series,
            'strings_parallel': strings_parallel,
            'array_isc_a': round(array_isc, 1),
            'controlador_mppt_a': controller_recommendation,
            'controlador_mppt_vmax': MPPT_VMAX,
            'controlador_mppt_cur_a': controller_current,
            'fio_bateria_mm2': cable_battery_mm2,
            'fio_array_mm2': cable_array_mm2,
            'fusivel_bateria_a': fusivel_bateria_a,
            'fusivel_array_a': fusivel_array_a,
            'disjuntor_ac_a': disjuntor_ac_a,
            'dps_recomendado': True,
            'aterramento_recomendado': True,
            'distancia_cabo_m': distancia_cabo_m,
            'area_necessaria_m2': area_necessaria_m2,
            'area_info': area_info,
            'inclinacao': round(surface_tilt, 1),
            'azimute': round(surface_azimuth, 1),
            'avisos': avisos
        }

        print(json.dumps(result))

    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()