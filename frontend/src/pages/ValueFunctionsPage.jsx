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
import { CheckCircleIcon, WarningIcon, CloseIcon, QuestionIcon } from '@chakra-ui/icons'
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

const clamp = (v, min, max) => {
  const num = Number.isFinite(v) ? v : min
  return Math.min(Math.max(num, min), max)
}

const sortByX = (pts) => [...pts].sort((a, b) => a.x - b.x)

const deriveRange = (criterion) => {
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
  const [midFlowStep, setMidFlowStep] = useState({})
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
      let finalValue = valueNum ?? thresholds.low
    
    if (shouldClamp) {
        // Enforce indifference point constraints based on threshold-relative logic
      if (stepKey === 'step1') {
          // Step 1 (0.5 point): must be between low and high thresholds
        finalValue = clamp(finalValue, thresholds.low, thresholds.high)
      } else if (stepKey === 'step2') {
          // Step 2 (0.25 point): must be between low threshold and step1
        const maxVal = midSplit.step1 ?? thresholds.high
        finalValue = clamp(finalValue, thresholds.low, maxVal)
      } else if (stepKey === 'step3') {
          // Step 3 (0.75 point): must be between step1 and high threshold
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
      if (activeData.midSplit?.skipFirst) {
        setCurrentMidStep(5)
        return
      }
      if (!(activeData.midSplit?.step1 !== null)) return
      setCurrentMidStep(3)
      return
    }
    if (currentMidStep === 3) {
      if (activeData.midSplit?.skipSecond) {
        setCurrentMidStep(4)
        return
      }
      if (!(activeData.midSplit?.step2 !== null)) return
      setCurrentMidStep(4)
      return
    }
    if (currentMidStep === 4) {
      if (activeData.midSplit?.skipThird || activeData.midSplit?.step3 !== null) {
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
    const thirdDone = activeData.midSplit?.skipThird || activeData.midSplit?.step3 !== null
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

  const progress = useMemo(() => {
    // Only count non-qualitative criteria
    const nonQualCriteria = criteria.filter(c => !c.is_qualitative)
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
  }, [criteria, valueFunctions])

  const nonQualCriteria = useMemo(
    () => criteria.filter((criterion) => !criterion.is_qualitative),
    [criteria],
  )

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
            Define value functions for each criterion using either mid-value splitting or free edit (set per criterion in Input Definition).
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
                          <HStack spacing={3} wrap="wrap" justify="space-between">
                            <Text>
                              Step 1: Is the value function of <strong>{active}</strong> increasing or decreasing?
                            </Text>
                            <HStack spacing={2}>
                              <Button
                                size="sm"
                                variant={activeData.midSplit?.directionAnswered && activeData.shape === 'linear_increasing' ? 'outline' : 'ghost'}
                                onClick={() => handleDirectionChange('linear_increasing')}
                              >
                                ↗ Increasing
                              </Button>
                              <Button
                                size="sm"
                                variant={activeData.midSplit?.directionAnswered && activeData.shape === 'linear_decreasing' ? 'outline' : 'ghost'}
                                onClick={() => handleDirectionChange('linear_decreasing')}
                              >
                                ↘ Decreasing
                              </Button>
                            </HStack>
                          </HStack>
                        </QuestionPrompt>
                        <HStack>
                          <Button
                            colorScheme="blue"
                            onClick={handleMidNext}
                            isDisabled={!activeData.midSplit?.directionAnswered}
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
                            <FormLabel fontSize="sm" m={0} fontWeight="medium">Low threshold</FormLabel>
                            <Tooltip
                              isOpen={clampHint?.field === 'low'}
                              label={`Auto-clamped to ${clampHint?.value}`}
                              placement="top"
                            >
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
                            </Tooltip>
                          </FormControl>
                          <FormControl maxW="150px">
                            <FormLabel fontSize="sm" m={0} fontWeight="medium">High threshold</FormLabel>
                            <Tooltip
                              isOpen={clampHint?.field === 'high'}
                              label={`Auto-clamped to ${clampHint?.value}`}
                              placement="top"
                            >
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
                            </Tooltip>
                          </FormControl>
                        </HStack>
                        <HStack>
                          <Button variant="outline" onClick={() => setCurrentMidStep(0)}>Back</Button>
                          <Button
                            colorScheme="blue"
                            onClick={handleMidNext}
                          >
                            Next
                          </Button>
                        </HStack>
                      </VStack>
                    )}

                    {currentMidStep === 2 && (
                      <VStack align="stretch" spacing={3}>
                        <QuestionPrompt>
                          Step 3: At which point X is equally important to improve <strong>{active}</strong> from <strong>{activeData.thresholds.low}</strong> to <strong>X</strong> as from <strong>X</strong> to <strong>{activeData.thresholds.high}</strong>?
                        </QuestionPrompt>
                        {!activeData.midSplit.skipFirst && (
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
                        )}
                        <HStack>
                          <Button variant="outline" onClick={handleSkipCurrentStep}>Skip</Button>
                          <Button variant="outline" onClick={() => setCurrentMidStep(1)}>Back</Button>
                          <Button
                            colorScheme="blue"
                            onClick={handleMidNext}
                            isDisabled={!(activeData.midSplit.skipFirst || activeData.midSplit.step1 !== null)}
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
                            Step 4: At which point X is equally important to improve <strong>{active}</strong> from <strong>{activeData.thresholds.low}</strong> to <strong>X</strong> as from <strong>X</strong> to <strong>{activeData.midSplit.step1 ?? activeData.thresholds.high}</strong>?
                          </Text>
                        </QuestionPrompt>
                        {!activeData.midSplit.skipFirst && (
                          <Box>
                            <Text fontSize="sm" color="gray.700" mb={1}>
                              Enter the second indifference point.
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
                          </Box>
                        )}
                        <HStack>
                          <Button variant="outline" onClick={handleSkipCurrentStep}>Skip</Button>
                          <Button variant="outline" onClick={() => setCurrentMidStep(2)}>Back</Button>
                          <Button
                            colorScheme="blue"
                            onClick={handleMidNext}
                            isDisabled={!activeData.midSplit.skipFirst && !(activeData.midSplit.skipSecond || activeData.midSplit.step2 !== null)}
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
                            Step 5: At which point X is equally important to improve <strong>{active}</strong> from <strong>{activeData.midSplit.step1 ?? activeData.thresholds.low}</strong> to <strong>X</strong> as from <strong>X</strong> to <strong>{activeData.thresholds.high}</strong>?
                          </Text>
                        </QuestionPrompt>
                        {!activeData.midSplit.skipFirst && (
                          <Box>
                            <Text fontSize="sm" color="gray.700" mb={1}>
                              Enter the other indifference point.
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
                          </Box>
                        )}
                        <HStack>
                          <Button variant="outline" onClick={handleSkipCurrentStep}>Skip</Button>
                          <Button variant="outline" onClick={() => setCurrentMidStep(3)}>Back</Button>
                          <Button
                            colorScheme="blue"
                            onClick={handleMidDone}
                            isDisabled={!activeData.midSplit.skipFirst && !(activeData.midSplit.skipThird || activeData.midSplit.step3 !== null)}
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
                      <FormLabel fontSize="sm" m={0} fontWeight="medium">Low threshold</FormLabel>
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
                      <FormLabel fontSize="sm" m={0} fontWeight="medium">High threshold</FormLabel>
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
