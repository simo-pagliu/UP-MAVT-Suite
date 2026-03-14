import { describe, it, expect } from 'vitest'
import {
  parseDistribution,
  distributionToString,
  isValidDistribution,
  getDistributionTypeLabel,
  getDistributionSummary,
  computeDistributionBounds,
} from '../utils/distributionUtils'

// ---------------------------------------------------------------------------
// parseDistribution
// ---------------------------------------------------------------------------
describe('parseDistribution', () => {
  it('returns null for null/undefined/empty input', () => {
    expect(parseDistribution(null)).toBeNull()
    expect(parseDistribution(undefined)).toBeNull()
    expect(parseDistribution('')).toBeNull()
    expect(parseDistribution(123)).toBeNull()
  })

  it('parses a certain (plain number) value', () => {
    expect(parseDistribution('42')).toEqual({ type: 'certain', value: 42 })
    expect(parseDistribution('3.14')).toEqual({ type: 'certain', value: 3.14 })
    expect(parseDistribution('0')).toEqual({ type: 'certain', value: 0 })
  })

  it('parses absolute-error format "value ± error"', () => {
    expect(parseDistribution('100 ± 5')).toEqual({
      type: 'errorAbsolute',
      value: 100,
      error: 5,
    })
    expect(parseDistribution('-50 ± 10.5')).toEqual({
      type: 'errorAbsolute',
      value: -50,
      error: 10.5,
    })
  })

  it('parses percent-error format "value ± p%"', () => {
    expect(parseDistribution('200 ± 10%')).toEqual({
      type: 'errorPercent',
      value: 200,
      percent: 10,
    })
  })

  it('parses gaussian format "N(mean, std)"', () => {
    expect(parseDistribution('N(100, 15)')).toEqual({
      type: 'gaussian',
      mean: 100,
      std: 15,
    })
    expect(parseDistribution('N(0, 1)')).toEqual({
      type: 'gaussian',
      mean: 0,
      std: 1,
    })
  })

  it('parses uniform format "U(low, high)"', () => {
    expect(parseDistribution('U(10, 20)')).toEqual({
      type: 'uniform',
      low: 10,
      high: 20,
    })
  })

  it('parses discrete format "{v1, v2, ...}"', () => {
    const result = parseDistribution('{1, 2, 3}')
    expect(result).toEqual({ type: 'discrete', values: [1, 2, 3] })
  })

  it('sorts discrete values in ascending order', () => {
    const result = parseDistribution('{5, 1, 3}')
    expect(result?.values).toEqual([1, 3, 5])
  })

  it('parses histogram format "(min-max: p%, ...)"', () => {
    const result = parseDistribution('(0-5: 40%, 5-10: 60%)')
    expect(result).toEqual({
      type: 'histogram',
      ranges: [
        { min: 0, max: 5, probability: 40 },
        { min: 5, max: 10, probability: 60 },
      ],
    })
  })

  it('parses trapezoid format "TRAP(min, ps, pe, max, bp)"', () => {
    const result = parseDistribution('TRAP(0, 2, 4, 6, 0.1)')
    expect(result).toEqual({
      type: 'trapezoid',
      min: 0,
      peak_start: 2,
      peak_end: 4,
      max: 6,
      base_prob: 0.1,
    })
  })

  it('parses trapezoid format "TRAP(min, ps, pe, max)" with default base_prob', () => {
    const result = parseDistribution('TRAP(0, 2, 4, 6)')
    expect(result).toEqual({
      type: 'trapezoid',
      min: 0,
      peak_start: 2,
      peak_end: 4,
      max: 6,
      base_prob: 0,
    })
  })

  it('parses triangular alias format "TRI(min, mode, max)"', () => {
    const result = parseDistribution('TRI(0, 3, 6)')
    expect(result).toEqual({
      type: 'trapezoid',
      min: 0,
      peak_start: 3,
      peak_end: 3,
      max: 6,
      base_prob: 0,
    })
  })

  it('parses custom_1 format "CUSTOM_1({a1,a2}, xl, xh)"', () => {
    const result = parseDistribution('CUSTOM_1({0.3, 0.7}, 0.2, 0.8)')
    expect(result).toEqual({
      type: 'custom_1',
      a_values: [0.3, 0.7],
      x_low: 0.2,
      x_high: 0.8,
    })
  })

  it('returns null for unrecognised input', () => {
    expect(parseDistribution('not-a-distribution')).toBeNull()
    expect(parseDistribution('N(a, b)')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// distributionToString
// ---------------------------------------------------------------------------
describe('distributionToString', () => {
  it('returns empty string for null', () => {
    expect(distributionToString(null)).toBe('')
  })

  it('serialises a certain value', () => {
    expect(distributionToString({ type: 'certain', value: 42 })).toBe('42')
  })

  it('serialises gaussian', () => {
    expect(distributionToString({ type: 'gaussian', mean: 100, std: 15 })).toBe('N(100, 15)')
  })

  it('serialises uniform', () => {
    expect(distributionToString({ type: 'uniform', low: 10, high: 20 })).toBe('U(10, 20)')
  })

  it('serialises errorAbsolute', () => {
    expect(distributionToString({ type: 'errorAbsolute', value: 100, error: 5 })).toBe('100 ± 5')
  })

  it('serialises errorPercent', () => {
    expect(distributionToString({ type: 'errorPercent', value: 200, percent: 10 })).toBe('200 ± 10%')
  })

  it('serialises discrete', () => {
    expect(distributionToString({ type: 'discrete', values: [1, 2, 3] })).toBe('{1, 2, 3}')
  })

  it('serialises histogram', () => {
    const dist = {
      type: 'histogram',
      ranges: [
        { min: 0, max: 5, probability: 40 },
        { min: 5, max: 10, probability: 60 },
      ],
    }
    expect(distributionToString(dist)).toBe('(0-5: 40%, 5-10: 60%)')
  })

  it('serialises trapezoid', () => {
    const dist = { type: 'trapezoid', min: 0, peak_start: 2, peak_end: 4, max: 6, base_prob: 0.1 }
    expect(distributionToString(dist)).toBe('TRAP(0, 2, 4, 6, 0.1)')
  })

  it('serialises custom_1', () => {
    const dist = { type: 'custom_1', a_values: [0.3, 0.7], x_low: 0.2, x_high: 0.8 }
    expect(distributionToString(dist)).toBe('CUSTOM_1({0.3, 0.7}, 0.2, 0.8)')
  })

  it('round-trips all distribution types (parse → toString → parse)', () => {
    const samples = [
      '42',
      'N(100, 15)',
      'U(10, 20)',
      '100 ± 5',
      '200 ± 10%',
      '{1, 2, 3}',
      '(0-5: 40%, 5-10: 60%)',
      'TRAP(0, 2, 4, 6, 0.1)',
      'CUSTOM_1({0.3, 0.7}, 0.2, 0.8)',
    ]
    for (const s of samples) {
      const parsed = parseDistribution(s)
      expect(parsed, `Could not parse: ${s}`).not.toBeNull()
      const serialised = distributionToString(parsed)
      const reparsed = parseDistribution(serialised)
      expect(reparsed, `Round-trip failed for: ${s}`).toEqual(parsed)
    }
  })
})

// ---------------------------------------------------------------------------
// isValidDistribution
// ---------------------------------------------------------------------------
describe('isValidDistribution', () => {
  it('returns false for null or missing type', () => {
    expect(isValidDistribution(null)).toBe(false)
    expect(isValidDistribution({})).toBe(false)
  })

  it('validates certain', () => {
    expect(isValidDistribution({ type: 'certain', value: 5 })).toBe(true)
    expect(isValidDistribution({ type: 'certain', value: NaN })).toBe(false)
  })

  it('validates gaussian — requires std > 0', () => {
    expect(isValidDistribution({ type: 'gaussian', mean: 0, std: 1 })).toBe(true)
    expect(isValidDistribution({ type: 'gaussian', mean: 0, std: 0 })).toBe(false)
    expect(isValidDistribution({ type: 'gaussian', mean: 0, std: -1 })).toBe(false)
  })

  it('validates uniform — requires low < high', () => {
    expect(isValidDistribution({ type: 'uniform', low: 1, high: 2 })).toBe(true)
    expect(isValidDistribution({ type: 'uniform', low: 2, high: 1 })).toBe(false)
    expect(isValidDistribution({ type: 'uniform', low: 1, high: 1 })).toBe(false)
  })

  it('validates errorAbsolute — requires error >= 0', () => {
    expect(isValidDistribution({ type: 'errorAbsolute', value: 10, error: 0 })).toBe(true)
    expect(isValidDistribution({ type: 'errorAbsolute', value: 10, error: -1 })).toBe(false)
  })

  it('validates discrete — requires non-empty array of numbers', () => {
    expect(isValidDistribution({ type: 'discrete', values: [1, 2] })).toBe(true)
    expect(isValidDistribution({ type: 'discrete', values: [] })).toBe(false)
    expect(isValidDistribution({ type: 'discrete', values: [1, NaN] })).toBe(false)
  })

  it('validates trapezoid ordering', () => {
    const valid = { type: 'trapezoid', min: 0, peak_start: 1, peak_end: 2, max: 3, base_prob: 0.5 }
    expect(isValidDistribution(valid)).toBe(true)
    const inverted = { ...valid, min: 3, max: 0 }
    expect(isValidDistribution(inverted)).toBe(false)
  })

  it('validates custom_1 — x_low/x_high must be in [0,1]', () => {
    const valid = { type: 'custom_1', a_values: [0.5], x_low: 0.1, x_high: 0.9 }
    expect(isValidDistribution(valid)).toBe(true)
    expect(isValidDistribution({ ...valid, x_low: -0.1 })).toBe(false)
    expect(isValidDistribution({ ...valid, x_high: 1.5 })).toBe(false)
  })

  it('returns false for unknown type', () => {
    expect(isValidDistribution({ type: 'unknown' })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// computeDistributionBounds
// ---------------------------------------------------------------------------
describe('computeDistributionBounds', () => {
  it('returns {0,0} for null', () => {
    expect(computeDistributionBounds(null)).toEqual({ min: 0, max: 0 })
  })

  it('returns exact value for certain', () => {
    expect(computeDistributionBounds({ type: 'certain', value: 7 })).toEqual({ min: 7, max: 7 })
  })

  it('applies ±1.96σ bounds for gaussian', () => {
    const bounds = computeDistributionBounds({ type: 'gaussian', mean: 100, std: 10 })
    expect(bounds.min).toBeCloseTo(100 - 1.96 * 10, 5)
    expect(bounds.max).toBeCloseTo(100 + 1.96 * 10, 5)
  })

  it('uses low/high for uniform', () => {
    expect(computeDistributionBounds({ type: 'uniform', low: 5, high: 15 })).toEqual({
      min: 5,
      max: 15,
    })
  })

  it('uses ±error for errorAbsolute', () => {
    expect(
      computeDistributionBounds({ type: 'errorAbsolute', value: 100, error: 20 })
    ).toEqual({ min: 80, max: 120 })
  })

  it('computes bounds from percent for errorPercent', () => {
    const bounds = computeDistributionBounds({ type: 'errorPercent', value: 100, percent: 10 })
    expect(bounds).toEqual({ min: 90, max: 110 })
  })

  it('uses min/max of values for discrete', () => {
    expect(
      computeDistributionBounds({ type: 'discrete', values: [3, 1, 2] })
    ).toEqual({ min: 1, max: 3 })
  })

  it('uses range min/max for histogram', () => {
    const bounds = computeDistributionBounds({
      type: 'histogram',
      ranges: [
        { min: 0, max: 5, probability: 40 },
        { min: 5, max: 10, probability: 60 },
      ],
    })
    expect(bounds).toEqual({ min: 0, max: 10 })
  })
})

// ---------------------------------------------------------------------------
// getDistributionTypeLabel
// ---------------------------------------------------------------------------
describe('getDistributionTypeLabel', () => {
  it('returns correct labels', () => {
    expect(getDistributionTypeLabel('certain')).toBe('Certain')
    expect(getDistributionTypeLabel('gaussian')).toBe('Gaussian')
    expect(getDistributionTypeLabel('uniform')).toBe('Uniform')
    expect(getDistributionTypeLabel('errorAbsolute')).toBe('±Error')
    expect(getDistributionTypeLabel('errorPercent')).toBe('±%Error')
    expect(getDistributionTypeLabel('discrete')).toBe('Discrete')
    expect(getDistributionTypeLabel('histogram')).toBe('Histogram')
    expect(getDistributionTypeLabel('trapezoid')).toBe('Trapezoid')
    expect(getDistributionTypeLabel('custom_1')).toBe('Custom 1')
  })

  it('returns "Unknown" for unrecognised types', () => {
    expect(getDistributionTypeLabel('bogus')).toBe('Unknown')
  })
})

// ---------------------------------------------------------------------------
// getDistributionSummary
// ---------------------------------------------------------------------------
describe('getDistributionSummary', () => {
  it('returns empty string for null', () => {
    expect(getDistributionSummary(null)).toBe('')
  })

  it('formats certain as fixed-2 decimal', () => {
    expect(getDistributionSummary({ type: 'certain', value: 42 })).toBe('42.00')
  })

  it('formats gaussian', () => {
    const s = getDistributionSummary({ type: 'gaussian', mean: 100, std: 15 })
    expect(s).toMatch(/N\(μ=100\.00, σ=15\.00\)/)
  })

  it('formats histogram with range count', () => {
    const s = getDistributionSummary({
      type: 'histogram',
      ranges: [
        { min: 0, max: 5, probability: 40 },
        { min: 5, max: 10, probability: 60 },
      ],
    })
    expect(s).toBe('Hist. (2 ranges)')
  })
})
