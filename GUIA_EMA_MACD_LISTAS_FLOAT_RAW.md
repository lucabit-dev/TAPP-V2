# Guía de Funciones EMA y MACD en Listas FLOAT (RAW)

## Resumen Ejecutivo

Este documento explica las funciones utilizadas para calcular indicadores técnicos EMA (Exponential Moving Average) y MACD (Moving Average Convergence Divergence) en la sección **"Listas FLOAT (RAW)"** de la aplicación TAPP V5.

La sección RAW obtiene sus datos directamente de ChartsWatcher y realiza verificaciones técnicas en tiempo real para identificar acciones que cumplen condiciones específicas de momentum y análisis técnico.

---

## Flujo de Datos en Listas FLOAT (RAW)

### 1. Punto de Entrada
- **Componente Frontend**: `FloatRawListsSection.tsx`
- **Fuente de Datos**: ChartsWatcher (a través de WebSocket)
- **Mensajes WebSocket**: `RAW_TECH_CHECKS` y `STOCK_TECH_UPDATE`

### 2. Procesamiento Backend
- **Función Principal**: `computeRawFiveTechChecks()` en `server.js`
- **Función de Análisis**: `analyzeSymbol()` en `server.js`
- **Servicio de Indicadores**: `IndicatorsService.calculateAllIndicators()` en `indicators.js`

### 3. Cálculo de Indicadores
- **EMAs**: Se calculan usando `calculateEMA()` de `utils/technical_indicators/macd_polygon.js`
- **MACD**: Se calcula usando `calculateMACDSingle()` de `utils/technical_indicators/macd_polygon.js`

---

## Funciones Utilizadas para EMA

### 1. `calculateEMA()` - Cálculo de Media Móvil Exponencial

**Ubicación**: `utils/technical_indicators/macd_polygon.js` (líneas 26-52)

**Descripción**:
Calcula la Media Móvil Exponencial (EMA) utilizando la fórmula exacta de Polygon.io, que inicializa la EMA con la media aritmética simple (SMA) del primer período y luego aplica el multiplicador exponencial estándar.

**Fórmula Matemática**:
```
- Multiplicador = 2 / (período + 1)
- EMA_inicial = SMA de los primeros 'período' valores
- EMA_today = (precio_today - EMA_yesterday) × multiplicador + EMA_yesterday
```

**Parámetros**:
- `values` (Array de números): Array de precios de cierre ordenados cronológicamente
- `period` (número): Período de la EMA (ej: 12, 18, 26, 200)

**Retorno**:
- `number | null`: Valor de la EMA o `null` si no hay suficientes datos

**Características Clave**:
1. **Inicialización con SMA**: Los primeros valores se promedian para obtener el valor inicial de la EMA
2. **Precisión de Polygon.io**: Utiliza exactamente la misma fórmula que la API de Polygon.io
3. **Validación de Datos**: Retorna `null` si hay menos datos que el período requerido

**Ejemplo de Uso**:
```javascript
const closes = [100, 101, 102, 103, 104, 105];
const ema18 = calculateEMA(closes, 18); // null si closes.length < 18
```

**EMAs Calculadas en Listas FLOAT (RAW)**:
- **EMA 1 minuto**: períodos 12, 18, 20, 26, 200
- **EMA 5 minutos**: períodos 12, 18, 20, 26, 200

---

### 2. `IndicatorsService.calculateEMA()` - Wrapper del Servicio

**Ubicación**: `indicators.js` (líneas 84-109)

**Descripción**:
Método wrapper que adapta los datos de velas (candles) para llamar a la función base `calculateEMA()`. Extrae los precios de cierre de las velas y valida los datos antes de realizar el cálculo.

**Flujo**:
1. Valida que existan velas
2. Extrae los precios de cierre: `candles.map(candle => candle.close)`
3. Verifica que haya suficientes datos
4. Llama a `calculateEMA()` de `macd_polygon.js`
5. Retorna el resultado o `null` en caso de error

**Parámetros**:
- `candles` (Array): Array de objetos de vela con propiedades `{timestamp, open, high, low, close, volume}`
- `period` (número): Período de la EMA
- `timeframe` (string): Marco temporal ('1m', '5m') - usado solo para logging

**Ejemplo de Uso**:
```javascript
const candles1m = [
  {timestamp: new Date(), open: 100, high: 101, low: 99, close: 100.5, volume: 1000},
  // ... más velas
];
const ema1m18 = indicatorsService.calculateEMA(candles1m, 18, '1m');
```

---

## Funciones Utilizadas para MACD

### 1. `calculateMACDSingle()` - Cálculo Optimizado de MACD

**Ubicación**: `utils/technical_indicators/macd_polygon.js` (líneas 176-249)

**Descripción**:
Calcula el indicador MACD (Moving Average Convergence Divergence) de forma eficiente y precisa, utilizando la fórmula exacta de Polygon.io. Esta función calcula solo el último valor del MACD, optimizada para cálculos en tiempo real.

**Fórmula MACD**:
```
1. EMA Rápida (12 períodos) con inicialización SMA
2. EMA Lenta (26 períodos) con inicialización SMA
3. Línea MACD = EMA Rápida - EMA Lenta
4. EMA Señal (9 períodos) aplicada a la línea MACD con inicialización SMA
5. Histograma = Línea MACD - EMA Señal
```

**Parámetros**:
- `closes` (Array de números): Array de precios de cierre
- `shortPeriod` (número, default: 12): Período de la EMA rápida
- `longPeriod` (número, default: 26): Período de la EMA lenta
- `signalPeriod` (número, default: 9): Período de la línea de señal

**Retorno**:
```javascript
{
  macd: number,      // Valor de la línea MACD
  signal: number,    // Valor de la línea de señal
  histogram: number  // Diferencia entre MACD y señal
} | null
```

**Algoritmo Detallado**:
1. **Validación**: Verifica que haya al menos `longPeriod + signalPeriod` precios
2. **Inicialización de EMAs Rápida y Lenta**:
   - Calcula SMA de los primeros `shortPeriod` valores para EMA rápida
   - Calcula SMA de los primeros `longPeriod` valores para EMA lenta
3. **Construcción Incremental de la Línea MACD**:
   - Para cada precio desde `longPeriod` hasta el final:
     - Actualiza EMA rápida y lenta incrementalmente
     - Calcula MACD = EMA rápida - EMA lenta
4. **Cálculo de la Línea de Señal**:
   - Inicializa con SMA de los primeros `signalPeriod` valores de la línea MACD
   - Aplica EMA a los valores restantes de la línea MACD
5. **Retorno**: Retorna el último valor de MACD, señal e histograma

**Características Clave**:
- **Eficiencia**: Cálculo incremental que evita recalcular todo desde cero
- **Precisión**: Coincide exactamente con los valores de Polygon.io
- **Optimizado para Tiempo Real**: Calcula solo el último valor, no toda la serie histórica

**Ejemplo de Uso**:
```javascript
const closes = [100, 101, 102, ...]; // Al menos 35 valores (26+9)
const macdResult = calculateMACDSingle(closes);
// Resultado: { macd: 0.1234, signal: 0.0987, histogram: 0.0247 }
```

**Nota**: En Listas FLOAT (RAW), esta función se llama con los precios de cierre de velas de 1 minuto y 5 minutos por separado, generando `macd1m` y `macd5m`.

---

### 2. `IndicatorsService.calculateMACD()` - Wrapper del Servicio

**Ubicación**: `indicators.js` (líneas 283-309)

**Descripción**:
Método wrapper que adapta los datos de velas para llamar a `calculateMACDSingle()`. Extrae los precios de cierre y valida que haya suficientes datos antes del cálculo.

**Flujo**:
1. Valida que existan velas
2. Extrae precios de cierre: `candles.map(candle => candle.close)`
3. Verifica que haya al menos `slowPeriod + signalPeriod` velas (mínimo 35)
4. Llama a `calculateMACDSingle()` de `macd_polygon.js`
5. Retorna el resultado o `null` en caso de error

**Parámetros**:
- `candles` (Array): Array de objetos de vela
- `timeframe` (string): '1m' o '5m' - usado solo para logging
- `fastPeriod` (número, default: 12): Período EMA rápida
- `slowPeriod` (número, default: 26): Período EMA lenta
- `signalPeriod` (número, default: 9): Período línea de señal

**Retorno**: Mismo formato que `calculateMACDSingle()`

**Ejemplo de Uso**:
```javascript
const candles1m = [...]; // Velas de 1 minuto
const macd1m = indicatorsService.calculateMACD(candles1m, '1m');
// Resultado: { macd: 0.1234, signal: 0.0987, histogram: 0.0247 }
```

---

## Función Principal: `calculateAllIndicators()`

**Ubicación**: `indicators.js` (líneas 367-448)

**Descripción**:
Función principal que calcula todos los indicadores técnicos necesarios para una acción, incluyendo múltiples EMAs y MACD en diferentes timeframes. Esta es la función que se llama desde `analyzeSymbol()` en el servidor.

**Indicadores Calculados**:

### EMAs de 1 Minuto:
- `ema1m12`: EMA de 12 períodos en velas de 1 minuto
- `ema1m18`: EMA de 18 períodos en velas de 1 minuto
- `ema1m20`: EMA de 20 períodos en velas de 1 minuto
- `ema1m26`: EMA de 26 períodos en velas de 1 minuto
- `ema1m200`: EMA de 200 períodos en velas de 1 minuto

### EMAs de 5 Minutos:
- `ema5m12`: EMA de 12 períodos en velas de 5 minutos
- `ema5m18`: EMA de 18 períodos en velas de 5 minutos
- `ema5m20`: EMA de 20 períodos en velas de 5 minutos
- `ema5m26`: EMA de 26 períodos en velas de 5 minutos
- `ema5m200`: EMA de 200 períodos en velas de 5 minutos

### MACD:
- `macd1m`: MACD calculado con velas de 1 minuto
  - Contiene: `{macd, signal, histogram}`
- `macd5m`: MACD calculado con velas de 5 minutos
  - Contiene: `{macd, signal, histogram}`

### Otros Indicadores:
- `vwap1m`: VWAP (Volume Weighted Average Price) de 1 minuto
- `lod`: Low of Day (precio mínimo del día)
- `hod`: High of Day (precio máximo del día)

**Parámetros**:
- `ticker` (string): Símbolo de la acción (ej: 'AAPL')
- `candles1m` (Array): Velas de 1 minuto
- `candles5m` (Array): Velas de 5 minutos
- `isExtendedHours` (boolean): Indica si está en horario extendido

**Retorno**:
```javascript
{
  ticker: string,
  timestamp: string,
  indicators: {
    ema1m12, ema1m18, ema1m20, ema1m26, ema1m200,
    ema5m12, ema5m18, ema5m20, ema5m26, ema5m200,
    macd1m: { macd, signal, histogram },
    macd5m: { macd, signal, histogram },
    vwap1m, lod, hod
  },
  lastCandle: {...},
  candleCounts: { candles1m: number, candles5m: number },
  manualCalculation: true,
  isExtendedHours: boolean,
  dataQuality: {...}
}
```

**Flujo Interno**:
1. Valida la frescura de los datos (no estén demasiado desactualizados)
2. Verifica la alineación temporal entre velas de 1m y 5m
3. Calcula todos los EMAs llamando a `this.calculateEMA()` múltiples veces
4. Calcula los MACD llamando a `this.calculateMACD()` para cada timeframe
5. Calcula VWAP, LOD y HOD
6. Retorna todos los resultados en un objeto estructurado

**Ejemplo de Uso**:
```javascript
const { candles1m, candles5m, isExtendedHours } = await fetchCandlesForAnalysis('AAPL');
const indicatorData = await indicatorsService.calculateAllIndicators(
  'AAPL', 
  candles1m, 
  candles5m, 
  isExtendedHours
);
```

---

## Integración con Listas FLOAT (RAW)

### Proceso Completo:

1. **WebSocket Recibe Datos**: `FloatRawListsSection.tsx` recibe mensajes `RAW_TECH_CHECKS`
2. **Servidor Procesa**: `computeRawFiveTechChecks()` en `server.js` analiza cada símbolo
3. **Análisis de Símbolo**: `analyzeSymbol()` obtiene velas y llama a `calculateAllIndicators()`
4. **Cálculo de Indicadores**: Se calculan todas las EMAs y MACD usando las funciones descritas
5. **Evaluación de Condiciones**: Se evalúan las condiciones técnicas y de momentum
6. **Broadcast**: Los resultados se envían al frontend vía WebSocket

### Condiciones de Trade en RAW:

Las condiciones técnicas se evalúan usando los indicadores calculados:
- **Tech Conditions**: Basadas en relaciones entre EMAs, MACD histogram, y precios
- **Momentum Conditions**: Basadas en movimiento de precios y volumen

El histograma de MACD de 1 minuto (`macd1m.histogram`) se usa como trigger para compras automáticas cuando está positivo y se cumplen todas las condiciones.

---

## Diferencias Importantes

### EMA: Método de Polygon.io vs. Método de Wilder

**Método de Polygon.io** (usado en RAW):
- Multiplicador: `2 / (período + 1)`
- Inicialización: Promedio simple (SMA) de los primeros valores
- Más reactivo a cambios recientes

**Método de Wilder** (NO usado en RAW, pero presente en `polygonService.js`):
- Multiplicador: `1 / período`
- Inicialización: Primer valor
- Menos reactivo, más suave

**Nota**: La sección RAW usa exclusivamente el método de Polygon.io para mantener consistencia con los datos de la API.

---

## Requisitos de Datos

### Para EMA:
- **Mínimo de velas requeridas**: Igual al período de la EMA
  - EMA 18: al menos 18 velas
  - EMA 200: al menos 200 velas

### Para MACD:
- **Mínimo de velas requeridas**: `slowPeriod + signalPeriod`
  - Con valores por defecto (12, 26, 9): mínimo 35 velas
  - Recomendado: al menos 50-100 velas para precisión

### Timeframes:
- **1 minuto**: Ideal para análisis de corto plazo
- **5 minutos**: Para señales de mediano plazo y confirmación

---

## Consideraciones de Performance

1. **Cálculo Incremental**: `calculateMACDSingle()` usa actualizaciones incrementales para eficiencia
2. **Procesamiento por Lotes**: En `computeRawFiveTechChecks()`, los símbolos se procesan en lotes de 4
3. **Caché de Resultados**: Los resultados de tech checks se cachean en `lastRawTechChecksResult`
4. **Validación de Frescura**: Se valida que los datos no estén demasiado desactualizados antes de calcular

---

## Troubleshooting

### Problemas Comunes:

1. **Indicadores retornan `null`**:
   - Verificar que haya suficientes velas
   - Verificar que las velas tengan precios de cierre válidos

2. **Valores de MACD inconsistentes**:
   - Verificar que los datos de entrada estén ordenados cronológicamente
   - Verificar que no haya valores faltantes o duplicados

3. **Diferencias con TradingView**:
   - TradingView puede usar métodos ligeramente diferentes
   - Esta implementación sigue exactamente la fórmula de Polygon.io

---

## Referencias Técnicas

- **Archivo Base**: `utils/technical_indicators/macd_polygon.js`
- **Servicio**: `indicators.js` (clase `IndicatorsService`)
- **Flujo en Servidor**: `server.js` → `computeRawFiveTechChecks()` → `analyzeSymbol()`
- **Frontend**: `client/src/components/FloatRawListsSection.tsx`

---

## Conclusión

Las funciones descritas en esta guía son fundamentales para el cálculo de indicadores técnicos en la sección Listas FLOAT (RAW). Utilizan fórmulas precisas que coinciden con Polygon.io para garantizar consistencia y precisión en las señales de trading.

El sistema está diseñado para:
- ✅ Procesar datos en tiempo real
- ✅ Calcular múltiples indicadores eficientemente
- ✅ Mantener compatibilidad con Polygon.io
- ✅ Soportar horarios extendidos de trading

---

*Documento generado para TAPP V5 - Última actualización: 2025*

