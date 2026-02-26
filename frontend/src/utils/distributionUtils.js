/**
 * Distribution utility functions
 * Handles parsing, serialization, and computation of uncertainty distributions
 */

/**
 * Distribution types and their structure:
 * - certain: { type: 'certain', value: number }
 * - gaussian: { type: 'gaussian', mean: number, std: number }
 * - errorAbsolute: { type: 'errorAbsolute', value: number, error: number }
 * - errorPercent: { type: 'errorPercent', value: number, percent: number }
 * - discrete: { type: 'discrete', values: number[] }
 * - uniform: { type: 'uniform', low: number, high: number }
 * - histogram: { type: 'histogram', ranges: Array<{min, max, probability}> }
 * - custom_1: { type: 'custom_1', a_values: number[], x_low: number, x_high: number }
 *            Samples: x~U(x_low,x_high), a=choice(a_values),
 *            p0=a*(1-x), p1=a*x+(1-a)*(1-x), p2=(1-a)*x, result=choice([0,1,2], p=[p0,p1,p2])
 * 
 * Note: Gaussian bounds are computed as mean ± (1.96 × std) for 98% confidence interval
 */

/**
 * Parse a distribution string from CSV format
 * Returns null if the string is not a valid distribution format
 */
export function parseDistribution(str) {
  if (!str || typeof str !== 'string') return null
  
  str = str.trim()
  
  // Certain value: just a number
  if (/^\d+(\.\d+)?$/.test(str)) {
    return {
      type: 'certain',
      value: parseFloat(str)
    }
  }
  
  // Gaussian or ±Error: "1000 ± 100"
  const errorMatch = str.match(/^([-+]?\d+(?:\.\d+)?)\s*±\s*([-+]?\d+(?:\.\d+)?)$/)
  if (errorMatch) {
    return {
      type: 'errorAbsolute',
      value: parseFloat(errorMatch[1]),
      error: parseFloat(errorMatch[2])
    }
  }
  
  // ±%Error: "1000 ± 5%"
  const percentMatch = str.match(/^([-+]?\d+(?:\.\d+)?)\s*±\s*([-+]?\d+(?:\.\d+)?)%$/)
  if (percentMatch) {
    return {
      type: 'errorPercent',
      value: parseFloat(percentMatch[1]),
      percent: parseFloat(percentMatch[2])
    }
  }
  
  // Gaussian: "N(mean,std)"
  const gaussianMatch = str.match(/^N\(([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)\)$/)
  if (gaussianMatch) {
    return {
      type: 'gaussian',
      mean: parseFloat(gaussianMatch[1]),
      std: parseFloat(gaussianMatch[2])
    }
  }
  
  // Uniform: "U(low, high)"
  const uniformMatch = str.match(/^U\(([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)\)$/)
  if (uniformMatch) {
    return {
      type: 'uniform',
      low: parseFloat(uniformMatch[1]),
      high: parseFloat(uniformMatch[2])
    }
  }

  // Trapezoid: "TRAP(min, peak_start, peak_end, max, base_prob)"
  const trapezoidMatch = str.match(/^TRAP\(([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)\)$/)
  if (trapezoidMatch) {
    return {
      type: 'trapezoid',
      min: parseFloat(trapezoidMatch[1]),
      peak_start: parseFloat(trapezoidMatch[2]),
      peak_end: parseFloat(trapezoidMatch[3]),
      max: parseFloat(trapezoidMatch[4]),
      base_prob: parseFloat(trapezoidMatch[5])
    }
  }
  
  // Discrete: "{900, 1000, 1100}"
  const discreteMatch = str.match(/^\{(.*)\}$/)
  if (discreteMatch) {
    const values = discreteMatch[1]
      .split(',')
      .map(v => parseFloat(v.trim()))
      .filter(v => !isNaN(v))
    if (values.length > 0) {
      return {
        type: 'discrete',
        values: values.sort((a, b) => a - b)
      }
    }
  }
  
  // Custom_1: "CUSTOM_1({a1, a2, ...}, x_low, x_high)"
  const custom1Match = str.match(/^CUSTOM_1\(\{([^}]+)\}\s*,\s*([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)\)$/)
  if (custom1Match) {
    const a_values = custom1Match[1].split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v))
    if (a_values.length > 0) {
      return {
        type: 'custom_1',
        a_values: a_values,
        x_low: parseFloat(custom1Match[2]),
        x_high: parseFloat(custom1Match[3])
      }
    }
  }

  // Histogram: "(3-4: 15%, 4-6: 32%)"
  const histogramMatch = str.match(/^\((.*)\)$/)
  if (histogramMatch) {
    const pairs = histogramMatch[1].split(',').map(p => p.trim())
    const ranges = []
    for (const pair of pairs) {
      const pairMatch = pair.match(/^([-+]?\d+(?:\.\d+)?)\s*-\s*([-+]?\d+(?:\.\d+)?)\s*:\s*([-+]?\d+(?:\.\d+)?)%$/)
      if (!pairMatch) continue
      ranges.push({
        min: parseFloat(pairMatch[1]),
        max: parseFloat(pairMatch[2]),
        probability: parseFloat(pairMatch[3])
      })
    }
    if (ranges.length > 0) {
      return {
        type: 'histogram',
        ranges: ranges
      }
    }
  }
  
  return null
}

/**
 * Convert a distribution object to CSV format string
 */
export function distributionToString(dist) {
  if (!dist) return ''
  
  switch (dist.type) {
    case 'certain':
      return dist.value.toString()
    
    case 'gaussian':
      return `N(${dist.mean}, ${dist.std})`
    
    case 'uniform':
      return `U(${dist.low}, ${dist.high})`
    
    case 'errorAbsolute':
      return `${dist.value} ± ${dist.error}`
    
    case 'errorPercent':
      return `${dist.value} ± ${dist.percent}%`
    
    case 'discrete':
      return `{${dist.values.join(', ')}}`
    
    case 'histogram':
      const ranges = dist.ranges
        .map(r => `${r.min}-${r.max}: ${r.probability}%`)
        .join(', ')
      return `(${ranges})`
    
    case 'trapezoid':
      return `TRAP(${dist.min}, ${dist.peak_start}, ${dist.peak_end}, ${dist.max}, ${dist.base_prob})`
    
    case 'custom_1':
      return `CUSTOM_1({${dist.a_values.join(', ')}}, ${dist.x_low}, ${dist.x_high})`
    
    default:
      return ''
  }
}

/**
 * Get the type label for display
 */
export function getDistributionTypeLabel(type) {
  const labels = {
    certain: 'Certain',
    gaussian: 'Gaussian',
    uniform: 'Uniform',
    errorAbsolute: '±Error',
    errorPercent: '±%Error',
    discrete: 'Discrete',
    histogram: 'Histogram',
    trapezoid: 'Trapezoid',
    custom_1: 'Custom 1'
  }
  return labels[type] || 'Unknown'
}

/**
 * Compute min/max bounds from a distribution
 */
export function computeDistributionBounds(dist) {
  if (!dist) return { min: 0, max: 0 }
  
  const epsilon = 1e-10
  
  switch (dist.type) {
    case 'certain':
      return {
        min: dist.value,
        max: dist.value
      }
    
    case 'gaussian':
      // 98% confidence interval: ±1.96 × std
      const margin = 1.96 * dist.std
      return {
        min: dist.mean - margin,
        max: dist.mean + margin
      }
    
    case 'uniform':
      return {
        min: dist.low,
        max: dist.high
      }
    
    case 'errorAbsolute':
      return {
        min: dist.value - dist.error,
        max: dist.value + dist.error
      }
    
    case 'errorPercent':
      const absError = (dist.value * dist.percent) / 100
      return {
        min: dist.value - absError,
        max: dist.value + absError
      }
    
    case 'discrete':
      return {
        min: Math.min(...dist.values),
        max: Math.max(...dist.values)
      }
    
    case 'histogram':
      return {
        min: Math.min(...dist.ranges.map(r => r.min)),
        max: Math.max(...dist.ranges.map(r => r.max))
      }
    
    case 'trapezoid':
      return {
        min: dist.min,
        max: dist.max
      }
    
    case 'custom_1':
      return {
        min: 0,
        max: 2
      }
    
    default:
      return { min: 0, max: 0 }
  }
}

/**
 * Generate plot data for visualization
 * Returns an array of {x, y} points for plotting
 */
export function generatePlotData(dist, numPoints = 100) {
  if (!dist) return []
  
  const bounds = computeDistributionBounds(dist)
  const points = []
  
  switch (dist.type) {
    case 'certain':
      // Lollipop: vertical line with dot at top
      return [
        { x: dist.value, y: 0, type: 'line' },
        { x: dist.value, y: 1, type: 'dot' }
      ]
    
    case 'gaussian':
      // Normal distribution bell curve
      const mean = dist.mean
      const std = dist.std
      const xMin = mean - 3.5 * std
      const xMax = mean + 3.5 * std
      const step = (xMax - xMin) / numPoints
      
      for (let i = 0; i <= numPoints; i++) {
        const x = xMin + step * i
        // Probability density function for normal distribution
        const y = (1 / (std * Math.sqrt(2 * Math.PI))) * 
                  Math.exp(-0.5 * Math.pow((x - mean) / std, 2))
        points.push({ x, y })
      }
      return points
    
    case 'uniform':
      // Uniform distribution U(low, high)
      {
        const uHeight = 1 / (dist.high - dist.low)
        return [
          { x: dist.low, y: 0 },
          { x: dist.low, y: uHeight },
          { x: dist.high, y: uHeight },
          { x: dist.high, y: 0 }
        ]
      }
    
    case 'errorAbsolute':
      // Uniform distribution
      const min1 = dist.value - dist.error
      const max1 = dist.value + dist.error
      const height1 = 1 / (2 * dist.error)
      return [
        { x: min1, y: 0 },
        { x: min1, y: height1 },
        { x: max1, y: height1 },
        { x: max1, y: 0 }
      ]
    
    case 'errorPercent':
      // Uniform distribution
      const absError = (dist.value * dist.percent) / 100
      const min2 = dist.value - absError
      const max2 = dist.value + absError
      const height2 = 1 / (2 * absError)
      return [
        { x: min2, y: 0 },
        { x: min2, y: height2 },
        { x: max2, y: height2 },
        { x: max2, y: 0 }
      ]
    
    case 'discrete':
      // Step function
      const step1 = (1 / dist.values.length) * 0.5
      for (const val of dist.values) {
        points.push({ x: val, y: step1 })
      }
      return points
    
    case 'histogram':
      // Histogram bars
      for (const range of dist.ranges) {
        const height = range.probability / 100
        points.push({ x: range.min, y: 0 })
        points.push({ x: range.min, y: height })
        points.push({ x: range.max, y: height })
        points.push({ x: range.max, y: 0 })
      }
      return points
    
    case 'trapezoid':
      // Trapezoid with auto-computed peak height (normalized)
      const left_width = dist.peak_start - dist.min
      const right_width = dist.max - dist.peak_end
      const plateau_width = dist.peak_end - dist.peak_start
      
      // Compute peak_height to normalize (area = 1)
      const denominator = (left_width + right_width) / 2 + plateau_width
      const peak_height = denominator > 0 
        ? (1 - (left_width + right_width) * dist.base_prob / 2) / denominator
        : 1
      
      return [
        { x: dist.min, y: dist.base_prob },
        { x: dist.peak_start, y: peak_height },
        { x: dist.peak_end, y: peak_height },
        { x: dist.max, y: dist.base_prob }
      ]
    
    case 'custom_1':
      // Show approximate PMF for outcomes 0, 1, 2 using mean of a_values and midpoint of x range
      {
        const a_mean = dist.a_values.reduce((s, v) => s + v, 0) / dist.a_values.length
        const x_mid = (dist.x_low + dist.x_high) / 2
        const p0 = a_mean * (1 - x_mid)
        const p1 = a_mean * x_mid + (1 - a_mean) * (1 - x_mid)
        const p2 = (1 - a_mean) * x_mid
        return [
          { x: 0, y: p0 },
          { x: 1, y: p1 },
          { x: 2, y: p2 }
        ]
      }
    
    default:
      return []
  }
}

/**
 * Validate a distribution object
 */
export function isValidDistribution(dist) {
  if (!dist || !dist.type) return false
  
  switch (dist.type) {
    case 'certain':
      return typeof dist.value === 'number' && !isNaN(dist.value)
    
    case 'gaussian':
      return typeof dist.mean === 'number' && typeof dist.std === 'number'
        && !isNaN(dist.mean) && !isNaN(dist.std) && dist.std > 0
    
    case 'uniform':
      return typeof dist.low === 'number' && typeof dist.high === 'number'
        && !isNaN(dist.low) && !isNaN(dist.high) && dist.low < dist.high
    
    case 'errorAbsolute':
      return typeof dist.value === 'number' && typeof dist.error === 'number'
        && !isNaN(dist.value) && !isNaN(dist.error) && dist.error >= 0
    
    case 'errorPercent':
      return typeof dist.value === 'number' && typeof dist.percent === 'number'
        && !isNaN(dist.value) && !isNaN(dist.percent) && dist.percent >= 0
    
    case 'discrete':
      return Array.isArray(dist.values) && dist.values.length > 0
        && dist.values.every(v => typeof v === 'number' && !isNaN(v))
    
    case 'histogram':
      return Array.isArray(dist.ranges) && dist.ranges.length > 0
        && dist.ranges.every(r => 
          typeof r.min === 'number' && typeof r.max === 'number' && typeof r.probability === 'number'
          && !isNaN(r.min) && !isNaN(r.max) && !isNaN(r.probability)
          && r.min <= r.max && r.probability >= 0 && r.probability <= 100
        )
    
    case 'trapezoid':
      return typeof dist.min === 'number' && typeof dist.peak_start === 'number'
        && typeof dist.peak_end === 'number' && typeof dist.max === 'number'
        && typeof dist.base_prob === 'number'
        && !isNaN(dist.min) && !isNaN(dist.peak_start) && !isNaN(dist.peak_end)
        && !isNaN(dist.max) && !isNaN(dist.base_prob)
        && dist.min <= dist.peak_start && dist.peak_start <= dist.peak_end
        && dist.peak_end <= dist.max && dist.base_prob >= 0 && dist.base_prob <= 1
    
    case 'custom_1':
      return Array.isArray(dist.a_values) && dist.a_values.length > 0
        && dist.a_values.every(v => typeof v === 'number' && !isNaN(v))
        && typeof dist.x_low === 'number' && typeof dist.x_high === 'number'
        && !isNaN(dist.x_low) && !isNaN(dist.x_high)
        && dist.x_low >= 0 && dist.x_high <= 1 && dist.x_low < dist.x_high
    
    default:
      return false
  }
}

/**
 * Get a summary string for display (e.g., in a cell)
 */
export function getDistributionSummary(dist) {
  if (!dist) return ''
  
  switch (dist.type) {
    case 'certain':
      return dist.value.toFixed(2)
    
    case 'gaussian':
      return `N(μ=${dist.mean.toFixed(2)}, σ=${dist.std.toFixed(2)})`
    
    case 'uniform':
      return `U(${dist.low.toFixed(2)}, ${dist.high.toFixed(2)})`
    
    case 'errorAbsolute':
      return `${dist.value.toFixed(2)} ± ${dist.error.toFixed(2)}`
    
    case 'errorPercent':
      return `${dist.value.toFixed(2)} ± ${dist.percent.toFixed(1)}%`
    
    case 'discrete':
      return `{${dist.values.map(v => v.toFixed(1)).join(', ')}}`
    
    case 'histogram':
      return `Hist. (${dist.ranges.length} ranges)`
    
    case 'trapezoid':
      const is_triangle = dist.peak_start === dist.peak_end
      return is_triangle
        ? `Tri(${dist.min.toFixed(1)}-${dist.max.toFixed(1)})`
        : `Trap(${dist.min.toFixed(1)}-${dist.max.toFixed(1)})`
    
    case 'custom_1':
      return `Custom1(a={${dist.a_values.join(',')}}, x=[${dist.x_low},${dist.x_high}])`
    
    default:
      return ''
  }
}
