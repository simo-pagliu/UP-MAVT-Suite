import { describe, it, expect } from 'vitest'
import {
  computeDistributionIndicators,
  formatPerElicitationDistributionSummary,
  buildDistributionStatsCsv,
} from './distributionStats'

describe('distributionStats', () => {
  it('computes core indicators for a simple sequence', () => {
    const stats = computeDistributionIndicators([0, 1, 2, 3, 4])

    expect(stats.n).toBe(5)
    expect(stats.average).toBeCloseTo(2, 6)
    expect(stats.median).toBeCloseTo(2, 6)
    expect(stats.variance).toBeCloseTo(2, 6)
    expect(stats.stdDev).toBeCloseTo(Math.sqrt(2), 6)
    expect(stats.p10).toBeCloseTo(0.4, 6)
    expect(stats.p90).toBeCloseTo(3.6, 6)
    expect(stats.iqr).toBeCloseTo(2, 6)
    expect(stats.min).toBe(0)
    expect(stats.max).toBe(4)
  })

  it('handles constant-value distributions safely', () => {
    const stats = computeDistributionIndicators([5, 5, 5, 5])

    expect(stats.stdDev).toBe(0)
    expect(stats.skewness).toBe(0)
    expect(stats.kurtosis).toBe(0)
    expect(stats.entropyBits).toBe(0)
    expect(stats.normalizedEntropy).toBe(0)
    expect(stats.modeApprox).toBe(5)
    expect(stats.peakProbability).toBe(1)
    expect(stats.cv).toBe(0)
  })

  it('returns null-valued indicators for empty or non-finite input', () => {
    const stats = computeDistributionIndicators([Number.NaN, Infinity, -Infinity])

    expect(stats.n).toBe(0)
    expect(stats.average).toBeNull()
    expect(stats.median).toBeNull()
    expect(stats.stdDev).toBeNull()
    expect(stats.skewness).toBeNull()
    expect(stats.entropyBits).toBeNull()
  })

  it('formats per-elicitation summary text with extended indicators', () => {
    const summary = formatPerElicitationDistributionSummary([
      { label: 'E1', expertName: 'Alice', values: [0.1, 0.3, 0.6, 0.8] },
      { label: 'E2', expertName: 'Bob', values: [0.2, 0.2, 0.25, 0.9] },
    ])

    expect(summary.text).toContain('E1 (Alice)')
    expect(summary.text).toContain('average=')
    expect(summary.text).toContain('median=')
    expect(summary.text).toContain('std=')
    expect(summary.text).toContain('skew=')
    expect(summary.text).toContain('kurt=')
    expect(summary.text).toContain('P10=')
    expect(summary.text).toContain('P90=')
    expect(summary.text).toContain('IQR=')
    expect(summary.text).toContain('entropy=')
    expect(summary.text).toContain('mode~=')
    expect(summary.lines.length).toBeGreaterThan(6)
  })

  it('builds a placeholder CSV when no stats are available yet', () => {
    const csv = buildDistributionStatsCsv(null, {
      title: 'Step 2 consensus quantification',
      placeholderMessage: 'Consensus quantification stats are not available yet.',
    })

    expect(csv).toContain('title;Step 2 consensus quantification')
    expect(csv).toContain('note;Consensus quantification stats are not available yet.')
  })

  it('builds a per-elicitation CSV for populated stats', () => {
    const csv = buildDistributionStatsCsv([
      { label: 'E1', expertName: 'Alice', values: [1, 2, 3] },
    ], {
      title: 'Step 5 uncertainty stats',
    })

    expect(csv).toContain('title;Step 5 uncertainty stats')
    expect(csv).toContain('E1 (Alice);average;2')
    expect(csv).toContain('E1 (Alice);median;2')
  })
})
