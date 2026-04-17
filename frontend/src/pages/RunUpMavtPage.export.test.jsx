import { describe, it, expect } from 'vitest'
import {
  buildRankProbabilityMatrix,
  buildRankingHeatmapSvg,
  getRankingHeatmapDimensions,
} from './RunUpMavtPage'

const sampleResults = {
  alternative_names: ['Alt A', 'Alt B'],
  aggregated_results: [
    [0.9, 0.1],
    [0.8, 0.2],
    [0.2, 0.7],
  ],
}

describe('RunUpMavtPage export helpers', () => {
  it('builds rank probability matrix from aggregated results', () => {
    const matrix = buildRankProbabilityMatrix(sampleResults)

    expect(matrix.alternatives).toEqual(['Alt A', 'Alt B'])
    expect(matrix.probabilities[0][0]).toBeCloseTo(2 / 3)
    expect(matrix.probabilities[0][1]).toBeCloseTo(1 / 3)
    expect(matrix.probabilities[1][0]).toBeCloseTo(1 / 3)
    expect(matrix.probabilities[1][1]).toBeCloseTo(2 / 3)
  })

  it('builds SVG markup for ranking heatmap export', () => {
    const svg = buildRankingHeatmapSvg({
      title: 'Results Heatmap',
      results: sampleResults,
    })

    expect(svg).toContain('<svg')
    expect(svg).toContain('Results Heatmap')
    expect(svg).toContain('Alt A')
    expect(svg).toContain('Rank 1')
    expect(svg).toContain('%')
  })

  it('returns fallback dimensions when heatmap data is missing', () => {
    const dimensions = getRankingHeatmapDimensions(null)
    expect(dimensions.width).toBe(920)
    expect(dimensions.height).toBe(300)
  })
})
