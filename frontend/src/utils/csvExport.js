/**
 * Generate CSV in input format: Alternative, Criterion1, Criterion2, ...
 * Row 1: Alternative, Criterion names
 * Row 2: Group, Groups for each criterion
 * Row 3: Description, Descriptions for each criterion
 * Row 4: is_qi, TRUE/FALSE per criterion
 * Row 5: vf_method, TRUE/FALSE per criterion (TRUE=mid-value splitting, FALSE=free-edit)
 * Row 6: Min, Min values for each criterion (empty unless custom min/max is enabled)
 * Row 7: Max, Max values for each criterion (empty unless custom min/max is enabled)
 * Rows N+: Alternative values (one row per alternative)
 * Last row: Unit, Units for each criterion
 */
export const generateInputCSV = (criteria) => {
  if (!criteria || criteria.length === 0) {
    return ''
  }

  const rows = []
  const alternativeCount = criteria[0]?.alternatives?.length || 0

  // Header: Alternative, Criterion1, Criterion2, ...
  rows.push([
    'Alternative',
    ...criteria.map(c => c.criterion_name || ''),
  ])

  // Group: Group, group1, group2, ...
  rows.push([
    'Group',
    ...criteria.map(c => c.group || ''),
  ])

  // Description: Description, desc1, desc2, ...
  rows.push([
    'Description',
    ...criteria.map(c => c.description || ''),
  ])

  // is_qi: is_qi, true/false per criterion
  rows.push([
    'is_qi',
    ...criteria.map(c => (c.is_qualitative ? 'TRUE' : 'FALSE')),
  ])

  // vf_method: TRUE/FALSE (TRUE = mid-value splitting)
  rows.push([
    'vf_method',
    ...criteria.map(c => (c.use_mid_splitting ? 'TRUE' : 'FALSE')),
  ])

  // Min: Min, min1, min2, ... (empty unless custom min/max is enabled)
  rows.push([
    'Min',
    ...criteria.map(c => (c.use_custom_min_max ? (c.min_value || '') : '')),
  ])

  // Max: Max, max1, max2, ... (empty unless custom min/max is enabled)
  rows.push([
    'Max',
    ...criteria.map(c => (c.use_custom_min_max ? (c.max_value || '') : '')),
  ])

  // Alternative rows: alt_name, value1, value2, ...
  for (let i = 0; i < alternativeCount; i++) {
    rows.push([
      criteria[0].alternatives[i]?.name || '',
      ...criteria.map(c => c.alternatives[i]?.value || ''),
    ])
  }

  // Unit: Unit, unit1, unit2, ...
  rows.push([
    'Unit',
    ...criteria.map(c => c.unit || ''),
  ])

  // Convert to CSV string with proper escaping
  const csvContent = rows
    .map(row =>
      row
        .map(cell => {
          const str = String(cell)
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`
          }
          return str
        })
        .join(','),
    )
    .join('\n')

  return csvContent
}

/**
 * Download CSV file
 */
export const downloadCSVFile = (csvContent, filename) => {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  link.setAttribute('href', url)
  link.setAttribute('download', filename)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}
