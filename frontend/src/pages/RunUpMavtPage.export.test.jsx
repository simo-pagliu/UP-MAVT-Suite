import { describe, it, expect } from 'vitest'
import {
  buildRankProbabilityMatrix,
  buildRankingHeatmapSvg,
  getRankingHeatmapDimensions,
  buildPipelineChartExportTargets,
  buildPipelineHeatmapExports,
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

  it('handles single-alternative and multi-alternative edge cases', () => {
    const single = buildRankProbabilityMatrix({
      alternative_names: ['Only Alt'],
      aggregated_results: [[0.42], [0.21]],
    })
    expect(single.probabilities).toEqual([[1]])

    const manyAlternatives = {
      alternative_names: ['A', 'B', 'C', 'D', 'E'],
      aggregated_results: [
        [5, 4, 3, 2, 1],
        [4, 5, 3, 2, 1],
      ],
    }
    const svg = buildRankingHeatmapSvg({ title: 'Many', results: manyAlternatives })
    const dimensions = getRankingHeatmapDimensions(manyAlternatives)

    expect(svg).toContain('Rank 5')
    expect(dimensions.width).toBeGreaterThanOrEqual(920)
    expect(dimensions.height).toBeGreaterThan(300)
  })

  it('builds chart export targets across Step 1, 2 and 5', () => {
    const targets = buildPipelineChartExportTargets({
      hasStep1Consistency: true,
      step2AlternativeNames: ['Alt A', 'Alt B'],
      step5AlternativeNames: ['Alt C'],
    })

    expect(targets.map((target) => target.exportId)).toEqual([
      'step1_declared_computed_ratios',
      'step2_distribution_0',
      'step2_distribution_1',
      'step5_distribution_0',
    ])
  })

  it('builds heatmap export descriptors for available steps only', () => {
    const targets = buildPipelineHeatmapExports({
      step3Results: { alternative_names: ['A'], aggregated_results: [[1]] },
      step4Results: {
        results_by_aggregation: {
          weighted_sum: { alternative_names: ['A'], aggregated_results: [[1]] },
          harmonic_mean: { alternative_names: ['A'], aggregated_results: [[1]] },
        },
      },
      step6Results: null,
    })

    expect(targets.map((target) => target.filenameBase)).toEqual([
      'step3_dominance_heatmap',
      'step4_sum_aggregation_heatmap',
      'step4_har_aggregation_heatmap',
    ])
  })
})
