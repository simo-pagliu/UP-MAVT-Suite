import {
  Badge,
  Box,
  Button,
  Divider,
  Flex,
  FormControl,
  FormLabel,
  Heading,
  HStack,
  Checkbox,
  Grid,
  Input,
  NumberInput,
  NumberInputField,
  Progress,
  Radio,
  RadioGroup,
  SimpleGrid,
  Spinner,
  Stack,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Tag,
  TagLabel,
  TagRightIcon,
  Text,
  Tooltip,
  VStack,
  useToast,
} from '@chakra-ui/react'
import { CheckCircleIcon, WarningIcon, CloseIcon } from '@chakra-ui/icons'
import axios from 'axios'
import { useEffect, useMemo, useRef, useState } from 'react'

const API_URL = 'http://localhost:5000/api'

const SHAPES = [
  { value: 'linear_increasing', label: 'Piecewise linear increasing', helper: 'Starts at 0 and rises to 1.' },
  { value: 'linear_decreasing', label: 'Piecewise linear decreasing', helper: 'Starts at 1 and falls to 0.' },
]

const MODE = {
  MID: 'mid-splitting',
  FREE: 'free-edit',
}

const clamp = (v, min, max) => {
  const num = Number.isFinite(v) ? v : min
  return Math.min(Math.max(num, min), max)
}

const sortByX = (pts) => [...pts].sort((a, b) => a.x - b.x)

const formatPointsForCsv = (points) => points.map((p) => `${p.x}:${p.y}`).join(';')

const deriveRange = (criterion) => {
  const numericValues = (criterion.alternatives || [])
    .map((alt) => Number(alt.value))
    .filter((v) => Number.isFinite(v))
  if (!numericValues.length) return { min: 0, max: 1 }
  return { min: Math.min(...numericValues), max: Math.max(...numericValues) }
}

const defaultPointsForShape = (shape, range, gaussian) => {
  if (shape === 'linear_decreasing') return sortByX([{ x: range.min, y: 1 }, { x: range.max, y: 0 }])
  return sortByX([{ x: range.min, y: 0 }, { x: range.max, y: 1 }])
}

const buildGaussianPoints = (range, mean, sigma, count, inverted) => {
  const pts = []
  const step = (range.max - range.min) / Math.max(count - 1, 1)
  for (let i = 0; i < count; i += 1) {
    const x = range.min + step * i
    const z = (x - mean) / sigma
    const base = Math.exp(-0.5 * z * z)
    const y = inverted ? 1 - base : base
    pts.push({ x, y: clamp(Number(y.toFixed(4)), 0, 1) })
  }
  // Ensure endpoints hit 0 for positive bell and 1 for inverted
  if (!inverted) {
    pts[0].y = 0
    pts[pts.length - 1].y = 0
  } else {
    pts[0].y = 1
    pts[pts.length - 1].y = 1
  }
  return sortByX(pts)
}

const buildMidSplitPoints = (range, shape, midSplit, thresholds) => {
  const anchors = buildThresholdAnchors(shape, thresholds, range)
  if (midSplit.skipFirst || !midSplit.step1) return anchors

  const pts = [...anchors]
  const increasing = shape === 'linear_increasing'

  pts.push({ x: midSplit.step1, y: 0.5 })

  if (!midSplit.skipSecond && midSplit.step2) {
    pts.push({ x: midSplit.step2, y: increasing ? 0.25 : 0.75 })
  }

  if (!midSplit.skipThird && midSplit.step3) {
    pts.push({ x: midSplit.step3, y: increasing ? 0.75 : 0.25 })
  }

  const monotonic = enforceMonotonic(sortByX(pts), increasing)
  return lockLinearEndpoints(monotonic, shape, range)
}

const clampPointsToRange = (points, range) => {
  return sortByX(points.map((p) => ({ x: clamp(p.x, range.min, range.max), y: clamp(p.y, 0, 1) })))
}

const enforceMonotonic = (points, increasing) => {
  const sorted = sortByX(points)
  if (increasing) {
    let last = 0
    return sorted.map((p, idx) => {
      const y = idx === 0 ? 0 : clamp(Math.max(p.y, last), 0, 1)
      last = y
      return { x: p.x, y }
    })
  }
  let last = 1
  return sorted.map((p, idx) => {
    const y = idx === 0 ? 1 : clamp(Math.min(p.y, last), 0, 1)
    last = y
    return { x: p.x, y }
  })
}

const lockLinearEndpoints = (points, shape, range) => {
  if (!(shape === 'linear_increasing' || shape === 'linear_decreasing')) return sortByX(points)
  const sorted = sortByX(points)
  if (!sorted.length) return sorted
  const startY = shape === 'linear_decreasing' ? 1 : 0
  const endY = shape === 'linear_decreasing' ? 0 : 1
  sorted[0] = { x: range.min, y: startY }
  sorted[sorted.length - 1] = { x: range.max, y: endY }
  return sorted
}

const buildThresholdAnchors = (shape, thresholds, range) => {
  const pts = []
  const { low, high } = thresholds
  if (shape === 'linear_increasing') {
    pts.push({ x: range.min, y: 0 })
    if (low > range.min) pts.push({ x: low, y: 0 })
    pts.push({ x: high, y: 1 })
    if (high < range.max) pts.push({ x: range.max, y: 1 })
    return lockLinearEndpoints(pts, shape, range)
  }
  if (shape === 'linear_decreasing') {
    pts.push({ x: range.min, y: 1 })
    if (low > range.min) pts.push({ x: low, y: 1 })
    pts.push({ x: high, y: 0 })
    if (high < range.max) pts.push({ x: range.max, y: 0 })
    return lockLinearEndpoints(pts, shape, range)
  }
  return []
}

function ValueFunctionPlot({ range, points, thresholds, onDrag, draggable, shape }) {
  const svgRef = useRef(null)
  const [dragIndex, setDragIndex] = useState(null)

  const width = 620
  const height = 260

  const toSvgX = (x) => ((x - range.min) / (range.max - range.min || 1)) * (width - 40) + 20
  const toSvgY = (y) => height - 20 - y * (height - 40)
  const fromSvg = (clientX, clientY, rect) => {
    const xRatio = clamp((clientX - rect.left - 20) / (width - 40), 0, 1)
    const yRatio = clamp((height - 20 - (clientY - rect.top)) / (height - 40), 0, 1)
    const x = range.min + xRatio * (range.max - range.min)
    const y = yRatio
    return { x, y }
  }

  const handlePointerDown = (idx) => (event) => {
    if (!draggable) return
    setDragIndex(idx)
    event.preventDefault()
  }

  const handlePointerMove = (event) => {
    if (dragIndex === null || !draggable || !onDrag) return
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const { x, y } = fromSvg(event.clientX, event.clientY, rect)
    onDrag(dragIndex, { x, y })
  }

  const handlePointerUp = () => setDragIndex(null)

  useEffect(() => {
    if (!draggable) return
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  })

  const linePath = points
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${toSvgX(p.x)} ${toSvgY(p.y)}`)
    .join(' ')

  const thresholdXs = [thresholds?.low, thresholds?.high].filter((v) => Number.isFinite(v))

  return (
    <Box border="1px solid" borderColor="gray.200" borderRadius="md" p={4} bg="gray.50">
      <svg ref={svgRef} width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <rect x={0} y={0} width={width} height={height} fill="transparent" />
        <line x1={20} y1={height - 20} x2={width - 20} y2={height - 20} stroke="#A0AEC0" strokeWidth="1" />
        <line x1={20} y1={20} x2={20} y2={height - 20} stroke="#A0AEC0" strokeWidth="1" />
        {thresholdXs.map((xVal, idx) => (
          <line
            key={`th-${idx}`}
            x1={toSvgX(xVal)}
            x2={toSvgX(xVal)}
            y1={20}
            y2={height - 20}
            stroke={idx === 0 ? '#4FD1C5' : '#63B3ED'}
            strokeDasharray="4 3"
            strokeWidth="1.5"
          />
        ))}
        <path d={linePath} stroke="#2B6CB0" strokeWidth="2" fill="none" />
        {points.map((p, idx) => (
          <g key={`${p.x}-${idx}`}>
            <circle
              cx={toSvgX(p.x)}
              cy={toSvgY(p.y)}
              r={draggable ? 7 : 6}
              fill={draggable ? '#3182CE' : '#4A5568'}
              stroke="#fff"
              strokeWidth="1.5"
              style={{ cursor: draggable ? 'grab' : 'default' }}
              onPointerDown={handlePointerDown(idx)}
            />
          </g>
        ))}
        <text x={width / 2} y={height - 2} textAnchor="middle" fontSize="11" fill="#718096">X ({range.min} – {range.max})</text>
        <text x={8} y={14} textAnchor="start" fontSize="11" fill="#718096">Y (0 – 1) [{shape}]</text>
      </svg>
      <Text fontSize="xs" color="gray.500" mt={2}>Drag points when free edit is active for linear shapes. Thresholds show as dashed lines.</Text>
    </Box>
  )
}

function ValueFunctionsPage({ sessionId }) {
  const [criteria, setCriteria] = useState([])
  const [valueFunctions, setValueFunctions] = useState({})
  const [active, setActive] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  const [clampHint, setClampHint] = useState(null)
  const [isSessionLocked, setIsSessionLocked] = useState(false)
  const toast = useToast()

  useEffect(() => {
    const fetchSession = async () => {
      try {
        const res = await axios.get(`${API_URL}/session/${sessionId}`)
        const session = res.data
        setIsSessionLocked(session?.session_locked || false)
        const crits = Array.isArray(session.criteria) ? session.criteria : []
        setCriteria(crits)

        const existing = (session.value_functions && session.value_functions.criteria) || {}
        const vf = {}
        crits.forEach((criterion, idx) => {
          const name = criterion.criterion_name || `Criterion ${idx + 1}`
          const range = deriveRange(criterion)
          const defaultGaussian = {
            mean: (range.min + range.max) / 2,
            sigma: (range.max - range.min) / 4 || 1,
            pointCount: 10,
          }
          const persisted = existing[name] || {}
          const gaussian = {
            mean: persisted.gaussian?.mean ?? defaultGaussian.mean,
            sigma: persisted.gaussian?.sigma ?? defaultGaussian.sigma,
            pointCount: persisted.gaussian?.pointCount ?? defaultGaussian.pointCount,
          }
          const shape = persisted.shape || 'linear_increasing'
          const thresholds = {
            low: clamp(persisted.thresholds?.low ?? range.min, range.min, range.max),
            high: clamp(persisted.thresholds?.high ?? range.max, range.min, range.max),
          }
          const midSplit = {
            step1: persisted.midSplit?.step1 ?? null,
            step2: persisted.midSplit?.step2 ?? null,
            step3: persisted.midSplit?.step3 ?? null,
            skipFirst: persisted.midSplit?.skipFirst ?? false,
            skipSecond: persisted.midSplit?.skipSecond ?? false,
            skipThird: persisted.midSplit?.skipThird ?? false,
          }

          let points = persisted.points
          if (!Array.isArray(points) || points.length === 0) {
            if (persisted.mode === MODE.MID) {
              points = buildMidSplitPoints(range, shape, midSplit, thresholds)
            } else {
              points = defaultPointsForShape(shape, range, gaussian)
            }
          }

          // Apply threshold anchors for linear shapes so extrema follow low/high
          if (shape === 'linear_increasing' || shape === 'linear_decreasing') {
            points = persisted.mode === MODE.MID
              ? buildMidSplitPoints(range, shape, midSplit, thresholds)
              : buildThresholdAnchors(shape, thresholds, range)
          }

          vf[name] = {
            shape,
            thresholds,
            mode: shape.startsWith('gaussian') ? MODE.FREE : (persisted.mode || MODE.MID),
            midSplit,
            gaussian,
            points: clampPointsToRange(points, range),
            range,
            lastUpdated: persisted.lastUpdated || null,
          }
        })
        setValueFunctions(vf)
        setActive(null)
      } catch (error) {
        toast({
          title: 'Error',
          description: error.response?.data?.error || 'Failed to load session',
          status: 'error',
          duration: 4000,
          isClosable: true,
        })
      } finally {
        setLoading(false)
      }
    }

    fetchSession()
  }, [sessionId, toast])

  const dirtyRef = useRef(false)
  const lockToastRef = useRef(false)

  const saveValueFunctions = async (payload) => {
    if (isSessionLocked) {
      toast({
        title: 'Session locked',
        description: 'This session is locked. You cannot modify value functions.',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      })
      return
    }
    try {
      setSaving(true)
      await axios.put(`${API_URL}/session/${sessionId}/value`, {
        value: { criteria: payload },
      })
      const now = new Date().toISOString()
      setLastSaved(now)
      setValueFunctions((prev) => {
        const updated = { ...prev }
        Object.keys(updated).forEach((name) => {
          if (payload[name]) updated[name].lastUpdated = now
        })
        return updated
      })
      dirtyRef.current = false
    } catch (error) {
      toast({
        title: 'Save failed',
        description: error.response?.data?.error || 'Could not save value functions',
        status: 'error',
        duration: 4000,
        isClosable: true,
      })
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (loading) return
    if (!dirtyRef.current) return
    const timer = setTimeout(() => {
      saveValueFunctions(valueFunctions)
    }, 800)
    return () => clearTimeout(timer)
  }, [valueFunctions, loading])

  const markDirty = (updater) => {
    if (isSessionLocked) {
      if (!lockToastRef.current) {
        lockToastRef.current = true
        toast({
          title: 'Session locked',
          description: 'Editing is disabled while the session is locked.',
          status: 'warning',
          duration: 2000,
          isClosable: true,
        })
        setTimeout(() => {
          lockToastRef.current = false
        }, 2000)
      }
      return
    }
    setValueFunctions((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      dirtyRef.current = true
      return next
    })
  }

  const activeData = active ? valueFunctions[active] : null

  const handleShapeChange = (shape) => {
    if (!activeData) return
    markDirty((prev) => {
      const updated = { ...prev }
      const entry = { ...updated[active] }
      entry.shape = shape
      entry.points = entry.mode === MODE.MID
        ? buildMidSplitPoints(entry.range, shape, entry.midSplit, entry.thresholds)
        : buildThresholdAnchors(shape, entry.thresholds, entry.range)
      updated[active] = entry
      return updated
    })
  }

  const handleThresholdChange = (key, valueNum) => {
    if (!activeData) return
    const { range } = activeData
    const clamped = clamp(valueNum ?? range.min, range.min, range.max)
    if (clamped !== valueNum) {
      setClampHint({ field: key, value: clamped })
      setTimeout(() => setClampHint(null), 1500)
    }
    markDirty((prev) => {
      const updated = { ...prev }
      const nextEntry = { ...updated[active] }
      const nextThresholds = { ...nextEntry.thresholds, [key]: clamped }

      // keep ordering: low <= high
      if (nextThresholds.low > nextThresholds.high) {
        if (key === 'low') {
          nextThresholds.high = nextThresholds.low
        } else {
          nextThresholds.low = nextThresholds.high
        }
      }

      nextEntry.thresholds = nextThresholds

      // Rebuild points for linear shapes
      if (nextEntry.shape === 'linear_increasing' || nextEntry.shape === 'linear_decreasing') {
        nextEntry.points = nextEntry.mode === MODE.MID
          ? buildMidSplitPoints(nextEntry.range, nextEntry.shape, nextEntry.midSplit, nextEntry.thresholds)
          : buildThresholdAnchors(nextEntry.shape, nextEntry.thresholds, nextEntry.range)
      }

      updated[active] = nextEntry
      return updated
    })
  }

  const handleMidSplitChange = (stepKey, valueNum, shouldClamp = true) => {
    if (!activeData) return
    const { range, shape, thresholds, midSplit } = activeData
    let finalValue = valueNum ?? range.min
    
    if (shouldClamp) {
      // Enforce indifference point constraints
      if (stepKey === 'step1') {
        // Step 1 must be between low and high thresholds
        finalValue = clamp(finalValue, thresholds.low, thresholds.high)
      } else if (stepKey === 'step2') {
        // Step 2 must be between low threshold and step1
        const maxVal = midSplit.step1 ?? thresholds.high
        finalValue = clamp(finalValue, thresholds.low, maxVal)
      } else if (stepKey === 'step3') {
        // Step 3 must be between step1 and high threshold
        const minVal = midSplit.step1 ?? thresholds.low
        finalValue = clamp(finalValue, minVal, thresholds.high)
      }
    }
    
    markDirty((prev) => {
      const updated = { ...prev }
      const newMidSplit = { ...updated[active].midSplit, [stepKey]: finalValue }
      const points = buildMidSplitPoints(range, shape, newMidSplit, updated[active].thresholds)
      updated[active] = { ...updated[active], midSplit: newMidSplit, mode: MODE.MID, points }
      return updated
    })
  }

  const handleSkipStep = (stepKey, value) => {
    if (!activeData) return
    const { range, shape, midSplit } = activeData
    markDirty((prev) => {
      const updated = { ...prev }
      const ms = { ...midSplit, [stepKey]: value }
      if (stepKey === 'skipFirst' && value) {
        ms.skipSecond = true
        ms.skipThird = true
        ms.step1 = null
        ms.step2 = null
        ms.step3 = null
      }
      const points = buildMidSplitPoints(range, shape, ms, activeData.thresholds)
      updated[active] = { ...updated[active], midSplit: ms, mode: MODE.MID, points }
      return updated
    })
  }

  const handleGaussianChange = (key, valueNum) => {
    if (!activeData) return
    // Gaussian editing removed; keep no-op to avoid runtime errors if called.
  }

  const handleAddPoint = () => {
    if (!activeData) return
    const { points, range, shape } = activeData
    if (points.length >= 10) {
      toast({
        title: 'Limit reached',
        description: 'Maximum of 10 points in free edit.',
        status: 'warning',
        duration: 2000,
        isClosable: true,
      })
      return
    }
    const midX = (range.min + range.max) / 2
    markDirty((prev) => {
      const updated = { ...prev }
      const nextPoints = sortByX([...points, { x: midX, y: 0.5 }])
      const monotonic = shape === 'linear_increasing' || shape === 'linear_decreasing'
      const corrected = monotonic ? enforceMonotonic(nextPoints, shape === 'linear_increasing') : nextPoints
      const clamped = clampPointsToRange(corrected, range)
      updated[active] = { ...updated[active], points: lockLinearEndpoints(clamped, shape, range), mode: MODE.FREE }
      return updated
    })
  }

  const handlePointChange = (idx, key, valueNum) => {
    if (!activeData) return
    const { points, range, shape } = activeData
    markDirty((prev) => {
      const updated = { ...prev }
      const next = [...points]
      next[idx] = { ...next[idx], [key]: valueNum }
      const clamped = clampPointsToRange(next, range)
      const monotonic = shape === 'linear_increasing' || shape === 'linear_decreasing'
      const adjusted = monotonic ? enforceMonotonic(clamped, shape === 'linear_increasing') : clamped
      updated[active] = { ...updated[active], points: lockLinearEndpoints(adjusted, shape, range), mode: MODE.FREE }
      return updated
    })
  }

  const handleDragPoint = (idx, coords) => {
    if (!activeData) return
    const { range, shape } = activeData
    markDirty((prev) => {
      const updated = { ...prev }
      const entry = { ...updated[active] }
      const pts = [...entry.points]
      pts[idx] = coords
      const clamped = clampPointsToRange(pts, range)
      const monotonic = shape === 'linear_increasing' || shape === 'linear_decreasing'
      if (idx === 0 || idx === pts.length - 1) return updated
      entry.points = lockLinearEndpoints(
        monotonic ? enforceMonotonic(clamped, shape === 'linear_increasing') : clamped,
        shape,
        range,
      )
      entry.mode = MODE.FREE
      updated[active] = entry
      return updated
    })
  }

  const handleRemovePoint = (idx) => {
    if (!activeData) return
    if (activeData.points.length <= 2) return
    markDirty((prev) => {
      const updated = { ...prev }
      updated[active] = {
        ...updated[active],
        points: updated[active].points.filter((_, i) => i !== idx),
        mode: MODE.FREE,
      }
      return updated
    })
  }

  const progress = useMemo(() => {
    // Only count non-qualitative criteria
    const nonQualCriteria = criteria.filter(c => !c.is_qualitative)
    if (!nonQualCriteria.length) return 0
    const filled = nonQualCriteria.filter((c) => {
      const name = c.criterion_name || `Criterion ${criteria.indexOf(c) + 1}`
      const entry = valueFunctions[name]
      return entry && Array.isArray(entry.points) && entry.points.length >= 2
    }).length
    return Math.round((filled / nonQualCriteria.length) * 100)
  }, [criteria, valueFunctions])

  if (loading) {
    return (
      <Flex align="center" justify="center" minH="60vh">
        <Spinner size="lg" mr={3} />
        <Text>Loading value functions...</Text>
      </Flex>
    )
  }

  if (!criteria.length) {
    return (
      <Box bg="white" p={8} borderRadius="lg" boxShadow="sm">
        <Heading size="md">No criteria found</Heading>
        <Text mt={2} color="gray.600">Please create a session with criteria first.</Text>
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
          <Heading size="md">Value Functions</Heading>
          <Text fontSize="sm" color="gray.600">
            Define value function for criterion levels through mid-value splitting method or free design.
          </Text>
          {isSessionLocked && (
            <Text fontSize="xs" color="orange.600">
              Session is locked. Editing is disabled.
            </Text>
          )}
        </VStack>
        <VStack spacing={3} align="stretch">
          {criteria.filter(c => !c.is_qualitative).map((criterion, idx) => {
            const name = criterion.criterion_name || `Criterion ${idx + 1}`
            const entry = valueFunctions[name]
            const isActive = active === name
            
            // Mark as done based on mode:
            // - Mid-splitting: user skipped or filled indifference points
            // - Free edit: user actively chose this mode (can't skip in free edit)
            const done = entry && (
              (entry.mode === 'mid-splitting' && (
                entry.midSplit?.skipFirst === true || 
                entry.midSplit?.step1 !== null
              )) ||
              (entry.mode === 'free-edit')
            )
            
            return (
              <Box
                key={name}
                p={3}
                borderRadius="md"
                cursor="pointer"
                bg={isActive ? 'blue.500' : done ? 'green.100' : 'white'}
                borderWidth="1px"
                borderColor={isActive ? 'blue.600' : done ? 'green.300' : 'gray.300'}
                _hover={{ shadow: 'sm' }}
                onClick={() => setActive(name)}
              >
                <HStack justify="space-between">
                  <Text
                    fontWeight="bold"
                    color={isActive ? 'white' : 'black'}
                    fontSize="sm"
                    isTruncated
                    flex={1}
                  >
                    {idx + 1}. {name}
                  </Text>
                  {done ? (
                    <CheckCircleIcon w={4} h={4} color={isActive ? 'white' : 'green.500'} />
                  ) : (
                    <CloseIcon w={3} h={3} color={isActive ? 'whiteAlpha.800' : 'red.500'} />
                  )}
                </HStack>
              </Box>
            )
          })}
        </VStack>
      </Box>

      {/* Main Content */}
      <Box
        flex={1}
        bg="white"
        p={4}
        maxH="100vh"
        overflowY="auto"
      >
        {activeData ? (
            <VStack align="stretch" spacing={5}>
              <VStack align="stretch" spacing={3}>
                <Heading size="md">{active}</Heading>
                <Box bg="gray.50" p={3} borderRadius="md" border="1px solid" borderColor="gray.200">
                  <Text fontSize="sm" fontWeight="semibold" mb={2}>
                    RANGE: [{activeData.range.min} – {activeData.range.max}]
                  </Text>
                  {(() => {
                    const activeCriterion = criteria.find((c) => (c.criterion_name || `Criterion ${criteria.indexOf(c) + 1}`) === active)
                    if (activeCriterion) {
                      return (
                        <>
                          {activeCriterion.unit && (
                            <Text fontSize="sm" color="gray.700">
                              <strong>Unit:</strong> {activeCriterion.unit}
                            </Text>
                          )}
                          {activeCriterion.description && (
                            <Text fontSize="sm" color="gray.700">
                              <strong>Description:</strong> {activeCriterion.description}
                            </Text>
                          )}
                        </>
                      )
                    }
                    return null
                  })()}
                </Box>
              </VStack>

              <Box>
                <FormLabel fontWeight="bold" mb={3}>Editing Method</FormLabel>
                <HStack spacing={2}>
                  <Button
                    variant={activeData.mode === MODE.MID ? 'solid' : 'outline'}
                    colorScheme="blue"
                    isDisabled={activeData.shape.startsWith('gaussian')}
                    onClick={() => {
                      markDirty((prev) => ({
                        ...prev,
                        [active]: { ...prev[active], mode: MODE.MID },
                      }))
                    }}
                  >
                    Mid-splitting
                  </Button>
                  <Button
                    variant={activeData.mode === MODE.FREE ? 'solid' : 'outline'}
                    colorScheme="blue"
                    onClick={() => {
                      markDirty((prev) => ({
                        ...prev,
                        [active]: { ...prev[active], mode: MODE.FREE },
                      }))
                    }}
                  >
                    Free Edit
                  </Button>
                </HStack>
              </Box>

              <Box>
                <FormLabel fontWeight="bold">Shape</FormLabel>
                <RadioGroup value={activeData.shape} onChange={handleShapeChange}>
                  <Stack direction="column" spacing={2}>
                    {SHAPES.map((opt) => (
                      <Tooltip key={opt.value} label={opt.helper} placement="right">
                        <Radio value={opt.value}>{opt.label}</Radio>
                      </Tooltip>
                    ))}
                  </Stack>
                </RadioGroup>
              </Box>

              <SimpleGrid columns={[1, 2]} spacing={4}>
                <FormControl>
                  <FormLabel>Low threshold</FormLabel>
                  <Tooltip
                    isOpen={clampHint?.field === 'low'}
                    label={`Auto-clamped to ${clampHint?.value}`}
                    placement="top"
                  >
                    <Input
                      key={`low-${activeData.thresholds.low}`}
                      type="number"
                      defaultValue={activeData.thresholds.low}
                      onBlur={(e) => {
                        const num = parseFloat(e.target.value)
                        if (Number.isFinite(num)) handleThresholdChange('low', num)
                      }}
                    />
                  </Tooltip>
                </FormControl>
                <FormControl>
                  <FormLabel>High threshold</FormLabel>
                  <Tooltip
                    isOpen={clampHint?.field === 'high'}
                    label={`Auto-clamped to ${clampHint?.value}`}
                    placement="top"
                  >
                    <Input
                      key={`high-${activeData.thresholds.high}`}
                      type="number"
                      defaultValue={activeData.thresholds.high}
                      onBlur={(e) => {
                        const num = parseFloat(e.target.value)
                        if (Number.isFinite(num)) handleThresholdChange('high', num)
                      }}
                    />
                  </Tooltip>
                </FormControl>
              </SimpleGrid>

              {activeData.mode === MODE.MID ? (
                <VStack align="stretch" spacing={4}>
                  <Box>
                    <Flex align="center" justify="space-between" mb={3}>
                      <FormLabel m={0} fontWeight="bold">Indifference point 0.5</FormLabel>
                      <HStack>
                        <Text fontSize="sm" color="gray.600">Skip</Text>
                        <Checkbox
                          isChecked={activeData.midSplit.skipFirst}
                          onChange={(e) => handleSkipStep('skipFirst', e.target.checked)}
                        />
                      </HStack>
                    </Flex>
                    {!activeData.midSplit.skipFirst && (
                      <VStack align="stretch" spacing={2}>
                        <Text fontSize="sm" color="gray.700">
                          At which point X increasing <strong>{active}</strong> from <strong>{activeData.range.min}</strong> to <strong>X</strong> has the same importance as increasing it from <strong>X</strong> to <strong>{activeData.range.max}</strong>?
                        </Text>
                        <Input
                          key={`mid-step1-${activeData.midSplit.step1 ?? 'blank'}`}
                          type="number"
                          defaultValue={activeData.midSplit.step1 ?? ''}
                          placeholder="Enter X"
                          onBlur={(e) => {
                            const num = parseFloat(e.target.value)
                            if (Number.isFinite(num)) handleMidSplitChange('step1', num, true)
                          }}
                        />
                      </VStack>
                    )}
                  </Box>

                  {!activeData.midSplit.skipFirst && (
                    <>
                      <Divider />
                      <Box>
                        <Flex align="center" justify="space-between" mb={3}>
                          <FormLabel m={0} fontWeight="bold">Indifference point 0.25</FormLabel>
                          <HStack>
                            <Text fontSize="sm" color="gray.600">Skip</Text>
                            <Checkbox
                              isChecked={activeData.midSplit.skipSecond}
                              onChange={(e) => handleSkipStep('skipSecond', e.target.checked)}
                            />
                          </HStack>
                        </Flex>
                        {!activeData.midSplit.skipSecond && (
                          <VStack align="stretch" spacing={2}>
                            <Text fontSize="sm" color="gray.700">
                              At which point X increasing <strong>{active}</strong> from <strong>{activeData.range.min}</strong> to <strong>X</strong> has the same importance as increasing it from <strong>X</strong> to <strong>{activeData.midSplit.step1 ?? activeData.range.max}</strong>?
                            </Text>
                            <Input
                              key={`mid-step2-${activeData.midSplit.step2 ?? 'blank'}`}
                              type="number"
                              defaultValue={activeData.midSplit.step2 ?? ''}
                              placeholder="Enter X"
                              onBlur={(e) => {
                                const num = parseFloat(e.target.value)
                                if (Number.isFinite(num)) handleMidSplitChange('step2', num, true)
                              }}
                            />
                          </VStack>
                        )}
                      </Box>

                      <Divider />
                      <Box>
                        <Flex align="center" justify="space-between" mb={3}>
                          <FormLabel m={0} fontWeight="bold">Indifference point 0.75</FormLabel>
                          <HStack>
                            <Text fontSize="sm" color="gray.600">Skip</Text>
                            <Checkbox
                              isChecked={activeData.midSplit.skipThird}
                              onChange={(e) => handleSkipStep('skipThird', e.target.checked)}
                            />
                          </HStack>
                        </Flex>
                        {!activeData.midSplit.skipThird && (
                          <VStack align="stretch" spacing={2}>
                            <Text fontSize="sm" color="gray.700">
                              At which point X increasing <strong>{active}</strong> from <strong>X</strong> to <strong>{activeData.range.max}</strong> has the same importance as increasing it from <strong>{activeData.range.min}</strong> to <strong>X</strong>?
                            </Text>
                            <Input
                              key={`mid-step3-${activeData.midSplit.step3 ?? 'blank'}`}
                              type="number"
                              defaultValue={activeData.midSplit.step3 ?? ''}
                              placeholder="Enter X"
                              onBlur={(e) => {
                                const num = parseFloat(e.target.value)
                                if (Number.isFinite(num)) handleMidSplitChange('step3', num, true)
                              }}
                            />
                          </VStack>
                        )}
                      </Box>
                    </>
                  )}
                  <Text fontSize="sm" color="gray.600">Skipping indifference point 0.5 keeps the function linear. Points 0.25 and 0.75 add curve refinement.</Text>
                </VStack>
              ) : (
                <VStack align="stretch" spacing={3}>
                  <HStack justify="space-between">
                    <Button size="sm" onClick={handleAddPoint}>Add point</Button>
                    <Text fontSize="sm" color="gray.500">Max 10 points. Endpoints stay in range.</Text>
                  </HStack>
                  {activeData.points.map((p, idx) => (
                    <HStack key={`${idx}-${p.x}`} spacing={3} align="center">
                      <Text fontSize="sm" color="gray.600">Point {idx + 1}</Text>
                      <NumberInput
                        value={p.x}
                        min={activeData.range.min}
                        max={activeData.range.max}
                        onChange={(val, num) => handlePointChange(idx, 'x', num)}
                      >
                        <NumberInputField placeholder="X" />
                      </NumberInput>
                      <NumberInput
                        value={p.y}
                        min={0}
                        max={1}
                        step={0.05}
                        onChange={(val, num) => handlePointChange(idx, 'y', num)}
                      >
                        <NumberInputField placeholder="Y" />
                      </NumberInput>
                      {idx !== 0 && idx !== activeData.points.length - 1 && (
                        <Button size="xs" colorScheme="red" variant="ghost" onClick={() => handleRemovePoint(idx)}>Remove</Button>
                      )}
                    </HStack>
                  ))}
                </VStack>
              )}

              <ValueFunctionPlot
                range={activeData.range}
                points={activeData.points}
                thresholds={activeData.thresholds}
                shape={activeData.shape}
                draggable={!isSessionLocked && activeData.mode === MODE.FREE && (activeData.shape === 'linear_increasing' || activeData.shape === 'linear_decreasing')}
                onDrag={activeData.mode === MODE.FREE ? handleDragPoint : undefined}
              />

              <Box>
                <Heading size="sm" mb={2}>Stored points</Heading>
                <Box
                  bg="gray.50"
                  p={3}
                  borderRadius="md"
                  border="1px solid"
                  borderColor="gray.200"
                  maxH="120px"
                  overflowY="auto"
                  overflowX="auto"
                  whiteSpace="nowrap"
                >
                  <Text fontFamily="mono" fontSize="sm" display="inline">
                    {formatPointsForCsv(activeData.points)}
                  </Text>
                </Box>
              </Box>
            </VStack>
          ) : (
            <VStack spacing={4} align="center" justify="center" minH="60vh">
              <Heading size="lg">Select a Criterion to Begin</Heading>
              <Text color="gray.600" fontSize="lg">
                Click on a criterion in the sidebar to define its value function
              </Text>
            </VStack>
          )}
      </Box>
    </HStack>
  )
}

export default ValueFunctionsPage
