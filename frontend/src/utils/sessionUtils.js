/**
 * Shared helpers to check whether a stakeholder elicitation session has
 * completed each analysis step.  These utilities are used by both RecapPage
 * and RunUpMavtPage to avoid duplicating the same logic in multiple files.
 */

export const isInputComplete = (criteria) => {
  if (!Array.isArray(criteria) || criteria.length === 0) return false
  return criteria.every((crit) => {
    if (!crit?.criterion_name || !crit?.unit) return false
    const alts = Array.isArray(crit?.alternatives) ? crit.alternatives : []
    if (alts.length === 0) return false
    return alts.every((alt) => alt?.name)
  })
}

export const isQualitativeComplete = (criteria, qualitativeIndicators) => {
  if (!Array.isArray(criteria)) return false
  const qualitativeCriteria = criteria.filter((crit) => crit?.is_qualitative)
  if (qualitativeCriteria.length === 0) return true
  if (!qualitativeIndicators || typeof qualitativeIndicators !== 'object') return false
  return qualitativeCriteria.every((crit) => {
    const name = crit?.criterion_name
    const data = name ? qualitativeIndicators[name] : null
    const ranking = data?.ranking
    const values = data?.values
    return ranking && values && Object.keys(ranking).length > 0 && Object.keys(values).length > 0
  })
}

export const isValueFunctionsComplete = (criteria, valueFunctions) => {
  if (!Array.isArray(criteria)) return false
  const criteriaMap = valueFunctions?.criteria || {}
  const nonQualitative = criteria.filter((crit) => !crit?.is_qualitative)
  if (nonQualitative.length === 0) return true
  return nonQualitative.every((crit) => {
    const name = crit?.criterion_name
    const cfg = name ? criteriaMap[name] : null
    const points = Array.isArray(cfg?.points) ? cfg.points : []
    return points.length > 0
  })
}

export const isPileBwtComplete = (criteria, bwtData) => {
  if (!Array.isArray(criteria) || criteria.length === 0) return false
  const comparisons = Array.isArray(bwtData?.comparisons) ? bwtData.comparisons : []
  const groupMap = criteria.reduce((acc, crit) => {
    const groupName = crit?.group || 'Ungrouped'
    if (!acc[groupName]) acc[groupName] = []
    acc[groupName].push(crit)
    return acc
  }, {})

  const baseGroups = Object.entries(groupMap).map(([name, groupCriteria]) => ({
    name,
    criteria: groupCriteria,
  }))

  const completedBaseGroups = baseGroups.every(({ name, criteria: groupCriteria }) => {
    const expected = Math.max(1, 2 * groupCriteria.length - 3)
    const groupComps = comparisons.filter((c) => c?.group === name)
    return groupComps.length >= expected
  })

  const hasMultipleGroups = baseGroups.length > 1
  const intraBExpected = hasMultipleGroups ? Math.max(1, 2 * baseGroups.length - 3) : 0
  const intraWExpected = hasMultipleGroups ? Math.max(1, 2 * baseGroups.length - 3) : 0
  const intraBComps = comparisons.filter((c) => c?.group === 'intra-B')
  const intraWComps = comparisons.filter((c) => c?.group === 'intra-W')
  const completedIntraB = !hasMultipleGroups || intraBComps.length >= intraBExpected
  const completedIntraW = !hasMultipleGroups || intraWComps.length >= intraWExpected

  return baseGroups.length > 0 && completedBaseGroups && completedIntraB && completedIntraW
}

export const isSessionComplete = (session, criteria) => {
  if (!session) return false
  const sessionCriteria =
    Array.isArray(session?.criteria) && session.criteria.length > 0
      ? session.criteria
      : criteria

  return (
    isInputComplete(sessionCriteria) &&
    isQualitativeComplete(sessionCriteria, session?.qualitative_indicators) &&
    isValueFunctionsComplete(sessionCriteria, session?.value_functions) &&
    isPileBwtComplete(sessionCriteria, session?.bwt)
  )
}
