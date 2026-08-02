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
  Select,
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
import { CheckCircleIcon, WarningIcon, CloseIcon, QuestionIcon, LockIcon, ArrowUpIcon, ArrowDownIcon } from '@chakra-ui/icons'
import axios from 'axios'
import { useEffect, useMemo, useRef, useState } from 'react'
import { parseDistribution, computeDistributionBounds } from '../utils/distributionUtils'
import { API_URL } from '../config'
import QuestionPrompt from '../components/QuestionPrompt'

const SHAPES = [
  { value: 'linear_increasing', label: 'Piecewise linear increasing', helper: 'Starts at 0 and rises to 1.' },
  { value: 'linear_decreasing', label: 'Piecewise linear decreasing', helper: 'Starts at 1 and falls to 0.' },
]

const MODE = {
  MID: 'mid-splitting',
  FREE: 'free-edit',
}

const CLAMP_FIELD_LABELS = {
  low: 'Low threshold',
  high: 'High threshold',
  step1: 'Step 3 value',
  step2: 'Step 4 value',
  step3: 'Step 5 value',
}

const clamp = (v, min, max) => {
  const num = Number.isFinite(v) ? v : min
  return Math.min(Math.max(num, min), max)
}

const sortByX = (pts) => [...pts].sort((a, b) => a.x - b.x)

const deriveRange = (criterion) => {
  // Check if custom min/max values are provided
  if (criterion.use_custom_min_max) {
    const minVal = Number(criterion.min_value)
    const maxVal = Number(criterion.max_value)
    if (Number.isFinite(minVal) && Number.isFinite(maxVal) && minVal < maxVal) {
      return { min: minVal, max: maxVal }
    }
  }
  
  // Fall back to computing from alternatives data
  const alternatives = criterion.alternatives || []
  const bounds = []
  
  // Try to extract ranges from distributions first
  for (const alt of alternatives) {
    const valueStr = alt.value || ''
    const dist = parseDistribution(valueStr)
    
    if (dist) {
      // It's a distribution - compute bounds
      const bounds_computed = computeDistributionBounds(dist)
      bounds.push(bounds_computed.min, bounds_computed.max)
    } else {
      // Try to parse as plain number
      const num = Number(valueStr)
      if (Number.isFinite(num)) {
        bounds.push(num)
      }
    }
  }
  
  if (bounds.length === 0) {
    return { min: 0, max: 1 }
  }
  
  return {
    min: Math.min(...bounds),
    max: Math.max(...bounds)
  }
}

const defaultPointsForShape = (shape, range, gaussian) => {
  if (shape === 'linear_decreasing') return sortByX([{ x: range.min, y: 1 }, { x: range.max, y: 0 }])
  return sortByX([{ x: range.min, y: 0 }, { x: range.max, y: 1 }])
}

const getThresholdHelpText = (thresholdKey, shape) => {
  const isIncreasing = shape === 'linear_increasing'
  const isLowThreshold = thresholdKey === 'low'

  if (isIncreasing) {
    return isLowThreshold
      ? 'For an increasing criterion, this is the lower cutoff: values at or below it are already at the worst end of the scale, so lower values do not change the value any further. Above it, the criterion starts to improve.'
      : 'For an increasing criterion, this is the upper cutoff: values at or above it are already at the best end of the scale, so higher values do not change the value any further. Below it, the criterion is still improving.'
  }

  return isLowThreshold
    ? 'For a decreasing criterion, this is the lower cutoff: values at or below it are already at the best end of the scale, so lower values do not change the value any further. Above it, the criterion starts to get worse.'
    : 'For a decreasing criterion, this is the upper cutoff: values at or above it are already at the worst end of the scale, so higher values do not change the value any further. Below it, the criterion is still improving.'
}

function ThresholdLabel({ label, thresholdKey, shape }) {
  return (
    <HStack spacing={1} mb={2}>
      <FormLabel fontSize="sm" m={0} fontWeight="medium">{label}</FormLabel>
      <Tooltip label={getThresholdHelpText(thresholdKey, shape)} placement="top" hasArrow>
        <QuestionIcon color="gray.500" boxSize={3} cursor="help" />
      </Tooltip>
    </HStack>
  )
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
  if (midSplit.skipFirst || midSplit.step1 === null || midSplit.step1 === undefined) return anchors

  const pts = [...anchors]
  const increasing = shape === 'linear_increasing'

  pts.push({ x: midSplit.step1, y: 0.5 })

  if (!midSplit.skipSecond && midSplit.step2 !== null && midSplit.step2 !== undefined) {
    pts.push({ x: midSplit.step2, y: increasing ? 0.25 : 0.75 })
  }

  if (!midSplit.skipThird && midSplit.step3 !== null && midSplit.step3 !== undefined) {
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

function ValueFunctionPlot({ range, points, thresholds, onDrag, draggable, shape, confidence = 4 }) {
  const svgRef = useRef(null)
  const clipIdRef = useRef(`plot-clip-${Math.random().toString(36).substr(2, 9)}`)
  const dragOffsetRef = useRef({ x: 0, y: 0 })
  const [dragIndex, setDragIndex] = useState(null)

  const width = 620
  const height = 260

  // Calculate confidence margin based on confidence level
  const getConfidenceMargin = (conf) => {
    if (conf === 4) return 0
    if (conf === 3) return 0.025
    if (conf === 2) return 0.05
    if (conf === 1) return 0.075
    if (conf === 0) return 0.1
    return 0
  }

  const margin = getConfidenceMargin(confidence)

  const toSvgX = (x) => ((x - range.min) / (range.max - range.min || 1)) * (width - 40) + 20
  const toSvgY = (y) => height - 20 - y * (height - 40)
  const toSvgCoords = (clientX, clientY, rect) => {
    const safeWidth = rect.width || 1
    const safeHeight = rect.height || 1
    return {
      x: ((clientX - rect.left) / safeWidth) * width,
      y: ((clientY - rect.top) / safeHeight) * height,
    }
  }

  const fromSvg = (svgX, svgY) => {
    const xRatio = clamp((svgX - 20) / (width - 40), 0, 1)
    const yRatio = clamp((height - 20 - svgY) / (height - 40), 0, 1)
    const x = range.min + xRatio * (range.max - range.min)
    const y = yRatio
    return { x, y }
  }

  const handlePointerDown = (idx) => (event) => {
    if (!draggable) return
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || !points[idx]) return

    const pointerSvg = toSvgCoords(event.clientX, event.clientY, rect)
    const pointSvg = {
      x: toSvgX(points[idx].x),
      y: toSvgY(points[idx].y),
    }

    dragOffsetRef.current = {
      x: pointerSvg.x - pointSvg.x,
      y: pointerSvg.y - pointSvg.y,
    }

    setDragIndex(idx)
    event.preventDefault()
  }

  const handlePointerMove = (event) => {
    if (dragIndex === null || !draggable || !onDrag) return
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const pointerSvg = toSvgCoords(event.clientX, event.clientY, rect)
    const anchoredSvg = {
      x: pointerSvg.x - dragOffsetRef.current.x,
      y: pointerSvg.y - dragOffsetRef.current.y,
    }
    const { x, y } = fromSvg(anchoredSvg.x, anchoredSvg.y)
    onDrag(dragIndex, { x, y })
  }

  const handlePointerUp = () => {
    setDragIndex(null)
    dragOffsetRef.current = { x: 0, y: 0 }
  }

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

  // Create upper and lower paths for confidence band
  // Don't clamp - let the SVG naturally clip at boundaries to maintain band width
  const upperPath = points
    .map((p, idx) => {
      const yUpper = p.y + margin
      return `${idx === 0 ? 'M' : 'L'} ${toSvgX(p.x)} ${toSvgY(yUpper)}`
    })
    .join(' ')

  const lowerPath = points
    .slice()
    .reverse()
    .map((p) => {
      const yLower = p.y - margin
      return `L ${toSvgX(p.x)} ${toSvgY(yLower)}`
    })
    .join(' ')

  const bandPath = margin > 0 ? `${upperPath} ${lowerPath} Z` : ''

  const thresholdXs = [thresholds?.low, thresholds?.high].filter((v) => Number.isFinite(v))

  return (
    <Box border="1px solid" borderColor="gray.200" borderRadius="md" p={4} bg="gray.50">
      <svg ref={svgRef} width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <clipPath id={clipIdRef.current}>
            <rect x={20} y={20} width={width - 40} height={height - 40} />
          </clipPath>
        </defs>
        <rect x={0} y={0} width={width} height={height} fill="transparent" />
        <line x1={20} y1={height - 20} x2={width - 20} y2={height - 20} stroke="#A0AEC0" strokeWidth="1" />
        <line x1={20} y1={20} x2={20} y2={height - 20} stroke="#A0AEC0" strokeWidth="1" />
        <g clipPath={`url(#${clipIdRef.current})`}>
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
          {bandPath && <path d={bandPath} fill="rgba(43, 108, 176, 0.15)" stroke="none" />}
          <path d={linePath} stroke="#2B6CB0" strokeWidth="2" fill="none" />
        </g>
        {points.map((p, idx) => (
          <g key={`${p.x}-${idx}`}>
            {draggable && dragIndex === idx && (
              <>
                <rect
                  x={toSvgX(p.x) - 34}
                  y={Math.max(2, toSvgY(p.y) - 30)}
                  width={68}
                  height={18}
                  rx={4}
                  fill="rgba(26, 32, 44, 0.85)"
                />
                <text
                  x={toSvgX(p.x)}
                  y={Math.max(14, toSvgY(p.y) - 17)}
                  textAnchor="middle"
                  fontSize="10"
                  fill="#F7FAFC"
                  fontWeight="600"
                >
                  ({p.x.toFixed(2)}, {p.y.toFixed(2)})
                </text>
              </>
            )}
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

function ValueFunctionsPage({ sessionId, onPageChange }) {
  const [criteria, setCriteria] = useState([])
  const [valueFunctions, setValueFunctions] = useState({})
  const [active, setActive] = useState(null)
  const [midFlowStep, setMidFlowStep] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  const [clampHint, setClampHint] = useState(null)
  const [isSessionLocked, setIsSessionLocked] = useState(false)
  const [isBwtLockActive, setIsBwtLockActive] = useState(false)
  const midStep1InputRef = useRef(null)
  const midStep2InputRef = useRef(null)
  const midStep3InputRef = useRef(null)
  const toast = useToast()

  useEffect(() => {
    const fetchSession = async () => {
      try {
        const res = await axios.get(`${API_URL}/session/${sessionId}`)
        const session = res.data
        const practitionerLock = session?.session_locked || false
        const bwtLock = Boolean(session?.bwt?.qi_vf_lock_active)
        setIsSessionLocked(practitionerLock || bwtLock)
        setIsBwtLockActive(bwtLock)
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
          const confidence = persisted.confidence ?? 4
          const midSplit = {
            step1: persisted.midSplit?.step1 ?? null,
            step2: persisted.midSplit?.step2 ?? null,
            step3: persisted.midSplit?.step3 ?? null,
            skipFirst: persisted.midSplit?.skipFirst ?? false,
            skipSecond: persisted.midSplit?.skipSecond ?? false,
            skipThird: persisted.midSplit?.skipThird ?? false,
            directionAnswered: persisted.midSplit?.directionAnswered ?? false,
          }

          // Determine mode from criterion setting
          const mode = criterion.use_mid_splitting !== false ? MODE.MID : MODE.FREE
          const freeEditConfigured = persisted.freeEditConfigured ?? false

          let points = persisted.points
          if (!Array.isArray(points) || points.length === 0) {
            if (mode === MODE.MID) {
              points = buildMidSplitPoints(range, shape, midSplit, thresholds)
            } else {
              points = defaultPointsForShape(shape, range, gaussian)
            }
          }

          // Apply threshold anchors for linear shapes so extrema follow low/high
          if (shape === 'linear_increasing' || shape === 'linear_decreasing') {
            points = mode === MODE.MID
              ? buildMidSplitPoints(range, shape, midSplit, thresholds)
              : buildThresholdAnchors(shape, thresholds, range)
          }

          vf[name] = {
            shape,
            thresholds,
            mode,
            midSplit,
            freeEditConfigured,
            gaussian,
            points: clampPointsToRange(points, range),
            range,
            confidence,
            lastUpdated: persisted.lastUpdated || null,
          }
        })
        setValueFunctions(vf)
        setActive(null)
      } catch (error) {
        toast({
          title: 'Request failed',
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
  const currentMidStep = active ? (midFlowStep[active] ?? 0) : 0
  const hasClampWarning = Boolean(clampHint)
  const clampHintText = useMemo(() => {
    if (!clampHint) return null
    const label = CLAMP_FIELD_LABELS[clampHint.field] || 'Value'
    return `${label} was outside allowed bounds and adjusted to ${clampHint.value}. Enter a valid value to continue.`
  }, [clampHint])

  useEffect(() => {
    // Reset field warnings when switching criterion.
    setClampHint(null)
  }, [active])

  useEffect(() => {
    if (!active || !activeData || activeData.mode !== MODE.MID) return
    if (midFlowStep[active] !== undefined) return
    const ms = activeData.midSplit || {}
    let initialStep = 0
    if (ms.directionAnswered) {
      initialStep = 1
      if (ms.skipFirst) {
        initialStep = 5
      } else if (ms.step1 !== null) {
        const secondDone = ms.skipSecond || ms.step2 !== null
        const thirdDone = ms.skipThird || ms.step3 !== null
        if (!secondDone) {
          initialStep = 3
        } else if (!thirdDone) {
          initialStep = 4
        } else {
          initialStep = 5
        }
      } else {
        initialStep = 2
      }
    }
    setMidFlowStep((prev) => ({ ...prev, [active]: initialStep }))
  }, [active, activeData, midFlowStep])

  const setCurrentMidStep = (nextStep) => {
    if (!active) return
    setMidFlowStep((prev) => ({
      ...prev,
      [active]: Math.min(Math.max(nextStep, 0), 5),
    }))
  }

  const handleDirectionChange = (shape) => {
    if (!activeData) return
    markDirty((prev) => {
      const updated = { ...prev }
      const entry = { ...updated[active] }
      entry.shape = shape
      entry.midSplit = {
        ...entry.midSplit,
        directionAnswered: true,
      }
      entry.mode = MODE.MID
      entry.points = buildMidSplitPoints(entry.range, shape, entry.midSplit, entry.thresholds)
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
    } else if (clampHint?.field === key) {
      setClampHint(null)
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
      if (nextEntry.mode === MODE.FREE) {
        nextEntry.freeEditConfigured = true
      }

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

    // Empty input means remove this indifference point.
    if (valueNum === null) {
      if (clampHint?.field === stepKey) setClampHint(null)
      markDirty((prev) => {
        const updated = { ...prev }
        const newMidSplit = { ...updated[active].midSplit, [stepKey]: null }
        if (stepKey === 'step1') {
          // Step 2 and 3 depend on step 1.
          newMidSplit.step2 = null
          newMidSplit.step3 = null
        }
        const points = buildMidSplitPoints(range, shape, newMidSplit, updated[active].thresholds)
        updated[active] = { ...updated[active], midSplit: newMidSplit, mode: MODE.MID, points }
        return updated
      })
      return
    }

    let finalValue = valueNum ?? thresholds.low
    const originalValue = valueNum
    const span = Math.max(range.max - range.min, 1)
    const strictGap = Math.max(span * 1e-6, 1e-9)
    
    if (shouldClamp) {
      // Enforce indifference point constraints based on threshold-relative logic
      if (stepKey === 'step1') {
        // Step 1 (0.5 point): must be strictly between low and high thresholds
        const minVal = thresholds.low + strictGap
        const maxVal = thresholds.high - strictGap
        finalValue = clamp(finalValue, minVal, maxVal)
      } else if (stepKey === 'step2') {
        // Step 2: strictly between low threshold and step1
        const reference = midSplit.step1 ?? thresholds.high
        const minVal = thresholds.low + strictGap
        const maxVal = reference - strictGap
        finalValue = clamp(finalValue, minVal, maxVal)
      } else if (stepKey === 'step3') {
        // Step 3: strictly between step1 and high threshold
        const reference = midSplit.step1 ?? thresholds.low
        const minVal = reference + strictGap
        const maxVal = thresholds.high - strictGap
        finalValue = clamp(finalValue, minVal, maxVal)
      }

      if (Number.isFinite(originalValue) && finalValue !== originalValue) {
        setClampHint({ field: stepKey, value: finalValue })
      } else if (clampHint?.field === stepKey) {
        setClampHint(null)
      }
    }
    
    markDirty((prev) => {
      const updated = { ...prev }
      const previousMidSplit = updated[active].midSplit || {}
      const newMidSplit = { ...previousMidSplit, [stepKey]: finalValue }

      // Step 2/3 are conditional on step1. If step1 changes after going back,
      // invalidate downstream indifference points to avoid inconsistent state.
      if (stepKey === 'step1' && previousMidSplit.step1 !== finalValue) {
        newMidSplit.step2 = null
        newMidSplit.step3 = null
        newMidSplit.skipSecond = false
        newMidSplit.skipThird = false
      }

      // If user provides a value for a previously skipped step, re-enable it.
      if (stepKey === 'step2' && finalValue !== null && finalValue !== undefined) {
        newMidSplit.skipSecond = false
      }
      if (stepKey === 'step3' && finalValue !== null && finalValue !== undefined) {
        newMidSplit.skipThird = false
      }

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
      if (stepKey === 'skipSecond' && value) {
        ms.step2 = null
      }
      if (stepKey === 'skipThird' && value) {
        ms.step3 = null
      }
      const points = buildMidSplitPoints(range, shape, ms, activeData.thresholds)
      updated[active] = { ...updated[active], midSplit: ms, mode: MODE.MID, points }
      return updated
    })
  }

  const handleMidNext = () => {
    if (!activeData) return
    if (currentMidStep === 0) {
      if (!activeData.midSplit?.directionAnswered) return
      setCurrentMidStep(1) // Go to confidence/thresholds
      return
    }
    if (currentMidStep === 1) {
      // From confidence/thresholds, go to step 1 (0.5 midpoint)
      setCurrentMidStep(2)
      return
    }
    if (currentMidStep === 2) {
      const typedStep1 = commitMidInputForStep('step1')
      if (activeData.midSplit?.skipFirst) {
        setCurrentMidStep(5)
        return
      }
      if (!(typedStep1 !== null || activeData.midSplit?.step1 !== null)) return
      setCurrentMidStep(3)
      return
    }
    if (currentMidStep === 3) {
      const typedStep2 = commitMidInputForStep('step2')
      if (activeData.midSplit?.skipSecond) {
        setCurrentMidStep(4)
        return
      }
      if (!(typedStep2 !== null || activeData.midSplit?.step2 !== null)) return
      setCurrentMidStep(4)
      return
    }
    if (currentMidStep === 4) {
      const typedStep3 = commitMidInputForStep('step3')
      if (activeData.midSplit?.skipThird || activeData.midSplit?.step3 !== null || typedStep3 !== null) {
        setCurrentMidStep(5)
        toast({
          title: 'Criterion completed',
          status: 'success',
          duration: 1200,
          isClosable: true,
        })
      }
    }
  }

  const handleMidDone = () => {
    if (!activeData) return
    const typedStep3 = commitMidInputForStep('step3')
    if (activeData.midSplit?.skipFirst) {
      setCurrentMidStep(5)
      toast({
        title: 'Criterion completed',
        status: 'success',
        duration: 1200,
        isClosable: true,
      })
      return
    }
    const secondDone = activeData.midSplit?.skipSecond || activeData.midSplit?.step2 !== null
    const thirdDone = activeData.midSplit?.skipThird || activeData.midSplit?.step3 !== null || typedStep3 !== null
    if (secondDone && thirdDone) {
      setCurrentMidStep(5)
      toast({
        title: 'Criterion completed',
        status: 'success',
        duration: 1200,
        isClosable: true,
      })
    }
  }

  const handleSkipCurrentStep = () => {
    if (!activeData) return
    if (currentMidStep === 2) {
      handleSkipStep('skipFirst', true)
      setCurrentMidStep(5)
      return
    }
    if (currentMidStep === 3) {
      handleSkipStep('skipSecond', true)
      setCurrentMidStep(4)
      return
    }
    if (currentMidStep === 4) {
      handleSkipStep('skipThird', true)
      setCurrentMidStep(5)
      return
    }
  }

  const commitMidInputForStep = (stepKey) => {
    const refMap = {
      step1: midStep1InputRef,
      step2: midStep2InputRef,
      step3: midStep3InputRef,
    }
    const inputRef = refMap[stepKey]
    const raw = inputRef?.current?.value?.trim()
    if (raw === undefined) return null
    if (raw === '') {
      handleMidSplitChange(stepKey, null, false)
      return null
    }
    const num = parseFloat(raw)
    if (Number.isFinite(num)) {
      handleMidSplitChange(stepKey, num, true)
      return num
    }
    return null
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
      updated[active] = {
        ...updated[active],
        points: lockLinearEndpoints(clamped, shape, range),
        mode: MODE.FREE,
        freeEditConfigured: true,
      }
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
      updated[active] = {
        ...updated[active],
        points: lockLinearEndpoints(adjusted, shape, range),
        mode: MODE.FREE,
        freeEditConfigured: true,
      }
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
      const epsilon = Math.max((range.max - range.min) * 0.0001, 1e-9)
      let nextX = clamp(coords.x, range.min, range.max)
      const nextY = clamp(coords.y, 0, 1)

      if (idx > 0) {
        nextX = Math.max(nextX, pts[idx - 1].x + epsilon)
      }
      if (idx < pts.length - 1) {
        nextX = Math.min(nextX, pts[idx + 1].x - epsilon)
      }

      pts[idx] = { x: nextX, y: nextY }
      const monotonic = shape === 'linear_increasing' || shape === 'linear_decreasing'
      if (idx === 0 || idx === pts.length - 1) return updated
      entry.points = lockLinearEndpoints(
        monotonic ? enforceMonotonic(pts, shape === 'linear_increasing') : pts,
        shape,
        range,
      )
      entry.mode = MODE.FREE
      entry.freeEditConfigured = true
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
        freeEditConfigured: true,
      }
      return updated
    })
  }

  const handleConfidenceChange = (valueStr) => {
    if (!activeData) return
    const confidence = parseInt(valueStr, 10)
    if (confidence < 0 || confidence > 4) return
    markDirty((prev) => ({
      ...prev,
      [active]: {
        ...prev[active],
        confidence,
        freeEditConfigured: prev[active].mode === MODE.FREE ? true : prev[active].freeEditConfigured,
      },
    }))
  }

  const nonQualCriteria = useMemo(
    () => criteria.filter((criterion) => !criterion.is_qualitative),
    [criteria],
  )

  const progress = useMemo(() => {
    if (!nonQualCriteria.length) return 0
    const filled = nonQualCriteria.filter((c) => {
      const name = c.criterion_name || `Criterion ${criteria.indexOf(c) + 1}`
      const entry = valueFunctions[name]
      if (!entry) return false
      if (entry.mode === MODE.FREE) {
          return entry.freeEditConfigured === true
      }
      if (entry.midSplit?.directionAnswered !== true) return false
      if (entry.midSplit?.skipFirst === true) return true
        const otherDone = entry.midSplit?.skipThird === true || entry.midSplit?.step3 !== null
        return entry.midSplit?.step1 !== null && otherDone
    }).length
    return Math.round((filled / nonQualCriteria.length) * 100)
  }, [criteria, nonQualCriteria, valueFunctions])

  const activeCriterionIndex = useMemo(() => {
    if (!active) return -1
    return nonQualCriteria.findIndex((criterion, idx) => {
      const name = criterion.criterion_name || `Criterion ${idx + 1}`
      return name === active
    })
  }, [active, nonQualCriteria])

  useEffect(() => {
    if (active || nonQualCriteria.length === 0) return
    const first = nonQualCriteria[0]
    const firstName = first.criterion_name || 'Criterion 1'
    setActive(firstName)
  }, [active, nonQualCriteria])

  const handleNavigateCriterion = (direction) => {
    if (activeCriterionIndex < 0) return
    const nextIndex = activeCriterionIndex + direction
    if (nextIndex < 0 || nextIndex >= nonQualCriteria.length) return
    const target = nonQualCriteria[nextIndex]
    const targetName = target.criterion_name || `Criterion ${nextIndex + 1}`
    setActive(targetName)
  }

  const handleNextCriterion = () => {
    if (!active || !activeData) return
    if (activeData.mode === MODE.FREE && activeData.freeEditConfigured !== true) {
      markDirty((prev) => ({
        ...prev,
        [active]: {
          ...prev[active],
          freeEditConfigured: true,
        },
      }))
    }
    handleNavigateCriterion(1)
  }

  if (loading) {
    return (
      <Flex align="center" justify="center" minH="60vh">
        <Spinner size="lg" mr={3} />
        <Text>Loading quantitative indicators...</Text>
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

  if (nonQualCriteria.length === 0) {
    return (
      <Box bg="white" p={8} borderRadius="lg" boxShadow="sm">
        <VStack spacing={4} align="stretch">
          <Heading size="lg">Quantitative Indicators</Heading>
          <Text color="gray.600">
            No quantitative indicators have been marked in the input.
          </Text>
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
          <Heading size="md">Quantitative Indicators</Heading>
          <Text fontSize="sm" color="gray.600">
            Define quantitative indicators (value functions) for each criterion using either mid-value splitting or free edit (set per criterion in Input Definition).
          </Text>
        </VStack>
        <VStack spacing={3} align="stretch">
          {criteria.filter(c => !c.is_qualitative).map((criterion, idx) => {
            const name = criterion.criterion_name || `Criterion ${idx + 1}`
            const entry = valueFunctions[name]
            const isActive = active === name
            
            const done = entry && (
              (entry.mode === MODE.MID && (
                entry.midSplit?.directionAnswered === true && (
                  entry.midSplit?.skipFirst === true || (
                    entry.midSplit?.step1 !== null &&
                    (entry.midSplit?.skipThird === true || entry.midSplit?.step3 !== null)
                  )
                )
              )) ||
              (entry.mode === MODE.FREE && entry.freeEditConfigured === true)
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
        {isSessionLocked && (
          <Box bg="yellow.50" p={3} borderRadius="md" borderLeft="4px" borderLeftColor="yellow.400" mb={4}>
            <HStack spacing={2} align="flex-start">
              <LockIcon color="yellow.800" />
              <VStack align="start" spacing={2} flex={1}>
                <Text fontSize="sm" color="yellow.800" fontWeight="semibold">
                  {isBwtLockActive
                    ? 'Quantitative Indicators are locked while weight elicitation is active.'
                    : 'Quantitative Indicators are locked by the practitioner.'}
                </Text>
                {isBwtLockActive ? (
                  <Button size="xs" variant="outline" onClick={() => onPageChange?.('pile')}>
                    Go to Weight Elicitation to unlock
                  </Button>
                ) : (
                  <Text fontSize="xs" color="yellow.800">
                    Ask the practitioner/admin to unlock this session.
                  </Text>
                )}
              </VStack>
            </HStack>
          </Box>
        )}
        {activeData ? (
            <VStack align="stretch" spacing={5}>
              <VStack align="stretch" spacing={2}>
                {(() => {
                  const activeCriterion = criteria.find((c) => (c.criterion_name || `Criterion ${criteria.indexOf(c) + 1}`) === active)
                  const unit = activeCriterion?.unit ? ` [${activeCriterion.unit}]` : ''
                  return (
                    <>
                      <Heading size="md">{active}{unit}</Heading>
                      {activeCriterion?.description && (
                        <Text fontSize="sm" color="gray.700">{activeCriterion.description}</Text>
                      )}
                    </>
                  )
                })()}
              </VStack>

              {activeData.mode === MODE.MID ? (
                <VStack align="stretch" spacing={4}>
                  <>
                    {currentMidStep === 0 && (
                      <VStack align="stretch" spacing={3}>
                        <QuestionPrompt>
                          <VStack align="stretch" spacing={3}>
                            <Text>
                              Step 1: Is the value function of <strong>{active}</strong> increasing or decreasing?
                            </Text>
                            <RadioGroup
                              value={activeData.midSplit?.directionAnswered ? activeData.shape : ''}
                              onChange={handleDirectionChange}
                            >
                              <HStack spacing={4} wrap="wrap">
                                <Radio value="linear_increasing" size="sm">
                                  <HStack spacing={1}>
                                    <ArrowUpIcon color="blue.500" />
                                    <Text>Increasing</Text>
                                  </HStack>
                                </Radio>
                                <Radio value="linear_decreasing" size="sm">
                                  <HStack spacing={1}>
                                    <ArrowDownIcon color="blue.500" />
                                    <Text>Decreasing</Text>
                                  </HStack>
                                </Radio>
                              </HStack>
                            </RadioGroup>
                          </VStack>
                        </QuestionPrompt>
                        <HStack>
                          <Button
                            colorScheme="blue"
                            onClick={handleMidNext}
                            isDisabled={!activeData.midSplit?.directionAnswered || hasClampWarning}
                          >
                            Next
                          </Button>
                        </HStack>
                      </VStack>
                    )}

                    {currentMidStep === 1 && (
                      <VStack align="stretch" spacing={3}>
                        <QuestionPrompt>
                          Step 2: Set the confidence and thresholds for <strong>{active}</strong>.
                        </QuestionPrompt>
                        <HStack spacing={4} align="flex-end" wrap="wrap">
                          <Box>
                            <HStack spacing={1} mb={2}>
                              <FormLabel fontSize="sm" m={0} fontWeight="medium">Confidence</FormLabel>
                              <Tooltip
                                label={
                                  <Box>
                                    <Text fontWeight="bold" mb={1}>Confidence Levels:</Text>
                                    <Text>0 - Not confident at all (±10%)</Text>
                                    <Text>1 - Low confidence (±7.5%)</Text>
                                    <Text>2 - Medium confidence (±5%)</Text>
                                    <Text>3 - High confidence (±2.5%)</Text>
                                    <Text>4 - Fully confident (no uncertainty)</Text>
                                  </Box>
                                }
                                placement="top"
                                hasArrow
                              >
                                <QuestionIcon color="gray.500" boxSize={3} cursor="help" />
                              </Tooltip>
                            </HStack>
                            <Select
                              value={activeData.confidence ?? 4}
                              onChange={(e) => handleConfidenceChange(e.target.value)}
                              size="sm"
                              minW="180px"
                            >
                              <option value="0">0 - Not confident (±10%)</option>
                              <option value="1">1 - Low (±7.5%)</option>
                              <option value="2">2 - Medium (±5%)</option>
                              <option value="3">3 - High (±2.5%)</option>
                              <option value="4">4 - Fully confident</option>
                            </Select>
                          </Box>
                          <FormControl maxW="150px">
                            <ThresholdLabel label="Low threshold" thresholdKey="low" shape={activeData.shape} />
                            <Input
                              key={`low-${activeData.thresholds.low}`}
                              type="number"
                              size="sm"
                              defaultValue={activeData.thresholds.low}
                              onBlur={(e) => {
                                const num = parseFloat(e.target.value)
                                if (Number.isFinite(num)) handleThresholdChange('low', num)
                              }}
                            />
                          </FormControl>
                          <FormControl maxW="150px">
                            <ThresholdLabel label="High threshold" thresholdKey="high" shape={activeData.shape} />
                            <Input
                              key={`high-${activeData.thresholds.high}`}
                              type="number"
                              size="sm"
                              defaultValue={activeData.thresholds.high}
                              onBlur={(e) => {
                                const num = parseFloat(e.target.value)
                                if (Number.isFinite(num)) handleThresholdChange('high', num)
                              }}
                            />
                          </FormControl>
                        </HStack>
                        {(clampHint?.field === 'low' || clampHint?.field === 'high') && clampHintText && (
                          <Text fontSize="xs" color="orange.600">{clampHintText}</Text>
                        )}
                        <HStack>
                          <Button variant="outline" onClick={() => setCurrentMidStep(0)}>Back</Button>
                          <Button
                            colorScheme="blue"
                            onClick={handleMidNext}
                            isDisabled={hasClampWarning}
                          >
                            Next
                          </Button>
                        </HStack>
                      </VStack>
                    )}

                    {currentMidStep === 2 && (
                      <VStack align="stretch" spacing={3}>
                        <QuestionPrompt>
                          Step 3: At which point X is equally important to {activeData.shape === 'linear_decreasing' ? 'reduce' : 'improve'} <strong>{active}</strong> from <strong>{activeData.shape === 'linear_decreasing' ? activeData.thresholds.high : activeData.thresholds.low}</strong> to <strong>X</strong> as from <strong>X</strong> to <strong>{activeData.shape === 'linear_decreasing' ? activeData.thresholds.low : activeData.thresholds.high}</strong>?
                        </QuestionPrompt>
                        {!activeData.midSplit.skipFirst && (
                          <Input
                            key={`mid-step1-${activeData.midSplit.step1 ?? 'blank'}`}
                              ref={midStep1InputRef}
                            type="number"
                            defaultValue={activeData.midSplit.step1 ?? ''}
                            placeholder="Enter X"
                            onBlur={(e) => {
                              const raw = e.target.value.trim()
                              if (raw === '') {
                                handleMidSplitChange('step1', null, false)
                                return
                              }
                              const num = parseFloat(raw)
                              if (Number.isFinite(num)) handleMidSplitChange('step1', num, true)
                            }}
                          />
                        )}
                        {clampHint?.field === 'step1' && clampHintText && (
                          <Text fontSize="xs" color="orange.600">{clampHintText}</Text>
                        )}
                        <HStack>
                          <Button variant="outline" onClick={handleSkipCurrentStep}>Skip</Button>
                          <Button variant="outline" onClick={() => setCurrentMidStep(1)} isDisabled={hasClampWarning}>Back</Button>
                          <Button
                            colorScheme="blue"
                            onClick={handleMidNext}
                            isDisabled={!(activeData.midSplit.skipFirst || activeData.midSplit.step1 !== null) || hasClampWarning}
                          >
                            Next
                          </Button>
                        </HStack>
                      </VStack>
                    )}

                    {currentMidStep === 3 && (
                      <VStack align="stretch" spacing={3}>
                        <QuestionPrompt>
                          <Text>
                            Step 4: At which point X is equally important to {activeData.shape === 'linear_decreasing' ? 'reduce' : 'improve'} <strong>{active}</strong> from <strong>{activeData.shape === 'linear_decreasing' ? activeData.midSplit.step1 ?? activeData.thresholds.high : activeData.thresholds.low}</strong> to <strong>X</strong> as from <strong>X</strong> to <strong>{activeData.shape === 'linear_decreasing' ? activeData.thresholds.low : activeData.midSplit.step1 ?? activeData.thresholds.high}</strong>?
                          </Text>
                        </QuestionPrompt>
                        {!activeData.midSplit.skipFirst && (
                          <Box>
                            <Text fontSize="sm" color="gray.700" mb={1}>
                              Enter the second indifference point.
                            </Text>
                            <Input
                              key={`mid-step2-${activeData.midSplit.step2 ?? 'blank'}`}
                                ref={midStep2InputRef}
                              type="number"
                              defaultValue={activeData.midSplit.step2 ?? ''}
                              placeholder="Enter X"
                              onBlur={(e) => {
                                const raw = e.target.value.trim()
                                if (raw === '') {
                                  handleMidSplitChange('step2', null, false)
                                  return
                                }
                                const num = parseFloat(raw)
                                if (Number.isFinite(num)) handleMidSplitChange('step2', num, true)
                              }}
                            />
                          </Box>
                        )}
                        {clampHint?.field === 'step2' && clampHintText && (
                          <Text fontSize="xs" color="orange.600">{clampHintText}</Text>
                        )}
                        <HStack>
                          <Button variant="outline" onClick={handleSkipCurrentStep} isDisabled={hasClampWarning}>Skip</Button>
                          <Button variant="outline" onClick={() => setCurrentMidStep(2)} isDisabled={hasClampWarning}>Back</Button>
                          <Button
                            colorScheme="blue"
                            onClick={handleMidNext}
                            isDisabled={(!activeData.midSplit.skipFirst && !(activeData.midSplit.skipSecond || activeData.midSplit.step2 !== null)) || hasClampWarning}
                          >
                            Next
                          </Button>
                        </HStack>
                      </VStack>
                    )}

                    {currentMidStep === 4 && (
                      <VStack align="stretch" spacing={3}>
                        <QuestionPrompt>
                          <Text>
                            Step 5: At which point X is equally important to {activeData.shape === 'linear_decreasing' ? 'reduce' : 'improve'} <strong>{active}</strong> from <strong>{activeData.shape === 'linear_decreasing' ? activeData.thresholds.high : activeData.midSplit.step1 ?? activeData.thresholds.low}</strong> to <strong>X</strong> as from <strong>X</strong> to <strong>{activeData.shape === 'linear_decreasing' ? activeData.midSplit.step1 ?? activeData.thresholds.low : activeData.thresholds.high}</strong>?
                          </Text>
                        </QuestionPrompt>
                        {!activeData.midSplit.skipFirst && (
                          <Box>
                            <Text fontSize="sm" color="gray.700" mb={1}>
                              Enter the other indifference point.
                            </Text>
                            <Input
                              key={`mid-step3-${activeData.midSplit.step3 ?? 'blank'}`}
                                ref={midStep3InputRef}
                              type="number"
                              defaultValue={activeData.midSplit.step3 ?? ''}
                              placeholder="Enter X"
                              onBlur={(e) => {
                                const raw = e.target.value.trim()
                                if (raw === '') {
                                  handleMidSplitChange('step3', null, false)
                                  return
                                }
                                const num = parseFloat(raw)
                                if (Number.isFinite(num)) handleMidSplitChange('step3', num, true)
                              }}
                            />
                          </Box>
                        )}
                        {clampHint?.field === 'step3' && clampHintText && (
                          <Text fontSize="xs" color="orange.600">{clampHintText}</Text>
                        )}
                        <HStack>
                          <Button variant="outline" onClick={handleSkipCurrentStep} isDisabled={hasClampWarning}>Skip</Button>
                          <Button variant="outline" onClick={() => setCurrentMidStep(3)} isDisabled={hasClampWarning}>Back</Button>
                          <Button
                            colorScheme="blue"
                            onClick={handleMidDone}
                            isDisabled={(!activeData.midSplit.skipFirst && !(activeData.midSplit.skipThird || activeData.midSplit.step3 !== null)) || hasClampWarning}
                          >
                            Done
                          </Button>
                        </HStack>
                      </VStack>
                    )}

                    {currentMidStep === 5 && (
                      <VStack align="stretch" spacing={3}>
                        <QuestionPrompt>
                          <Text>
                            Great, you finished this elicitation step for <strong>{active}</strong>. You can go back to modify values or continue to the next criterion.
                          </Text>
                        </QuestionPrompt>
                        <HStack>
                          <Button variant="outline" onClick={() => setCurrentMidStep(4)}>Back</Button>
                          <Button
                            colorScheme="blue"
                            onClick={handleNextCriterion}
                            isDisabled={activeCriterionIndex < 0 || activeCriterionIndex >= nonQualCriteria.length - 1}
                          >
                            Next criterion
                          </Button>
                        </HStack>
                      </VStack>
                    )}

                  </>

                </VStack>
              ) : (
                <VStack align="stretch" spacing={3}>
                  <VStack align="stretch" spacing={2}>
                    <QuestionPrompt mb={0}>
                      Does the value function for <strong>{active}</strong> increase or decrease as we move from {activeData.range.min} to {activeData.range.max}?
                    </QuestionPrompt>
                    <HStack spacing={2}>
                      <Button
                        size="sm"
                        variant={activeData.shape === 'linear_increasing' ? 'solid' : 'outline'}
                        colorScheme="blue"
                        onClick={() => {
                          markDirty((prev) => ({
                            ...prev,
                            [active]: {
                              ...prev[active],
                              shape: 'linear_increasing',
                              mode: MODE.FREE,
                              points: buildThresholdAnchors('linear_increasing', prev[active].thresholds, prev[active].range),
                              freeEditConfigured: true,
                            },
                          }))
                        }}
                      >
                        ↗ Increasing
                      </Button>
                      <Button
                        size="sm"
                        variant={activeData.shape === 'linear_decreasing' ? 'solid' : 'outline'}
                        colorScheme="blue"
                        onClick={() => {
                          markDirty((prev) => ({
                            ...prev,
                            [active]: {
                              ...prev[active],
                              shape: 'linear_decreasing',
                              mode: MODE.FREE,
                              points: buildThresholdAnchors('linear_decreasing', prev[active].thresholds, prev[active].range),
                              freeEditConfigured: true,
                            },
                          }))
                        }}
                      >
                        ↘ Decreasing
                      </Button>
                    </HStack>
                  </VStack>

                  <QuestionPrompt mb={2}>
                    Add points and drag them directly on the graph to shape the value function.
                  </QuestionPrompt>
                  
                  <HStack spacing={4} wrap="wrap" align="center">
                    <Button size="sm" onClick={handleAddPoint}>Add point</Button>
                    <FormControl maxW="150px">
                      <FormLabel fontSize="sm" m={0} fontWeight="medium">Confidence</FormLabel>
                      <Select
                        value={activeData.confidence ?? 4}
                        onChange={(e) => handleConfidenceChange(e.target.value)}
                        size="sm"
                      >
                        <option value="0">0 - Not confident</option>
                        <option value="1">1 - Low</option>
                        <option value="2">2 - Medium</option>
                        <option value="3">3 - High</option>
                        <option value="4">4 - Fully confident</option>
                      </Select>
                    </FormControl>
                    <FormControl maxW="140px">
                      <ThresholdLabel label="Low threshold" thresholdKey="low" shape={activeData.shape} />
                      <Input
                        key={`low-${activeData.thresholds.low}`}
                        type="number"
                        size="sm"
                        defaultValue={activeData.thresholds.low}
                        onBlur={(e) => {
                          const num = parseFloat(e.target.value)
                          if (Number.isFinite(num)) handleThresholdChange('low', num)
                        }}
                      />
                    </FormControl>
                    <FormControl maxW="140px">
                      <ThresholdLabel label="High threshold" thresholdKey="high" shape={activeData.shape} />
                      <Input
                        key={`high-${activeData.thresholds.high}`}
                        type="number"
                        size="sm"
                        defaultValue={activeData.thresholds.high}
                        onBlur={(e) => {
                          const num = parseFloat(e.target.value)
                          if (Number.isFinite(num)) handleThresholdChange('high', num)
                        }}
                      />
                    </FormControl>
                  </HStack>

                  <HStack justify="flex-end" spacing={2}>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleNavigateCriterion(-1)}
                      isDisabled={activeCriterionIndex <= 0}
                    >
                      Back
                    </Button>
                    <Button
                      size="sm"
                      colorScheme="blue"
                      onClick={handleNextCriterion}
                      isDisabled={activeCriterionIndex < 0 || activeCriterionIndex >= nonQualCriteria.length - 1}
                    >
                      Next
                    </Button>
                  </HStack>
                </VStack>
              )}

              <ValueFunctionPlot
                range={activeData.range}
                points={activeData.mode === MODE.MID && currentMidStep === 0 && !activeData.midSplit?.directionAnswered ? [] : activeData.points}
                thresholds={activeData.mode === MODE.MID && currentMidStep === 0 && !activeData.midSplit?.directionAnswered ? null : activeData.thresholds}
                shape={activeData.mode === MODE.MID && currentMidStep === 0 && !activeData.midSplit?.directionAnswered ? 'not selected' : activeData.shape}
                confidence={activeData.confidence ?? 4}
                draggable={!isSessionLocked && activeData.mode === MODE.FREE && (activeData.shape === 'linear_increasing' || activeData.shape === 'linear_decreasing')}
                onDrag={activeData.mode === MODE.FREE ? handleDragPoint : undefined}
              />
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
