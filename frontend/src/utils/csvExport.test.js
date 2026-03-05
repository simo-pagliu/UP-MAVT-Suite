import { describe, it, expect, vi, afterEach } from 'vitest'
import { generateInputCSV, downloadCSVFile } from '../utils/csvExport'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const makeCriteria = (overrides = []) => {
  const defaults = [
    {
      criterion_name: 'C1',
      unit: 'km',
      group: 'G1',
      description: 'First criterion',
      is_qualitative: false,
      use_custom_min_max: false,
      min_value: '',
      max_value: '',
      alternatives: [
        { name: 'Alt A', value: '10' },
        { name: 'Alt B', value: '20' },
      ],
    },
    {
      criterion_name: 'C2',
      unit: 'EUR',
      group: 'G2',
      description: 'Second criterion',
      is_qualitative: false,
      use_custom_min_max: false,
      min_value: '',
      max_value: '',
      alternatives: [
        { name: 'Alt A', value: '5' },
        { name: 'Alt B', value: '15' },
      ],
    },
  ]
  return [...defaults, ...overrides]
}

const parseCSV = (csv) =>
  csv.split('\n').map((line) => {
    const values = []
    let current = ''
    let inQuotes = false
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes
      } else if (char === ',' && !inQuotes) {
        values.push(current)
        current = ''
      } else {
        current += char
      }
    }
    values.push(current)
    return values
  })

// ---------------------------------------------------------------------------
// generateInputCSV
// ---------------------------------------------------------------------------
describe('generateInputCSV', () => {
  it('returns empty string for null or empty criteria', () => {
    expect(generateInputCSV(null)).toBe('')
    expect(generateInputCSV([])).toBe('')
  })

  it('produces the correct number of rows', () => {
    const csv = generateInputCSV(makeCriteria())
    const rows = csv.split('\n')
    // header + group + description + 2 alternatives + unit = 6 rows
    expect(rows).toHaveLength(6)
  })

  it('first row is the header (Alternative, criterion names)', () => {
    const criteria = makeCriteria()
    const rows = parseCSV(generateInputCSV(criteria))
    expect(rows[0][0]).toBe('Alternative')
    expect(rows[0][1]).toBe('C1')
    expect(rows[0][2]).toBe('C2')
  })

  it('second row is the group row', () => {
    const criteria = makeCriteria()
    const rows = parseCSV(generateInputCSV(criteria))
    expect(rows[1][0]).toBe('Group')
    expect(rows[1][1]).toBe('G1')
    expect(rows[1][2]).toBe('G2')
  })

  it('third row is the description row', () => {
    const criteria = makeCriteria()
    const rows = parseCSV(generateInputCSV(criteria))
    expect(rows[2][0]).toBe('Description')
    expect(rows[2][1]).toBe('First criterion')
    expect(rows[2][2]).toBe('Second criterion')
  })

  it('last row is the unit row', () => {
    const criteria = makeCriteria()
    const rows = parseCSV(generateInputCSV(criteria))
    const lastRow = rows[rows.length - 1]
    expect(lastRow[0]).toBe('Unit')
    expect(lastRow[1]).toBe('km')
    expect(lastRow[2]).toBe('EUR')
  })

  it('alternative rows contain names and values', () => {
    const criteria = makeCriteria()
    const rows = parseCSV(generateInputCSV(criteria))
    // rows[3] = Alt A, rows[4] = Alt B
    expect(rows[3][0]).toBe('Alt A')
    expect(rows[3][1]).toBe('10')
    expect(rows[3][2]).toBe('5')
    expect(rows[4][0]).toBe('Alt B')
    expect(rows[4][1]).toBe('20')
    expect(rows[4][2]).toBe('15')
  })

  it('includes Min/Max rows when use_custom_min_max is set', () => {
    const criteria = [
      {
        criterion_name: 'C1',
        unit: 'km',
        group: '',
        description: '',
        is_qualitative: false,
        use_custom_min_max: true,
        min_value: '0',
        max_value: '100',
        alternatives: [{ name: 'Alt A', value: '50' }],
      },
    ]
    const rows = parseCSV(generateInputCSV(criteria))
    const rowLabels = rows.map((r) => r[0])
    expect(rowLabels).toContain('Min')
    expect(rowLabels).toContain('Max')
    const minRow = rows.find((r) => r[0] === 'Min')
    const maxRow = rows.find((r) => r[0] === 'Max')
    expect(minRow[1]).toBe('0')
    expect(maxRow[1]).toBe('100')
  })

  it('does not include Min/Max rows when no criterion has custom min/max', () => {
    const csv = generateInputCSV(makeCriteria())
    expect(csv).not.toContain('Min')
    expect(csv).not.toContain('Max')
  })

  it('properly quotes cells that contain commas', () => {
    const criteria = [
      {
        criterion_name: 'C, one',
        unit: 'km',
        group: '',
        description: '',
        is_qualitative: false,
        use_custom_min_max: false,
        min_value: '',
        max_value: '',
        alternatives: [{ name: 'Alt A', value: '5' }],
      },
    ]
    const csv = generateInputCSV(criteria)
    expect(csv).toContain('"C, one"')
  })
})

// ---------------------------------------------------------------------------
// downloadCSVFile
// ---------------------------------------------------------------------------
describe('downloadCSVFile', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates a temporary <a> element and triggers a click', () => {
    // Mock URL.createObjectURL / revokeObjectURL
    const mockUrl = 'blob:mock-url'
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => mockUrl),
      revokeObjectURL: vi.fn(),
    })

    const clickSpy = vi.fn()
    const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation(() => {})
    const removeSpy = vi.spyOn(document.body, 'removeChild').mockImplementation(() => {})
    vi.spyOn(document, 'createElement').mockReturnValue({
      setAttribute: vi.fn(),
      click: clickSpy,
      style: {},
    })

    downloadCSVFile('a,b\n1,2', 'test.csv')

    expect(clickSpy).toHaveBeenCalledOnce()
    expect(appendSpy).toHaveBeenCalledOnce()
    expect(removeSpy).toHaveBeenCalledOnce()
  })
})
