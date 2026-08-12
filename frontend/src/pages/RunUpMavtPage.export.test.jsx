import { describe, it, expect } from 'vitest'
import {
  buildRankProbabilityMatrix,
  buildRankProbabilityCsv,
  computeConsensusQuantification,
  buildConsensusQuantificationCsv,
  buildSimulationRowsCsv,
  buildSimulationCsvExports,
  buildRankingHeatmapSvg,
  getRankingHeatmapDimensions,
  buildPipelineChartExportTargets,
  buildPipelineHeatmapExports,
  buildWeightSpacePlotSvg,
  inlineSvgComputedStyles,
  toWorkflowStepFilenameBase,
} from './RunUpMavtPage'

const sampleResults = {
  alternative_names: ['Alt A', 'Alt B'],
  aggregated_results: [
    [0.9, 0.1],
    [0.8, 0.2],
    [0.2, 0.7],
  ],
}

const step2Results = {
  alternative_names: ['Alt A', 'Alt B'],
  results_by_elicitation: {
    2: [
      [0.9, 0.1],
      [0.8, 0.2],
    ],
    10: [
      [0.6, 0.4],
    ],
  },
}

const step4Results = {
  results_by_aggregation: {
    weighted_sum: {
      alternative_names: ['Alt A', 'Alt B'],
      aggregated_results: [
        [0.7, 0.3],
        [0.4, 0.6],
      ],
    },
    harmonic_mean: {
      alternative_names: ['Alt A', 'Alt B'],
      aggregated_results: [
        [0.5, 0.5],
      ],
    },
  },
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
    const rendered = buildRankingHeatmapSvg({
      title: 'Results Heatmap',
      results: sampleResults,
    })

    expect(rendered.svgMarkup).toContain('<svg')
    expect(rendered.svgMarkup).toContain('Results Heatmap')
    expect(rendered.svgMarkup).toContain('Alt A')
    expect(rendered.svgMarkup).toContain('Rank 1')
    expect(rendered.svgMarkup).toContain('%')
    expect(rendered.width).toBeGreaterThan(0)
    expect(rendered.height).toBeGreaterThan(0)
  })

  it('keeps buildRankingHeatmapSvg dimensions in sync with getRankingHeatmapDimensions', () => {
    const rendered = buildRankingHeatmapSvg({
      title: 'Results Heatmap',
      results: sampleResults,
    })
    const dimensions = getRankingHeatmapDimensions(sampleResults)

    expect(rendered.width).toBe(dimensions.width)
    expect(rendered.height).toBe(dimensions.height)
  })

  it('builds CSV output for rank probabilities', () => {
    const csv = buildRankProbabilityCsv(sampleResults)
    expect(csv).toContain('rank;Alt A;Alt B')
    expect(csv).toContain('1;0.666667;0.333333')
  })

  it('builds wide CSV output for raw simulation rows', () => {
    const csv = buildSimulationRowsCsv({
      alternative_names: ['Alt A', 'Alt B'],
      aggregated_results: [
        [1, 2],
        [3.1234567, 4],
      ],
    })

    expect(csv).toContain('iteration;Alt A;Alt B')
    expect(csv).toContain('1;1.000000;2.000000')
    expect(csv).toContain('2;3.123457;4.000000')
  })

  it('builds step-specific raw simulation export descriptors', () => {
    const step2Exports = buildSimulationCsvExports(2, step2Results)
    const step3Exports = buildSimulationCsvExports(3, sampleResults)
    const step4Exports = buildSimulationCsvExports(4, step4Results)

    expect(step2Exports).toHaveLength(2)
    expect(step2Exports[0].filenameBase).toContain('step_2_elicitation_1')
    expect(step2Exports[0].csvText).toContain('iteration;Alt A;Alt B')

    expect(step3Exports).toHaveLength(1)
    expect(step3Exports[0].filenameBase).toBe('step_3_simulation')

    expect(step4Exports.map((entry) => entry.filenameBase)).toEqual([
      'step_4_aggregation_harmonic_mean',
      'step_4_aggregation_weighted_sum',
    ])
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
    const rendered = buildRankingHeatmapSvg({ title: 'Many', results: manyAlternatives })
    const dimensions = getRankingHeatmapDimensions(manyAlternatives)

    expect(rendered.svgMarkup).toContain('Rank 5')
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

  it('computes consensus quantification from normalized distributions', () => {
    const identical = computeConsensusQuantification(
      [
        { x: 0.25, E1: 0.4, E2: 0.4 },
        { x: 0.75, E1: 0.6, E2: 0.6 },
      ],
      ['E1', 'E2']
    )
    const disjoint = computeConsensusQuantification(
      [
        { x: 0.25, E1: 1, E2: 0 },
        { x: 0.75, E1: 0, E2: 1 },
      ],
      ['E1', 'E2']
    )

    expect(identical.consensusPercent).toBeCloseTo(100, 6)
    expect(disjoint.consensusPercent).toBeCloseTo(0, 6)
  })

  it('builds consensus quantification CSV for step 2 exports', () => {
    const csv = buildConsensusQuantificationCsv([
      {
        alternative: 'Alt A',
        elicitationCount: 3,
        differenceArea: 1.234567,
        consensusRatio: 0.6172835,
        consensusPercent: 61.72835,
      },
    ])

    expect(csv).toContain('title;Step 2 consensus quantification')
    expect(csv).toContain('alternative;elicitation_count;difference_area;consensus_ratio;consensus_percent')
    expect(csv).toContain('Alt A;3;1.234567;0.617284;61.73')
  })

  it('includes weight-space target when available', () => {
    const targets = buildPipelineChartExportTargets({ hasWeightSpacePlot: true })
    expect(targets.map((target) => target.filenameBase)).toContain('step1_weight_space_plot')
  })

  it('builds heatmap export descriptors for available steps only', () => {
    const targets = buildPipelineHeatmapExports({
      step4Results: {
        results_by_aggregation: {
          weighted_sum: { alternative_names: ['A'], aggregated_results: [[1]] },
          harmonic_mean: { alternative_names: ['A'], aggregated_results: [[1]] },
        },
      },
      step6Results: null,
    })

    expect(targets.map((target) => target.filenameBase)).toEqual([
      'step4_wam_aggregation_heatmap',
      'step4_har_aggregation_heatmap',
    ])
  })

  it('builds SVG markup for weight-space export', () => {
    const rendered = buildWeightSpacePlotSvg({
      data: [{ C1: 0.6, C2: 0.4 }, { C1: 0.5, C2: 0.5 }],
      orderedCriteria: ['C2', 'C1'],
      isNonLinearModel: true,
      solutionCount: 2,
    })
    expect(rendered.svgMarkup).toContain('<svg')
    expect(rendered.svgMarkup).toContain('Weight Space Plot')
    expect(rendered.svgMarkup).toContain('C2')
  })

  it('inlines computed SVG styles recursively, including zero values', () => {
    const styleTag = document.createElement('style')
    styleTag.textContent = '.export-style { fill: rgb(25, 118, 210); fill-opacity: 0; stroke-width: 0; }'
    document.head.appendChild(styleTag)

    const svgNs = 'http://www.w3.org/2000/svg'
    const sourceSvg = document.createElementNS(svgNs, 'svg')
    const group = document.createElementNS(svgNs, 'g')
    const path = document.createElementNS(svgNs, 'path')
    path.setAttribute('class', 'export-style')
    group.appendChild(path)
    sourceSvg.appendChild(group)
    document.body.appendChild(sourceSvg)

    const cloneSvg = sourceSvg.cloneNode(true)
    document.body.appendChild(cloneSvg)
    const clonePath = cloneSvg.querySelector('path')
    expect(clonePath.style.fill).toBe('')
    expect(clonePath.style.fillOpacity).toBe('')

    inlineSvgComputedStyles(sourceSvg, cloneSvg)

    expect(clonePath.style.fill).toBe('rgb(25, 118, 210)')
    expect(clonePath.style.fillOpacity).toBe('0')
    expect(clonePath.style.strokeWidth).toBe('0')
    document.body.removeChild(cloneSvg)
    document.body.removeChild(sourceSvg)
    document.head.removeChild(styleTag)
  })

  it('renames both stepN_ (images) and step_N_ (CSVs) filename bases to their workflow-facing name', () => {
    // Image filenameBases historically had no underscore before the digit (step5_...), while CSV
    // filenameBases from buildSimulationCsvExports do (step_5_...) - both must resolve the same way.
    expect(toWorkflowStepFilenameBase('step5_distribution_0')).toBe('step_3_uncertainty_analysis_distribution_0')
    expect(toWorkflowStepFilenameBase('step_5_elicitation_1_E1')).toBe('step_3_uncertainty_analysis_elicitation_1_E1')
    expect(toWorkflowStepFilenameBase('step2_distribution_0')).toBe('step_4_consensus_analysis_distribution_0')
    expect(toWorkflowStepFilenameBase('step4_wam_aggregation_heatmap')).toBe('step_2_choose_aggregation_method_wam_aggregation_heatmap')
    expect(toWorkflowStepFilenameBase('step1_declared_computed_ratios')).toBe('step_1_finalize_elicited_data_declared_computed_ratios')
    expect(toWorkflowStepFilenameBase('step6_results_heatmap')).toBe('step_5_final_results_results_heatmap')
    expect(toWorkflowStepFilenameBase('unrelated_file')).toBe('unrelated_file')
  })
})
