import React, { useState, useEffect } from 'react'
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  ModalFooter,
  Button,
  VStack,
  HStack,
  FormControl,
  FormLabel,
  Input,
  Select,
  Text,
  Box,
  Divider,
} from '@chakra-ui/react'
import {
  parseDistribution,
  computeDistributionBounds,
  generatePlotData,
  getDistributionTypeLabel,
  isValidDistribution,
} from '../utils/distributionUtils'

/**
 * DistributionModal Component
 * Modal dialog for editing cell distributions with parameters and preview
 */
export function DistributionModal({
  isOpen,
  onClose,
  initialValue = '',
  onSave,
  title = 'Edit Distribution',
}) {
  const [distType, setDistType] = useState('certain')
  const [params, setParams] = useState({})
  
  useEffect(() => {
    if (isOpen && initialValue) {
      const parsed = parseDistribution(initialValue)
      if (parsed) {
        setDistType(parsed.type)
        setParams(parsed)
      } else {
        // Try to parse as a number
        const num = parseFloat(initialValue)
        if (!isNaN(num)) {
          setDistType('certain')
          setParams({ type: 'certain', value: num })
        } else {
          setDistType('certain')
          setParams({ type: 'certain', value: 0 })
        }
      }
    }
  }, [isOpen, initialValue])

  const handleTypeChange = (e) => {
    const newType = e.target.value
    setDistType(newType)
    
    // Initialize params based on new type
    switch (newType) {
      case 'certain':
        setParams({ type: 'certain', value: 0 })
        break
      case 'gaussian':
        setParams({ type: 'gaussian', mean: 0, std: 1 })
        break
      case 'uniform':
        setParams({ type: 'uniform', low: 0, high: 1 })
        break
      case 'errorAbsolute':
        setParams({ type: 'errorAbsolute', value: 0, error: 0 })
        break
      case 'errorPercent':
        setParams({ type: 'errorPercent', value: 0, percent: 5 })
        break
      case 'discrete':
        setParams({ type: 'discrete', values: [0] })
        break
      case 'histogram':
        setParams({
          type: 'histogram',
          ranges: [{ min: 0, max: 1, probability: 100 }],
        })
        break
      case 'trapezoid':
        setParams({
          type: 'trapezoid',
          min: 0,
          peak_start: 1,
          peak_end: 2,
          max: 3,
          base_prob: 0
        })
        break
      case 'custom_1':
        setParams({
          type: 'custom_1',
          a_values: [1],
          x_low: 0.3,
          x_high: 0.7
        })
        break
      default:
        setParams({ type: newType })
    }
  }

  const handleParamChange = (key, value) => {
    setParams(prev => ({ ...prev, [key]: value }))
  }

  const handleDiscreteValuesChange = (e) => {
    const input = e.target.value
    const values = input
      .split(',')
      .map(v => parseFloat(v.trim()))
      .filter(v => !isNaN(v))
    setParams(prev => ({ ...prev, values }))
  }

  const handleHistogramRangeChange = (idx, field, value) => {
    const newRanges = [...params.ranges]
    newRanges[idx] = { ...newRanges[idx], [field]: parseFloat(value) || 0 }
    setParams(prev => ({ ...prev, ranges: newRanges }))
  }

  const addHistogramRange = () => {
    const newRange = { min: 0, max: 1, probability: 50 }
    setParams(prev => ({
      ...prev,
      ranges: [...prev.ranges, newRange],
    }))
  }

  const removeHistogramRange = (idx) => {
    const newRanges = params.ranges.filter((_, i) => i !== idx)
    setParams(prev => ({ ...prev, ranges: newRanges }))
  }

  const handleSave = () => {
    if (isValidDistribution(params)) {
      onSave(params)
      onClose()
    }
  }

  const bounds = computeDistributionBounds(params)
  const plotData = generatePlotData(params)

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>{title}</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <VStack spacing={6} align="stretch">
            {/* Type Selector */}
            <FormControl>
              <FormLabel fontWeight="bold">Distribution Type</FormLabel>
              <Select value={distType} onChange={handleTypeChange}>
                <option value="certain">Certain (single value)</option>
                <option value="gaussian">Gaussian (Normal) N(μ, σ)</option>
                <option value="uniform">Uniform U(low, high)</option>
                <option value="errorAbsolute">±Error (absolute)</option>
                <option value="errorPercent">±%Error (percentage)</option>
                <option value="discrete">Discrete {`{x, y, z}`}</option>
                <option value="histogram">Histogram {`(range: %)`}</option>
                <option value="trapezoid">Trapezoid / Triangle</option>
                <option value="custom_1">Custom 1 (categorical)</option>
              </Select>
            </FormControl>

            {/* Parameters based on type */}
            {distType === 'certain' && (
              <FormControl>
                <FormLabel>Value</FormLabel>
                <Input
                  type="number"
                  value={params.value || ''}
                  onChange={(e) => handleParamChange('value', parseFloat(e.target.value))}
                  placeholder="Enter value"
                />
              </FormControl>
            )}

            {distType === 'gaussian' && (
              <>
                <FormControl>
                  <FormLabel>Mean (μ)</FormLabel>
                  <Input
                    type="number"
                    value={params.mean || ''}
                    onChange={(e) => handleParamChange('mean', parseFloat(e.target.value))}
                    placeholder="Enter mean"
                  />
                </FormControl>
                <FormControl>
                  <FormLabel>Standard Deviation (σ)</FormLabel>
                  <Input
                    type="number"
                    value={params.std || ''}
                    onChange={(e) => handleParamChange('std', parseFloat(e.target.value))}
                    placeholder="Enter standard deviation"
                    min="0.001"
                  />
                  <Text fontSize="xs" color="gray.600" mt={2}>
                    Bounds computed as μ ± 1.96σ (98% confidence interval)
                  </Text>
                </FormControl>
                <Box bg="blue.50" p={3} borderRadius="md">
                  <Text fontSize="sm">Range: {bounds.min.toFixed(2)} to {bounds.max.toFixed(2)}</Text>
                </Box>
              </>
            )}

            {distType === 'uniform' && (
              <>
                <FormControl>
                  <FormLabel>Low</FormLabel>
                  <Input
                    type="number"
                    value={params.low !== undefined ? params.low : ''}
                    onChange={(e) => handleParamChange('low', parseFloat(e.target.value))}
                    placeholder="Lower bound"
                  />
                </FormControl>
                <FormControl>
                  <FormLabel>High</FormLabel>
                  <Input
                    type="number"
                    value={params.high !== undefined ? params.high : ''}
                    onChange={(e) => handleParamChange('high', parseFloat(e.target.value))}
                    placeholder="Upper bound"
                  />
                </FormControl>
                <Box bg="blue.50" p={3} borderRadius="md">
                  <Text fontSize="sm">Range: {bounds.min.toFixed(2)} to {bounds.max.toFixed(2)}</Text>
                </Box>
              </>
            )}

            {distType === 'errorAbsolute' && (
              <>
                <FormControl>
                  <FormLabel>Value</FormLabel>
                  <Input
                    type="number"
                    value={params.value || ''}
                    onChange={(e) => handleParamChange('value', parseFloat(e.target.value))}
                    placeholder="Enter value"
                  />
                </FormControl>
                <FormControl>
                  <FormLabel>Error (±)</FormLabel>
                  <Input
                    type="number"
                    value={params.error || ''}
                    onChange={(e) => handleParamChange('error', parseFloat(e.target.value))}
                    placeholder="Enter error range"
                  />
                </FormControl>
                <Box bg="blue.50" p={3} borderRadius="md">
                  <Text fontSize="sm">Range: {bounds.min.toFixed(2)} to {bounds.max.toFixed(2)}</Text>
                </Box>
              </>
            )}

            {distType === 'errorPercent' && (
              <>
                <FormControl>
                  <FormLabel>Value</FormLabel>
                  <Input
                    type="number"
                    value={params.value || ''}
                    onChange={(e) => handleParamChange('value', parseFloat(e.target.value))}
                    placeholder="Enter value"
                  />
                </FormControl>
                <FormControl>
                  <FormLabel>Error (%)</FormLabel>
                  <Input
                    type="number"
                    value={params.percent || ''}
                    onChange={(e) => handleParamChange('percent', parseFloat(e.target.value))}
                    placeholder="Enter percentage"
                  />
                </FormControl>
                <Box bg="blue.50" p={3} borderRadius="md">
                  <Text fontSize="sm">Range: {bounds.min.toFixed(2)} to {bounds.max.toFixed(2)}</Text>
                </Box>
              </>
            )}

            {distType === 'discrete' && (
              <>
                <FormControl>
                  <FormLabel>Values (comma-separated)</FormLabel>
                  <Input
                    value={params.values ? params.values.join(', ') : ''}
                    onChange={handleDiscreteValuesChange}
                    placeholder="e.g., low, mid, high or 900, 1000, 1100"
                  />
                  <Text fontSize="xs" color="gray.600" mt={2}>
                    Each value has equal probability
                  </Text>
                </FormControl>
                {params.values && params.values.length > 0 && (
                  <Box bg="blue.50" p={3} borderRadius="md">
                    <Text fontSize="sm">
                      Min: {bounds.min.toFixed(2)}, Max: {bounds.max.toFixed(2)}, Count: {params.values.length}
                    </Text>
                  </Box>
                )}
              </>
            )}

            {distType === 'histogram' && (
              <>
                <Text fontSize="sm" fontWeight="semibold">Ranges and Probabilities</Text>
                <VStack spacing={3} align="stretch">
                  {params.ranges && params.ranges.map((range, idx) => (
                    <HStack key={idx} spacing={2} align="flex-end">
                      <FormControl>
                        <FormLabel fontSize="xs">Min</FormLabel>
                        <Input
                          type="number"
                          size="sm"
                          value={range.min}
                          onChange={(e) => handleHistogramRangeChange(idx, 'min', e.target.value)}
                        />
                      </FormControl>
                      <FormControl>
                        <FormLabel fontSize="xs">Max</FormLabel>
                        <Input
                          type="number"
                          size="sm"
                          value={range.max}
                          onChange={(e) => handleHistogramRangeChange(idx, 'max', e.target.value)}
                        />
                      </FormControl>
                      <FormControl>
                        <FormLabel fontSize="xs">Prob. (%)</FormLabel>
                        <Input
                          type="number"
                          size="sm"
                          value={range.probability}
                          onChange={(e) => handleHistogramRangeChange(idx, 'probability', e.target.value)}
                          max="100"
                        />
                      </FormControl>
                      <Button
                        size="sm"
                        colorScheme="red"
                        variant="outline"
                        onClick={() => removeHistogramRange(idx)}
                        isDisabled={params.ranges.length === 1}
                      >
                        ×
                      </Button>
                    </HStack>
                  ))}
                  <Button size="sm" variant="outline" onClick={addHistogramRange}>
                    + Add Range
                  </Button>
                </VStack>
                {params.ranges && params.ranges.length > 0 && (
                  <Box bg="blue.50" p={3} borderRadius="md">
                    <Text fontSize="sm">
                      Total Probability: {params.ranges.reduce((sum, r) => sum + r.probability, 0).toFixed(1)}%
                    </Text>
                    <Text fontSize="sm">
                      Range: {bounds.min.toFixed(2)} to {bounds.max.toFixed(2)}
                    </Text>
                  </Box>
                )}
              </>
            )}

            {distType === 'trapezoid' && (
              <>
                <Text fontSize="sm" fontWeight="semibold" mb={2}>
                  Trapezoid Shape: min → peak_start → peak_end → max
                </Text>
                <FormControl>
                  <FormLabel>Min (left)</FormLabel>
                  <Input
                    type="number"
                    value={params.min || ''}
                    onChange={(e) => handleParamChange('min', parseFloat(e.target.value))}
                    placeholder="Minimum x value"
                  />
                </FormControl>
                <FormControl>
                  <FormLabel>Peak Start</FormLabel>
                  <Input
                    type="number"
                    value={params.peak_start || ''}
                    onChange={(e) => handleParamChange('peak_start', parseFloat(e.target.value))}
                    placeholder="Start of plateau"
                  />
                </FormControl>
                <FormControl>
                  <FormLabel>Peak End (can equal Peak Start for triangle)</FormLabel>
                  <Input
                    type="number"
                    value={params.peak_end || ''}
                    onChange={(e) => handleParamChange('peak_end', parseFloat(e.target.value))}
                    placeholder="End of plateau"
                  />
                </FormControl>
                <FormControl>
                  <FormLabel>Max (right)</FormLabel>
                  <Input
                    type="number"
                    value={params.max || ''}
                    onChange={(e) => handleParamChange('max', parseFloat(e.target.value))}
                    placeholder="Maximum x value"
                  />
                </FormControl>
                <FormControl>
                  <FormLabel>Base Probability (0 to 1)</FormLabel>
                  <Input
                    type="number"
                    value={params.base_prob !== undefined ? params.base_prob : ''}
                    onChange={(e) => handleParamChange('base_prob', parseFloat(e.target.value))}
                    placeholder="Probability at min/max (usually 0)"
                    min="0"
                    max="1"
                    step="0.1"
                  />
                  <Text fontSize="xs" color="gray.600" mt={2}>
                    Peak height is auto-computed to normalize (area = 1)
                  </Text>
                </FormControl>
                {params.min !== undefined && params.max !== undefined && (
                  <Box bg="blue.50" p={3} borderRadius="md">
                    <Text fontSize="sm">
                      Shape: {params.peak_start === params.peak_end ? 'Triangle' : 'Trapezoid'}
                    </Text>
                    <Text fontSize="sm">
                      Range: {params.min.toFixed(2)} to {params.max.toFixed(2)}
                    </Text>
                  </Box>
                )}
              </>
            )}

            {distType === 'custom_1' && (
              <>
                <Text fontSize="sm" fontWeight="semibold" mb={2}>
                  Custom categorical distribution: samples outcome 0, 1, or 2
                </Text>
                <FormControl>
                  <FormLabel>a values (comma-separated)</FormLabel>
                  <Input
                    value={params.a_values ? params.a_values.join(', ') : ''}
                    onChange={(e) => {
                      const values = e.target.value
                        .split(',')
                        .map(v => parseFloat(v.trim()))
                        .filter(v => !isNaN(v))
                      handleParamChange('a_values', values)
                    }}
                    placeholder="e.g., 1 or 0.38"
                  />
                  <Text fontSize="xs" color="gray.600" mt={2}>
                    One value is randomly chosen each sample
                  </Text>
                </FormControl>
                <FormControl>
                  <FormLabel>x_low</FormLabel>
                  <Input
                    type="number"
                    value={params.x_low !== undefined ? params.x_low : ''}
                    onChange={(e) => handleParamChange('x_low', parseFloat(e.target.value))}
                    placeholder="Lower bound for x (0-1)"
                    min="0"
                    max="1"
                    step="0.1"
                  />
                </FormControl>
                <FormControl>
                  <FormLabel>x_high</FormLabel>
                  <Input
                    type="number"
                    value={params.x_high !== undefined ? params.x_high : ''}
                    onChange={(e) => handleParamChange('x_high', parseFloat(e.target.value))}
                    placeholder="Upper bound for x (0-1)"
                    min="0"
                    max="1"
                    step="0.1"
                  />
                </FormControl>
                <Box bg="blue.50" p={3} borderRadius="md">
                  <Text fontSize="sm">Outputs: 0, 1, or 2 (categorical)</Text>
                  <Text fontSize="xs" color="gray.600">
                    p(0) = a*(1-x), p(1) = a*x + (1-a)*(1-x), p(2) = (1-a)*x
                  </Text>
                </Box>
              </>
            )}

            <Divider />

            {/* Plot Preview */}
            <Box>
              <Text fontSize="sm" fontWeight="semibold" mb={2}>
                Distribution Preview
              </Text>
              <SimplePlotPreview plotData={plotData} bounds={bounds} />
            </Box>
          </VStack>
        </ModalBody>

        <ModalFooter>
          <HStack spacing={3}>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              colorScheme="blue"
              onClick={handleSave}
              isDisabled={!isValidDistribution(params)}
            >
              Save
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

/**
 * Simple SVG plot preview
 */
function SimplePlotPreview({ plotData, bounds }) {
  if (!plotData || plotData.length === 0) {
    return (
      <Box
        borderWidth={1}
        borderRadius="md"
        p={4}
        bg="gray.50"
        height="150px"
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        <Text fontSize="sm" color="gray.500">
          No data to plot
        </Text>
      </Box>
    )
  }

  const width = 400
  const height = 150
  const padding = 40
  const plotWidth = width - 2 * padding
  const plotHeight = height - 2 * padding

  // Compute plot bounds
  const minX = Math.min(...plotData.map(p => p.x))
  const maxX = Math.max(...plotData.map(p => p.x))
  const minY = 0
  const maxY = Math.max(...plotData.map(p => p.y))

  const rangeX = maxX - minX || 1
  const rangeY = maxY - minY || 1

  const scaleX = (x) => ((x - minX) / rangeX) * plotWidth + padding
  const scaleY = (y) => height - ((y - minY) / rangeY) * plotHeight - padding

  // Check if this is a lollipop plot (certain value)
  const isLollipop = plotData.length === 2 && 
                     plotData[0].type === 'line' && 
                     plotData[1].type === 'dot'

  // Check if this is a Gaussian plot (many smooth points)
  const isGaussian = plotData.length > 10

  let pathData = ''
  if (!isLollipop) {
    // Build SVG path for regular plots
    pathData = plotData
      .map((p, i) => {
        const x = scaleX(p.x)
        const y = scaleY(p.y)
        return `${i === 0 ? 'M' : 'L'} ${x} ${y}`
      })
      .join(' ')
  }

  return (
    <Box borderWidth={1} borderRadius="md" p={2} bg="white">
      <svg width={width} height={height} style={{ border: '1px solid #e2e8f0' }}>
        {/* Grid lines */}
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#e2e8f0" />
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#e2e8f0" />

        {/* Plot */}
        {isLollipop ? (
          <>
            {/* Lollipop: vertical line */}
            <line
              x1={scaleX(plotData[0].x)}
              y1={scaleY(plotData[0].y)}
              x2={scaleX(plotData[1].x)}
              y2={scaleY(plotData[1].y)}
              stroke="#3182ce"
              strokeWidth="3"
            />
            {/* Lollipop: dot at top */}
            <circle
              cx={scaleX(plotData[1].x)}
              cy={scaleY(plotData[1].y)}
              r="5"
              fill="#3182ce"
            />
          </>
        ) : (
          <path d={pathData} stroke="#3182ce" strokeWidth={isGaussian ? "1.5" : "2"} fill="none" />
        )}
        
        {/* Axis labels */}
        <text x={padding - 10} y={height - padding + 15} fontSize="10" fill="#718096">
          {minX.toFixed(1)}
        </text>
        <text x={width - padding - 20} y={height - padding + 15} fontSize="10" fill="#718096">
          {maxX.toFixed(1)}
        </text>
      </svg>
    </Box>
  )
}
