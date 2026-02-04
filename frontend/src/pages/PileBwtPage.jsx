import {
  Box,
  Button,
  HStack,
  VStack,
  Heading,
  Text,
  Divider,
  Spinner,
  useToast,
  Badge,
  Grid,
  Slider,
  SliderTrack,
  SliderFilledTrack,
  SliderThumb,
  FormLabel,
  NumberInput,
  NumberInputField,
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
  AlertDialog,
  AlertDialogBody,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogContent,
  AlertDialogOverlay,
  useDisclosure,
} from '@chakra-ui/react'
import { ChevronLeftIcon, ChevronRightIcon } from '@chakra-ui/icons'
import axios from 'axios'
import { useEffect, useMemo, useState, useRef } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  ReferenceDot,
} from 'recharts'

const API_URL = 'http://localhost:5000/api'

function PileBwtPage({ sessionId, onPageChange }) {
  const [criteria, setCriteria] = useState([])
  const [valueFunction, setValueFunction] = useState({})
  const [loading, setLoading] = useState(true)
  const [groups, setGroups] = useState([])
  const [selectedGroupIndex, setSelectedGroupIndex] = useState(null)
  const [step, setStep] = useState('idle')
  const [bestCriterion, setBestCriterion] = useState(null)
  const [worstCriterion, setWorstCriterion] = useState(null)
  const [pairs, setPairs] = useState([])
  const [currentPairIndex, setCurrentPairIndex] = useState(0)
  const [comparisons, setComparisons] = useState([])
  const [sliderValue, setSliderValue] = useState(0)
  const [sliderInputValue, setSliderInputValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [bwtSignature, setBwtSignature] = useState(null)
  const [criteriaMismatch, setCriteriaMismatch] = useState(false)
  const [criteriaMismatchAcknowledged, setCriteriaMismatchAcknowledged] = useState(false)
  const [isSessionLocked, setIsSessionLocked] = useState(false)
  const { isOpen, onOpen, onClose } = useDisclosure()
  const cancelRef = useRef()
  const mainContentRef = useRef(null)
  const toast = useToast()

  const getCriteriaSignature = (criteriaList) => {
    const normalized = (criteriaList || []).map((crit) => ({
      name: crit.criterion_name || '',
      unit: crit.unit || '',
      group: crit.group || '',
      alternatives: (crit.alternatives || []).map((alt) => ({
        name: alt.name || alt.alternative_name || '',
        value: alt.value,
      })),
    }))
    return JSON.stringify(normalized)
  }

  const criteriaSignature = useMemo(() => getCriteriaSignature(criteria), [criteria])

  useEffect(() => {
    const fetchSession = async () => {
      try {
        const response = await axios.get(`${API_URL}/session/${sessionId}`)
        const session = response.data
        setCriteria(Array.isArray(session.criteria) ? session.criteria : [])
        setIsSessionLocked(session?.session_locked || false)

        if (session.value_functions?.criteria) {
          setValueFunction(session.value_functions.criteria)
        }

        const groupedCriteria = {}
        session.criteria.forEach((crit) => {
          const groupName = crit.group || 'Ungrouped'
          if (!groupedCriteria[groupName]) {
            groupedCriteria[groupName] = []
          }
          groupedCriteria[groupName].push(crit)
        })

        const groupList = Object.entries(groupedCriteria).map(([name, crits]) => ({
          name,
          criteria: crits,
        }))
        setGroups(groupList)

        if (session.bwt?.comparisons && session.bwt.comparisons.length > 0) {
          setComparisons(session.bwt.comparisons)
        }

        if (session.bwt?.criteria_signature) {
          setBwtSignature(session.bwt.criteria_signature)
        }
      } catch (error) {
        toast({
          title: 'Error',
          description: 'Failed to load session data',
          status: 'error',
          isClosable: true,
        })
      } finally {
        setLoading(false)
      }
    }

    if (sessionId) {
      fetchSession()
    }
  }, [sessionId, toast])

  useEffect(() => {
    if (loading) return
    
    console.log('BWT Mismatch Check:', {
      comparisonsLength: comparisons.length,
      bwtSignature,
      criteriaSignature,
      match: bwtSignature === criteriaSignature
    })
    
    // If there are comparisons but no saved signature (old data), it's a mismatch
    if (comparisons.length > 0 && !bwtSignature) {
      console.log('Setting mismatch: comparisons exist but no signature')
      setCriteriaMismatch(true)
      return
    }
    
    // If there's a saved signature and current signature, compare them
    if (bwtSignature && criteriaSignature) {
      if (bwtSignature !== criteriaSignature) {
        console.log('Setting mismatch: signatures dont match')
        setCriteriaMismatch(true)
      } else {
        console.log('Clearing mismatch: signatures match')
        setCriteriaMismatch(false)
        setCriteriaMismatchAcknowledged(false)
      }
    }
  }, [loading, bwtSignature, criteriaSignature, comparisons.length])

  useEffect(() => {
    if (!loading && groups.length > 0 && selectedGroupIndex !== null) {
      const groupName = groups[selectedGroupIndex]?.name
      const groupComps = comparisons.filter((c) => c.group === groupName && c.type !== 'intra-best' && c.type !== 'intra-worst')
      
      if (groupComps.length === 0) {
        setStep('select-criteria')
      } else {
        // Generate pairs for this group and load
        const groupCriteria = groups[selectedGroupIndex].criteria
        const { best, worst } = getGroupBestWorst(selectedGroupIndex)
        if (best && worst) {
          const others = groupCriteria.filter(
            (c) => c.criterion_name !== best.criterion_name && c.criterion_name !== worst.criterion_name
          )
          const newPairs = [
            { reference: worst, adjusted: best, type: 'best' },
            ...others.map((other) => ({
              reference: other,
              adjusted: best,
              type: 'standard',
            })),
            ...others.map((other) => ({
              reference: worst,
              adjusted: other,
              type: 'standard',
            })),
          ]
          setPairs(newPairs)
          setBestCriterion(best)
          setWorstCriterion(worst)
          setStep('evaluate-pairs')
          setCurrentPairIndex(0)
          const firstPair = newPairs[0]
          const existing = comparisons.find(
            (c) =>
              c.reference_criterion === firstPair.reference.criterion_name &&
              c.adjusted_criterion === firstPair.adjusted.criterion_name &&
              c.group === groupName
          )
          setSliderValue(existing ? existing.data_value : getDataRange(firstPair.adjusted).min)
        }
      }
    }
  }, [loading, groups, selectedGroupIndex])

  useEffect(() => {
    if (Number.isFinite(sliderValue)) {
      setSliderInputValue(sliderValue.toFixed(2))
    }
  }, [sliderValue])

  const buildBwtPayload = (comps) => ({
    comparisons: comps,
    criteria_signature: criteriaSignature,
  })

  const ensureSessionUnlocked = () => {
    if (!isSessionLocked) return true
    toast({
      title: 'Session locked',
      description: 'This session is locked. You cannot modify BWT data.',
      status: 'warning',
      isClosable: true,
    })
    return false
  }

  const handleCriteriaMismatchReset = async () => {
    if (!ensureSessionUnlocked()) return
    setSaving(true)
    try {
      await axios.put(`${API_URL}/session/${sessionId}/bwt`, {
        value: buildBwtPayload([]),
      })
      setComparisons([])
      setPairs([])
      setBestCriterion(null)
      setWorstCriterion(null)
      setCurrentPairIndex(0)
      setStep('select-criteria')
      setCriteriaMismatch(false)
      setCriteriaMismatchAcknowledged(false)
      setBwtSignature(criteriaSignature)
      toast({
        title: 'BWT reset',
        description: 'Please redo the elicitation process.',
        status: 'success',
        isClosable: true,
      })
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to reset BWT',
        status: 'error',
        isClosable: true,
      })
    } finally {
      setSaving(false)
    }
  }

  const getGroupCompletionStatus = (groupIndex) => {
    const groupName = groups[groupIndex]?.name
    if (!groupName) return 0
    const groupComps = comparisons.filter((c) => c.group === groupName && c.type !== 'intra-best' && c.type !== 'intra-worst')
    const expectedComps = groups[groupIndex]?.criteria?.length || 0
    const expected = Math.max(1, 2 * expectedComps - 3)
    return groupComps.length > 0 ? Math.min(100, Math.round((groupComps.length / expected) * 100)) : 0
  }

  const getGroupBestWorst = (groupIndex) => {
    const groupName = groups[groupIndex]?.name
    const groupComps = comparisons.filter((c) => c.group === groupName && c.type === 'best')
    if (groupComps.length === 0) return { best: null, worst: null }
    const bestName = groupComps[0].adjusted_criterion
    const worstName = groupComps[0].reference_criterion
    const best = criteria.find((c) => c.criterion_name === bestName)
    const worst = criteria.find((c) => c.criterion_name === worstName)
    return { best, worst }
  }

  const isGroupComplete = (groupIndex) => {
    const groupName = groups[groupIndex]?.name
    const groupComps = comparisons.filter((c) => c.group === groupName && c.type !== 'intra-best' && c.type !== 'intra-worst')
    const expectedComps = groups[groupIndex]?.criteria?.length || 0
    const expected = Math.max(1, 2 * expectedComps - 3)
    return groupComps.length >= expected
  }

  const handleResetGroup = async () => {
    if (!ensureSessionUnlocked()) return
    const groupName = groups[selectedGroupIndex].name
    const newComparisons = comparisons.filter((c) => c.group !== groupName)
    setComparisons(newComparisons)
    setBestCriterion(null)
    setWorstCriterion(null)
    setPairs([])
    setStep('select-criteria')
    setSaving(true)
    try {
      await axios.put(`${API_URL}/session/${sessionId}/bwt`, {
        value: buildBwtPayload(newComparisons),
      })
      toast({
        title: 'Group reset successfully',
        status: 'success',
        isClosable: true,
      })
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to reset group',
        status: 'error',
        isClosable: true,
      })
    } finally {
      setSaving(false)
    }
  }

  const getDataRange = (criterion) => {
    const alternatives = criterion.alternatives || []
    const values = alternatives.map((alt) => Number(alt.value)).filter((v) => isFinite(v))
    if (values.length === 0) return { min: 0, max: 1 }
    return { min: Math.min(...values), max: Math.max(...values) }
  }

  const interpolateVF = (criterionName, dataValue) => {
    if (!valueFunction[criterionName]) return 0.5
    const points = valueFunction[criterionName].points || []
    if (!points || points.length === 0) return 0.5

    const sorted = [...points].sort((a, b) => a.x - b.x)
    if (dataValue <= sorted[0].x) return sorted[0].y
    if (dataValue >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].y

    for (let i = 0; i < sorted.length - 1; i++) {
      const p1 = sorted[i]
      const p2 = sorted[i + 1]
      if (dataValue >= p1.x && dataValue <= p2.x) {
        const ratio = (dataValue - p1.x) / (p2.x - p1.x)
        return p1.y + ratio * (p2.y - p1.y)
      }
    }
    return 0.5
  }

  const getBestDataValue = (criterion) => {
    const points = valueFunction[criterion.criterion_name]?.points || []
    if (!points || points.length === 0) {
      const range = getDataRange(criterion)
      return range.max
    }
    // Find the x value where y is maximum (closest to 1)
    const sorted = [...points].sort((a, b) => b.y - a.y)
    return sorted[0].x
  }

  const getWorstDataValue = (criterion) => {
    const points = valueFunction[criterion.criterion_name]?.points || []
    if (!points || points.length === 0) {
      const range = getDataRange(criterion)
      return range.min
    }
    // Find the x value where y is minimum (closest to 0)
    const sorted = [...points].sort((a, b) => a.y - b.y)
    return sorted[0].x
  }

  const handleSelectCriteria = () => {
    if (!bestCriterion || !worstCriterion) {
      toast({
        title: 'Please select both best and worst criteria',
        status: 'warning',
        isClosable: true,
      })
      return
    }

    const groupCriteria = groups[selectedGroupIndex].criteria
    const others = groupCriteria.filter(
      (c) => c.criterion_name !== bestCriterion.criterion_name && c.criterion_name !== worstCriterion.criterion_name
    )

    const newPairs = [
      { reference: worstCriterion, adjusted: bestCriterion, type: 'best' },
      ...others.map((other) => ({
        reference: other,
        adjusted: bestCriterion,
        type: 'standard',
      })),
      ...others.map((other) => ({
        reference: worstCriterion,
        adjusted: other,
        type: 'standard',
      })),
    ]

    setPairs(newPairs)
    setCurrentPairIndex(0)
    setStep('evaluate-pairs')
    setSliderValue(getDataRange(bestCriterion).min)
  }

  const upsertComparisonForPair = (pairIndex, value = sliderValue, comps = comparisons) => {
    if (!pairs[pairIndex]) return comps
    const pair = pairs[pairIndex]
    const newComparison = {
      reference_criterion: pair.reference.criterion_name,
      adjusted_criterion: pair.adjusted.criterion_name,
      data_value: value,
      type: pair.type,
      group: groups[selectedGroupIndex].name,
    }

    const filtered = comps.filter(
      (c) => !(c.reference_criterion === pair.reference.criterion_name &&
        c.adjusted_criterion === pair.adjusted.criterion_name &&
        c.group === groups[selectedGroupIndex].name)
    )
    return [...filtered, newComparison]
  }

  const handleNextPair = async () => {
    if (!ensureSessionUnlocked()) return
    const updatedComparisons = upsertComparisonForPair(currentPairIndex, sliderValue)
    
    if (currentPairIndex < pairs.length - 1) {
      // Save and then navigate to next pair
      setSaving(true)
      try {
        await axios.put(`${API_URL}/session/${sessionId}/bwt`, {
          value: buildBwtPayload(updatedComparisons),
        })
        setComparisons(updatedComparisons)
        setCurrentPairIndex(currentPairIndex + 1)
        const nextComp = getComparisonForPair(currentPairIndex + 1, updatedComparisons)
        setSliderValue(nextComp ? nextComp.data_value : getDataRange(pairs[currentPairIndex + 1].adjusted).min)
        // Scroll to top
        if (mainContentRef.current) {
          mainContentRef.current.scrollTop = 0
        }
      } catch (error) {
        toast({
          title: 'Error',
          description: error.response?.data?.error || 'Failed to save comparison',
          status: 'error',
          isClosable: true,
        })
      } finally {
        setSaving(false)
      }
    } else {
      // Last pair - just save, don't move to next group automatically
      await handleSaveAll(updatedComparisons)
    }
  }

  const handlePrevPair = async () => {
    if (!ensureSessionUnlocked()) return
    if (currentPairIndex > 0) {
      const updatedComparisons = upsertComparisonForPair(currentPairIndex, sliderValue)
      
      setSaving(true)
      try {
        await axios.put(`${API_URL}/session/${sessionId}/bwt`, {
          value: buildBwtPayload(updatedComparisons),
        })
        setComparisons(updatedComparisons)
        setCurrentPairIndex(currentPairIndex - 1)
        const prevComp = getComparisonForPair(currentPairIndex - 1, updatedComparisons)
        setSliderValue(prevComp ? prevComp.data_value : getDataRange(pairs[currentPairIndex - 1].adjusted).min)
        // Scroll to top
        if (mainContentRef.current) {
          mainContentRef.current.scrollTop = 0
        }
      } catch (error) {
        toast({
          title: 'Error',
          description: error.response?.data?.error || 'Failed to save comparison',
          status: 'error',
          isClosable: true,
        })
      } finally {
        setSaving(false)
      }
    }
  }

  const handleSaveAll = async (comps = comparisons) => {
    if (!ensureSessionUnlocked()) return
    setSaving(true)
    try {
      await axios.put(`${API_URL}/session/${sessionId}/bwt`, {
        value: buildBwtPayload(comps),
      })
      setComparisons(comps)
      toast({
        title: 'Saved',
        description: 'Comparison saved successfully',
        status: 'success',
        duration: 2000,
        isClosable: true,
      })
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to save BWT data',
        status: 'error',
        isClosable: true,
      })
    } finally {
      setSaving(false)
    }
  }

  const getComparisonForPair = (pairIndex, comps = comparisons) => {
    if (pairIndex >= pairs.length) return null
    const pair = pairs[pairIndex]
    return comps.find(
      (c) => c.reference_criterion === pair.reference.criterion_name &&
        c.adjusted_criterion === pair.adjusted.criterion_name &&
        c.group === groups[selectedGroupIndex].name
    )
  }

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minH="400px">
        <Spinner size="lg" />
      </Box>
    )
  }

  if (groups.length === 0) {
    return (
      <Box bg="white" p={8} borderRadius="lg" boxShadow="sm">
        <Heading>No criteria available</Heading>
      </Box>
    )
  }

  const renderContent = () => {
    if (step === 'idle') {
      return (
        <Box display="flex" justifyContent="center" alignItems="center" minH="60vh">
          <VStack spacing={4} textAlign="center">
            {criteriaMismatch && (
              <Alert status="error" borderRadius="md" textAlign="left" w="100%">
                <AlertIcon />
                <Box flex="1">
                  <AlertTitle>BWT invalid</AlertTitle>
                  <AlertDescription>
                    The criteria have changed since the last elicitation. Please reset and redo the BWT process.
                  </AlertDescription>
                </Box>
                <HStack spacing={2} ml={4}>
                  {!criteriaMismatchAcknowledged && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setCriteriaMismatchAcknowledged(true)}
                    >
                      Keep (invalid)
                    </Button>
                  )}
                  <Button
                    size="sm"
                    colorScheme="red"
                    onClick={handleCriteriaMismatchReset}
                    isLoading={saving}
                  >
                    Reset BWT
                  </Button>
                </HStack>
              </Alert>
            )}
            <Heading size="lg">Select a Group to Start</Heading>
            <Text color="gray.600" fontSize="lg">
              Click on a group in the sidebar to view or complete its comparisons
            </Text>
          </VStack>
        </Box>
      )
    }

    if (step === 'select-criteria') {
      const selectedGroup = groups[selectedGroupIndex]
      return (
        <VStack spacing={6} align="stretch">
          {criteriaMismatch && (
            <Alert status="error" borderRadius="md">
              <AlertIcon />
              <Box flex="1">
                <AlertTitle>BWT invalid</AlertTitle>
                <AlertDescription>
                  The criteria have changed since the last elicitation. Please reset and redo the BWT process.
                </AlertDescription>
              </Box>
              <HStack spacing={2} ml={4}>
                {!criteriaMismatchAcknowledged && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCriteriaMismatchAcknowledged(true)}
                  >
                    Keep (invalid)
                  </Button>
                )}
                <Button
                  size="sm"
                  colorScheme="red"
                  onClick={handleCriteriaMismatchReset}
                  isLoading={saving}
                >
                  Reset BWT
                </Button>
              </HStack>
            </Alert>
          )}
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Heading size="lg">Select Best and Worst Criteria</Heading>
            <Badge colorScheme="blue">
              Group {selectedGroupIndex + 1} of {groups.length}: {selectedGroup.name}
            </Badge>
          </Box>
          <Text fontSize="sm" color="gray.600">
            Select the criterion you would increase FIRST if everything was at worst (Best),
            and the one you would increase LAST (Worst).
          </Text>
          <Divider />

          <Box>
            <Heading size="md" mb={4}>
              Criteria in {selectedGroup.name}
            </Heading>
            <Grid templateColumns="repeat(auto-fit, minmax(250px, 1fr))" gap={4}>
              {selectedGroup.criteria.map((crit) => {
                const range = getDataRange(crit)
                return (
                  <Box key={crit.criterion_name} p={4} border="1px" borderColor="gray.200" borderRadius="md">
                    <Text fontWeight="bold" mb={2}>
                      {crit.criterion_name}
                    </Text>
                    <Text fontSize="sm" color="gray.600" mb={2}>
                      Unit: {crit.unit}
                    </Text>
                    <Text fontSize="sm" mb={2}>
                      Min: {range.min.toFixed(2)} | Max: {range.max.toFixed(2)}
                    </Text>
                    <HStack spacing={2}>
                      <Button
                        size="sm"
                        colorScheme={bestCriterion?.criterion_name === crit.criterion_name ? 'green' : 'gray'}
                        onClick={() => setBestCriterion(crit)}
                      >
                        Best
                      </Button>
                      <Button
                        size="sm"
                        colorScheme={worstCriterion?.criterion_name === crit.criterion_name ? 'red' : 'gray'}
                        onClick={() => setWorstCriterion(crit)}
                      >
                        Worst
                      </Button>
                    </HStack>
                  </Box>
                )
              })}
            </Grid>
          </Box>

          <Box pt={4} display="flex" gap={4} justifyContent="flex-end">
            <Button onClick={handleSelectCriteria} colorScheme="blue" isDisabled={!bestCriterion || !worstCriterion}>
              Continue to Pairs
            </Button>
          </Box>
        </VStack>
      )
    }

    if (step === 'evaluate-pairs') {
      const pair = pairs[currentPairIndex]
      const adjustedRange = getDataRange(pair.adjusted)
      const referenceRange = getDataRange(pair.reference)
      const groupCriteria = groups[selectedGroupIndex].criteria
      const comparison = getComparisonForPair(currentPairIndex)
      const isAllComplete = isGroupComplete(selectedGroupIndex)
      const currentVFValue = interpolateVF(pair.adjusted.criterion_name, sliderValue)

      const plot1Data = groupCriteria.map((crit) => {
        const isReference = crit.criterion_name === pair.reference.criterion_name
        const bestValue = isReference ? getBestDataValue(pair.reference) : 0
        const value = isReference ? interpolateVF(crit.criterion_name, bestValue) : 0
        return {
          name: crit.criterion_name,
          value: value,
          isReference: isReference,
        }
      })

      const plot2Data = groupCriteria.map((crit) => {
        const isAdjusted = crit.criterion_name === pair.adjusted.criterion_name
        const value = isAdjusted ? interpolateVF(crit.criterion_name, sliderValue) : 0
        return {
          name: crit.criterion_name,
          value: value,
          isAdjusted: isAdjusted,
        }
      })

      const vfPoints = valueFunction[pair.adjusted.criterion_name]?.points || []
      const vfData = [...vfPoints]
        .sort((a, b) => a.x - b.x)
        .map((p) => ({ x: p.x, y: p.y }))
      const vfMinX = vfData.length ? vfData[0].x : adjustedRange.min
      const vfMaxX = vfData.length ? vfData[vfData.length - 1].x : adjustedRange.max

      return (
        <VStack spacing={6} align="stretch">
          {criteriaMismatch && (
            <Alert status="error" borderRadius="md">
              <AlertIcon />
              <Box flex="1">
                <AlertTitle>BWT invalid</AlertTitle>
                <AlertDescription>
                  The criteria have changed since the last elicitation. Please reset and redo the BWT process.
                </AlertDescription>
              </Box>
              <HStack spacing={2} ml={4}>
                {!criteriaMismatchAcknowledged && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCriteriaMismatchAcknowledged(true)}
                  >
                    Keep (invalid)
                  </Button>
                )}
                <Button
                  size="sm"
                  colorScheme="red"
                  onClick={handleCriteriaMismatchReset}
                  isLoading={saving}
                >
                  Reset BWT
                </Button>
              </HStack>
            </Alert>
          )}
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Heading size="lg">
              Pair {currentPairIndex + 1} of {pairs.length}
            </Heading>
            <Badge colorScheme="purple">
              {pairs[currentPairIndex].type}
            </Badge>
          </Box>

          <Box border="1px" borderColor="gray.200" borderRadius="md" p={4} bg="gray.50">
            <Text fontSize="sm" color="gray.700" mb={2}>
              On the left, you see the baseline: all criteria are at their worst, except for {' '}
              <strong>{pair.reference.criterion_name}</strong>, which is at its best.
              <br />
              On the right, the compensated scenario: how much must {' '}
              <strong>{pair.adjusted.criterion_name}</strong> improve to compensate the total loss of {' '}
              <strong>{pair.reference.criterion_name}</strong>?
            </Text>
            <Text fontSize="sm" color="gray.600">
              Adjust the slider to affect the compensated scenario.
            </Text>
          </Box>

          <HStack spacing={4} align="stretch">
            <Box border="1px" borderColor="gray.200" borderRadius="md" p={3} flex={1} bg="white">
              <Text fontSize="sm" color="gray.700" mb={1}>
                <strong>Baseline:</strong> {pair.reference.criterion_name} [{referenceRange.min.toFixed(2)}-{referenceRange.max.toFixed(2)}] {pair.reference.unit}
              </Text>
              {pair.reference.description && (
                <Text fontSize="xs" color="gray.600">
                  {pair.reference.description}
                </Text>
              )}
            </Box>
            <Box border="1px" borderColor="gray.200" borderRadius="md" p={3} flex={1} bg="white">
              <Text fontSize="sm" color="gray.700" mb={1}>
                <strong>Adjustable:</strong> {pair.adjusted.criterion_name} [{adjustedRange.min.toFixed(2)}-{adjustedRange.max.toFixed(2)}] {pair.adjusted.unit}
              </Text>
              {pair.adjusted.description && (
                <Text fontSize="xs" color="gray.600">
                  {pair.adjusted.description}
                </Text>
              )}
            </Box>
          </HStack>

          <HStack spacing={4} align="stretch">
            <Box border="1px" borderColor="gray.200" borderRadius="md" p={4} flex={1}>
              <Heading size="sm" mb={2} textAlign="center">Baseline scenario</Heading>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={plot1Data} margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="name" 
                    angle={-45} 
                    textAnchor="end" 
                    height={80} 
                    interval={0}
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis domain={[0, 1]} tick={{ fontSize: 12 }} />
                  <Bar dataKey="value" fill="#2b6cb0">
                    {plot1Data.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.isReference ? '#2c5282' : '#cbd5e0'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Box>

            <Box border="1px" borderColor="gray.200" borderRadius="md" p={4} flex={1}>
              <Heading size="sm" mb={2} textAlign="center">Compensated scenario</Heading>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={plot2Data} margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="name" 
                    angle={-45} 
                    textAnchor="end" 
                    height={80} 
                    interval={0}
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis domain={[0, 1]} tick={{ fontSize: 12 }} />
                  <Bar dataKey="value" fill="#63b3ed">
                    {plot2Data.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.isAdjusted ? '#2b6cb0' : '#cbd5e0'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </HStack>

          <Box>
            <HStack justify="space-between" align="center" spacing={3} mb={2}>
              <HStack spacing={3}>
                <FormLabel mb={0} fontWeight="bold" fontSize="md">
                  Adjust "{pair.adjusted.criterion_name}" [{pair.adjusted.unit}]:
                </FormLabel>
                <NumberInput
                  value={sliderInputValue}
                  min={adjustedRange.min}
                  max={adjustedRange.max}
                  step={(adjustedRange.max - adjustedRange.min) / 100}
                  precision={2}
                  onChange={(valueString) => {
                    setSliderInputValue(valueString)
                  }}
                  size="md"
                  maxW="160px"
                  variant="unstyled"
                >
                  <NumberInputField
                    textAlign="left"
                    fontWeight="bold"
                    fontSize="md"
                    lineHeight="1.2"
                    px={2}
                    py={1}
                    height="auto"
                    mt="1px"
                    border="1px solid"
                    borderColor="gray.300"
                    borderRadius="md"
                    bg="white"
                    _focus={{ borderColor: 'blue.400', boxShadow: '0 0 0 1px #63b3ed' }}
                    onBlur={() => {
                      const parsed = Number(sliderInputValue)
                      if (Number.isFinite(parsed)) {
                        const clamped = Math.min(adjustedRange.max, Math.max(adjustedRange.min, parsed))
                        setSliderValue(clamped)
                        setSliderInputValue(clamped.toFixed(2))
                      } else {
                        setSliderInputValue(Number.isFinite(sliderValue) ? sliderValue.toFixed(2) : adjustedRange.min.toFixed(2))
                      }
                    }}
                  />
                </NumberInput>
              </HStack>
              <HStack spacing={4}>
                <Button
                  leftIcon={<ChevronLeftIcon />}
                  isDisabled={currentPairIndex === 0}
                  onClick={handlePrevPair}
                  size="md"
                >
                  Previous
                </Button>
                <Button 
                  colorScheme="blue" 
                  rightIcon={<ChevronRightIcon />} 
                  onClick={async () => {
                    if (currentPairIndex === pairs.length - 1) {
                      // On last pair - save and move to next group or output
                      const updatedComparisons = upsertComparisonForPair(currentPairIndex, sliderValue)
                      await handleSaveAll(updatedComparisons)
                      
                      if (selectedGroupIndex < groups.length - 1) {
                        // Move to next group
                        setSelectedGroupIndex(selectedGroupIndex + 1)
                        setBestCriterion(null)
                        setWorstCriterion(null)
                        setPairs([])
                        setStep('select-criteria')
                        if (mainContentRef.current) {
                          mainContentRef.current.scrollTop = 0
                        }
                      } else {
                        // Last group - go to output
                        if (onPageChange) {
                          onPageChange('output')
                        }
                      }
                    } else {
                      // Not on last pair - just go to next
                      await handleNextPair()
                    }
                  }} 
                  isLoading={saving}
                  size="md"
                >
                  {currentPairIndex === pairs.length - 1 
                    ? (selectedGroupIndex === groups.length - 1 ? 'Complete & Go to Output' : 'Next Group') 
                    : 'Next'}
                </Button>
              </HStack>
            </HStack>
            <Slider
              min={adjustedRange.min}
              max={adjustedRange.max}
              step={(adjustedRange.max - adjustedRange.min) / 100}
              value={sliderValue}
              onChange={setSliderValue}
            >
              <SliderTrack>
                <SliderFilledTrack />
              </SliderTrack>
              <SliderThumb />
            </Slider>
            <HStack spacing={2} mt={2} fontSize="sm" color="gray.600">
              <Text>{adjustedRange.min.toFixed(2)}</Text>
              <Box flex={1} />
              <Text>{adjustedRange.max.toFixed(2)}</Text>
            </HStack>
          </Box>

          <Box border="1px" borderColor="gray.200" borderRadius="md" p={4}>
            <Heading size="sm" mb={2} textAlign="center">Value Function: {pair.adjusted.criterion_name}</Heading>
            {vfData.length > 0 ? (
              <ResponsiveContainer width="100%" height={350}>
                <LineChart data={vfData} margin={{ top: 20, right: 30, bottom: 60, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="x"
                    type="number"
                    domain={[vfMinX, vfMaxX]}
                    tick={{ fontSize: 12 }}
                    allowDataOverflow
                  />
                  <YAxis domain={[0, 1]} tick={{ fontSize: 12 }} />
                  <Line type="linear" dataKey="y" stroke="#2b6cb0" dot strokeWidth={2} />
                  <ReferenceDot
                    x={sliderValue}
                    y={currentVFValue}
                    r={4}
                    fill="#4299e1"
                    stroke="#2b6cb0"
                    strokeWidth={1.5}
                    isFront
                    ifOverflow="extendDomain"
                  />
                  <RechartsTooltip />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <Text color="gray.500" textAlign="center" py={8}>
                No VF data
              </Text>
            )}
          </Box>
        </VStack>
      )
    }

    return null
  }

  return (
    <HStack align="stretch" spacing={0} minH="100vh">
      {/* Sidebar */}
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
          <Heading size="md">Groups</Heading>
          <Button
            colorScheme="red"
            size="sm"
            onClick={onOpen}
            variant="outline"
            isDisabled={isSessionLocked}
          >
            Reset All BWT Data
          </Button>
        </VStack>
        <VStack spacing={3} align="stretch">
          {groups.map((group, idx) => {
            const isActive = selectedGroupIndex === idx
            const completion = getGroupCompletionStatus(idx)
            const isCompleted = completion === 100
            return (
              <Box key={group.name}>
                <Box
                  p={3}
                  borderRadius="md"
                  cursor="pointer"
                  bg={isActive ? 'blue.500' : isCompleted ? 'green.100' : 'white'}
                  borderWidth="1px"
                  borderColor={isActive ? 'blue.600' : isCompleted ? 'green.300' : 'gray.300'}
                  onClick={() => {
                    setSelectedGroupIndex(idx)
                  }}
                  _hover={{ shadow: 'sm' }}
                >
                  <HStack justify="space-between">
                    <VStack align="start" spacing={0} flex={1}>
                      <Text
                        fontWeight="bold"
                        color={isActive ? 'white' : 'black'}
                        fontSize="sm"
                      >
                        {group.name}
                      </Text>
                      <Text fontSize="xs" color={isActive ? 'whiteAlpha.800' : 'gray.600'}>
                        {completion}% complete
                      </Text>
                    </VStack>
                    <Box
                      h="12px"
                      w="12px"
                      borderRadius="full"
                      bg={completion === 100 ? 'green.500' : completion > 0 ? 'blue.500' : 'gray.300'}
                    />
                  </HStack>
                </Box>

                {/* Pairs list for this group */}
                {isActive && step === 'evaluate-pairs' && pairs.length > 0 && (
                  <Box mt={2} ml={2} borderLeft="2px" borderColor="blue.300" pl={2}>
                    <Text fontSize="xs" fontWeight="bold" color="gray.600" mb={2}>
                      Pairs:
                    </Text>
                    <VStack spacing={1} align="stretch">
                      {pairs.map((pair, pairIdx) => {
                        const comp = getComparisonForPair(pairIdx)
                        const isActivePair = currentPairIndex === pairIdx
                        return (
                          <Box
                            key={pairIdx}
                            p={2}
                            borderRadius="sm"
                            bg={isActivePair ? 'blue.400' : comp ? 'green.50' : 'white'}
                            border="1px"
                            borderColor={isActivePair ? 'blue.500' : comp ? 'green.300' : 'gray.200'}
                            cursor="pointer"
                            onClick={async () => {
                              if (pairIdx === currentPairIndex) return
                              if (!ensureSessionUnlocked()) return
                              const updated = upsertComparisonForPair(currentPairIndex, sliderValue)
                              setSaving(true)
                              try {
                                await axios.put(`${API_URL}/session/${sessionId}/bwt`, {
                                  value: buildBwtPayload(updated),
                                })
                                setComparisons(updated)
                                setCurrentPairIndex(pairIdx)
                                const targetComp = getComparisonForPair(pairIdx, updated)
                                setSliderValue(targetComp ? targetComp.data_value : getDataRange(pairs[pairIdx].adjusted).min)
                                // Scroll to top
                                if (mainContentRef.current) {
                                  mainContentRef.current.scrollTop = 0
                                }
                              } catch (error) {
                                toast({
                                  title: 'Error',
                                  description: 'Failed to save and navigate',
                                  status: 'error',
                                  isClosable: true,
                                })
                              } finally {
                                setSaving(false)
                              }
                            }}
                            _hover={{ shadow: 'sm' }}
                          >
                            <Text fontSize="xs" fontWeight="bold" color={isActivePair ? 'white' : 'black'} noOfLines={2}>
                              {pair.reference.criterion_name.substring(0, 12)} → {pair.adjusted.criterion_name.substring(0, 12)}
                            </Text>
                            {comp && (
                              <Text fontSize="xs" color={isActivePair ? 'whiteAlpha.800' : 'green.700'}>
                                ✓ {comp.data_value.toFixed(2)}
                              </Text>
                            )}
                          </Box>
                        )
                      })}
                    </VStack>
                  </Box>
                )}
              </Box>
            )
          })}
        </VStack>
      </Box>

      {/* Main Content */}
      <Box ref={mainContentRef} flex={1} bg="white" p={4} overflow="auto">
        {isSessionLocked && (
          <Box bg="yellow.50" p={3} borderRadius="md" borderLeft="4px" borderLeftColor="yellow.400" mb={4}>
            <Text fontSize="sm" color="yellow.800" fontWeight="semibold">
              🔒 Session is locked. Editing is disabled.
            </Text>
          </Box>
        )}
        {renderContent()}
      </Box>

      {/* Reset Confirmation Dialog */}
      <AlertDialog
        isOpen={isOpen}
        leastDestructiveRef={cancelRef}
        onClose={onClose}
      >
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              Reset All BWT Data
            </AlertDialogHeader>

            <AlertDialogBody>
              Are you sure you want to reset all BWT comparisons? This will delete all your progress and cannot be undone.
            </AlertDialogBody>

            <AlertDialogFooter>
              <Button ref={cancelRef} onClick={onClose}>
                Cancel
              </Button>
              <Button 
                colorScheme="red" 
                onClick={() => {
                  handleCriteriaMismatchReset()
                  onClose()
                }} 
                ml={3}
                isLoading={saving}
              >
                Reset All
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </HStack>
  )
}

export default PileBwtPage
