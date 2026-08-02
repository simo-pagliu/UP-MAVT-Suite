import { describe, it, expect } from 'vitest'
import {
  isInputComplete,
  isQualitativeComplete,
  isValueFunctionsComplete,
  isPileBwtComplete,
  isSessionComplete,
} from '../utils/sessionUtils'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const makeCriterion = (overrides = {}) => ({
  criterion_name: 'C1',
  unit: 'km',
  is_qualitative: false,
  alternatives: [
    { name: 'Alt A', value: '10' },
    { name: 'Alt B', value: '20' },
  ],
  ...overrides,
})

const makeQualCriterion = (name = 'Q1') =>
  makeCriterion({ criterion_name: name, is_qualitative: true, alternatives: [{ name: 'Alt A' }, { name: 'Alt B' }] })

// ---------------------------------------------------------------------------
// isInputComplete
// ---------------------------------------------------------------------------
describe('isInputComplete', () => {
  it('returns false for null / empty array', () => {
    expect(isInputComplete(null)).toBe(false)
    expect(isInputComplete([])).toBe(false)
  })

  it('returns false when a criterion is missing a name', () => {
    expect(isInputComplete([makeCriterion({ criterion_name: '' })])).toBe(false)
  })

  it('returns false when a criterion is missing a unit', () => {
    expect(isInputComplete([makeCriterion({ unit: '' })])).toBe(false)
  })

  it('returns false when criteria have no alternatives', () => {
    expect(isInputComplete([makeCriterion({ alternatives: [] })])).toBe(false)
  })

  it('returns false when an alternative is missing a name', () => {
    const crit = makeCriterion({ alternatives: [{ name: '', value: '5' }] })
    expect(isInputComplete([crit])).toBe(false)
  })

  it('returns true when all criteria are complete', () => {
    expect(isInputComplete([makeCriterion()])).toBe(true)
  })

  it('returns true with multiple complete criteria', () => {
    expect(
      isInputComplete([
        makeCriterion({ criterion_name: 'C1' }),
        makeCriterion({ criterion_name: 'C2' }),
      ])
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// isQualitativeComplete
// ---------------------------------------------------------------------------
describe('isQualitativeComplete', () => {
  it('returns false for non-array', () => {
    expect(isQualitativeComplete(null, {})).toBe(false)
  })

  it('returns true when there are no qualitative criteria', () => {
    expect(isQualitativeComplete([makeCriterion()], {})).toBe(true)
  })

  it('returns false when qualitative indicators are missing', () => {
    const criteria = [makeQualCriterion('Q1')]
    expect(isQualitativeComplete(criteria, null)).toBe(false)
    expect(isQualitativeComplete(criteria, {})).toBe(false)
  })

  it('returns false when ranking or values are empty', () => {
    const criteria = [makeQualCriterion('Q1')]
    const qi = { Q1: { ranking: {}, values: {} } }
    expect(isQualitativeComplete(criteria, qi)).toBe(false)
  })

  it('returns true when all qualitative criteria have ranking and values', () => {
    const criteria = [makeQualCriterion('Q1'), makeQualCriterion('Q2')]
    const qi = {
      Q1: { ranking: { 'Alt A': 1 }, values: { 'Alt A': 0.8 } },
      Q2: { ranking: { 'Alt A': 1 }, values: { 'Alt A': 0.9 } },
    }
    expect(isQualitativeComplete(criteria, qi)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// isValueFunctionsComplete
// ---------------------------------------------------------------------------
describe('isValueFunctionsComplete', () => {
  it('returns false for non-array', () => {
    expect(isValueFunctionsComplete(null, {})).toBe(false)
  })

  it('returns true when all criteria are qualitative (no VF needed)', () => {
    expect(isValueFunctionsComplete([makeQualCriterion()], {})).toBe(true)
  })

  it('returns false when a non-qualitative criterion has no VF points', () => {
    const criteria = [makeCriterion({ criterion_name: 'C1' })]
    const vf = { criteria: { C1: { points: [] } } }
    expect(isValueFunctionsComplete(criteria, vf)).toBe(false)
  })

  it('returns false when valueFunctions is empty/null', () => {
    expect(isValueFunctionsComplete([makeCriterion()], null)).toBe(false)
    expect(isValueFunctionsComplete([makeCriterion()], {})).toBe(false)
  })

  it('returns true when all non-qualitative criteria have VF points', () => {
    const criteria = [makeCriterion({ criterion_name: 'C1' })]
    const vf = { criteria: { C1: { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } } }
    expect(isValueFunctionsComplete(criteria, vf)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// isPileBwtComplete
// ---------------------------------------------------------------------------
describe('isPileBwtComplete', () => {
  it('returns false for null / empty criteria', () => {
    expect(isPileBwtComplete(null, {})).toBe(false)
    expect(isPileBwtComplete([], {})).toBe(false)
  })

  it('returns false when there are no comparisons', () => {
    const criteria = [makeCriterion({ group: 'G1' }), makeCriterion({ criterion_name: 'C2', group: 'G1' })]
    expect(isPileBwtComplete(criteria, { comparisons: [] })).toBe(false)
  })

  it('returns true when enough comparisons are present for a single group', () => {
    // 2 criteria in one group → expected = max(1, 2*2 - 3) = 1 comparison
    const criteria = [
      makeCriterion({ criterion_name: 'C1', group: 'G1' }),
      makeCriterion({ criterion_name: 'C2', group: 'G1' }),
    ]
    const bwt = { comparisons: [{ group: 'G1', best: 'C1', worst: 'C2' }] }
    expect(isPileBwtComplete(criteria, bwt)).toBe(true)
  })

  it('returns false when not enough comparisons are present', () => {
    // 4 criteria → expected = max(1, 2*4 - 3) = 5 comparisons
    const criteria = Array.from({ length: 4 }, (_, i) =>
      makeCriterion({ criterion_name: `C${i}`, group: 'G1' })
    )
    const bwt = { comparisons: [{ group: 'G1', best: 'C1', worst: 'C2' }] }
    expect(isPileBwtComplete(criteria, bwt)).toBe(false)
  })

  it('requires intra-B/intra-W comparisons when there are multiple groups', () => {
    // 2 groups, 1 criterion each → 1 intra-B and 1 intra-W comparison needed
    const criteria = [
      makeCriterion({ criterion_name: 'C1', group: 'G1' }),
      makeCriterion({ criterion_name: 'C2', group: 'G2' }),
    ]
    const bwtOnlyBase = {
      comparisons: [
        { group: 'G1', best: 'C1', worst: 'C1' },
        { group: 'G2', best: 'C2', worst: 'C2' },
      ],
    }
    // Missing intra-B and intra-W
    expect(isPileBwtComplete(criteria, bwtOnlyBase)).toBe(false)

    const bwtComplete = {
      comparisons: [
        { group: 'G1', best: 'C1', worst: 'C1' },
        { group: 'G2', best: 'C2', worst: 'C2' },
        { group: 'intra-B', best: 'G1', worst: 'G2' },
        { group: 'intra-W', best: 'G1', worst: 'G2' },
      ],
    }
    expect(isPileBwtComplete(criteria, bwtComplete)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// isSessionComplete
// ---------------------------------------------------------------------------
describe('isSessionComplete', () => {
  it('returns false for null session', () => {
    expect(isSessionComplete(null, [])).toBe(false)
  })

  it('returns false when input is incomplete', () => {
    const session = {
      criteria: [makeCriterion({ criterion_name: '' })], // invalid
      qualitative_indicators: {},
      value_functions: null,
      bwt: null,
    }
    expect(isSessionComplete(session, [])).toBe(false)
  })

  it('returns true for a fully complete session (no qualitative, no BWT multi-group)', () => {
    const criteria = [makeCriterion({ criterion_name: 'C1', group: 'G1' })]
    const session = {
      criteria,
      qualitative_indicators: {},
      value_functions: { criteria: { C1: { points: [{ x: 0, y: 0 }] } } },
      bwt: { comparisons: [{ group: 'G1', best: 'C1', worst: 'C1' }] },
    }
    expect(isSessionComplete(session, criteria)).toBe(true)
  })

  it('falls back to the passed-in criteria when session.criteria is empty', () => {
    const fallbackCriteria = [makeCriterion({ criterion_name: '' })]
    const session = {
      criteria: [], // triggers fallback
      qualitative_indicators: {},
      value_functions: null,
      bwt: null,
    }
    expect(isSessionComplete(session, fallbackCriteria)).toBe(false)
  })
})
