/**
 * Shared helpers to check whether a stakeholder elicitation session has
 * completed each analysis step.  These utilities are used by both RecapPage
 * and RunUpMavtPage to avoid duplicating the same logic in multiple files.
 */

/**
 * Returns `true` when every criterion has a name, a unit, at least one
 * alternative, and every alternative has a name.
 *
 * @param {Array} criteria - Array of criterion objects from the study session.
 * @returns {boolean}
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

/**
 * Returns `true` when all qualitative criteria have a complete ranking and
 * value mapping in `qualitativeIndicators`, or when no qualitative criteria
 * exist (nothing to check).
 *
 * @param {Array}  criteria               - Array of criterion objects.
 * @param {object} qualitativeIndicators  - Map of criterion name → { ranking, values }.
 * @returns {boolean}
 */
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

/**
 * Returns `true` when every non-qualitative criterion has at least one value
 * function point defined, or when all criteria are qualitative.
 *
 * @param {Array}  criteria       - Array of criterion objects.
 * @param {object} valueFunctions - Value-functions config object (`{ criteria: { [name]: { points } } }`).
 * @returns {boolean}
 */
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

/**
 * Returns `true` when the PILE-BWT comparison data contains enough comparisons
 * for every criterion group, and — when multiple groups exist — also enough
 * intra-B and intra-W comparisons to rank the groups relative to each other.
 *
 * The minimum comparisons required per group is `max(1, 2n − 3)` where `n` is
 * the number of items being compared (criteria within a group, or groups when
 * computing intra-B/intra-W).
 *
 * @param {Array}  criteria - Array of criterion objects (must have a `group` field).
 * @param {object} bwtData  - BWT data object (`{ comparisons: Array }`).
 * @returns {boolean}
 */
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

/**
 * Convenience wrapper that checks all four steps for a single session.
 * Uses `session.criteria` when available; falls back to the study-level
 * `criteria` array otherwise.
 *
 * @param {object} session  - Elicitation session document from the API.
 * @param {Array}  criteria - Fallback array of criterion objects from the study session.
 * @returns {boolean}
 */
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
