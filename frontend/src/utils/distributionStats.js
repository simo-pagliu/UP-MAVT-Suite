function toFiniteNumbers(values) {
  if (!Array.isArray(values)) return []
  return values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function quantileFromSorted(sortedValues, quantile) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) return null
  const q = clamp(Number(quantile) || 0, 0, 1)
  if (sortedValues.length === 1) return sortedValues[0]

  const position = (sortedValues.length - 1) * q
  const lowIndex = Math.floor(position)
  const highIndex = Math.ceil(position)
  const weight = position - lowIndex

  if (lowIndex === highIndex) return sortedValues[lowIndex]
  return sortedValues[lowIndex] + (sortedValues[highIndex] - sortedValues[lowIndex]) * weight
}

export const DISTRIBUTION_STAT_COLUMNS = [
  { key: 'average', label: 'Mean' },
  { key: 'median', label: 'Median' },
  { key: 'stdDev', label: 'Std. Dev.' },
  { key: 'iqr', label: 'IQR' },
  { key: 'skewness', label: 'Skewness' },
  { key: 'kurtosis', label: 'Kurtosis' },
  { key: 'min', label: 'Min' },
  { key: 'p5', label: 'P5' },
  { key: 'p25', label: 'P25' },
  { key: 'p75', label: 'P75' },
  { key: 'p95', label: 'P95' },
  { key: 'max', label: 'Max' },
]

function deriveHistogramProperties(values, minValue, maxValue) {
  const n = values.length
  if (n === 0) {
    return {
      entropyBits: null,
      normalizedEntropy: null,
      modeApprox: null,
      peakProbability: null,
    }
  }

  if (minValue === maxValue) {
    return {
      entropyBits: 0,
      normalizedEntropy: 0,
      modeApprox: minValue,
      peakProbability: 1,
    }
  }

  const binCount = clamp(Math.round(Math.sqrt(n)), 8, 40)
  const counts = new Array(binCount).fill(0)
  const width = (maxValue - minValue) / binCount

  values.forEach((value) => {
    const normalized = (value - minValue) / (maxValue - minValue)
    const idx = Math.min(binCount - 1, Math.max(0, Math.floor(normalized * binCount)))
    counts[idx] += 1
  })

  const maxCount = Math.max(...counts)
  const modeIndex = counts.findIndex((count) => count === maxCount)
  const modeApprox = minValue + (modeIndex + 0.5) * width

  let entropyBits = 0
  counts.forEach((count) => {
    if (count <= 0) return
    const p = count / n
    entropyBits -= p * Math.log2(p)
  })

  const normalizedEntropy = binCount > 1
    ? entropyBits / Math.log2(binCount)
    : 0

  return {
    entropyBits,
    normalizedEntropy,
    modeApprox,
    peakProbability: maxCount / n,
  }
}

export function computeDistributionIndicators(values) {
  const numericValues = toFiniteNumbers(values)
  const n = numericValues.length
  if (n === 0) {
    return {
      n: 0,
      average: null,
      median: null,
      variance: null,
      stdDev: null,
      skewness: null,
      kurtosis: null,
      p10: null,
      p5: null,
      p25: null,
      p50: null,
      p75: null,
      p90: null,
      p95: null,
      iqr: null,
      min: null,
      max: null,
      cv: null,
      entropyBits: null,
      normalizedEntropy: null,
      modeApprox: null,
      peakProbability: null,
      effectiveSampleSize: null,
    }
  }

  const sortedValues = [...numericValues].sort((a, b) => a - b)
  const sum = numericValues.reduce((acc, value) => acc + value, 0)
  const average = sum / n
  const variance = numericValues.reduce((acc, value) => {
    const delta = value - average
    return acc + (delta * delta)
  }, 0) / n
  const stdDev = Math.sqrt(variance)

  const skewness = stdDev > 0
    ? numericValues.reduce((acc, value) => {
      const z = (value - average) / stdDev
      return acc + (z ** 3)
    }, 0) / n
    : 0

  const kurtosis = stdDev > 0
    ? (numericValues.reduce((acc, value) => {
      const z = (value - average) / stdDev
      return acc + (z ** 4)
    }, 0) / n) - 3
    : 0

  const p5 = quantileFromSorted(sortedValues, 0.05)
  const p10 = quantileFromSorted(sortedValues, 0.1)
  const p25 = quantileFromSorted(sortedValues, 0.25)
  const p50 = quantileFromSorted(sortedValues, 0.5)
  const p75 = quantileFromSorted(sortedValues, 0.75)
  const p90 = quantileFromSorted(sortedValues, 0.9)
  const p95 = quantileFromSorted(sortedValues, 0.95)
  const iqr = p75 !== null && p25 !== null ? (p75 - p25) : null
  const min = sortedValues[0]
  const max = sortedValues[sortedValues.length - 1]
  const cv = average !== 0 ? stdDev / Math.abs(average) : null
  const histogram = deriveHistogramProperties(sortedValues, min, max)

  return {
    n,
    average,
    median: p50,
    variance,
    stdDev,
    skewness,
    kurtosis,
    p5,
    p10,
    p25,
    p50,
    p75,
    p90,
    p95,
    iqr,
    min,
    max,
    cv,
    entropyBits: histogram.entropyBits,
    normalizedEntropy: histogram.normalizedEntropy,
    modeApprox: histogram.modeApprox,
    peakProbability: histogram.peakProbability,
    effectiveSampleSize: n,
  }
}

function formatNumber(value, decimals = 4) {
  if (!Number.isFinite(value)) return 'n/a'
  return Number(value).toFixed(decimals)
}

function formatPercent(value, decimals = 2) {
  if (!Number.isFinite(value)) return 'n/a'
  return `${(value * 100).toFixed(decimals)}%`
}

export function formatPerElicitationDistributionSummary(expertSeries, options = {}) {
  const decimals = Number.isInteger(options.decimals) ? options.decimals : 4

  if (!Array.isArray(expertSeries) || expertSeries.length === 0) {
    return {
      text: 'No distribution stats available.',
      lines: ['No distribution stats available.'],
    }
  }

  const lines = []

  expertSeries.forEach((entry, idx) => {
    const stats = computeDistributionIndicators(entry?.values || [])
    const expertName = String(entry?.expertName || entry?.label || `E${idx + 1}`)

    lines.push(expertName)
    lines.push(
      `n=${stats.n}; average=${formatNumber(stats.average, decimals)}; median=${formatNumber(stats.median, decimals)}; std=${formatNumber(stats.stdDev, decimals)}; var=${formatNumber(stats.variance, decimals)}`
    )
    lines.push(
      `skew=${formatNumber(stats.skewness, decimals)}; kurt=${formatNumber(stats.kurtosis, decimals)}; cv=${formatPercent(stats.cv)}; entropy=${formatNumber(stats.entropyBits, 3)}b (norm=${formatNumber(stats.normalizedEntropy, 3)})`
    )
    lines.push(
      `P5=${formatNumber(stats.p5, decimals)}; P25=${formatNumber(stats.p25, decimals)}; P50=${formatNumber(stats.p50, decimals)}; P75=${formatNumber(stats.p75, decimals)}; P95=${formatNumber(stats.p95, decimals)}; IQR=${formatNumber(stats.iqr, decimals)}`
    )
    lines.push(
      `min=${formatNumber(stats.min, decimals)}; max=${formatNumber(stats.max, decimals)}; mode~=${formatNumber(stats.modeApprox, decimals)}; peak~=${formatPercent(stats.peakProbability)}; ESS~=${stats.effectiveSampleSize}`
    )

    if (idx < expertSeries.length - 1) {
      lines.push('')
    }
  })

  return {
    text: lines.join('\n'),
    lines,
  }
}

export function buildDistributionStatsRows(expertSeries) {
  if (!Array.isArray(expertSeries) || expertSeries.length === 0) return []

  return expertSeries.map((entry, idx) => {
    const stats = computeDistributionIndicators(entry?.values || [])
    return {
      alternative: entry?.alternative ? String(entry.alternative) : '',
      expertName: String(entry?.expertName || entry?.label || `E${idx + 1}`),
      n: stats.n,
      ...Object.fromEntries(DISTRIBUTION_STAT_COLUMNS.map((column) => [column.key, stats[column.key]])),
    }
  })
}

export function buildDistributionStatsCsv(expertSeries, options = {}) {
  const title = String(options.title || 'Distribution stats').trim()
  const placeholderMessage = String(
    options.placeholderMessage || 'No distribution stats available yet.'
  ).trim()

  const rows = buildDistributionStatsRows(expertSeries)
  const includeAlternativeColumn = rows.some((row) => row.alternative)

  const headers = [
    ...(includeAlternativeColumn ? ['alternative'] : []),
    'expert',
    'n',
    ...DISTRIBUTION_STAT_COLUMNS.map((column) => column.key),
  ]
  const lines = [`title;${title}`, headers.join(';')]

  if (rows.length === 0) {
    lines.push(`;note;${placeholderMessage}`)
    return `${lines.join('\n')}\n`
  }

  rows.forEach((row) => {
    const values = [
      ...(includeAlternativeColumn ? [String(row.alternative || '').replace(/;/g, ',')] : []),
      String(row.expertName || '').replace(/;/g, ','),
      Number.isFinite(row.n) ? String(row.n) : '',
      ...DISTRIBUTION_STAT_COLUMNS.map((column) => (
        Number.isFinite(row[column.key]) ? String(row[column.key]) : ''
      )),
    ]
    lines.push(values.join(';'))
  })

  return `${lines.join('\n')}\n`
}
