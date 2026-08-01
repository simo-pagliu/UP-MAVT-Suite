export const normalizeConfidenceAdjustment = (value, defaultValue = 0) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return defaultValue
  if (parsed < -4 || parsed > 4) return defaultValue
  return Number(parsed.toFixed(1))
}

export const normalizeOverallWeightValue = (value, defaultValue = 1) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return defaultValue
  return parsed
}

export const createDefaultPractitionerSettings = (criteriaList = []) => {
  const qiCriteria = {}
  const vfCriteria = {}
  criteriaList.forEach((criterion) => {
    const name = criterion?.criterion_name
    if (!name) return
    if (criterion?.is_qualitative) {
      qiCriteria[name] = 0
    } else {
      vfCriteria[name] = 0
    }
  })
  return {
    notes: '',
    overall_weight: 1,
    confidence_adjustments: {
      overall: 0,
      qi: 0,
      vf: 0,
      qi_criteria: qiCriteria,
      vf_criteria: vfCriteria,
    },
  }
}

export const normalizePractitionerSettings = (criteriaList = [], settings) => {
  const defaults = createDefaultPractitionerSettings(criteriaList)
  const input = settings && typeof settings === 'object' ? settings : {}
  const inputAdjustments = input.confidence_adjustments && typeof input.confidence_adjustments === 'object'
    ? input.confidence_adjustments
    : {}
  return {
    notes: String(input.notes ?? ''),
    overall_weight: normalizeOverallWeightValue(input.overall_weight, defaults.overall_weight),
    confidence_adjustments: {
      overall: normalizeConfidenceAdjustment(inputAdjustments.overall, defaults.confidence_adjustments.overall),
      qi: normalizeConfidenceAdjustment(inputAdjustments.qi, defaults.confidence_adjustments.qi),
      vf: normalizeConfidenceAdjustment(inputAdjustments.vf, defaults.confidence_adjustments.vf),
      qi_criteria: Object.keys(defaults.confidence_adjustments.qi_criteria).reduce((acc, name) => {
        acc[name] = normalizeConfidenceAdjustment(
          inputAdjustments.qi_criteria?.[name],
          defaults.confidence_adjustments.qi_criteria[name]
        )
        return acc
      }, {}),
      vf_criteria: Object.keys(defaults.confidence_adjustments.vf_criteria).reduce((acc, name) => {
        acc[name] = normalizeConfidenceAdjustment(
          inputAdjustments.vf_criteria?.[name],
          defaults.confidence_adjustments.vf_criteria[name]
        )
        return acc
      }, {}),
    },
  }
}
