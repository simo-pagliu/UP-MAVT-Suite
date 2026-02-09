import {
  Box,
  Button,
  Heading,
  VStack,
  HStack,
  SimpleGrid,
  Text,
  useToast,
  Divider,
  Grid,
  GridItem,
  Card,
  CardBody,
  CardHeader,
  Progress,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  NumberIncrementStepper,
  NumberDecrementStepper,
} from '@chakra-ui/react'
import { ArrowBackIcon, ArrowForwardIcon, CheckCircleIcon } from '@chakra-ui/icons'
import axios from 'axios'
import { useEffect, useState, useRef } from 'react'

const API_URL = 'http://localhost:5000/api'

const clamp = (v, min, max) => {
  const num = Number.isFinite(v) ? v : min
  return Math.min(Math.max(num, min), max)
}

const sortByRank = (pts) => [...pts].sort((a, b) => Number(a.rank) - Number(b.rank))

// Tierlist component for Phase 1 (ranking alternatives)
function TierlistPhase({ alternatives, onComplete, isDisabled, initialRanking, onRankingChange }) {
  const [tiers, setTiers] = useState([])
  const [draggedItem, setDraggedItem] = useState(null)
  const [dragSource, setDragSource] = useState(null)

  useEffect(() => {
    // Initialize with previous ranking if available, otherwise each alternative in its own tier
    if (alternatives.length > 0 && tiers.length === 0) {
      if (initialRanking && Object.keys(initialRanking).length > 0) {
        // Restore from previous ranking
        const rankMap = {}
        Object.entries(initialRanking).forEach(([alt, rank]) => {
          if (!rankMap[rank]) rankMap[rank] = []
          rankMap[rank].push(alt)
        })
        const restoredTiers = Object.entries(rankMap)
          .sort(([rankA], [rankB]) => Number(rankA) - Number(rankB))
          .map(([rank, alts]) => alts.map((alt) => ({ name: alt, rank: Number(rank) })))
        setTiers(restoredTiers)
      } else {
        // Initialize new ranking with each alternative in its own tier
        const initialTiers = alternatives.map((alt, idx) => [{ name: alt, rank: idx }])
        setTiers(initialTiers)
      }
    }
  }, [alternatives, tiers.length, initialRanking])

  // Notify parent whenever tiers change
  useEffect(() => {
    if (tiers.length > 0 && onRankingChange) {
      const ranking = {}
      tiers.forEach((tier, tierIdx) => {
        tier.forEach((item) => {
          ranking[item.name] = tierIdx
        })
      })
      onRankingChange(ranking)
    }
  }, [tiers, onRankingChange])

  const handleDragStart = (tierIdx, itemIdx) => {
    setDraggedItem(alternatives[alternatives.findIndex(a => a === tiers[tierIdx][itemIdx].name)])
    setDragSource({ tierIdx, itemIdx })
  }

  const handleDragOver = (e) => {
    e.preventDefault()
  }

  const handleDrop = (tierIdx) => {
    if (!draggedItem || !dragSource) return

    setTiers((prev) => {
      const newTiers = prev.map(t => [...t])
      
      // Check if source tier will become empty
      const sourceTierWillBeEmpty = newTiers[dragSource.tierIdx].length === 1
      
      // Remove from source
      newTiers[dragSource.tierIdx].splice(dragSource.itemIdx, 1)
      
      // Remove empty tiers
      const filteredTiers = newTiers.filter(t => t.length > 0)
      
      // Adjust destination index if source tier was removed and was before destination
      let adjustedTierIdx = tierIdx
      if (sourceTierWillBeEmpty && dragSource.tierIdx < tierIdx) {
        adjustedTierIdx = tierIdx - 1
      }
      
      // Add to destination
      while (filteredTiers.length <= adjustedTierIdx) {
        filteredTiers.push([])
      }
      filteredTiers[adjustedTierIdx].push({ name: draggedItem, rank: adjustedTierIdx })
      return filteredTiers
    })

    setDraggedItem(null)
    setDragSource(null)
  }

  const handleDropNewTop = () => {
    if (!draggedItem || !dragSource) return

    setTiers((prev) => {
      const newTiers = prev.map(t => [...t])
      // Remove from source
      newTiers[dragSource.tierIdx].splice(dragSource.itemIdx, 1)
      // Remove empty tiers
      const filteredTiers = newTiers.filter(t => t.length > 0)
      // Insert new tier at the beginning
      filteredTiers.unshift([{ name: draggedItem, rank: 0 }])
      // Re-index all tiers
      return filteredTiers.map((tier, idx) => 
        tier.map(item => ({ ...item, rank: idx }))
      )
    })

    setDraggedItem(null)
    setDragSource(null)
  }

  const handleDropNewBottom = () => {
    if (!draggedItem || !dragSource) return

    setTiers((prev) => {
      const newTiers = prev.map(t => [...t])
      // Remove from source
      newTiers[dragSource.tierIdx].splice(dragSource.itemIdx, 1)
      // Remove empty tiers
      const filteredTiers = newTiers.filter(t => t.length > 0)
      // Add new tier at the end
      const newRank = filteredTiers.length
      filteredTiers.push([{ name: draggedItem, rank: newRank }])
      return filteredTiers
    })

    setDraggedItem(null)
    setDragSource(null)
  }

  const handleNextPhase = () => {
    const ranking = {}
    tiers.forEach((tier, tierIdx) => {
      tier.forEach((item) => {
        ranking[item.name] = tierIdx
      })
    })
    onComplete(ranking)
  }

  return (
    <VStack spacing={6} align="stretch">
      <Box>
        <Heading size="md" mb={3}>Step 1: Rank the Alternatives</Heading>
        <Text fontSize="sm" color="gray.600">Drag alternatives to organize them by preference. Alternatives in the same tier have equal rank. Drop above the first tier or below the last tier to create new ranks.</Text>
      </Box>

      <VStack spacing={2} align="stretch">
        {/* Drop zone for new tier at top */}
        <Box 
          minH="40px" 
          border="2px dashed" 
          borderColor="blue.200" 
          borderRadius="md" 
          p={2} 
          onDragOver={handleDragOver} 
          onDrop={handleDropNewTop}
          bg="blue.50"
          display="flex"
          alignItems="center"
          justifyContent="center"
        >
          <Text fontSize="xs" color="blue.600" fontWeight="medium">Drop here to create best rank</Text>
        </Box>

        {tiers.map((tier, tierIdx) => (
          <Box key={tierIdx} minH="60px" border="2px dashed" borderColor="gray.300" borderRadius="md" p={3} onDragOver={handleDragOver} onDrop={() => handleDrop(tierIdx)}>
            <HStack spacing={2} wrap="wrap">
              {tier.length === 0 ? (
                <Text fontSize="sm" color="gray.400">Drop here for rank {tierIdx}</Text>
              ) : (
                tier.map((item, itemIdx) => (
                  <Box
                    key={`${tierIdx}-${itemIdx}`}
                    bg="blue.50"
                    border="1px solid"
                    borderColor="blue.200"
                    px={3}
                    py={2}
                    borderRadius="md"
                    draggable
                    onDragStart={() => handleDragStart(tierIdx, itemIdx)}
                    cursor="move"
                  >
                    <Text fontSize="sm" fontWeight="medium">{item.name}</Text>
                  </Box>
                ))
              )}
            </HStack>
          </Box>
        ))}

        {/* Drop zone for new tier at bottom */}
        <Box 
          minH="40px" 
          border="2px dashed" 
          borderColor="blue.200" 
          borderRadius="md" 
          p={2} 
          onDragOver={handleDragOver} 
          onDrop={handleDropNewBottom}
          bg="blue.50"
          display="flex"
          alignItems="center"
          justifyContent="center"
        >
          <Text fontSize="xs" color="blue.600" fontWeight="medium">Drop here to create worst rank</Text>
        </Box>
      </VStack>
    </VStack>
  )
}

// Plot component for Phase 2 (value function visualization)
function QualitativeValuePlot({ ranking, isIncreasing, adjustedValues }) {
  const svgRef = useRef(null)
  const width = 480
  const height = 480

  // Build points for the plot
  const uniqueRanks = Array.from(new Set(Object.values(ranking)))
    .map(Number)
    .sort((a, b) => a - b)

  // Build reverse mapping: rank -> alternative names
  const rankToAlternatives = {}
  Object.entries(ranking).forEach(([alt, rank]) => {
    if (!rankToAlternatives[rank]) rankToAlternatives[rank] = []
    rankToAlternatives[rank].push(alt)
  })

  // Prepare points - equally spaced on x-axis
  const points = []
  const totalPoints = uniqueRanks.length + 2 // hypothetical worst + ranks + hypothetical best
  
  // Add hypothetical points - they flip based on direction
  // X-axis: worst alternatives on LEFT, best alternatives on RIGHT
  if (isIncreasing) {
    // Increasing: better alternatives have HIGHER utility
    // Hypothetical worst (left, x=0) should have lowest utility
    points.push({ x: 0, y: 0, isHypothetical: true })
  } else {
    // Decreasing: better alternatives have LOWER utility
    // Hypothetical worst (left, x=0) should have highest utility
    points.push({ x: 0, y: 1, isHypothetical: true })
  }
  
  // Add ranked alternatives (equally spaced on x-axis)
  // Plot goes from left to right: worst (rank N-1) → best (rank 0)
  [...uniqueRanks].reverse().forEach((rank, idx) => {
    const xPos = idx + 1
    const linearY = xPos / (totalPoints - 1)
    // Use adjusted value if available, otherwise fallback to linear interpolation
    const y = adjustedValues[rank] !== undefined ? adjustedValues[rank] : linearY
    const altNames = rankToAlternatives[rank] || []
    const rankIdx = uniqueRanks.indexOf(rank)
    points.push({ x: xPos, y, rank, rankIdx, altNames, isHypothetical: false })
  })
  
  // Add the other hypothetical point
  if (isIncreasing) {
    // Increasing: hypothetical best (right, x=N+1) should have highest utility
    points.push({ x: uniqueRanks.length + 1, y: 1, isHypothetical: true })
  } else {
    // Decreasing: hypothetical best (right, x=N+1) should have lowest utility
    points.push({ x: uniqueRanks.length + 1, y: 0, isHypothetical: true })
  }

  // Equal spacing on x-axis
  const toSvgX = (xIdx) => (xIdx / (totalPoints - 1)) * (width - 70) + 50
  const toSvgY = (y) => height - 40 - y * (height - 80)

  const linePath = points
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${toSvgX(p.x)} ${toSvgY(p.y)}`)
    .join(' ')

  return (
    <Box border="1px solid" borderColor="gray.200" borderRadius="lg" p={4} bg="gray.50">
      <svg ref={svgRef} width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <rect x={0} y={0} width={width} height={height} fill="transparent" />
        {/* Axes */}
        <line x1={50} y1={height - 40} x2={width - 20} y2={height - 40} stroke="#A0AEC0" strokeWidth="2" />
        <line x1={50} y1={40} x2={50} y2={height - 40} stroke="#A0AEC0" strokeWidth="2" />
        {/* Y-axis value labels */}
        <text x={42} y={height - 35} textAnchor="end" fontSize="13" fill="#2D3748" fontWeight="bold">0</text>
        <text x={42} y={50} textAnchor="end" fontSize="13" fill="#2D3748" fontWeight="bold">1</text>
        {/* Y-axis label (vertical) */}
        <text
          x={-height / 2}
          y={12}
          textAnchor="middle"
          fontSize="15"
          fill="#1A202C"
          fontWeight="bold"
          transform={`rotate(-90)`}
        >
          Value
        </text>
        {/* Line */}
        <path d={linePath} stroke="#2B6CB0" strokeWidth="2.5" fill="none" />
        {/* Points and labels */}
        {points.map((p, idx) => (
          <g key={idx}>
            <circle
              cx={toSvgX(p.x)}
              cy={toSvgY(p.y)}
              r={p.isHypothetical ? 5 : 4}
              fill={p.isHypothetical ? '#ED8936' : '#3182CE'}
              stroke="#fff"
              strokeWidth="1.5"
            />
            {!p.isHypothetical && p.altNames && p.altNames.length > 0 && (
              <text
                x={toSvgX(p.x)}
                y={toSvgY(p.y) - 15}
                textAnchor="middle"
                fontSize="14"
                fill="#1A202C"
                fontWeight="bold"
              >
                {p.altNames.join(', ')}
              </text>
            )}
          </g>
        ))}
        {/* X-axis label */}
        <text x={width / 2} y={height - 8} textAnchor="middle" fontSize="15" fill="#1A202C" fontWeight="bold">
          Alternative Ranks (Worst → Best)
        </text>
      </svg>
    </Box>
  )
}

// Phase 2: Slider adjustment
function SliderPhase({ ranking, alternatives, onComplete, onBack, isDisabled, initialValues, initialIsIncreasing, onValuesChange }) {
  const [isIncreasing, setIsIncreasing] = useState(initialIsIncreasing !== null ? initialIsIncreasing : true)
  const [adjustedValues, setAdjustedValues] = useState({})
  const [hasInitialized, setHasInitialized] = useState(false)

  const uniqueRanks = Array.from(new Set(Object.values(ranking))).map(Number).sort((a, b) => a - b)
  const alternativesByRank = {}
  uniqueRanks.forEach((rank) => {
    alternativesByRank[rank] = alternatives.filter((alt) => ranking[alt] === rank)
  })

  // Initialize values with linear interpolation only once
  useEffect(() => {
    if (hasInitialized) return
    
    // Use saved values if available, otherwise initialize with linear interpolation
    if (initialValues && Object.keys(initialValues).length > 0) {
      setAdjustedValues(initialValues)
      setHasInitialized(true)
      return
    }
    
    const newInitialValues = {}
    const totalPoints = uniqueRanks.length + 2 // hypothetical worst + ranks + hypothetical best
    
    // uniqueRanks is [0, 1, 2, ...] where 0=best (top tier), N-1=worst (bottom tier)
    // X-axis: worst on left, best on right
    // rank N-1 (worst) should be at x=1 with low y, rank 0 (best) at x=N with high y
    uniqueRanks.forEach((rank, idx) => {
      const xPos = uniqueRanks.length - idx // rank 0→xPos=N, rank N-1→xPos=1
      const linearY = xPos / (totalPoints - 1)
      newInitialValues[rank] = linearY
    })
    setAdjustedValues(newInitialValues)
    setHasInitialized(true)
  }, [uniqueRanks, hasInitialized, initialValues])

  useEffect(() => {
    if (onValuesChange && hasInitialized) {
      onValuesChange({
        values: adjustedValues,
        isIncreasing: isIncreasing,
      })
    }
  }, [adjustedValues, isIncreasing, hasInitialized, onValuesChange])

  const handleSliderChange = (rank, value) => {
    const numValue = clamp(parseFloat(value) || 0, 0, 1)
    const rankIndex = uniqueRanks.indexOf(rank)

    let minVal, maxVal

    if (isIncreasing) {
      // Increasing: Better ranks (lower rank numbers) should have HIGHER utility values
      // value[rank_i] >= value[rank_j] where rank_i < rank_j
      
      // Lower bound: must be >= any worse ranked alternative's value
      // Worse ranks have higher rank numbers (later in uniqueRanks array)
      minVal = 0
      for (let i = rankIndex + 1; i < uniqueRanks.length; i++) {
        if (adjustedValues[uniqueRanks[i]] !== undefined) {
          minVal = Math.max(minVal, adjustedValues[uniqueRanks[i]])
        }
      }
      
      // Upper bound: must be <= any better ranked alternative's value
      // Better ranks have lower rank numbers (earlier in uniqueRanks array)
      maxVal = 1
      for (let i = 0; i < rankIndex; i++) {
        if (adjustedValues[uniqueRanks[i]] !== undefined) {
          maxVal = Math.min(maxVal, adjustedValues[uniqueRanks[i]])
        }
      }
    } else {
      // Decreasing: Better ranks (lower rank numbers) should have LOWER utility values
      // value[rank_i] <= value[rank_j] where rank_i < rank_j
      
      // Upper bound: must be <= any worse ranked alternative's value
      // Worse ranks have higher rank numbers (later in uniqueRanks array)
      maxVal = 1
      for (let i = rankIndex + 1; i < uniqueRanks.length; i++) {
        if (adjustedValues[uniqueRanks[i]] !== undefined) {
          maxVal = Math.min(maxVal, adjustedValues[uniqueRanks[i]])
        }
      }
      
      // Lower bound: must be >= any better ranked alternative's value
      // Better ranks have lower rank numbers (earlier in uniqueRanks array)
      minVal = 0
      for (let i = 0; i < rankIndex; i++) {
        if (adjustedValues[uniqueRanks[i]] !== undefined) {
          minVal = Math.max(minVal, adjustedValues[uniqueRanks[i]])
        }
      }
    }

    const constrainedValue = clamp(numValue, minVal, maxVal)
    setAdjustedValues((prev) => ({ ...prev, [rank]: constrainedValue }))
  }

  const handleToggleDirection = () => {
    // Reset to linear interpolation when toggling direction
    const totalPoints = uniqueRanks.length + 2 // hypothetical worst + ranks + hypothetical best
    const linearValues = {}
    
    uniqueRanks.forEach((rank, idx) => {
      const xPos = uniqueRanks.length - idx // rank 0→xPos=N, rank N-1→xPos=1
      let linearY = xPos / (totalPoints - 1)
      
      // If currently increasing and switching to decreasing, invert the linear values
      if (isIncreasing) {
        linearY = 1 - linearY
      }
      linearValues[rank] = linearY
    })
    
    setAdjustedValues(linearValues)
    setIsIncreasing(!isIncreasing)
  }

  const handleComplete = () => {
    onComplete({
      ranking,
      values: adjustedValues,
      isIncreasing,
    })
  }

  return (
    <VStack spacing={6} align="stretch">
      <Box>
        <Heading size="md">Step 2: Adjust Value Function</Heading>
        <Text fontSize="sm" color="gray.600">Use sliders to adjust utility values for each rank. Use the toggle to switch between increasing and decreasing functions.</Text>
      </Box>

      <HStack spacing={4} wrap="wrap">
        <Button size="sm" variant={isIncreasing ? 'solid' : 'outline'} onClick={handleToggleDirection}>
          {isIncreasing ? '↗ Increasing' : '↘ Decreasing'}
        </Button>
      </HStack>

      <HStack spacing={6} align="flex-start">
        <Box minW="400px" maxH="700px">
          <QualitativeValuePlot ranking={ranking} isIncreasing={isIncreasing} adjustedValues={adjustedValues} />
        </Box>

        <VStack spacing={6} align="stretch" flex="1" minW="400px" maxH="700px" overflowY="auto">
          {uniqueRanks.map((rank, idx) => {
            const alts = alternativesByRank[rank]
            return (
              <Box key={rank} pb={2} borderBottomWidth="1px" borderBottomColor="gray.200">
                <HStack spacing={4} mb={3} justify="space-between">
                  <Text fontSize="sm" fontWeight="semibold">{alts.join(', ')}</Text>
                  <NumberInput
                    value={(adjustedValues[rank] !== undefined ? adjustedValues[rank] : 0.5).toFixed(2)}
                    min={0}
                    max={1}
                    step={0.01}
                    precision={2}
                    onChange={(valueString) => {
                      const val = parseFloat(valueString)
                      if (!isNaN(val)) {
                        handleSliderChange(rank, val)
                      }
                    }}
                    size="md"
                    maxW="90px"
                  >
                    <NumberInputField textAlign="right" />
                    <NumberInputStepper>
                      <NumberIncrementStepper />
                      <NumberDecrementStepper />
                    </NumberInputStepper>
                  </NumberInput>
                </HStack>
                <HStack spacing={3}>
                  <Text fontSize="xs" color="gray.600" minW="35px">0</Text>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={adjustedValues[rank] !== undefined ? adjustedValues[rank] : 0.5}
                    onChange={(e) => handleSliderChange(rank, e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <Text fontSize="xs" color="gray.600" minW="35px">1</Text>
                </HStack>
              </Box>
            )
          })}
        </VStack>
      </HStack>
    </VStack>
  )
}

function QualitativeIndicatorsPage({ sessionId }) {
  const [criteria, setCriteria] = useState([])
  const [qualitativeData, setQualitativeData] = useState({})
  const [activeIndicatorIdx, setActiveIndicatorIdx] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [isSessionLocked, setIsSessionLocked] = useState(false)
  const [phase, setPhase] = useState('ranking') // 'ranking' or 'adjustment'
  const [currentRanking, setCurrentRanking] = useState(null)
  const [savedValues, setSavedValues] = useState(null)
  const [savedIsIncreasing, setSavedIsIncreasing] = useState(null)
  const [currentAdjustedValues, setCurrentAdjustedValues] = useState({})
  const [currentIsIncreasing, setCurrentIsIncreasing] = useState(true)
  const toast = useToast()

  const qualitativeCriteria = criteria.filter((c) => c.is_qualitative)
  const activeIndicator = activeIndicatorIdx !== null ? qualitativeCriteria[activeIndicatorIdx] : null

  useEffect(() => {
    const fetchSession = async () => {
      try {
        setLoading(true)
        const response = await axios.get(`${API_URL}/session/${sessionId}`)
        const session = response.data
        setIsSessionLocked(session?.session_locked || false)
        setCriteria(session?.criteria || [])
        setQualitativeData(session?.qualitative_indicators || {})
      } catch (error) {
        console.error('Failed to fetch session:', error)
        toast({
          title: 'Error',
          description: 'Failed to load session',
          status: 'error',
          duration: 3,
          isClosable: true,
        })
      } finally {
        setLoading(false)
      }
    }
    fetchSession()
  }, [sessionId, toast])

  // Helper function to detect if ranking order has changed
  const hasRankingOrderChanged = (oldRanking, newRanking) => {
    if (!oldRanking || !newRanking) return false
    
    // Get ordered lists of alternatives by rank
    const oldOrder = Object.entries(oldRanking)
      .sort((a, b) => a[1] - b[1])
      .map(([alt]) => alt)
    
    const newOrder = Object.entries(newRanking)
      .sort((a, b) => a[1] - b[1])
      .map(([alt]) => alt)
    
    return JSON.stringify(oldOrder) !== JSON.stringify(newOrder)
  }

  // Helper function to load indicator data from DB
  // Accepts dataStore parameter to handle cases where we need to use updated data before state renders
  const loadIndicatorData = (idx, criterionName, dataStore = null) => {
    const store = dataStore !== null ? dataStore : qualitativeData
    const savedData = store[criterionName]
    
    if (savedData && savedData.ranking) {
      // Data exists in DB - load it and go to adjustment phase
      setCurrentRanking(savedData.ranking)
      setSavedValues(savedData.values || null)
      setSavedIsIncreasing(savedData.isIncreasing !== undefined ? savedData.isIncreasing : null)
      setPhase('adjustment')
    } else {
      // No data in DB - start fresh from ranking phase
      setCurrentRanking(null)
      setSavedValues(null)
      setSavedIsIncreasing(null)
      setPhase('ranking')
    }
  }

  const handlePhase1Complete = (ranking) => {
    // Check if ranking order has changed compared to saved data
    const savedData = qualitativeData[activeIndicator.criterion_name]
    if (savedData && hasRankingOrderChanged(savedData.ranking, ranking)) {
      // Ranking order changed, clear saved values so user re-elicits them
      setSavedValues(null)
      setSavedIsIncreasing(null)
    }
    setCurrentRanking(ranking)
    setPhase('adjustment')
  }

  const handlePhase2Back = async () => {
    if (isSessionLocked) {
      setSavedValues(currentAdjustedValues)
      setSavedIsIncreasing(currentIsIncreasing)
      setPhase('ranking')
      return
    }

    // Save current progress before going back
    setSaving(true)
    try {
      const data = {
        ranking: currentRanking,
        values: currentAdjustedValues,
        isIncreasing: currentIsIncreasing,
      }
      
      const updatedData = {
        ...qualitativeData,
        [activeIndicator.criterion_name]: data,
      }
      
      await axios.put(`${API_URL}/session/${sessionId}/qualitative`, {
        value: updatedData,
      })

      setQualitativeData(updatedData)
      setSavedValues(currentAdjustedValues)
      setSavedIsIncreasing(currentIsIncreasing)
      setPhase('ranking')
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to save',
        status: 'error',
        duration: 3,
        isClosable: true,
      })
    } finally {
      setSaving(false)
    }
    // Keep currentRanking to preserve the ranking when returning to Phase 1
  }

  const handlePhase2CompleteFromTop = (data) => {
    handlePhase2Complete(data)
  }

  const handlePhase2Complete = async (data) => {
    if (isSessionLocked) {
      toast({
        title: 'Session locked',
        description: 'This session is locked. You cannot save changes.',
        status: 'warning',
        duration: 3,
        isClosable: true,
      })
      return
    }

    setSaving(true)
    try {
      const updatedData = {
        ...qualitativeData,
        [activeIndicator.criterion_name]: data,
      }
      await axios.put(`${API_URL}/session/${sessionId}/qualitative`, {
        value: updatedData,
      })

      setQualitativeData(updatedData)
      toast({
        title: 'Success',
        description: `Saved ${activeIndicator.criterion_name}`,
        status: 'success',
        duration: 2,
        isClosable: true,
      })

      // Move to next indicator or finish
      if (activeIndicatorIdx !== null && activeIndicatorIdx < qualitativeCriteria.length - 1) {
        const newIdx = activeIndicatorIdx + 1
        setActiveIndicatorIdx(newIdx)
        loadIndicatorData(newIdx, qualitativeCriteria[newIdx].criterion_name, updatedData)
      } else {
        toast({
          title: 'Complete',
          description: 'All qualitative indicators have been elicited',
          status: 'success',
          duration: 2,
          isClosable: true,
        })
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to save',
        status: 'error',
        duration: 3,
        isClosable: true,
      })
    } finally {
      setSaving(false)
    }
  }

  // Handle sidebar navigation - save current indicator before switching
  const handleSidebarNavigate = async (idx) => {
    // If currently in adjustment phase with data, save before navigating
    if (phase === 'adjustment' && currentRanking && activeIndicator) {
      if (isSessionLocked) {
        toast({
          title: 'Session locked',
          description: 'This session is locked. You cannot save changes.',
          status: 'warning',
          duration: 3,
          isClosable: true,
        })
        return
      }

      setSaving(true)
      try {
        const data = {
          ranking: currentRanking,
          values: currentAdjustedValues,
          isIncreasing: currentIsIncreasing,
        }
        
        const updatedData = {
          ...qualitativeData,
          [activeIndicator.criterion_name]: data,
        }
        
        await axios.put(`${API_URL}/session/${sessionId}/qualitative`, {
          value: updatedData,
        })

        setQualitativeData(updatedData)
        
        // Now load the clicked indicator with updated data
        setActiveIndicatorIdx(idx)
        loadIndicatorData(idx, qualitativeCriteria[idx].criterion_name, updatedData)
      } catch (error) {
        toast({
          title: 'Error',
          description: error.response?.data?.error || 'Failed to save',
          status: 'error',
          duration: 3,
          isClosable: true,
        })
      } finally {
        setSaving(false)
      }
    } else {
      // Not in adjustment phase or no data to save, just navigate
      setActiveIndicatorIdx(idx)
      loadIndicatorData(idx, qualitativeCriteria[idx].criterion_name)
    }
  }

  if (loading) {
    return (
      <Box bg="white" p={8} borderRadius="lg" boxShadow="sm">
        <VStack spacing={4}>
          <Heading size="md">Loading Qualitative Indicators...</Heading>
        </VStack>
      </Box>
    )
  }

  if (qualitativeCriteria.length === 0) {
    return (
      <Box bg="white" p={8} borderRadius="lg" boxShadow="sm">
        <VStack spacing={4} align="stretch">
          <Heading size="lg">Qualitative Indicators</Heading>
          <Text color="gray.600">No qualitative indicators have been marked in the input.</Text>
        </VStack>
      </Box>
    )
  }

  return (
    <HStack align="stretch" spacing={0} h="100vh" overflow="hidden">
      {/* Left Sidebar */}
      <Box
        w="320px"
        bg="gray.100"
        p={4}
        borderRight="1px"
        borderColor="gray.300"
        maxH="100vh"
        overflowY="auto"
      >
        <VStack spacing={4} align="stretch" mb={6}>
          <Heading size="md">Qualitative Indicators</Heading>
          <Text fontSize="sm" color="gray.600">
            Rank alternatives from best to worst, then adjust value functions to quantify distance between ranks.
          </Text>
        </VStack>
        <VStack spacing={3} align="stretch">
          {qualitativeCriteria.map((criterion, idx) => {
            const isComplete = qualitativeData[criterion.criterion_name] !== undefined
            const isActive = activeIndicatorIdx === idx
            return (
              <Box
                key={idx}
                p={3}
                borderRadius="md"
                cursor="pointer"
                bg={isActive ? 'blue.500' : isComplete ? 'green.100' : 'white'}
                borderWidth="1px"
                borderColor={isActive ? 'blue.600' : isComplete ? 'green.300' : 'gray.300'}
                _hover={{ shadow: 'sm' }}
                onClick={() => handleSidebarNavigate(idx)}
                >
                  <HStack justify="space-between">
                    <Text
                      fontWeight="bold"
                      color={isActive ? 'white' : 'black'}
                      fontSize="sm"
                      isTruncated
                      flex={1}
                    >
                      {idx + 1}. {criterion.criterion_name}
                    </Text>
                    {isComplete && (
                      <CheckCircleIcon w={4} h={4} color={isActive ? 'white' : 'green.500'} />
                    )}
                  </HStack>
                </Box>
              )
            })}
          </VStack>
      </Box>

      {/* Right Main Area */}
      <Box
        flex={1}
        bg="white"
        p={4}
        maxH="100vh"
        overflowY="auto"
      >
          {isSessionLocked && (
            <Box bg="yellow.50" p={3} borderRadius="md" borderLeft="4px" borderLeftColor="yellow.400" mb={4}>
              <Text fontSize="sm" color="yellow.800" fontWeight="semibold">
                🔒 Session is locked. Changes are disabled.
              </Text>
            </Box>
          )}

          {qualitativeCriteria.length === 0 ? (
            <VStack spacing={4} align="center" justify="center" minH="60vh">
              <Heading size="lg">No Qualitative Indicators</Heading>
              <Text color="gray.600" fontSize="lg">
                Please add qualitative criteria from the Input page
              </Text>
            </VStack>
          ) : !activeIndicator ? (
            <VStack spacing={4} align="center" justify="center" minH="60vh">
              <Heading size="lg">Select an Indicator</Heading>
              <Text color="gray.600" fontSize="lg">
                Click on an indicator in the sidebar to start elicitation
              </Text>
            </VStack>
          ) : (
            <>
              <Progress value={(activeIndicatorIdx + (phase === 'adjustment' ? 0.5 : 0)) / qualitativeCriteria.length * 100} mb={6} h={2} borderRadius="md" />

              <VStack spacing={6} align="stretch">
                <Box>
                  <HStack justify="space-between">
                    <Box>
                      <Heading size="lg">{activeIndicator.criterion_name}</Heading>
                      <Text fontSize="sm" color="gray.600" mt={1}>{activeIndicator.description}</Text>
                    </Box>
                    <HStack spacing={2}>
                      {phase === 'ranking' ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            leftIcon={<ArrowBackIcon />}
                            onClick={() => {
                              if (activeIndicatorIdx > 0) {
                                const newIdx = activeIndicatorIdx - 1
                                setActiveIndicatorIdx(newIdx)
                                loadIndicatorData(newIdx, qualitativeCriteria[newIdx].criterion_name)
                              }
                            }}
                            isDisabled={activeIndicatorIdx === 0}
                          >
                            Previous
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            rightIcon={<ArrowForwardIcon />}
                            onClick={() => {
                              if (!currentRanking) return
                              // Ranking complete: go to adjustment for the current indicator
                              const savedData = qualitativeData[activeIndicator.criterion_name]
                              if (savedData && hasRankingOrderChanged(savedData.ranking, currentRanking)) {
                                setSavedValues(null)
                                setSavedIsIncreasing(null)
                              }
                              setPhase('adjustment')
                            }}
                            isDisabled={!currentRanking}
                          >
                            Next
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            leftIcon={<ArrowBackIcon />}
                            onClick={handlePhase2Back}
                          >
                            Back
                          </Button>
                          <Button
                            size="sm"
                            colorScheme="blue"
                            rightIcon={<CheckCircleIcon />}
                            onClick={() => {
                              handlePhase2Complete({
                                ranking: currentRanking,
                                values: currentAdjustedValues,
                                isIncreasing: currentIsIncreasing,
                              })
                            }}
                            isLoading={saving}
                          >
                            Confirm
                          </Button>
                        </>
                      )}
                    </HStack>
                  </HStack>
                </Box>

                {phase === 'ranking' ? (
                  <TierlistPhase
                    key={`tierlist_${activeIndicator.criterion_name}`}
                    alternatives={activeIndicator.alternatives.map((alt) => alt.name)}
                    onComplete={handlePhase1Complete}
                    isDisabled={isSessionLocked}
                    initialRanking={currentRanking}
                    onRankingChange={(ranking) => {
                      // Update current ranking as user drags alternatives
                      setCurrentRanking(ranking)
                    }}
                  />
                ) : (
                  <SliderPhase
                    key={`slider_${activeIndicator.criterion_name}`}
                    ranking={currentRanking}
                    alternatives={activeIndicator.alternatives.map((alt) => alt.name)}
                    onComplete={handlePhase2Complete}
                    onBack={handlePhase2Back}
                    isDisabled={isSessionLocked || saving}
                    initialValues={savedValues}
                    initialIsIncreasing={savedIsIncreasing}
                    onValuesChange={(data) => {
                      setCurrentAdjustedValues(data.values)
                      setCurrentIsIncreasing(data.isIncreasing)
                    }}
                  />
                )}
              </VStack>
            </>
          )}
      </Box>
    </HStack>
  )
}

export default QualitativeIndicatorsPage