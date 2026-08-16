import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Box,
  Heading,
  VStack,
  HStack,
  SimpleGrid,
  Button,
  IconButton,
  Select,
  Checkbox,
  Radio,
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
  Divider,
  OrderedList,
  UnorderedList,
  ListItem,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Badge,
  Spinner,
  Text,
  useToast,
  Tooltip,
  Link,
  useDisclosure,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  NumberIncrementStepper,
  NumberDecrementStepper,
  Slider,
  SliderTrack,
  SliderFilledTrack,
  SliderThumb,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  ModalFooter,
  Collapse,
  TableContainer,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
} from '@chakra-ui/react'
import { DownloadIcon, ExternalLinkIcon, InfoOutlineIcon, ChevronDownIcon, ChevronRightIcon, WarningIcon } from '@chakra-ui/icons'
import axios from 'axios'
import JSZip from 'jszip'
import PdfModal from '../components/PdfModal'
import { InlineMath, BlockMath } from 'react-katex'
import 'katex/dist/katex.min.css'

import {
  AreaChart,
  Area,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend as RechartsLegend,
  ResponsiveContainer,
} from 'recharts'
import { API_URL } from '../config'
import {
  isInputComplete,
  isQualitativeComplete,
  isValueFunctionsComplete,
  isPileBwtComplete,
  isSessionComplete,
} from '../utils/sessionUtils'
import {
  formatPerElicitationDistributionSummary,
  buildDistributionStatsCsv,
  buildDistributionStatsRows,
  DISTRIBUTION_STAT_COLUMNS,
} from '../utils/distributionStats'
import { downloadCSVFile } from '../utils/csvExport'
import {
  normalizeConfidenceAdjustment,
  normalizePractitionerSettings,
} from '../utils/practitionerSettings'

const STEP2_COLORS = ['#3182CE', '#E57373', '#C77DFF', '#4DD0E1', '#38A169', '#D69E2E']
const PNG_SCALE_FACTOR = 2
const DEFAULT_PNG_WIDTH = 1200
const DEFAULT_PNG_HEIGHT = 700
const HEATMAP_CELL_SIZE = 70
const HEATMAP_CELL_GAP = 4
const HEATMAP_ROW_LABEL_WIDTH = 90
const HEATMAP_FALLBACK_WIDTH = 920
const HEATMAP_FALLBACK_HEIGHT = 300
const SVG_INLINE_STYLE_PROPS = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-opacity',
  'stroke-width',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
]

const AGGREGATION_METHODS = [
  {
    id: 'WAM',
    label: 'WAM',
    fullName: 'Weighted Arithmetic Mean',
    backendMethod: 'weighted_sum',
    usesAlpha: false,
    formula: String.raw`V_{WAM} = \sum_{i=1}^{n} w_i v_i`,
  },
  {
    id: 'GEO',
    label: 'GEO',
    fullName: 'Geometric Mean',
    backendMethod: 'geometric_mean',
    usesAlpha: false,
    formula: String.raw`V_{GEO} = \prod_{i=1}^{n} v_i^{w_i}`,
  },
  {
    id: 'HAR',
    label: 'HAR',
    fullName: 'Harmonic Mean',
    backendMethod: 'harmonic_mean',
    usesAlpha: false,
    formula: String.raw`V_{HAR} = \left(\sum_{i=1}^{n} \frac{w_i}{v_i}\right)^{-1}`,
  },
  {
    id: 'GEO_OFFSET',
    label: 'GEO+offset',
    fullName: 'Geometric Mean with Offset',
    backendMethod: 'geometric_mean_offset',
    usesAlpha: true,
    formula: String.raw`V_{GEO+offset} = \left( \prod_{i=1}^{n} (v_i - \log(\alpha))^{w_i} \right) + \log(\alpha)`,
  },
  {
    id: 'WAM_MIN',
    label: 'WAM+MIN',
    fullName: 'Mixture of Weighted Arithmetic Mean and Minimum',
    backendMethod: 'weighted_sum_min_mix',
    usesAlpha: true,
    formula: String.raw`V_{WAM+MIN} = (1 - \alpha) \cdot \sum_{i=1}^{n} w_i v_i + \alpha \cdot \min(\mathbf{v})`,
  },
  {
    id: 'WPM',
    label: 'WPM',
    fullName: 'Weighted Power Mean',
    backendMethod: 'weighted_power_mean',
    usesAlpha: true,
    formula: String.raw`V_{WPM} =
\begin{cases}
\left( \sum_{i=1}^{n} w_i v_i^{\ln\left(\frac{2}{\alpha + 1} - 1 \right) + 1} \right)^{\frac{1}{\ln\left(\frac{2}{\alpha + 1} - 1 \right) + 1}} & \text{if } \ln\left(\frac{2}{\alpha + 1} - 1 \right) + 1 \neq 0 \\
\prod_{i=1}^{n} v_i^{w_i} & \text{if } \ln\left(\frac{2}{\alpha + 1} - 1 \right) + 1 = 0 \\
\min(\mathbf{v}) & \text{if } \ln\left(\frac{2}{\alpha + 1} - 1 \right) + 1 = -\infty \\
\max(\mathbf{v}) & \text{if } \ln\left(\frac{2}{\alpha + 1} - 1 \right) + 1 = \infty
\end{cases}`,
  },
  {
    id: 'WEM',
    label: 'WEM',
    fullName: 'Weighted Exponential Mean',
    backendMethod: 'weighted_exponential_mean',
    usesAlpha: true,
    formula: String.raw`V_{WEM} =
\begin{cases}
\log_{\left( - \frac{\ln\left(\frac{\alpha + 1}{2}\right)}{\ln(2)}\right)} \left( \sum_{i=1}^{n} w_i \cdot \left( - \frac{\ln\left(\frac{\alpha + 1}{2}\right)}{\ln(2)}\right)^{v_i} \right) & \text{if } - \frac{\ln\left(\frac{\alpha + 1}{2}\right)}{\ln(2)} \neq 1 \\
\sum_{i=1}^{n} w_i v_i & \text{if } - \frac{\ln\left(\frac{\alpha + 1}{2}\right)}{\ln(2)} = 1
\end{cases}`,
  },
]
const DEFAULT_AGGREGATION_STEP_METHODS = ['WAM', 'GEO', 'HAR']
const DISTRIBUTION_STAT_TOOLTIPS = {
  average: 'Arithmetic mean; useful as a central tendency indicator but sensitive to extreme values.',
  median: 'Robust central tendency (50th percentile); less sensitive to outliers than the mean.',
  stdDev: 'Spread around the mean; larger values indicate higher overall variability.',
  iqr: 'Interquartile Range (P75 - P25); robust spread measure focused on the middle 50% of values.',
  skewness: 'Asymmetry indicator: positive means a longer right tail, negative means a longer left tail.',
  kurtosis: 'Tail heaviness relative to a normal distribution; higher values indicate more extreme tails.',
  min: 'Smallest observed value in the sampled distribution.',
  p5: 'Lower-tail quantile: 5% of sampled values are below this point.',
  p25: 'First quartile: 25% of sampled values are below this point.',
  p75: 'Third quartile: 75% of sampled values are below this point.',
  p95: 'Upper-tail quantile: 95% of sampled values are below this point.',
  max: 'Largest observed value in the sampled distribution.',
}
function toConfidenceNumber(value, fallback = null) {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) return fallback
  return Math.max(0, Math.min(4, numericValue))
}

function formatConfidenceValue(value) {
  const numericValue = toConfidenceNumber(value)
  if (numericValue === null) return 'N/A'
  return Number.isInteger(numericValue) ? `${numericValue}` : numericValue.toFixed(1)
}

function averageConfidence(values) {
  if (!Array.isArray(values) || values.length === 0) return null
  const total = values.reduce((sum, value) => sum + value, 0)
  return total / values.length
}

function applyConfidenceAdjustment(value, ...adjustments) {
  const confidence = toConfidenceNumber(value)
  if (confidence === null) return null
  const totalAdjustment = adjustments.reduce(
    (sum, adjustment) => sum + normalizeConfidenceAdjustment(adjustment, 0),
    0
  )
  return toConfidenceNumber(confidence + totalAdjustment, 0)
}

function getQualitativeDeclaredConfidences(session, criterionName) {
  const criterionData = session?.qualitative_indicators?.[criterionName]
  const confidences = criterionData?.confidences
  if (!confidences || typeof confidences !== 'object') return []
  return Object.values(confidences)
    .map((value) => toConfidenceNumber(value))
    .filter((value) => value !== null)
}

function getValueFunctionDeclaredConfidence(session, criterionName) {
  return toConfidenceNumber(session?.value_functions?.criteria?.[criterionName]?.confidence)
}

function getSessionDeclaredConfidenceValues(session, criteria, scope = 'all') {
  const values = []
  ;(criteria || []).forEach((criterion) => {
    const criterionName = criterion?.criterion_name
    if (!criterionName) return
    if (criterion?.is_qualitative) {
      if (scope === 'vf') return
      values.push(...getQualitativeDeclaredConfidences(session, criterionName))
      return
    }
    if (scope === 'qi') return
    const confidence = getValueFunctionDeclaredConfidence(session, criterionName)
    if (confidence !== null) values.push(confidence)
  })
  return values
}

function getAggregationMeta(methodId) {
  const token = String(methodId || '').trim().toUpperCase()
  return AGGREGATION_METHODS.find((entry) => entry.id === token) || AGGREGATION_METHODS[0]
}

function toBackendAggregationMethod(methodId) {
  return getAggregationMeta(methodId).backendMethod
}

function formatAlphaValue(alphaValue) {
  const numericValue = Number(alphaValue)
  if (!Number.isFinite(numericValue)) return null
  const clamped = Math.max(-1, Math.min(1, numericValue))
  return Number(clamped.toFixed(2)).toString()
}

function getAggregationPlotLabel(backendMethod, alphaMap = null, fallbackAlpha = null) {
  const meta = AGGREGATION_METHODS.find((entry) => entry.backendMethod === backendMethod)
  const label = meta?.label || backendMethod
  if (!meta?.usesAlpha) return label

  let alpha = fallbackAlpha
  if (alphaMap && typeof alphaMap === 'object' && Object.prototype.hasOwnProperty.call(alphaMap, backendMethod)) {
    alpha = alphaMap[backendMethod]
  }
  const formattedAlpha = formatAlphaValue(alpha)
  if (formattedAlpha === null) return `${label} (alpha = 0)`
  return `${label} (alpha = ${formattedAlpha})`
}

// Controlled NumberInput whose displayed text is a local edit buffer, not a
// direct reflection of the (clamped, rounded) committed value. Chakra's
// NumberInput reformats a numeric `value` prop on every render, which fights
// the user mid-keystroke (e.g. typing "0." gets reverted to "0", so the next
// keystroke "5" is read as "05" and clamped to the max). Clamping/formatting
// here only happens on blur, once the user is done typing.
function AlphaNumberInput({ value, onChange, min = -1, max = 1, step = 0.01, precision = 2, isDisabled, width = '100px' }) {
  const [text, setText] = useState(() => formatAlphaValue(value) ?? '0')
  const isFocusedRef = useRef(false)

  useEffect(() => {
    if (isFocusedRef.current) return
    setText(formatAlphaValue(value) ?? '0')
  }, [value])

  return (
    <NumberInput
      value={text}
      min={min}
      max={max}
      step={step}
      precision={precision}
      width={width}
      isDisabled={isDisabled}
      onFocus={() => {
        isFocusedRef.current = true
      }}
      onBlur={() => {
        isFocusedRef.current = false
        setText(formatAlphaValue(value) ?? '0')
      }}
      onChange={(valueString, valueAsNumber) => {
        setText(valueString)
        if (Number.isFinite(valueAsNumber)) {
          onChange(Math.max(min, Math.min(max, valueAsNumber)))
        }
      }}
    >
      <NumberInputField />
      <NumberInputStepper>
        <NumberIncrementStepper />
        <NumberDecrementStepper />
      </NumberInputStepper>
    </NumberInput>
  )
}

function inlineSvgComputedStyles(sourceNode, cloneNode) {
  if (
    typeof window === 'undefined'
    || typeof window.getComputedStyle !== 'function'
    || !(sourceNode instanceof Element)
    || !(cloneNode instanceof Element)
  ) {
    return
  }

  const computedStyle = window.getComputedStyle(sourceNode)
  SVG_INLINE_STYLE_PROPS.forEach((property) => {
    const value = computedStyle.getPropertyValue(property)
    if (value === null || value === undefined) return
    const normalizedValue = String(value).trim()
    if (normalizedValue === '') return
    cloneNode.style.setProperty(property, normalizedValue)
  })

  const sourceChildren = sourceNode.children
  const cloneChildren = cloneNode.children
  const childCount = Math.min(sourceChildren.length, cloneChildren.length)
  for (let childIndex = 0; childIndex < childCount; childIndex += 1) {
    inlineSvgComputedStyles(sourceChildren[childIndex], cloneChildren[childIndex])
  }
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================
function RunUpMavtPage({ studySessionId, onNavigate }) {
  const toast = useToast()

  // State for sessions
  const [sessions, setSessions] = useState([])
  const [criteria, setCriteria] = useState([])
  const [selectedSessions, setSelectedSessions] = useState([])
  const [practitionerSettingsById, setPractitionerSettingsById] = useState({})
  const [savingPractitionerSettingsById, setSavingPractitionerSettingsById] = useState({})
  const [practitionerSettingsSaveStateById, setPractitionerSettingsSaveStateById] = useState({})
  const [loadingStudy, setLoadingStudy] = useState(true)

  // Workflow status from DB
  const [workflowStatus, setWorkflowStatus] = useState(null)

  // Current task tracking
  const [activeTaskId, setActiveTaskId] = useState(null)
  const [runningStep, setRunningStep] = useState(null)
  const [consoleOutput, setConsoleOutput] = useState('')
  const [showConsole, setShowConsole] = useState(false)
  const pollRef = useRef(null)
  const practitionerSettingsSaveTimersRef = useRef({})

  // Active tab
  const [activeStep, setActiveStep] = useState(0)

  // Step parameters - MC iterations per step
  const [mcIterations, setMcIterations] = useState({
    1: 1000, 2: 1000, 3: 1000, 4: 200, 5: 1000, 6: 10000,
  })

  // Aggregation method: compared/checked methods in Step 2, and the one
  // chosen among them to carry forward (read-only) into Steps 3-5.
  const [aggregationStepMethods, setAggregationStepMethods] = useState(DEFAULT_AGGREGATION_STEP_METHODS)
  const [aggregationStepAlphas, setAggregationStepAlphas] = useState({})
  const [chosenAggregationMethod, setChosenAggregationMethod] = useState(DEFAULT_AGGREGATION_STEP_METHODS[0])

  // Weight space plot state
  const [selectedWeightSession, setSelectedWeightSession] = useState('')
  const [weightSpaceData, setWeightSpaceData] = useState(null)
  const [showDeclaredVsComputed, setShowDeclaredVsComputed] = useState(false)
  const [expandedConfidenceSections, setExpandedConfidenceSections] = useState({})
  const [useNonLinearModel, setUseNonLinearModel] = useState(true)
  const [runPrefsHydrated, setRunPrefsHydrated] = useState(false)
  const [phase3TolerancePct, setPhase3TolerancePct] = useState(1)
  const [maxResults, setMaxResults] = useState(10)
  const [maxRestarts, setMaxRestarts] = useState(300)
  const [rngSeed, setRngSeed] = useState(426)
  const [eps, setEps] = useState(0.001)
  const [feasibilityTol, setFeasibilityTol] = useState(0.01)
  const [slsqpMaxiter, setSlsqpMaxiter] = useState(500)
  const [slsqpFtol, setSlsqpFtol] = useState(1e-10)
  const [outputWeightDecimals, setOutputWeightDecimals] = useState(3)
  const [dePopsize, setDePopsize] = useState(15)
  const [deMaxiter, setDeMaxiter] = useState(1000)
  const [deSeed, setDeSeed] = useState(426)
  // Step 2 results state
  const [step2Results, setStep2Results] = useState(null)
  const [step5Results, setStep5Results] = useState(null)
  const [step4Results, setStep4Results] = useState(null)
  const [step6Results, setStep6Results] = useState(null)
  const [exportingDataZip, setExportingDataZip] = useState(false)
  const [exportingResults, setExportingResults] = useState(false)
  const [exportIncludeResultsCsv, setExportIncludeResultsCsv] = useState(true)
  const [exportIncludeSimulationCsvs, setExportIncludeSimulationCsvs] = useState(true)
  const [exportIncludePlotImages, setExportIncludePlotImages] = useState(true)
  const [exportIncludeStep2ConsensusQuantificationCsv, setExportIncludeStep2ConsensusQuantificationCsv] = useState(true)
  const [exportIncludeStep5UncertaintyStatsCsv, setExportIncludeStep5UncertaintyStatsCsv] = useState(true)
  const [exportIncludeFullData, setExportIncludeFullData] = useState(false)
  // PDF Modal states
  const { isOpen: isUncertaintiesOpen, onOpen: onUncertaintiesOpen, onClose: onUncertaintiesClose } = useDisclosure()
  const { isOpen: isMcModesOpen, onOpen: onMcModesOpen, onClose: onMcModesClose } = useDisclosure()
  const { isOpen: isExportResultsOpen, onOpen: onExportResultsOpen, onClose: onExportResultsClose } = useDisclosure()

  // Derived state
  const weightsComputed = workflowStatus?.weights?.computed === true
  const weightsTimestamp = workflowStatus?.weights?.timestamp
  const chosenAggregationMeta = chosenAggregationMethod ? getAggregationMeta(chosenAggregationMethod) : null
  const chosenAggregationAlpha = chosenAggregationMeta?.usesAlpha
    ? Number(aggregationStepAlphas[chosenAggregationMethod] ?? 0)
    : 0

  // ============================================================================
  // LOAD DATA
  // ============================================================================
  const fetchWorkflowStatus = useCallback(async () => {
    if (!studySessionId) return
    try {
      const response = await axios.get(`${API_URL}/study-session/${studySessionId}/workflow-status`)
      setWorkflowStatus(response.data)
    } catch (error) {
      console.error('Error fetching workflow status:', error)
    }
  }, [studySessionId])

  const saveRunPagePreferences = useCallback(async (payload) => {
    if (!studySessionId) return
    try {
      await axios.put(
        `${API_URL}/study-session/${studySessionId}/workflow-preferences/run-page`,
        payload
      )
    } catch (error) {
      console.error('Error saving run-page preferences:', error)
    }
  }, [studySessionId])

  const fetchStep2Results = useCallback(async () => {
    if (!studySessionId) return
    try {
      const response = await axios.get(`${API_URL}/study-session/${studySessionId}/step-results/2`)
      setStep2Results(response.data)
    } catch (error) {
      console.error('Error fetching step 2 results:', error)
    }
  }, [studySessionId])

  const fetchStep5Results = useCallback(async () => {
    if (!studySessionId) return
    try {
      const response = await axios.get(`${API_URL}/study-session/${studySessionId}/step-results/5`)
      setStep5Results(response.data)
    } catch (error) {
      console.error('Error fetching step 5 results:', error)
    }
  }, [studySessionId])

  const fetchStep4Results = useCallback(async () => {
    if (!studySessionId) return
    try {
      const response = await axios.get(`${API_URL}/study-session/${studySessionId}/step-results/4`)
      setStep4Results(response.data)
    } catch (error) {
      console.error('Error fetching step 4 results:', error)
    }
  }, [studySessionId])

  const fetchStep6Results = useCallback(async () => {
    if (!studySessionId) return
    try {
      const response = await axios.get(`${API_URL}/study-session/${studySessionId}/step-results/6`)
      setStep6Results(response.data)
    } catch (error) {
      console.error('Error fetching step 6 results:', error)
    }
  }, [studySessionId])

  const fetchWeightSpace = useCallback(async (sessionId) => {
    if (!sessionId || !studySessionId) return
    try {
      const response = await axios.get(
        `${API_URL}/study-session/${studySessionId}/weight-space/${sessionId}`
      )
      setWeightSpaceData(response.data.weight_solutions || response.data.weight_space)
    } catch (error) {
      console.error('Error fetching weight space:', error)
      setWeightSpaceData(null)
    }
  }, [studySessionId])

  useEffect(() => {
    setRunPrefsHydrated(false)

    const fetchSessions = async () => {
      if (!studySessionId) return
      setLoadingStudy(true)
      try {
        const response = await axios.get(`${API_URL}/study-session/${studySessionId}/elicitation-sessions`)
        const studyData = response.data
        const allSessions = studyData.sessions || []
        const allCriteria = studyData.criteria || []

        setSessions(allSessions)
        setCriteria(allCriteria)
        setPractitionerSettingsById(
          allSessions.reduce((acc, session) => {
            acc[session._id] = normalizePractitionerSettings(allCriteria, session.practitioner_settings)
            return acc
          }, {})
        )

        const completedAndLocked = allSessions.filter((s) =>
          isSessionComplete(s, allCriteria) && s.session_locked === true
        )
        setSelectedSessions(completedAndLocked.map((s) => s._id))
      } catch (error) {
        console.error('Error fetching study:', error)
        toast({
          title: 'Error loading study',
          description: error.response?.data?.error || error.message,
          status: 'error',
          duration: 4000,
        })
      } finally {
        setLoadingStudy(false)
      }
    }

    fetchSessions()
    fetchWorkflowStatus()
  }, [studySessionId, toast, fetchWorkflowStatus])

  useEffect(() => {
    if (!studySessionId || sessions.length === 0) return
    if (runPrefsHydrated) return

    const validIds = new Set(
      sessions
        .filter((s) => isSessionComplete(s, criteria) && s.session_locked === true)
        .map((s) => s._id)
    )
    const runPrefs = workflowStatus?.preferences?.run_page || {}

    if (runPrefs.use_non_linear_model !== undefined) {
      setUseNonLinearModel(Boolean(runPrefs.use_non_linear_model))
    }

    if (Array.isArray(runPrefs.selected_session_ids)) {
      const restoredSelected = runPrefs.selected_session_ids.filter((id) => validIds.has(id))
      // Respect explicit persisted empty selection ([]).
      setSelectedSessions(restoredSelected)
    }

    if (Array.isArray(runPrefs.aggregation_step_methods) && runPrefs.aggregation_step_methods.length > 0) {
      setAggregationStepMethods(runPrefs.aggregation_step_methods)
    }

    if (runPrefs.aggregation_step_alphas && typeof runPrefs.aggregation_step_alphas === 'object') {
      setAggregationStepAlphas(runPrefs.aggregation_step_alphas)
    }

    if (runPrefs.chosen_aggregation_method) {
      setChosenAggregationMethod(runPrefs.chosen_aggregation_method)
    }

    setRunPrefsHydrated(true)
  }, [studySessionId, sessions, criteria, workflowStatus?.preferences?.run_page, runPrefsHydrated])

  useEffect(() => {
    if (!runPrefsHydrated) return
    saveRunPagePreferences({ use_non_linear_model: useNonLinearModel })
  }, [runPrefsHydrated, useNonLinearModel, saveRunPagePreferences])

  useEffect(() => {
    if (!runPrefsHydrated) return
    saveRunPagePreferences({ selected_session_ids: selectedSessions })
  }, [runPrefsHydrated, selectedSessions, saveRunPagePreferences])

  useEffect(() => {
    if (!runPrefsHydrated) return
    saveRunPagePreferences({ aggregation_step_methods: aggregationStepMethods })
  }, [runPrefsHydrated, aggregationStepMethods, saveRunPagePreferences])

  useEffect(() => {
    if (!runPrefsHydrated) return
    saveRunPagePreferences({ aggregation_step_alphas: aggregationStepAlphas })
  }, [runPrefsHydrated, aggregationStepAlphas, saveRunPagePreferences])

  useEffect(() => {
    if (!runPrefsHydrated) return
    saveRunPagePreferences({ chosen_aggregation_method: chosenAggregationMethod || '' })
  }, [runPrefsHydrated, chosenAggregationMethod, saveRunPagePreferences])

  // If the chosen method gets unchecked from the comparison list, it can no
  // longer be carried into the following steps - clear it.
  useEffect(() => {
    if (chosenAggregationMethod && !aggregationStepMethods.includes(chosenAggregationMethod)) {
      setChosenAggregationMethod(null)
    }
  }, [chosenAggregationMethod, aggregationStepMethods])

  useEffect(() => {
    if (workflowStatus?.weights?.phase3_tolerance_pct !== undefined) {
      const pct = Number(workflowStatus.weights.phase3_tolerance_pct)
      setPhase3TolerancePct(Number.isFinite(pct) ? pct : 1)
    }
  }, [
    workflowStatus?.weights?.phase3_tolerance_pct,
  ])

  // Fetch step 2 results when step 2 is completed
  useEffect(() => {
    if (workflowStatus?.steps?.['2']?.completed) {
      fetchStep2Results()
    }
  }, [workflowStatus?.steps?.['2']?.completed, fetchStep2Results])

  useEffect(() => {
    if (workflowStatus?.steps?.['5']?.completed) {
      fetchStep5Results()
    }
  }, [workflowStatus?.steps?.['5']?.completed, fetchStep5Results])

  useEffect(() => {
    if (workflowStatus?.steps?.['4']?.completed) {
      fetchStep4Results()
    }
  }, [workflowStatus?.steps?.['4']?.completed, fetchStep4Results])

  useEffect(() => {
    if (workflowStatus?.steps?.['6']?.completed) {
      fetchStep6Results()
    }
  }, [workflowStatus?.steps?.['6']?.completed, fetchStep6Results])
  // ============================================================================
  // TASK POLLING
  // ============================================================================
  const startPolling = useCallback((taskId, stepName, stepNumber = null) => {
    if (pollRef.current) clearInterval(pollRef.current)

    pollRef.current = setInterval(async () => {
      try {
        const response = await axios.get(`${API_URL}/task/${taskId}/status`)
        const task = response.data

        setConsoleOutput(task.console_output || '')

        if (task.status === 'completed') {
          clearInterval(pollRef.current)
          pollRef.current = null
          setRunningStep(null)
          setActiveTaskId(null)
          
          // Fetch workflow status first
          await fetchWorkflowStatus()
          
          // Then fetch the step results for the completed step
          if (stepNumber === 2) {
            await fetchStep2Results()
          } else if (stepNumber === 4) {
            await fetchStep4Results()
          } else if (stepNumber === 5) {
            await fetchStep5Results()
          } else if (stepNumber === 6) {
            await fetchStep6Results()
          } else if (stepNumber === null && stepName.includes('Weights')) {
            // If weights were computed and we have a selected weight session, refetch its weight space
            if (selectedWeightSession) {
              await fetchWeightSpace(selectedWeightSession)
            }
          }
          
          toast({ title: `${stepName} completed`, status: 'success', duration: 3000 })
        } else if (task.status === 'failed') {
          clearInterval(pollRef.current)
          pollRef.current = null
          setRunningStep(null)
          setActiveTaskId(null)
          toast({
            title: `${stepName} failed`,
            description: task.error || 'Unknown error',
            status: 'error',
            duration: 6000,
          })
        } else if (task.status === 'cancelled') {
          clearInterval(pollRef.current)
          pollRef.current = null
          setRunningStep(null)
          setActiveTaskId(null)
          toast({ title: `${stepName} cancelled`, status: 'info', duration: 3000 })
        }
      } catch (error) {
        console.error('Polling error:', error)
      }
    }, 2000)
  }, [fetchWorkflowStatus, fetchStep2Results, fetchStep4Results, fetchStep5Results, fetchStep6Results, fetchWeightSpace, selectedWeightSession, toast])

  // Check for active/running tasks on mount (called after startPolling is defined)
  const checkForActiveTask = useCallback(async () => {
    try {
      const response = await axios.get(`${API_URL}/study-session/${studySessionId}/active-task`)
      const activeTask = response.data.active_task
      
      if (activeTask && (activeTask.status === 'pending' || activeTask.status === 'running')) {
        // Restore task state
        setActiveTaskId(activeTask.task_id)
        setConsoleOutput(activeTask.console_output || 'Task in progress...\n')
        
        // Determine which step is running
        const taskType = activeTask.type
        const params = activeTask.params || {}
        
        if (taskType === 'compute_weights') {
          setRunningStep('weights')
          startPolling(activeTask.task_id, 'Compute Weights', null)
        } else if (taskType === 'run_step') {
          const stepNumber = params.step_number
          const stepName = params.step_name || `Step ${stepNumber}`
          setRunningStep(stepName)
          startPolling(activeTask.task_id, stepName, stepNumber)
        }
      }
    } catch (error) {
      console.error('Error checking for active task:', error)
      // Don't show error toast - this is a background check
    }
  }, [studySessionId, startPolling])

  // Call checkForActiveTask on mount
  useEffect(() => {
    if (studySessionId) {
      checkForActiveTask()
    }
  }, [studySessionId, checkForActiveTask])

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      Object.values(practitionerSettingsSaveTimersRef.current).forEach((timeoutId) => clearTimeout(timeoutId))
    }
  }, [])

  // ============================================================================
  // SESSION SELECTION
  // ============================================================================
  const completedAndLockedSessions = sessions.filter((s) =>
    isSessionComplete(s, criteria) && s.session_locked === true
  )
  const completedAndLockedCount = completedAndLockedSessions.length
  const incompleteOrUnlockedSessionsExcluded = selectedSessions.length < completedAndLockedCount

  const handleSessionToggle = (sessionId) => {
    setSelectedSessions((prev) => {
      if (prev.includes(sessionId)) {
        return prev.filter((id) => id !== sessionId)
      } else {
        return [...prev, sessionId]
      }
    })
  }

  const getSessionLabel = (session, fallbackLabel = '') => {
    if (!session) return fallbackLabel
    const friendly = String(session.friendly_name || '').trim()
    if (friendly) return friendly
    return session._id || fallbackLabel || 'Unknown session'
  }

  const handlePractitionerSettingsChange = (sessionId, updater) => {
    let nextSettings = null
    setPractitionerSettingsById((prev) => {
      const session = sessions.find((entry) => entry._id === sessionId)
      const current = normalizePractitionerSettings(
        criteria,
        prev[sessionId] || session?.practitioner_settings
      )
      nextSettings = normalizePractitionerSettings(
        criteria,
        typeof updater === 'function' ? updater(current) : updater
      )
      return {
        ...prev,
        [sessionId]: nextSettings,
      }
    });
    if (nextSettings) {
      const existingTimeout = practitionerSettingsSaveTimersRef.current[sessionId]
      if (existingTimeout) clearTimeout(existingTimeout)
      setPractitionerSettingsSaveStateById((prev) => ({ ...prev, [sessionId]: 'pending' }))
      practitionerSettingsSaveTimersRef.current[sessionId] = setTimeout(() => {
        handleSavePractitionerSettings(sessionId, nextSettings)
      }, 500)
    }
  }

  const handleSavePractitionerSettings = async (sessionId, settingsOverride = null) => {
    const session = sessions.find((entry) => entry._id === sessionId)
    if (!session) return

    const existingTimeout = practitionerSettingsSaveTimersRef.current[sessionId]
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      delete practitionerSettingsSaveTimersRef.current[sessionId]
    }

    const settings = normalizePractitionerSettings(
      criteria,
      settingsOverride || practitionerSettingsById[sessionId] || session.practitioner_settings
    )

    setSavingPractitionerSettingsById((prev) => ({ ...prev, [sessionId]: true }))
    setPractitionerSettingsSaveStateById((prev) => ({ ...prev, [sessionId]: 'saving' }))
    try {
      const response = await axios.put(`${API_URL}/session/${sessionId}/practitioner-settings`, {
        practitioner_settings: settings,
      })
      const updatedSettings = normalizePractitionerSettings(criteria, response.data?.practitioner_settings)
      setPractitionerSettingsById((prev) => ({ ...prev, [sessionId]: updatedSettings }))
      setSessions((prev) => prev.map((entry) => (
        entry._id === sessionId
          ? { ...entry, practitioner_settings: updatedSettings }
          : entry
      )))
      setPractitionerSettingsSaveStateById((prev) => ({ ...prev, [sessionId]: 'saved' }))
    } catch (error) {
      setPractitionerSettingsSaveStateById((prev) => ({ ...prev, [sessionId]: 'error' }))
      toast({
        title: 'Failed to save session settings',
        description: error.response?.data?.error || error.message,
        status: 'error',
        duration: 4000,
      })
    } finally {
      setSavingPractitionerSettingsById((prev) => ({ ...prev, [sessionId]: false }))
    }
  }

  const handleToggleConfidenceSection = (sessionId, sectionKey) => {
    setExpandedConfidenceSections((prev) => ({
      ...prev,
      [sessionId]: {
        ...prev[sessionId],
        [sectionKey]: !prev[sessionId]?.[sectionKey],
      },
    }))
  }

  // ============================================================================
  // STEP 1: COMPUTE WEIGHTS
  // ============================================================================
  const handleComputeWeights = async () => {
    if (selectedSessions.length === 0) {
      toast({ title: 'Select at least one session', status: 'warning', duration: 3000 })
      return
    }

    setRunningStep('weights')
    setConsoleOutput('Submitting weight computation task...\n')

    try {
      const response = await axios.post(
        `${API_URL}/study-session/${studySessionId}/compute-weights`,
        {
          selected_session_ids: selectedSessions,
          use_non_linear_model: useNonLinearModel,
          phase3_tolerance_pct: phase3TolerancePct,
          weight_space_parameters: {
            max_results: maxResults,
            max_restarts: maxRestarts,
            rng_seed: rngSeed,
            eps,
            feasibility_tol: feasibilityTol,
            slsqp_maxiter: slsqpMaxiter,
            slsqp_ftol: slsqpFtol,
            output_weight_decimals: outputWeightDecimals,
            de_popsize: dePopsize,
            de_maxiter: deMaxiter,
            de_seed: deSeed,
          },
        }
      )
      const taskId = response.data.task_id
      setActiveTaskId(taskId)
      startPolling(taskId, 'Compute Weights', null)
    } catch (error) {
      setRunningStep(null)
      toast({
        title: 'Error starting weight computation',
        description: error.response?.data?.error || error.message,
        status: 'error',
        duration: 4000,
      })
    }
  }

  const handleResetWeights = async () => {
    try {
      await axios.post(`${API_URL}/study-session/${studySessionId}/reset-weights`)
      setWorkflowStatus(null)
      setWeightSpaceData(null)
      fetchWorkflowStatus()
      toast({ title: 'Weights and all step results reset', status: 'info', duration: 3000 })
    } catch (error) {
      toast({
        title: 'Error resetting weights',
        description: error.response?.data?.error || error.message,
        status: 'error',
        duration: 4000,
      })
    }
  }

  // ============================================================================
  // STEPS 2-6: RUN UP-MAVT
  // ============================================================================
  const handleRunStep = async (stepNumber, stepName, overrides = {}) => {
    if (runningStep) return
    if (!weightsComputed) return
    if (selectedSessions.length === 0) {
      toast({ title: 'Select at least one session', status: 'warning', duration: 3000 })
      return
    }
    if (stepNumber === 4 && aggregationStepMethods.length === 0) {
      toast({ title: 'Select at least one aggregation method', status: 'warning', duration: 3000 })
      return
    }
    if ([2, 5, 6].includes(stepNumber) && !chosenAggregationMethod) {
      toast({ title: 'Choose an aggregation method in Step 2 first', status: 'warning', duration: 3000 })
      return
    }

    const selectedAggregationMethodIds = aggregationStepMethods.length > 0
      ? aggregationStepMethods
      : DEFAULT_AGGREGATION_STEP_METHODS
    const selectedBackendMethods = [...new Set(selectedAggregationMethodIds.map((id) => toBackendAggregationMethod(id)))]
    const selectedBackendAlphas = {}
    selectedAggregationMethodIds.forEach((methodId) => {
      const meta = getAggregationMeta(methodId)
      const value = Number(aggregationStepAlphas[methodId])
      const alpha = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0
      selectedBackendAlphas[meta.backendMethod] = meta.usesAlpha ? alpha : 0
    })

    // Build step-specific params
    const stepConfigs = {
      2: {
        mc_mode: 'strict',
        aggregation_method: toBackendAggregationMethod(chosenAggregationMethod),
        aggregation_alpha: chosenAggregationAlpha,
        use_random_weights: false,
      },
      4: {
        mc_mode: 'non_strict',
        aggregation_method: selectedBackendMethods[0] || 'weighted_sum',
        aggregation_alpha: selectedBackendAlphas[selectedBackendMethods[0]] ?? 0,
        aggregation_methods: selectedBackendMethods,
        aggregation_alphas: selectedBackendAlphas,
        use_random_weights: false,
      },
      5: {
        mc_mode: 'strict',
        aggregation_method: toBackendAggregationMethod(chosenAggregationMethod),
        aggregation_alpha: chosenAggregationAlpha,
        use_random_weights: false,
      },
      6: {
        mc_mode: 'non_strict',
        aggregation_method: toBackendAggregationMethod(chosenAggregationMethod),
        aggregation_alpha: chosenAggregationAlpha,
        use_random_weights: false,
      },
    }

    const config = { ...stepConfigs[stepNumber], ...overrides }

    // Clear previous results for this step so they don't linger during the new run
    const stepResultClearers = {
      2: () => setStep2Results(null),
      4: () => setStep4Results(null),
      5: () => setStep5Results(null),
      6: () => setStep6Results(null),
    }
    stepResultClearers[stepNumber]?.()

    setRunningStep(stepName)
    setConsoleOutput(`Submitting ${stepName} task...\n`)

    try {
      const response = await axios.post(
        `${API_URL}/study-session/${studySessionId}/run-step`,
        {
          step_number: stepNumber,
          selected_session_ids: selectedSessions,
          mc_iterations: mcIterations[stepNumber] || (stepNumber === 6 ? 10000 : 1000),
          aggregation_method: config.aggregation_method,
          aggregation_alpha: config.aggregation_alpha ?? 0,
          aggregation_methods: config.aggregation_methods,
          aggregation_alphas: config.aggregation_alphas,
          mc_mode: config.mc_mode,
          use_random_weights: config.use_random_weights,
        }
      )
      const taskId = response.data.task_id
      setActiveTaskId(taskId)
      startPolling(taskId, stepName, stepNumber)
    } catch (error) {
      setRunningStep(null)
      toast({
        title: `Error starting ${stepName}`,
        description: error.response?.data?.error || error.message,
        status: 'error',
        duration: 4000,
      })
    }
  }

  // ============================================================================
  // STOP / CANCEL
  // ============================================================================
  const handleStopExecution = async () => {
    if (activeTaskId) {
      try {
        await axios.post(`${API_URL}/task/${activeTaskId}/cancel`)
      } catch (error) {
        console.error('Error cancelling task:', error)
      }
    }
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    setRunningStep(null)
    setActiveTaskId(null)
    setConsoleOutput((prev) => prev + '\n[Execution stopped by user]')
    toast({ title: 'Execution stopped', status: 'info' })
  }

  // ============================================================================
  // WEIGHT SPACE PLOT
  // ============================================================================
  useEffect(() => {
    if (selectedWeightSession) {
      fetchWeightSpace(selectedWeightSession)
    }
  }, [selectedWeightSession, fetchWeightSpace])

  // Auto-select first session for weight plot when weights are computed
  useEffect(() => {
    if (weightsComputed && selectedSessions.length > 0 && !selectedWeightSession) {
      setSelectedWeightSession(selectedSessions[0])
    }
  }, [weightsComputed, selectedSessions, selectedWeightSession])

  // ============================================================================
  // HELPERS
  // ============================================================================
  // Tab indices: 0 = Introduction (always enabled, not gated here), 1 = Step 1 (always enabled),
  // 2-5 = Steps 2-5 (gated behind weights being computed).
  const isStepDisabled = (stepIndex) => {
    if (stepIndex <= 1) return false
    return !weightsComputed || runningStep !== null
  }

  const isButtonDisabled = (stepIndex) => {
    return isStepDisabled(stepIndex) || runningStep !== null
  }

  const getStepStatus = (stepNumber) => {
    if (!workflowStatus?.steps) return null
    return workflowStatus.steps[String(stepNumber)]
  }

  const formatTimestamp = (ts) => {
    if (!ts) return ''
    const d = new Date(ts)
    return d.toLocaleString()
  }

  const updateMcIterations = (step, value) => {
    const maxAllowed = step === 6 ? 10000 : 5000
    const fallback = step === 6 ? 10000 : 1000
    const v = Math.max(100, Math.min(maxAllowed, parseInt(value) || fallback))
    setMcIterations((prev) => ({ ...prev, [step]: v }))
  }

  // Read-only summary of the aggregation method chosen in Step 2, used by
  // Steps 3-5. It cannot be edited here - the user must go back to Step 2.
  const renderChosenAggregationSummary = () => {
    if (!chosenAggregationMethod || !chosenAggregationMeta) {
      return (
        <Alert status="warning" borderRadius="md" alignItems="flex-start">
          <AlertIcon />
          <Box flex={1}>
            <AlertTitle fontSize="sm">No aggregation method chosen yet</AlertTitle>
            <AlertDescription fontSize="sm" display="block">
              Go to Step 2, compare the methods you're interested in, and mark one as the method to use for the rest of the workflow.
            </AlertDescription>
          </Box>
          <Button size="sm" flexShrink={0} onClick={() => setActiveStep(2)}>Go to Step 2</Button>
        </Alert>
      )
    }

    const meta = chosenAggregationMeta

    return (
      <VStack spacing={3} align="stretch">
        <HStack spacing={3} align="center" flexWrap="wrap" justify="space-between">
          <HStack spacing={3} align="center" flexWrap="wrap">
            <Text fontWeight="bold">Aggregation:</Text>
            <Badge colorScheme="blue" fontSize="sm" px={2} py={1}>{meta.label}</Badge>
            {meta.usesAlpha && (
              <Text fontSize="sm" color="gray.700">α = {formatAlphaValue(chosenAggregationAlpha) ?? '0'}</Text>
            )}
          </HStack>
          <Button size="xs" variant="link" onClick={() => setActiveStep(2)}>Change in Step 2</Button>
        </HStack>
        <Text fontSize="xs" color="gray.600">
          This is the method chosen in Step 2. Go back to Step 2 to compare other methods or change the selection.
        </Text>
        <VStack spacing={1} align="stretch">
          <Text fontSize="sm" color="gray.700">
            <strong>{meta.label}</strong> = {meta.fullName}
          </Text>
          <Box
            bg="white"
            borderWidth={1}
            borderColor="gray.200"
            borderRadius="md"
            py={2}
            px={3}
            overflowX="auto"
            maxW="360px"
            fontSize="14px"
            sx={{ '.katex-display': { margin: 0, textAlign: 'left' } }}
          >
            <BlockMath math={meta.formula} />
          </Box>
        </VStack>
      </VStack>
    )
  }

  const renderAggregationChecklist = () => (
    <VStack spacing={3} align="stretch">
      <Text fontWeight="bold">Aggregation methods (select one or more to compare):</Text>
      <Text fontSize="xs" color="gray.600">
        Mark one of the checked methods as "Use for next steps" - that choice (and its α) is carried, read-only, into Steps 3-5.
      </Text>
      <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
        {AGGREGATION_METHODS.map((method) => {
          const isSelected = aggregationStepMethods.includes(method.id)
          const isChosen = chosenAggregationMethod === method.id
          const alphaValue = Number(aggregationStepAlphas[method.id] ?? 0)
          return (
            <Box
              key={method.id}
              bg="white"
              borderWidth={isChosen ? 2 : 1}
              borderColor={isChosen ? 'blue.400' : 'gray.200'}
              borderRadius="md"
              p={3}
            >
              <VStack spacing={2} align="stretch">
                <HStack spacing={3} align="center" flexWrap="wrap" justify="space-between">
                  <HStack spacing={3} align="center" flexWrap="wrap">
                    <Checkbox
                      isChecked={isSelected}
                      isDisabled={runningStep !== null}
                      onChange={(e) => {
                        const checked = e.target.checked
                        setAggregationStepMethods((prev) => {
                          if (checked) {
                            return prev.includes(method.id) ? prev : [...prev, method.id]
                          }
                          return prev.filter((id) => id !== method.id)
                        })
                      }}
                    >
                      <Text fontWeight="semibold">{method.label}</Text>
                    </Checkbox>
                    <Text fontSize="sm" color="gray.700">
                      {method.fullName}
                    </Text>
                  </HStack>
                  {isSelected && (
                    <Tooltip label="Use this method (and its α) for Steps 3-5" hasArrow>
                      <HStack spacing={1} as="label" cursor={runningStep !== null ? 'not-allowed' : 'pointer'}>
                        <Radio
                          isChecked={isChosen}
                          isDisabled={runningStep !== null}
                          onChange={() => setChosenAggregationMethod(method.id)}
                        />
                        <Text fontSize="xs" color="gray.600">Use for next steps</Text>
                      </HStack>
                    </Tooltip>
                  )}
                </HStack>
                <Box
                  borderWidth={1}
                  borderColor="gray.200"
                  borderRadius="md"
                  py={2}
                  px={3}
                  overflowX="auto"
                  fontSize="14px"
                  sx={{ '.katex-display': { margin: 0, textAlign: 'left' } }}
                >
                  <BlockMath math={method.formula} />
                </Box>
                {method.usesAlpha && isSelected && (
                  <HStack spacing={2} align="center" flexWrap="wrap">
                    <Text fontWeight="medium">α:</Text>
                    <Slider
                      value={alphaValue}
                      min={-1}
                      max={1}
                      step={0.01}
                      isDisabled={runningStep !== null}
                      onChange={(value) => setAggregationStepAlphas((prev) => ({ ...prev, [method.id]: Number(value) }))}
                      flex={1}
                    >
                      <SliderTrack>
                        <SliderFilledTrack />
                      </SliderTrack>
                      <SliderThumb />
                    </Slider>
                    <AlphaNumberInput
                      value={alphaValue}
                      onChange={(clamped) => setAggregationStepAlphas((prev) => ({ ...prev, [method.id]: clamped }))}
                      isDisabled={runningStep !== null}
                    />
                  </HStack>
                )}
              </VStack>
            </Box>
          )
        })}
      </SimpleGrid>
      <Text fontSize="xs" color="gray.600">
        α ∈ [-1, 1]. At α = 0 the aggregation is fully compensatory; values toward 1 emphasize poor performance, while values toward -1 emphasize strong performance.
      </Text>
    </VStack>
  )

  const renderSessionSelector = ({
    heading = 'Session Selection',
    helperText,
    showManageLink = true,
    showInfoAlert = true,
  } = {}) => (
    <VStack spacing={3} align="stretch">
      <HStack justify="space-between" align="center">
        <HStack spacing={2} align="center">
          <Heading as="h2" size="sm">
            {heading}
          </Heading>
          {showInfoAlert && (
            <Tooltip
              label="Only completed and locked sessions can be selected. This ensures data integrity during analysis runs."
              hasArrow
            >
              <Box as="span" display="inline-flex" alignItems="center" cursor="help">
                <InfoOutlineIcon color="gray.500" boxSize={3.5} />
              </Box>
            </Tooltip>
          )}
          {incompleteOrUnlockedSessionsExcluded && (
            <Tooltip
              label={`Using ${selectedSessions.length} out of ${completedAndLockedCount} available sessions - ${completedAndLockedCount - selectedSessions.length} completed and locked session(s) not selected.`}
              hasArrow
            >
              <Box as="span" display="inline-flex" alignItems="center" cursor="help">
                <WarningIcon color="orange.400" boxSize={3.5} />
              </Box>
            </Tooltip>
          )}
        </HStack>
        {showManageLink && (
          <Button
            size="sm"
            variant="outline"
            rightIcon={<ExternalLinkIcon />}
            onClick={() => onNavigate && onNavigate('case-study')}
          >
            Manage Sessions
          </Button>
        )}
      </HStack>

      {helperText && (
        <Text fontSize="sm" color="gray.600">
          {helperText}
        </Text>
      )}

      <VStack pl={2} spacing={2} align="stretch">
        {sessions.length > 0 ? (
          sessions.map((session) => {
            const isComplete = isSessionComplete(session, criteria)
            const isLocked = session.session_locked === true
            const canSelect = isComplete && isLocked

            let statusText = ''
            let tooltipLabel = ''

            if (isComplete && isLocked) {
              statusText = '(completed and locked)'
            } else if (isComplete && !isLocked) {
              statusText = '(completed and unlocked)'
              tooltipLabel = 'Session is not locked. Lock it from Manage Sessions to ensure data integrity.'
            } else if (!isComplete && isLocked) {
              statusText = '(incomplete and locked)'
              tooltipLabel = 'Session is incomplete. Complete all elicitation steps first.'
            } else {
              statusText = '(incomplete and unlocked)'
              tooltipLabel = 'Session is incomplete and not locked. Complete all steps and lock it from Manage Sessions.'
            }

            return (
              <Tooltip key={session._id} label={tooltipLabel} isDisabled={canSelect}>
                <HStack spacing={3}>
                  <Checkbox
                    isChecked={selectedSessions.includes(session._id)}
                    onChange={() => handleSessionToggle(session._id)}
                    isDisabled={!canSelect}
                  >
                    {getSessionLabel(session, `Session ${session._id}`)}{' '}
                    <Text as="span" color="gray.500" ml={2}>{statusText}</Text>
                  </Checkbox>
                </HStack>
              </Tooltip>
            )
          })
        ) : (
          <Text color="gray.500">No sessions found</Text>
        )}
      </VStack>
    </VStack>
  )

  // ============================================================================
  // STEP 2: DISTRIBUTION PLOT HELPERS
  // ============================================================================
  const getDistributionDataForAlternative = (stepResults, altIndex) => {
    if (!stepResults?.results_by_elicitation || !stepResults?.alternative_names) return null

    const expertSeries = []
    const allValues = []
    const sortedElicitations = Object.entries(stepResults.results_by_elicitation)
      .sort((a, b) => Number(a[0]) - Number(b[0]))

    sortedElicitations.forEach(([expertIdx, iterations], idx) => {
      const expertName = getSessionLabel(sessions[parseInt(expertIdx)], `Expert ${parseInt(expertIdx) + 1}`)
      const values = iterations.map((row) => Number(row[altIndex])).filter((v) => Number.isFinite(v))
      expertSeries.push({
        label: `E${idx + 1}`,
        expertName,
        values,
      })
      allValues.push(...values)
    })

    if (allValues.length === 0) return null

    const numBins = 180
    const gaussianSigma = 2.5
    const kernelRadius = 7

    const smoothSeries = (series) => {
      const out = new Array(series.length).fill(0)
      const weights = []
      for (let k = -kernelRadius; k <= kernelRadius; k += 1) {
        weights.push(Math.exp(-0.5 * ((k / gaussianSigma) ** 2)))
      }

      for (let i = 0; i < series.length; i += 1) {
        let weighted = 0
        let totalW = 0
        for (let k = -kernelRadius; k <= kernelRadius; k += 1) {
          const idx = Math.max(0, Math.min(series.length - 1, i + k))
          const w = weights[k + kernelRadius]
          weighted += series[idx] * w
          totalW += w
        }
        out[i] = totalW > 0 ? weighted / totalW : 0
      }
      return out
    }

    const densityByExpert = {}
    expertSeries.forEach(({ expertName, values }) => {
      const bins = new Array(numBins).fill(0)
      values.forEach((value) => {
        const clamped = Math.max(0, Math.min(1, value))
        const idx = Math.min(numBins - 1, Math.floor(clamped * numBins))
        bins[idx] += 1
      })

      const normalized = values.length > 0 ? bins.map((count) => count / values.length) : bins
      const smoothed = smoothSeries(normalized)

      const total = smoothed.reduce((acc, value) => acc + value, 0)
      densityByExpert[expertName] = total > 0 ? smoothed.map((value) => value / total) : smoothed
    })

    const densityData = Array.from({ length: numBins }, (_, i) => {
      const x = (i + 0.5) / numBins
      const row = { x }
      expertSeries.forEach(({ expertName }) => {
        row[expertName] = densityByExpert[expertName][i] || 0
      })
      return row
    })

    const distributionSummary = formatPerElicitationDistributionSummary(expertSeries)
    const expertNames = expertSeries.map((entry) => entry.expertName)
    const consensus = computeConsensusQuantification(densityData, expertNames)

    return {
      altName: stepResults.alternative_names[altIndex],
      densityData,
      expertNames,
      expertSeries,
      summaryText: distributionSummary.text,
      summaryLines: distributionSummary.lines,
      consensus,
    }
  }

  const getLegendItems = (stepResults) => {
    if (!stepResults?.results_by_elicitation) return []
    return Object.entries(stepResults.results_by_elicitation)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([expertIdx], idx) => ({
        label: `E${idx + 1}`,
        expertName: getSessionLabel(sessions[parseInt(expertIdx)], `Expert ${parseInt(expertIdx) + 1}`),
      }))
  }

  const interpolateValueFunction = (points, xValue) => {
    const numericX = Number(xValue)
    if (!Array.isArray(points) || points.length < 2 || !Number.isFinite(numericX)) return null

    const sorted = points
      .map((point) => ({ x: Number(point?.x), y: Number(point?.y) }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      .sort((a, b) => a.x - b.x)

    if (sorted.length < 2) return null
    if (numericX <= sorted[0].x) return sorted[0].y
    if (numericX >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].y

    for (let i = 0; i < sorted.length - 1; i += 1) {
      const left = sorted[i]
      const right = sorted[i + 1]
      if (numericX >= left.x && numericX <= right.x) {
        const span = right.x - left.x
        if (span === 0) return left.y
        const t = (numericX - left.x) / span
        return left.y + t * (right.y - left.y)
      }
    }

    return null
  }

  const normalizeWeightSamples = (rawWeightData) => {
    if (Array.isArray(rawWeightData)) {
      return rawWeightData
        .filter((sample) => sample && typeof sample === 'object')
        .map((sample) => Object.fromEntries(
          Object.entries(sample).map(([criterion, value]) => [criterion, Number(value)])
        ))
    }

    if (!rawWeightData || typeof rawWeightData !== 'object') return []

    const criteriaNames = Object.keys(rawWeightData)
      .filter((criterion) => Array.isArray(rawWeightData[criterion]))

    if (criteriaNames.length === 0) return []

    const sampleCount = Math.min(...criteriaNames.map((criterion) => rawWeightData[criterion].length))
    if (!Number.isFinite(sampleCount) || sampleCount <= 0) return []

    return Array.from({ length: sampleCount }, (_, idx) => {
      const row = {}
      criteriaNames.forEach((criterion) => {
        row[criterion] = Number(rawWeightData[criterion][idx])
      })
      return row
    })
  }

  const isHierarchicalStudy = (criteria || []).some((criterion) => {
    const groupName = String(criterion?.group || '').trim().toLowerCase()
    return groupName !== '' && groupName !== 'single-group'
  })

  const weightSpaceSolutionCount = normalizeWeightSamples(weightSpaceData).length

  // UI: toggles for showing per-distribution stats (each table's own defaultOpen sets its initial state)
  const [showDistributionStats, setShowDistributionStats] = useState({})

  const toggleDistributionStats = (key) => {
    setShowDistributionStats((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const formatDistributionStatValue = (value) => {
    const numericValue = Number(value)
    if (!Number.isFinite(numericValue)) return 'n/a'
    return numericValue.toFixed(4)
  }

  const handleDownloadDistributionStatsCsv = (expertSeries, title, filenameBase) => {
    const csvContent = buildDistributionStatsCsv(expertSeries, {
      title,
      placeholderMessage: 'Distribution stats are not available yet.',
    })
    downloadCSVFile(csvContent, `${sanitizeFilename(filenameBase)}.csv`)
  }

  const renderDistributionStatsTable = ({ stepPrefix, altIndex, distData, title, filenameBase, defaultOpen = false }) => {
    const statsKey = `${stepPrefix}_${altIndex}`
    const isOpen = statsKey in showDistributionStats ? showDistributionStats[statsKey] : defaultOpen
    const statsRows = buildDistributionStatsRows(distData?.expertSeries || [])

    return (
      <>
        <HStack justify="space-between" align="center" mb={2} pr={12}>
          <Text fontWeight="semibold" fontSize="sm">{`Distribution of Values for ${distData?.altName || 'Alternative'}`}</Text>
          <Button
            size="sm"
            variant="link"
            rightIcon={(
              <ChevronDownIcon
                transform={isOpen ? 'rotate(180deg)' : 'rotate(0deg)'}
                transition="transform 0.2s ease"
              />
            )}
            onClick={() => toggleDistributionStats(statsKey)}
          >
            Distribution stats
          </Button>
        </HStack>
        <Collapse in={isOpen} animateOpacity>
          <Box mb={3} bg="white" borderWidth={1} borderColor="gray.200" borderRadius="md" p={3}>
            <HStack justify="space-between" mb={3}>
              <Text fontSize="sm" color="gray.700" fontWeight="medium">
                Per-expert uncertainty statistics
              </Text>
              <Tooltip label="Download stats table as CSV" hasArrow>
                <IconButton
                  aria-label={`Download distribution stats table for ${distData?.altName || 'alternative'}`}
                  icon={<DownloadIcon />}
                  size="sm"
                  variant="outline"
                  onClick={() => handleDownloadDistributionStatsCsv(distData?.expertSeries || [], title, filenameBase)}
                />
              </Tooltip>
            </HStack>
            <TableContainer overflowX="auto">
              <Table size="sm" variant="simple">
                <Thead>
                  <Tr>
                    <Th>Expert</Th>
                    {DISTRIBUTION_STAT_COLUMNS.map((column) => (
                      <Th key={column.key}>
                        <HStack spacing={1}>
                          <Text as="span">{column.label}</Text>
                          <Tooltip label={DISTRIBUTION_STAT_TOOLTIPS[column.key] || column.label} hasArrow>
                            <Box as="span" display="inline-flex" alignItems="center">
                              <InfoOutlineIcon color="gray.500" boxSize={3} />
                            </Box>
                          </Tooltip>
                        </HStack>
                      </Th>
                    ))}
                  </Tr>
                </Thead>
                <Tbody>
                  {statsRows.map((row) => (
                    <Tr key={`${row.label}-${row.expertName}`}>
                      <Td>{`${row.label} (${row.expertName})`}</Td>
                      {DISTRIBUTION_STAT_COLUMNS.map((column) => (
                        <Td key={`${row.label}-${row.expertName}-${column.key}`}>
                          {formatDistributionStatValue(row[column.key])}
                        </Td>
                      ))}
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </TableContainer>
          </Box>
        </Collapse>
      </>
    )
  }

  const getConsistencyPlotData = () => {
    const sessionDoc = sessions.find((session) => session?._id === selectedWeightSession)
    const comparisons = Array.isArray(sessionDoc?.bwt?.comparisons) ? sessionDoc.bwt.comparisons : []
    const weightSamples = normalizeWeightSamples(weightSpaceData)

    if (!sessionDoc || comparisons.length === 0 || weightSamples.length === 0) return { data: [], comparisons: [] }

    const valueFunctionMap = sessionDoc?.value_functions?.criteria || {}
    const criteriaMetaMap = Object.fromEntries(
      (criteria || [])
        .filter((criterion) => criterion?.criterion_name)
        .map((criterion) => [criterion.criterion_name, criterion])
    )
    const allDataPoints = []
    const comparisonLabels = []
    const COMPARISON_BAND = 0.7

    comparisons.forEach((comparison, idx) => {
      const referenceCriterion = comparison?.reference_criterion
      const adjustedCriterion = comparison?.adjusted_criterion
      const comparisonValue = Number(comparison?.data_value)

      if (!referenceCriterion || !adjustedCriterion || !Number.isFinite(comparisonValue)) return

      const adjustedCriterionMeta = criteriaMetaMap?.[adjustedCriterion]
      const isQualitativeAdjusted = Boolean(adjustedCriterionMeta?.is_qualitative)
      const adjustedVFPoints = valueFunctionMap?.[adjustedCriterion]?.points

      // Qualitative indicators are modeled with identity VF in computation: vf(x)=x.
      // Ignore any stale stored VF points to keep consistency with worker constraints.
      const vfValue = isQualitativeAdjusted
        ? comparisonValue
        : interpolateValueFunction(adjustedVFPoints, comparisonValue)
      const declaredRatio = Number.isFinite(vfValue) && vfValue > 0 ? (1 / vfValue) : null

      const computedRatios = weightSamples
        .map((sample) => {
          const wReference = Number(sample?.[referenceCriterion])
          const wAdjusted = Number(sample?.[adjustedCriterion])
          if (!Number.isFinite(wReference) || !Number.isFinite(wAdjusted) || wReference <= 0) return null
          return wAdjusted / wReference
        })
        .filter((value) => Number.isFinite(value))

      if (!Number.isFinite(declaredRatio) || computedRatios.length === 0) return

      const comparisonLabel = `${referenceCriterion} / ${adjustedCriterion}`
      comparisonLabels.push(comparisonLabel)

      // Add declared ratio as a single point
      allDataPoints.push({
        comparison: comparisonLabel,
        yIndex: idx,
        yPlot: idx,
        value: Number(declaredRatio.toFixed(4)),
        type: 'declared',
      })

      // Add each computed ratio as an individual plotted point.
      // A tiny deterministic vertical spread avoids exact point overlap.
      const totalComputed = computedRatios.length
      computedRatios.forEach((ratio, solutionIndex) => {
        const localOffset = totalComputed === 1
          ? 0
          : ((solutionIndex / (totalComputed - 1)) - 0.5) * COMPARISON_BAND

        allDataPoints.push({
          comparison: comparisonLabel,
          yIndex: idx,
          yPlot: idx + localOffset,
          value: Number(ratio.toFixed(4)),
          type: 'computed',
          solutionIndex,
        })
      })
    })

    return { data: allDataPoints, comparisons: comparisonLabels }
  }

  const triggerDownloadFromBlob = (blob, filename) => {
    const objectUrl = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(objectUrl)
  }

  // Captures a live Recharts SVG for PNG export. Chart titles/badges rendered as surrounding HTML
  // (not inside the <svg>) are lost by a raw capture, so `headerLines` lets callers prepend them
  // as real SVG text above the chart instead.
  const buildSvgMarkupFromElement = (svgElement, headerLines = []) => {
    if (!svgElement) return null
    const clonedSvg = svgElement.cloneNode(true)
    inlineSvgComputedStyles(svgElement, clonedSvg)
    const bounds = svgElement.getBoundingClientRect()
    const contentWidth = Math.max(1, Math.round(bounds.width || DEFAULT_PNG_WIDTH))
    const contentHeight = Math.max(1, Math.round(bounds.height || DEFAULT_PNG_HEIGHT))
    clonedSvg.setAttribute('width', String(contentWidth))
    clonedSvg.setAttribute('height', String(contentHeight))
    if (!clonedSvg.getAttribute('viewBox')) {
      clonedSvg.setAttribute('viewBox', `0 0 ${contentWidth} ${contentHeight}`)
    }
    clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clonedSvg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')

    const validHeaderLines = (headerLines || []).filter((line) => typeof line === 'string' && line.trim().length > 0)
    if (validHeaderLines.length === 0) {
      return { svgMarkup: new XMLSerializer().serializeToString(clonedSvg), width: contentWidth, height: contentHeight }
    }

    const headerLineHeight = 20
    const headerPaddingTop = 12
    const headerPaddingBottom = 8
    const headerHeight = headerPaddingTop + validHeaderLines.length * headerLineHeight + headerPaddingBottom
    const width = contentWidth
    const height = contentHeight + headerHeight

    clonedSvg.setAttribute('x', '0')
    clonedSvg.setAttribute('y', String(headerHeight))
    const innerSvgMarkup = new XMLSerializer().serializeToString(clonedSvg)

    const headerMarkup = validHeaderLines.map((line, idx) => {
      const y = headerPaddingTop + idx * headerLineHeight + 14
      const fontSize = idx === 0 ? 15 : 12
      const fontWeight = idx === 0 ? '700' : '400'
      const color = idx === 0 ? '#1A202C' : '#4A5568'
      return `<text x="12" y="${y}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="${fontWeight}" fill="${color}">${escapeSvgText(line)}</text>`
    }).join('')

    const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#ffffff" />${headerMarkup}${innerSvgMarkup}</svg>`

    return { svgMarkup, width, height }
  }

  const getPlotSvgElement = (container) => {
    if (!container) return null
    const rechartsSvg = container.querySelector('svg.recharts-surface')
    if (rechartsSvg) return rechartsSvg
    const nonButtonSvg = Array.from(container.querySelectorAll('svg'))
      .find((candidate) => !candidate.closest('button'))
    return nonButtonSvg || null
  }

  const renderSvgMarkupToPngBlob = (svgMarkup, width = DEFAULT_PNG_WIDTH, height = DEFAULT_PNG_HEIGHT) => new Promise((resolve, reject) => {
    const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' })
    const svgUrl = window.URL.createObjectURL(svgBlob)
    const image = new Image()

    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        window.URL.revokeObjectURL(svgUrl)
        reject(new Error('Canvas context could not be created for image export'))
        return
      }
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(image, 0, 0, width, height)
      canvas.toBlob((blob) => {
        window.URL.revokeObjectURL(svgUrl)
        if (!blob) {
          reject(new Error('Failed to generate PNG blob from canvas'))
          return
        }
        resolve(blob)
      }, 'image/png')
    }

    image.onerror = () => {
      window.URL.revokeObjectURL(svgUrl)
      reject(new Error('Failed to load SVG image for PNG conversion'))
    }

    image.src = svgUrl
  })

  const createPolylinePath = (points) => {
    if (!Array.isArray(points) || points.length === 0) return ''
    return `M ${points.map((point) => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' L ')}`
  }

  const createClosedAreaPath = (points, baselineY) => {
    if (points.length === 0) return ''
    const linePart = points.map((point) => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' L ')
    const firstPoint = points[0]
    const lastPoint = points[points.length - 1]
    return `M ${firstPoint.x.toFixed(2)} ${baselineY.toFixed(2)} L ${linePart} L ${lastPoint.x.toFixed(2)} ${baselineY.toFixed(2)} Z`
  }

  const buildConsistencyPlotSvg = ({ title, comparisons, data }) => {
    if (!Array.isArray(comparisons) || comparisons.length === 0 || !Array.isArray(data) || data.length === 0) return null

    const labelFontSize = 11
    const minLeft = 160
    const maxLeft = 460
    const labelPadding = 40
    // Size the label column to fit the longest comparison name (capped), instead of a fixed
    // width that clips or overlaps long names against the axis.
    const measuredMaxLabelWidth = Math.max(
      0,
      ...comparisons.map((comparison) => measureSvgTextWidth(comparison, labelFontSize, '400'))
    )
    const left = Math.min(maxLeft, Math.max(minLeft, measuredMaxLabelWidth + labelPadding))
    const plotWidth = 700
    const width = left + plotWidth + 30
    const top = 82
    const bottom = 55
    const plotHeight = Math.max(220, comparisons.length * 30)
    const height = top + plotHeight + bottom

    const values = data.map((point) => Number(point?.value)).filter((value) => Number.isFinite(value))
    const maxValue = Math.max(1, ...values)
    const minValue = Math.min(0, ...values)
    const yMin = -0.5
    const yMax = Math.max(0.5, comparisons.length - 0.5)

    const scaleX = (value) => left + ((value - minValue) / (maxValue - minValue || 1)) * plotWidth
    const scaleY = (value) => top + ((yMax - value) / (yMax - yMin || 1)) * plotHeight

    const xTicks = Array.from({ length: 6 }, (_, idx) => minValue + ((maxValue - minValue) * idx) / 5)
    const yTicks = comparisons.map((comparison, idx) => ({ label: comparison, y: idx }))

    const declaredPoints = data.filter((point) => point?.type === 'declared')
    const computedPoints = data.filter((point) => point?.type === 'computed')

    const svgMarkup = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <rect width="100%" height="100%" fill="#ffffff" />
        <text x="${left}" y="26" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="#1f2937">${escapeSvgText(title)}</text>
        <text x="${left}" y="42" font-family="Arial, sans-serif" font-size="12" fill="#6b7280">Declared ratios compared to computed weight ratios</text>

        ${xTicks.map((tick) => {
          const x = scaleX(tick)
          return `
            <line x1="${x}" y1="${top}" x2="${x}" y2="${top + plotHeight}" stroke="#e5e7eb" stroke-width="1" />
            <text x="${x}" y="${top + plotHeight + 22}" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" fill="#6b7280">${Number(tick).toFixed(2)}</text>
          `
        }).join('')}

        ${yTicks.map(({ label, y }) => {
          const yPos = scaleY(y)
          const displayLabel = truncateSvgTextToWidth(label, left - labelPadding + 20, labelFontSize, '400')
          return `
            <line x1="${left}" y1="${yPos}" x2="${left + plotWidth}" y2="${yPos}" stroke="#f3f4f6" stroke-width="1" />
            <text x="${left - 10}" y="${yPos + 4}" text-anchor="end" font-family="Arial, sans-serif" font-size="11" fill="#374151"><title>${escapeSvgText(label)}</title>${escapeSvgText(displayLabel)}</text>
          `
        }).join('')}

        ${computedPoints.map((point) => `
          <circle cx="${scaleX(point.value)}" cy="${scaleY(point.yPlot)}" r="4" fill="#48BB78" fill-opacity="0.72" />
        `).join('')}

        ${declaredPoints.map((point) => `
          <polygon points="${scaleX(point.value) - 5},${scaleY(point.yPlot) - 5} ${scaleX(point.value) + 5},${scaleY(point.yPlot)} ${scaleX(point.value) - 5},${scaleY(point.yPlot) + 5} ${scaleX(point.value) - 10},${scaleY(point.yPlot)}" fill="#DD6B20" stroke="#DD6B20" />
        `).join('')}

        <line x1="${left}" y1="${top + plotHeight}" x2="${left + plotWidth}" y2="${top + plotHeight}" stroke="#9ca3af" stroke-width="1.2" />
        <line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotHeight}" stroke="#9ca3af" stroke-width="1.2" />
        <text x="${left + plotWidth / 2}" y="${height - 16}" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" fill="#4b5563">Ratio value</text>

        ${(() => {
          const legendFontSize = 11
          // Icon box is a fixed 12px-wide slot; the label starts iconSlotWidth past the slot's left edge.
          const iconSlotWidth = 12
          const iconToTextGap = 6
          const itemGap = 20
          const legendPaddingX = 14
          const items = [
            {
              label: 'Computed',
              // x here is the left edge of the icon slot.
              renderSwatch: (x, y) => `<circle cx="${x + 4}" cy="${y}" r="4" fill="#48BB78" fill-opacity="0.72" />`,
            },
            {
              label: 'Declared',
              renderSwatch: (x, y) => `<polygon points="${x + 6},${y - 5} ${x + 11},${y} ${x + 6},${y + 5} ${x + 1},${y}" fill="#DD6B20" stroke="#DD6B20" />`,
            },
          ]
          const itemWidths = items.map((item) => iconSlotWidth + iconToTextGap + measureSvgTextWidth(item.label, legendFontSize, '400'))
          const legendContentWidth = itemWidths.reduce((sum, w) => sum + w, 0) + itemGap * (items.length - 1)
          const legendBoxWidth = legendContentWidth + legendPaddingX * 2
          const legendBoxHeight = 22
          const legendBoxX = left + plotWidth - legendBoxWidth
          const legendBoxY = top - 24
          const legendCenterY = legendBoxY + legendBoxHeight / 2

          let cursorX = legendBoxX + legendPaddingX
          const itemsMarkup = items.map((item, idx) => {
            const markup = `
              ${item.renderSwatch(cursorX, legendCenterY)}
              <text x="${cursorX + iconSlotWidth + iconToTextGap}" y="${legendCenterY + 4}" font-family="Arial, sans-serif" font-size="${legendFontSize}" fill="#374151">${escapeSvgText(item.label)}</text>
            `
            cursorX += itemWidths[idx] + itemGap
            return markup
          }).join('')

          return `
            <rect x="${legendBoxX}" y="${legendBoxY}" width="${legendBoxWidth}" height="${legendBoxHeight}" rx="4" fill="#ffffff" stroke="#e5e7eb" />
            ${itemsMarkup}
          `
        })()}
      </svg>
    `.replace(/\n\s+/g, '\n').trim()

    return { svgMarkup, width, height }
  }

  // Self-contained distribution plot builder (no DOM dependency) used for the bulk ZIP export, so
  // charts export correctly regardless of which step tab happens to be active in the browser.
  const buildDistributionPlotSvg = ({ title, altName, subtitleLines = [], densityData, expertNames, summaryLines = [] }) => {
    if (!Array.isArray(densityData) || densityData.length === 0 || !Array.isArray(expertNames) || expertNames.length === 0) return null

    const width = 980
    const right = 30
    const left = 70
    const plotWidth = width - left - right
    const plotHeight = 250
    const summaryLineHeight = 14

    const legendFontSize = 11
    const legendSwatchSize = 10
    const legendSwatchToTextGap = 6
    const legendItemGap = 18
    const legendRowHeight = 18

    const legendItems = expertNames.map((expertName, idx) => ({
      expertName,
      color: STEP2_COLORS[idx % STEP2_COLORS.length],
      itemWidth: legendSwatchSize + legendSwatchToTextGap + measureSvgTextWidth(expertName, legendFontSize, '400'),
    }))
    const legendRows = []
    let currentRow = []
    let currentRowWidth = 0
    legendItems.forEach((item) => {
      const widthWithGap = item.itemWidth + (currentRow.length > 0 ? legendItemGap : 0)
      if (currentRow.length > 0 && currentRowWidth + widthWithGap > plotWidth) {
        legendRows.push(currentRow)
        currentRow = []
        currentRowWidth = 0
      }
      currentRow.push(item)
      currentRowWidth += item.itemWidth + (currentRow.length > 1 ? legendItemGap : 0)
    })
    if (currentRow.length > 0) legendRows.push(currentRow)

    const normalizedSubtitleLines = Array.isArray(subtitleLines) ? subtitleLines.filter((line) => typeof line === 'string' && line.length > 0) : []
    const subtitleY = 44
    const legendStartY = subtitleY + (normalizedSubtitleLines.length > 0 ? 16 : 0) + 12
    const legendHeight = legendRows.length * legendRowHeight
    const top = legendStartY + legendHeight + 14

    const normalizedSummaryLines = Array.isArray(summaryLines)
      ? summaryLines.filter((line) => typeof line === 'string')
      : []
    const printableSummaryLines = normalizedSummaryLines.length > 0
      ? ['Distribution Summary (per elicitation)', '', ...normalizedSummaryLines]
      : []

    const summaryBoxPadding = 12
    const summaryBoxHeight = printableSummaryLines.length > 0
      ? Math.max(62, (printableSummaryLines.length * summaryLineHeight) + (summaryBoxPadding * 2))
      : 0

    const bottom = printableSummaryLines.length > 0
      ? (summaryBoxHeight + 70)
      : 55
    const height = top + plotHeight + bottom
    const summaryBoxY = top + plotHeight + 44

    const maxDensity = Math.max(0.001, ...densityData.flatMap((row) => expertNames.map((name) => Number(row?.[name]) || 0)))
    const scaleX = (value) => left + Math.max(0, Math.min(1, value)) * plotWidth
    const scaleY = (value) => top + ((maxDensity - value) / maxDensity) * plotHeight
    const xTicks = [0, 0.2, 0.4, 0.6, 0.8, 1]

    const series = expertNames.map((expertName, idx) => {
      const color = STEP2_COLORS[idx % STEP2_COLORS.length]
      const points = densityData.map((row) => ({ x: scaleX(Number(row?.x) || 0), y: scaleY(Number(row?.[expertName]) || 0) }))
      return { expertName, color, points }
    }).filter((entry) => entry.points.some((point) => Number.isFinite(point.x) && Number.isFinite(point.y)))

    const fillPolygons = series.map((entry) => {
      const firstPoint = entry.points[0]
      const lastPoint = entry.points[entry.points.length - 1]
      const polygonPoints = [
        `${firstPoint.x.toFixed(2)},${(top + plotHeight).toFixed(2)}`,
        ...entry.points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`),
        `${lastPoint.x.toFixed(2)},${(top + plotHeight).toFixed(2)}`,
      ].join(' ')
      return { ...entry, polygonPoints }
    })

    let legendCursorX = left
    const legendMarkup = legendRows.map((row, rowIdx) => {
      legendCursorX = left
      const rowY = legendStartY + rowIdx * legendRowHeight
      return row.map((item) => {
        const markup = `
          <rect x="${legendCursorX}" y="${rowY - legendSwatchSize + 2}" width="${legendSwatchSize}" height="${legendSwatchSize}" fill="${item.color}" fill-opacity="0.22" stroke="${item.color}" />
          <text x="${legendCursorX + legendSwatchSize + legendSwatchToTextGap}" y="${rowY + 2}" font-family="Arial, sans-serif" font-size="${legendFontSize}" fill="${item.color}">${escapeSvgText(item.expertName)}</text>
        `
        legendCursorX += item.itemWidth + legendItemGap
        return markup
      }).join('')
    }).join('')

    const svgMarkup = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <rect width="100%" height="100%" fill="#ffffff" />
        <text x="${left}" y="26" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="#1f2937">${escapeSvgText(title)}</text>
        <text x="${left}" y="${subtitleY}" font-family="Arial, sans-serif" font-size="12" fill="#6b7280">${escapeSvgText([altName, ...normalizedSubtitleLines].filter(Boolean).join('  ·  '))}</text>

        ${legendMarkup}

        ${xTicks.map((tick) => {
          const x = scaleX(tick)
          return `
            <line x1="${x}" y1="${top}" x2="${x}" y2="${top + plotHeight}" stroke="#e5e7eb" stroke-width="1" />
            <text x="${x}" y="${top + plotHeight + 22}" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" fill="#6b7280">${Number(tick).toFixed(1)}</text>
          `
        }).join('')}

        <line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotHeight}" stroke="#9ca3af" stroke-width="1.2" />
        <line x1="${left}" y1="${top + plotHeight}" x2="${left + plotWidth}" y2="${top + plotHeight}" stroke="#9ca3af" stroke-width="1.2" />
        <text x="${left + plotWidth / 2}" y="${top + plotHeight + 36}" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" fill="#4b5563">Value</text>

        ${fillPolygons.map((entry) => `
          <polygon points="${entry.polygonPoints}" fill="${entry.color}" fill-opacity="0.22" stroke="none" />
        `).join('')}

        ${series.map((entry) => `
          <path d="${createPolylinePath(entry.points)}" fill="none" stroke="${entry.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
        `).join('')}

        ${printableSummaryLines.length > 0 ? `
          <rect
            x="${left}"
            y="${summaryBoxY}"
            width="${plotWidth}"
            height="${summaryBoxHeight}"
            rx="6"
            fill="#f8fafc"
            stroke="#e2e8f0"
          />
          ${printableSummaryLines.map((line, idx) => {
    const y = summaryBoxY + summaryBoxPadding + 12 + (idx * summaryLineHeight)
    const fontWeight = idx === 0 ? '700' : '400'
    return `<text x="${left + summaryBoxPadding}" y="${y}" font-family="Arial, sans-serif" font-size="11" font-weight="${fontWeight}" fill="#334155">${escapeSvgText(line)}</text>`
  }).join('')}
        ` : ''}
      </svg>
    `.replace(/\n\s+/g, '\n').trim()

    return { svgMarkup, width, height }
  }

  const handleDownloadChartPng = async (exportId, filenameBase, headerLines = []) => {
    const container = document.querySelector(`[data-export-id="${exportId}"]`)
    const svgElement = getPlotSvgElement(container)
    const rendered = buildSvgMarkupFromElement(svgElement, headerLines)
    if (!rendered?.svgMarkup) {
      toast({
        title: 'Image not available',
        description: 'The plot is not ready for download yet.',
        status: 'warning',
        duration: 3500,
      })
      return
    }

    try {
      const pngBlob = await renderSvgMarkupToPngBlob(rendered.svgMarkup, rendered.width * PNG_SCALE_FACTOR, rendered.height * PNG_SCALE_FACTOR)
      triggerDownloadFromBlob(pngBlob, `${sanitizeFilename(filenameBase)}.png`)
    } catch (error) {
      toast({
        title: 'Unable to export image',
        description: error.message,
        status: 'error',
        duration: 5000,
      })
    }
  }

  const handleDownloadHeatmapPng = async (results, title, filenameBase) => {
    const rendered = buildRankingHeatmapSvg({ title, results })
    if (!rendered?.svgMarkup) {
      toast({
        title: 'Image not available',
        description: 'No ranking heatmap is available yet.',
        status: 'warning',
        duration: 3500,
      })
      return
    }

    try {
      const pngBlob = await renderSvgMarkupToPngBlob(rendered.svgMarkup, rendered.width * PNG_SCALE_FACTOR, rendered.height * PNG_SCALE_FACTOR)
      triggerDownloadFromBlob(pngBlob, `${sanitizeFilename(filenameBase)}.png`)
    } catch (error) {
      toast({
        title: 'Unable to export image',
        description: error.message,
        status: 'error',
        duration: 5000,
      })
    }
  }

  const handleDownloadWeightSpacePng = async () => {
    const rendered = buildWeightSpacePlotSvg({
      data: weightSpaceData,
      orderedCriteria: (criteria || [])
        .map((criterion) => criterion?.criterion_name)
        .filter((name) => typeof name === 'string' && name.length > 0),
      isNonLinearModel: useNonLinearModel,
      isHierarchicalStudy,
      solutionCount: weightSpaceSolutionCount,
    })

    if (!rendered?.svgMarkup) {
      toast({
        title: 'Image not available',
        description: 'No weight space plot is available yet.',
        status: 'warning',
        duration: 3500,
      })
      return
    }

    try {
      const pngBlob = await renderSvgMarkupToPngBlob(
        rendered.svgMarkup,
        rendered.width * PNG_SCALE_FACTOR,
        rendered.height * PNG_SCALE_FACTOR
      )
      triggerDownloadFromBlob(pngBlob, `${sanitizeFilename('step1_weight_space_plot')}.png`)
    } catch (error) {
      toast({
        title: 'Unable to export image',
        description: error.message,
        status: 'error',
        duration: 5000,
      })
    }
  }

  const fetchWorkflowDataZipBlob = async () => {
    const response = await axios.get(
      `${API_URL}/study-session/${studySessionId}/workflow-export/data`,
      { responseType: 'blob' }
    )

    const disposition = response.headers['content-disposition'] || ''
    const filenameMatch = disposition.match(/filename="?([^";]+)"?/i)
    const filename = filenameMatch?.[1] || 'upmavt_data.zip'
    return { blob: response.data, filename }
  }

  const handleExportWorkflowDataZip = async ({ showSuccessToast = true } = {}) => {
    if (!studySessionId) return

    setExportingDataZip(true)
    try {
      const { blob, filename } = await fetchWorkflowDataZipBlob()
      triggerDownloadFromBlob(blob, filename)

      if (showSuccessToast) {
        toast({
          title: 'Data ZIP exported',
          description: 'The Run UP-MAVT data bundle was downloaded.',
          status: 'success',
          duration: 3500,
        })
      }
      return true
    } catch (error) {
      toast({
        title: 'Unable to export data ZIP',
        description: error.response?.data?.error || error.message,
        status: 'error',
        duration: 5000,
      })
      return false
    } finally {
      setExportingDataZip(false)
    }
  }

  const handleExportFinalResults = async () => {
    if (!exportIncludeResultsCsv && !exportIncludeSimulationCsvs && !exportIncludePlotImages && !exportIncludeStep2ConsensusQuantificationCsv && !exportIncludeStep5UncertaintyStatsCsv && !exportIncludeFullData) {
      toast({
        title: 'Choose at least one export item',
        status: 'warning',
        duration: 3500,
      })
      return
    }

    setExportingResults(true)
    try {
      const exportZip = new JSZip()
      let exportedArtifacts = 0

      if (exportIncludeResultsCsv) {
        const resultsCsv = buildRankProbabilityCsv(step6Results)
        if (resultsCsv) {
          exportZip.file('results/step5_final_results_rank_probabilities.csv', resultsCsv)
          exportedArtifacts += 1
        }
      }

      if (exportIncludeSimulationCsvs) {
        const simulationExports = [
          ...buildSimulationCsvExports(2, step2Results),
          ...buildSimulationCsvExports(4, step4Results),
          ...buildSimulationCsvExports(5, step5Results),
          ...buildSimulationCsvExports(6, step6Results),
        ]
        simulationExports.forEach((entry) => {
          const workflowNamedBase = toWorkflowStepFilenameBase(entry.filenameBase)
          exportZip.file(`results/simulation_csvs/${sanitizeFilename(workflowNamedBase)}.csv`, entry.csvText)
        })
        if (simulationExports.length > 0) {
          exportedArtifacts += 1
        }
      }

      if (exportIncludeStep2ConsensusQuantificationCsv || exportIncludeStep5UncertaintyStatsCsv) {
        if (exportIncludeStep2ConsensusQuantificationCsv) {
          const step2ConsensusRows = (step2Results?.alternative_names || []).map((altName, altIndex) => {
            const distData = getDistributionDataForAlternative(step2Results, altIndex)
            if (!distData?.consensus) return null
            return {
              alternative: altName,
              ...distData.consensus,
            }
          }).filter(Boolean)

          const step2StatsCsv = buildConsensusQuantificationCsv(step2ConsensusRows, {
            title: 'Step 4 consensus analysis quantification',
            placeholderMessage: 'Consensus quantification is not available yet.',
          })
          exportZip.file('results/step4_consensus_analysis_quantification.csv', step2StatsCsv)
          exportedArtifacts += 1
        }

        if (exportIncludeStep5UncertaintyStatsCsv) {
          const step5Stats = (step5Results?.alternative_names || []).flatMap((altName, altIndex) => {
            const distData = getDistributionDataForAlternative(step5Results, altIndex)
            if (!distData) return []
            return distData.expertSeries.map((entry) => ({
              label: `${altName} - ${entry.label}`,
              expertName: entry.expertName,
              values: entry.values,
            }))
          })
          const step5StatsCsv = buildDistributionStatsCsv(step5Stats, {
            title: 'Step 3 uncertainty analysis stats',
            placeholderMessage: 'Uncertainty stats are not available yet.',
          })
          exportZip.file('results/step3_uncertainty_analysis_stats.csv', step5StatsCsv)
          exportedArtifacts += 1
        }
      }

      if (exportIncludeResultsCsv) {
        const finalHeatmap = buildRankingHeatmapSvg({
          title: 'Results Heatmap',
          results: step6Results,
        })
        if (finalHeatmap?.svgMarkup) {
          exportZip.file('results/step5_final_results_ranking_heatmap.svg', finalHeatmap.svgMarkup)
          try {
            const finalHeatmapPng = await renderSvgMarkupToPngBlob(
              finalHeatmap.svgMarkup,
              finalHeatmap.width * PNG_SCALE_FACTOR,
              finalHeatmap.height * PNG_SCALE_FACTOR
            )
            exportZip.file('results/step5_final_results_ranking_heatmap.png', finalHeatmapPng)
          } catch (error) {
            console.error('Unable to export final ranking heatmap as PNG', error)
          }
        }
      }

      if (exportIncludeFullData) {
        const { blob: fullDataZipBlob } = await fetchWorkflowDataZipBlob()
        const fullDataZip = await JSZip.loadAsync(fullDataZipBlob)
        const fullDataFiles = Object.values(fullDataZip.files)
        for (const zipEntry of fullDataFiles) {
          if (zipEntry.dir) continue
          const content = await zipEntry.async('uint8array')
          exportZip.file(`full_data/${zipEntry.name}`, content)
        }
        if (fullDataFiles.some((entry) => !entry.dir)) {
          exportedArtifacts += 1
        }
      }

      if (exportIncludePlotImages) {
        const imageTargets = []

        const consistencyData = getConsistencyPlotData()
        const consistencyRendered = buildConsistencyPlotSvg({
          title: 'Declared vs Computed Ratios',
          comparisons: consistencyData.comparisons,
          data: consistencyData.data,
        })
        if (consistencyRendered?.svgMarkup) {
          imageTargets.push({
            filenameBase: 'step1_declared_computed_ratios',
            svgMarkup: consistencyRendered.svgMarkup,
            width: consistencyRendered.width,
            height: consistencyRendered.height,
          })
        }

        const weightSpaceRendered = weightSpaceData
          ? buildWeightSpacePlotSvg({
            data: weightSpaceData,
            orderedCriteria: (criteria || [])
              .map((criterion) => criterion?.criterion_name)
              .filter((name) => typeof name === 'string' && name.length > 0),
            isNonLinearModel: useNonLinearModel,
            isHierarchicalStudy,
            solutionCount: weightSpaceSolutionCount,
          })
          : null

        if (weightSpaceRendered?.svgMarkup) {
          imageTargets.push({
            filenameBase: 'step1_weight_space_plot',
            svgMarkup: weightSpaceRendered.svgMarkup,
            width: weightSpaceRendered.width,
            height: weightSpaceRendered.height,
          })
        }

        // Built from step-result data directly (not captured from the live DOM) so these images
        // export correctly even when their step's tab isn't the one currently open in the browser.
        const appendDistributionTargets = (stepResults, stepPrefix, plotTitle, includeConsensus) => {
          if (!stepResults?.alternative_names) return
          stepResults.alternative_names.forEach((altName, altIndex) => {
            const distData = getDistributionDataForAlternative(stepResults, altIndex)
            if (!distData) return

            const subtitleLines = includeConsensus
              ? [`Consensus = ${Number(distData.consensus?.consensusPercent || 0).toFixed(2)}%`]
              : []

            const rendered = buildDistributionPlotSvg({
              title: plotTitle,
              altName,
              subtitleLines,
              densityData: distData.densityData,
              expertNames: distData.expertNames,
              summaryLines: distData.summaryLines,
            })
            if (!rendered?.svgMarkup) return

            imageTargets.push({
              filenameBase: `${stepPrefix}_distribution_${altIndex}`,
              svgMarkup: rendered.svgMarkup,
              width: rendered.width,
              height: rendered.height,
            })
          })
        }

        appendDistributionTargets(step2Results, 'step2', 'Distribution of Values', true)
        appendDistributionTargets(step5Results, 'step5', 'Uncertainty Distribution', false)

        const heatmapTargets = buildPipelineHeatmapExports({
          step4Results,
          step6Results,
        })

        for (const target of heatmapTargets) {
          const rendered = buildRankingHeatmapSvg({ title: target.title, results: target.results })
          if (!rendered?.svgMarkup) continue
          imageTargets.push({ filenameBase: target.filenameBase, svgMarkup: rendered.svgMarkup, width: rendered.width, height: rendered.height })
        }

        if (imageTargets.length > 0) {
          exportedArtifacts += 1
        }

        for (const image of imageTargets) {
          const workflowNamedBase = toWorkflowStepFilenameBase(image.filenameBase)
          exportZip.file(`images/${sanitizeFilename(workflowNamedBase)}.svg`, image.svgMarkup)

          try {
            const pngBlob = await renderSvgMarkupToPngBlob(
              image.svgMarkup,
              image.width * PNG_SCALE_FACTOR,
              image.height * PNG_SCALE_FACTOR
            )
            exportZip.file(`images/${sanitizeFilename(workflowNamedBase)}.png`, pngBlob)
          } catch (error) {
            console.error(`Unable to export ${image.filenameBase} as PNG`, error)
          }
        }
      }

      if (!exportedArtifacts) {
        exportZip.file('README.txt', 'No selected artifacts were available for this session export.')
      }

      const zipBlob = await exportZip.generateAsync({ type: 'blob' })
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      triggerDownloadFromBlob(zipBlob, `upmavt_export_${timestamp}.zip`)

      toast({
        title: 'Results exported',
        description: 'Your selected artifacts were packaged into a single ZIP download.',
        status: 'success',
        duration: 3500,
      })
      onExportResultsClose()
    } catch (error) {
      toast({
        title: 'Unable to export results',
        description: error.message,
        status: 'error',
        duration: 5000,
      })
    } finally {
      setExportingResults(false)
    }
  }

  // ============================================================================
  // RENDER
  // ============================================================================
  if (loadingStudy) {
    return (
      <Box bg="white" p={6} borderRadius="lg" boxShadow="sm">
        <VStack spacing={4} align="center" py={8}>
          <Spinner size="lg" />
          <Text>Loading study data...</Text>
        </VStack>
      </Box>
    )
  }

  const step1ConsistencyResult = getConsistencyPlotData()
  const step1ConsistencyData = step1ConsistencyResult.data
  const step1ConsistencyComparisons = step1ConsistencyResult.comparisons

  return (
    <Box bg="white" p={6} borderRadius="lg" boxShadow="sm">
      <VStack spacing={6} align="stretch">
        {/* Header */}
        <HStack justify="space-between" align="center" flexWrap="wrap">
          <Heading as="h1" size="lg">
            Run UP-MAVT
          </Heading>
          <Button
            size="sm"
            colorScheme="blue"
            leftIcon={<DownloadIcon />}
            onClick={handleExportWorkflowDataZip}
            isLoading={exportingDataZip}
            loadingText="Exporting"
          >
            Download Data ZIP
          </Button>
        </HStack>

        <Divider />

        {/* Workflow Steps */}
        <VStack spacing={4} align="stretch">
          <Heading as="h2" size="md">
            Workflow
          </Heading>

          <Tabs index={activeStep} onChange={setActiveStep} variant="soft-rounded" colorScheme="blue">
            <TabList
              overflowX="auto"
              pb={2}
              position="sticky"
              top={0}
              zIndex={2}
              bg="white"
              borderBottomWidth={1}
              borderColor="gray.100"
            >
              <Tab>
                Introduction
              </Tab>
              <Tab isDisabled={isStepDisabled(1)}>
                Step 1: Finalize Elicited data {weightsComputed && <Badge ml={2} colorScheme="green">Done</Badge>}
              </Tab>
              <Tab isDisabled={isStepDisabled(2)}>
                Step 2: Choose Aggregation Method {getStepStatus(4)?.completed && <Badge ml={2} colorScheme="green">Done</Badge>}
              </Tab>
              <Tab isDisabled={isStepDisabled(3)}>
                Step 3: Uncertainty Analysis {getStepStatus(5)?.completed && <Badge ml={2} colorScheme="green">Done</Badge>}
              </Tab>
              <Tab isDisabled={isStepDisabled(4)}>
                Step 4: Consensus Analysis {getStepStatus(2)?.completed && <Badge ml={2} colorScheme="green">Done</Badge>}
              </Tab>
              <Tab isDisabled={isStepDisabled(5)}>
                Step 5: Final Results {getStepStatus(6)?.completed && <Badge ml={2} colorScheme="green">Done</Badge>}
              </Tab>
            </TabList>

            <TabPanels>
              {/* Introduction */}
              <TabPanel>
                <VStack spacing={5} align="stretch">
                  <Text color="gray.700">
                    Uncertainty Propagated - Multi-Attribute Value Theory (UP-MAVT) is an extension of traditional MAVT, developed by Pagliuca et al. (2026 - publication forthcoming) to systematically incorporate uncertainty into the decision analysis process.
                    {' '}
                    <Link color="blue.600" textDecoration="underline" cursor="pointer" onClick={onUncertaintiesOpen}>
                      This diagram illustrates the sources of uncertainty considered in the framework.  
                      The UP-MAVT workflow guides the practitioner through the analysis, in the five steps that are detailed below.
                      
                    </Link>
                  </Text>

                  <Box>
                    <Heading as="h3" size="sm" mb={1}>Step 1 — Finalize Elicited Data</Heading>
                    <Text color="gray.700" mb={2}>
                      This step reviews the elicited data and runs the preliminary computation needed to derive each session's feasible weight space. It is a hard prerequisite: Steps 2-5 remain disabled until it completes.
                      It also lets the practitioner adjust each expert's self-declared confidence to correct for over- or under-estimation of their own judgment; the confirmed confidence, which is <b>not</b> shown on the expert's end, is used to determine the uncertainty of their judgment, which is propagated along with the other sources of uncertainty.
                    </Text>
                    <Text fontWeight="semibold" color="gray.700" mb={1}>What you do:</Text>
                    <OrderedList spacing={1} color="gray.700" pl={2}>
                      <ListItem>Select the completed &amp; locked sessions you want to include.</ListItem>
                      <ListItem>(Optional) Open <b>Advanced</b> if you need to change the sampling parameters (target valid solutions, restarts, RNG seed, tolerances) — the defaults work for most studies, leave them alone unless you have a specific reason.</ListItem>
                      <ListItem>Click <b>Run Compute Weights</b>.</ListItem>
                      <ListItem>Review the <b>Weight Space Plot</b> for each session — it shows the region of feasible criteria weights implied by each expert's answers.</ListItem>
                      <ListItem>Open <b>Declared vs Computed Ratios</b> to sanity-check that the weight ratios the algorithm derived roughly match what the expert declared. A session with wildly diverging ratios may indicate confused or contradictory input.</ListItem>
                      <ListItem>In <b>Confidence Review</b>, look at each expert's self-declared confidence and adjust it if you have reason to believe it's over- or under-stated (e.g., you observed hesitation during elicitation, or the consistency check in the previous point flags a problem). Adjustments can be applied overall, to all quantitative indicators, to all value functions, or per criterion — more specific adjustments override general ones. Adjusted values are clipped to the 0-4 scale and are never shown back to the expert.</ListItem>
                    </OrderedList>
                  </Box>

                  <Divider />

                  <Box>
                    <Heading as="h3" size="sm" mb={1}>Step 2 — Choose Aggregation Method</Heading>
                    <Text color="gray.700" mb={2}>
                      The original aggregation method for MAVT is WAM (Weighted Arithmetic Mean), a fully compensatory method: poor performance on one indicator can be completely offset by strong performance on another, equally weighted indicator.
                      This philosophy does not always reflect how a decision-maker actually approaches the problem — for example, a risk-averse decision-maker facing high-stakes choices may want poor-performing indicators to weigh more heavily rather than be offset.
                      This is why partially compensatory methods such as GEO and HAR exist, and why the more advanced methods expose a parameter that lets the practitioner calibrate the bias toward poor or strong performance.
                      This step lets you see, side by side, whether the ranking is sensitive to the choice of aggregation method before you commit to one for the rest of the analysis.
                      {' '}The α-parameterized methods (GEO+offset, WAM+MIN, WPM, WEM) implement the non-additive aggregation approach of{' '}
                      <Link href="https://doi.org/10.1016/j.omega.2018.05.011" isExternal color="blue.600" textDecoration="underline">
                        Haag et al. (2019) <ExternalLinkIcon mx="2px" />
                      </Link>
                      .
                    </Text>
                    <Text fontWeight="semibold" color="gray.700" mb={1}>What you do:</Text>
                    <OrderedList spacing={1} color="gray.700" pl={2}>
                      <ListItem>Check one or more of the seven aggregation methods: WAM, GEO, HAR, GEO+offset, WAM+MIN, WPM, WEM.</ListItem>
                      <ListItem>
                        For the methods that use it, set <b>α</b> between −1 and 1:
                        <UnorderedList spacing={1} mt={1}>
                          <ListItem><InlineMath math={'\\alpha = 0'} /> → fully compensatory (a weak criterion can be offset by a strong one).</ListItem>
                          <ListItem><InlineMath math={'\\alpha \\to 1'} /> → penalizes poor performance on any single criterion more heavily.</ListItem>
                          <ListItem><InlineMath math={'\\alpha \\to -1'} /> → rewards strong performance more heavily.</ListItem>
                        </UnorderedList>
                      </ListItem>
                      <ListItem>Set the number of Monte Carlo iterations (the default is fine in most cases).</ListItem>
                      <ListItem>Click <b>Run</b> and compare the resulting <b>ranking heatmaps</b>, one per method — each shows how often each alternative lands in each rank.</ListItem>
                    </OrderedList>
                  </Box>

                  <Divider />

                  <Box>
                    <Heading as="h3" size="sm" mb={1}>Step 3 — Uncertainty Analysis</Heading>
                    <Text color="gray.700" mb={2}>
                      Because SMC keeps each expert's simulation separate, it returns a value distribution for every alternative and lets you assess the degree of uncertainty around it.
                      If a distribution's uncertainty is too large to draw a meaningful conclusion, that is a signal to go back and review the input data.
                    </Text>
                    <Text fontWeight="semibold" color="gray.700" mb={1}>What you do:</Text>
                    <OrderedList spacing={1} color="gray.700" pl={2}>
                      <ListItem>Pick a single aggregation method and α (informed by what you saw in Step 2).</ListItem>
                      <ListItem>Set the Monte Carlo iteration count (the default is fine in most cases) and run SMC.</ListItem>
                      <ListItem>Inspect the per-alternative value distribution plots, one per expert — look at spread and skew, and watch for unusually wide distributions.</ListItem>
                      <ListItem>If needed, use the distribution statistics table (mean, median, std. dev., IQR, skewness, kurtosis, percentiles) for a numeric read on how uncertain each alternative's value is.</ListItem>
                    </OrderedList>
                  </Box>

                  <Divider />

                  <Box>
                    <Heading as="h3" size="sm" mb={1}>Step 4 — Consensus Analysis</Heading>
                    <Text color="gray.700" mb={2}>
                      This step quantifies expert agreement by evaluating the overlap between expert judgments. The practitioner may use it to identify distinct groups of experts worth analyzing separately, or to identify outliers that should be excluded at this stage.
                    </Text>
                    <Text fontWeight="semibold" color="gray.700" mb={1}>What you do:</Text>
                    <OrderedList spacing={1} color="gray.700" pl={2}>
                      <ListItem>Pick the aggregation method, α, and iteration count (left column), then run the analysis.</ListItem>
                      <ListItem>
                        Read the consensus score <InlineMath math={'C = \\frac{A}{N-1}'} />, where <InlineMath math={'A = \\sum_x \\left|\\max_i p_i(x) - \\sum_i p_i(x)\\right|'} /> is the average absolute gap between each expert's distribution and the group's maximum overlap at each point. Higher values mean the experts agree more; lower values mean their opinions diverge.
                      </ListItem>
                      <ListItem>If needed, use the session list on the right to exclude opinions from this step and from the final results, then re-run.</ListItem>
                    </OrderedList>
                  </Box>

                  <Divider />

                  <Box>
                    <Heading as="h3" size="sm" mb={1}>Step 5 — Final Results</Heading>
                    <Text color="gray.700" mb={2}>
                      This is the deliverable: a ranking of alternatives produced with NSMC mode using the choices you validated in the previous steps, packaged for reporting.
                    </Text>
                    <Text fontWeight="semibold" color="gray.700" mb={1}>What you do:</Text>
                    <OrderedList spacing={1} color="gray.700" pl={2}>
                      <ListItem>Pick the previously chosen aggregation method and α if needed; the default MC iteration count is fine in most cases.</ListItem>
                      <ListItem>Click <b>Run</b> to get the final ranking heatmap.</ListItem>
                      <ListItem>Click <b>Export Results</b> to choose which artifacts to download.</ListItem>
                    </OrderedList>
                  </Box>

                  <Divider />

                  <Box>
                    <Heading as="h3" size="sm" mb={2}>Quick reference</Heading>
                    <TableContainer>
                      <Table size="sm" variant="simple">
                        <Thead>
                          <Tr>
                            <Th>Term</Th>
                            <Th>Meaning</Th>
                          </Tr>
                        </Thead>
                        <Tbody>
                          <Tr>
                            <Td fontWeight="semibold">SMC</Td>
                            <Td>Strict Monte Carlo — keeps each decision-maker's distribution separate.</Td>
                          </Tr>
                          <Tr>
                            <Td fontWeight="semibold">NSMC</Td>
                            <Td>Non-Strict Monte Carlo — pools all decision-makers into one distribution per alternative.</Td>
                          </Tr>
                          <Tr>
                            <Td fontWeight="semibold">α (alpha)</Td>
                            <Td>Compensation dial for aggregation methods, −1 to 1; 0 = fully compensatory.</Td>
                          </Tr>
                          <Tr>
                            <Td fontWeight="semibold">Weight space / z*</Td>
                            <Td>The region of criteria weights consistent with an expert's answers, and its boundary, computed in Step 1.</Td>
                          </Tr>
                          <Tr>
                            <Td fontWeight="semibold">Confidence adjustment</Td>
                            <Td>Practitioner-side correction to an expert's self-declared confidence; hierarchical (overall → QI/VF → per-criterion), clipped to 0-4.</Td>
                          </Tr>
                          <Tr>
                            <Td fontWeight="semibold">Consensus (C)</Td>
                            <Td><InlineMath math={'C = A / (N-1)'} /> — agreement score between decision-makers' distributions, computed in Step 4.</Td>
                          </Tr>
                          <Tr>
                            <Td fontWeight="semibold">Ranking heatmap</Td>
                            <Td>Chart showing how often each alternative lands in each rank position.</Td>
                          </Tr>
                          <Tr>
                            <Td fontWeight="semibold">MC iterations</Td>
                            <Td>Number of Monte Carlo samples drawn for a given run; higher = smoother/more stable results, slower run.</Td>
                          </Tr>
                        </Tbody>
                      </Table>
                    </TableContainer>
                  </Box>

                  <Divider />

                  <Box>
                    <Heading as="h3" size="sm" mb={1}>Resources</Heading>
                    <VStack align="stretch" spacing={1}>
                      <Text color="gray.700">
                        <Link color="blue.600" textDecoration="underline" cursor="pointer" onClick={onMcModesOpen}>
                          The logic behind SMC and NSMC is detailed in this diagram.
                        </Link>
                      </Text>
                      <Text color="gray.700">
                        Software paper (SoftwareX): <Text as="span" fontStyle="italic" color="gray.500">coming soon.</Text>
                      </Text>
                      <Text color="gray.700">
                        Method paper (European Journal of Operational Research), detailing the UP-MAVT methodology and workflow: <Text as="span" fontStyle="italic" color="gray.500">coming soon.</Text>
                      </Text>
                      <Text color="gray.700">
                        The α-parameterized (partially compensatory) aggregation methods used in Step 2 follow{' '}
                        <Link href="https://doi.org/10.1016/j.omega.2018.05.011" isExternal color="blue.600" textDecoration="underline">
                          Haag, F., Lienert, J., Schuwirth, N., &amp; Reichert, P. (2019). Identifying non-additive multi-attribute value functions based on uncertain indifference statements. <i>Omega</i>, 85, 49-67. <ExternalLinkIcon mx="2px" />
                        </Link>
                      </Text>
                      <Text color="gray.700">
                        For the full project source code, see the{' '}
                        <Link href="https://github.com/simo-pagliu/UP-MAVT-Suite" isExternal color="blue.600" textDecoration="underline">
                          repository <ExternalLinkIcon mx="2px" />
                        </Link>
                        .
                      </Text>
                      <Text color="gray.700">
                        To run this study locally, use the <b>Download Data ZIP</b> action above. It exports a runnable local bundle with scripts and CSV data for the selected study.
                      </Text>
                    </VStack>
                  </Box>
                </VStack>
              </TabPanel>

              {/* Step 1: Compute Weights */}
              <TabPanel>
                <VStack spacing={6} align="stretch">
                  {renderSessionSelector()}

                  <Divider />

                  <StepSection
                    title="Compute Weights"
                  description={
                    <VStack spacing={2} align="stretch">
                      <Text>
                        Step 1 computes the critical boundary level z*, samples candidate weights,
                        then filters to the boundary band and stores rounded, deduplicated solutions.
                        Additional controls are available in the Advanced panel.
                      </Text>
                      <Text>
                        For background on the general workflow, see the forthcoming UP-MAVT method paper: <Text as="span" fontStyle="italic" color="gray.500">coming soon.</Text>
                      </Text>
                      <Alert status="info" borderRadius="md">
                        <AlertIcon />
                        <AlertDescription>
                          <strong>Important:</strong> This step is required to unlock all following workflow steps.
                          Steps 2-6 will remain disabled until weights are computed and saved.
                        </AlertDescription>
                      </Alert>
                      <Alert status="warning" borderRadius="md">
                        <AlertIcon />
                        <AlertDescription>
                          Due to the complexity of the search, this process can take some minutes. Please be patient.
                        </AlertDescription>
                      </Alert>
                    </VStack>
                  }
                  onRun={() => handleComputeWeights()}
                  onStop={handleStopExecution}
                  isRunning={runningStep === 'weights'}
                  isDisabled={runningStep !== null || selectedSessions.length === 0}
                  showConsole={showConsole}
                  consoleOutput={consoleOutput}
                  onToggleConsole={() => setShowConsole(!showConsole)}
                  controlMeta={weightsComputed ? (
                    <HStack spacing={2}>
                      <Text fontSize="sm" color="gray.600">
                        Last computed: {formatTimestamp(weightsTimestamp) || '-'}
                      </Text>
                      <Button
                        size="sm"
                        variant="outline"
                        colorScheme="orange"
                        onClick={handleResetWeights}
                      >
                        Reset Weights
                      </Button>
                    </HStack>
                  ) : null}
                  parametersCollapsible
                  parametersTitle="Advanced"
                  parameters={
                    <VStack spacing={3} align="stretch">
                      <Box>
                        <Text fontWeight="medium" mb={1}>Target Valid Solutions</Text>
                        <NumberInput
                          value={maxResults}
                          min={1}
                          max={500}
                          step={1}
                          isDisabled={runningStep !== null}
                          onChange={(_, valueAsNumber) => {
                            if (Number.isFinite(valueAsNumber)) {
                              const clamped = Math.max(1, Math.min(500, valueAsNumber))
                              setMaxResults(clamped)
                            }
                          }}
                        >
                          <NumberInputField />
                          <NumberInputStepper>
                            <NumberIncrementStepper />
                            <NumberDecrementStepper />
                          </NumberInputStepper>
                        </NumberInput>
                        <Text fontSize="sm" color="gray.600" mt={1}>
                          Maximum number of valid weight solutions to collect. Higher values might compromise web page responsiveness. Default is 10.
                        </Text>
                      </Box>

                      <Box>
                        <Text fontWeight="medium" mb={1}>Maximum Restart Attempts</Text>
                        <NumberInput
                          value={maxRestarts}
                          min={10}
                          max={5000}
                          step={10}
                          isDisabled={runningStep !== null}
                          onChange={(_, valueAsNumber) => {
                            if (Number.isFinite(valueAsNumber)) {
                              const clamped = Math.max(10, Math.min(5000, valueAsNumber))
                              setMaxRestarts(clamped)
                            }
                          }}
                        >
                          <NumberInputField />
                          <NumberInputStepper>
                            <NumberIncrementStepper />
                            <NumberDecrementStepper />
                          </NumberInputStepper>
                        </NumberInput>
                        <Text fontSize="sm" color="gray.600" mt={1}>
                          Maximum number of search attempts to find valid solutions. Increasing this will prolong the runtime. Default is 300.
                        </Text>
                      </Box>

                      <Box>
                        <Text fontWeight="medium" mb={1}>RNG Seed</Text>
                        <NumberInput
                          value={rngSeed}
                          min={0}
                          max={1000000000}
                          step={1}
                          isDisabled={runningStep !== null}
                          onChange={(_, valueAsNumber) => {
                            if (Number.isFinite(valueAsNumber)) {
                              setRngSeed(Math.max(0, Math.floor(valueAsNumber)))
                            }
                          }}
                        >
                          <NumberInputField />
                          <NumberInputStepper>
                            <NumberIncrementStepper />
                            <NumberDecrementStepper />
                          </NumberInputStepper>
                        </NumberInput>
                        <Text fontSize="sm" color="gray.600" mt={1}>
                          Seed for randomized restarts in Step B. Default is 426.
                        </Text>
                      </Box>

                      <Box>
                        <Text fontWeight="medium" mb={1}>EPS</Text>
                        <NumberInput
                          value={eps}
                          min={1e-12}
                          max={1}
                          step={0.0001}
                          precision={6}
                          isDisabled={runningStep !== null}
                          onChange={(_, valueAsNumber) => {
                            if (Number.isFinite(valueAsNumber)) {
                              setEps(Math.max(1e-12, valueAsNumber))
                            }
                          }}
                        >
                          <NumberInputField />
                          <NumberInputStepper>
                            <NumberIncrementStepper />
                            <NumberDecrementStepper />
                          </NumberInputStepper>
                        </NumberInput>
                        <Text fontSize="sm" color="gray.600" mt={1}>
                          Numerical floor used in ratio calculations to avoid division by zero. Default is 0.001.
                        </Text>
                      </Box>

                      <Box>
                        <Text fontWeight="medium" mb={1}>Feasibility Tolerance</Text>
                        <NumberInput
                          value={feasibilityTol}
                          min={0}
                          max={1}
                          step={0.001}
                          precision={6}
                          isDisabled={runningStep !== null}
                          onChange={(_, valueAsNumber) => {
                            if (Number.isFinite(valueAsNumber)) {
                              setFeasibilityTol(Math.max(0, valueAsNumber))
                            }
                          }}
                        >
                          <NumberInputField />
                          <NumberInputStepper>
                            <NumberIncrementStepper />
                            <NumberDecrementStepper />
                          </NumberInputStepper>
                        </NumberInput>
                        <Text fontSize="sm" color="gray.600" mt={1}>
                          Stored as runtime tolerance metadata for feasibility checks. Default is 0.01.
                        </Text>
                      </Box>

                      <Box>
                        <Text fontWeight="medium" mb={1}>SLSQP Max Iterations</Text>
                        <NumberInput
                          value={slsqpMaxiter}
                          min={1}
                          max={20000}
                          step={50}
                          isDisabled={runningStep !== null}
                          onChange={(_, valueAsNumber) => {
                            if (Number.isFinite(valueAsNumber)) {
                              setSlsqpMaxiter(Math.max(1, Math.floor(valueAsNumber)))
                            }
                          }}
                        >
                          <NumberInputField />
                          <NumberInputStepper>
                            <NumberIncrementStepper />
                            <NumberDecrementStepper />
                          </NumberInputStepper>
                        </NumberInput>
                        <Text fontSize="sm" color="gray.600" mt={1}>
                          Maximum SLSQP iterations per restart. Default is 500.
                        </Text>
                      </Box>

                      <Box>
                        <Text fontWeight="medium" mb={1}>SLSQP Function Tolerance (ftol)</Text>
                        <NumberInput
                          value={slsqpFtol}
                          min={1e-16}
                          max={1e-2}
                          step={1e-10}
                          precision={12}
                          isDisabled={runningStep !== null}
                          onChange={(_, valueAsNumber) => {
                            if (Number.isFinite(valueAsNumber)) {
                              setSlsqpFtol(Math.max(1e-16, valueAsNumber))
                            }
                          }}
                        >
                          <NumberInputField />
                          <NumberInputStepper>
                            <NumberIncrementStepper />
                            <NumberDecrementStepper />
                          </NumberInputStepper>
                        </NumberInput>
                        <Text fontSize="sm" color="gray.600" mt={1}>
                          Convergence tolerance for SLSQP objective value. Default is 1e-10.
                        </Text>
                      </Box>

                      <Box>
                        <Text fontWeight="medium" mb={1}>Output Weight Decimals</Text>
                        <NumberInput
                          value={outputWeightDecimals}
                          min={0}
                          max={10}
                          step={1}
                          isDisabled={runningStep !== null}
                          onChange={(_, valueAsNumber) => {
                            if (Number.isFinite(valueAsNumber)) {
                              const clamped = Math.max(0, Math.min(10, Math.floor(valueAsNumber)))
                              setOutputWeightDecimals(clamped)
                            }
                          }}
                        >
                          <NumberInputField />
                          <NumberInputStepper>
                            <NumberIncrementStepper />
                            <NumberDecrementStepper />
                          </NumberInputStepper>
                        </NumberInput>
                        <Text fontSize="sm" color="gray.600" mt={1}>
                          Decimal precision used for deduplication and final output. Default is 3.
                        </Text>
                      </Box>

                      <Box>
                        <Text fontWeight="medium" mb={1}>DE Population Size</Text>
                        <NumberInput
                          value={dePopsize}
                          min={1}
                          max={200}
                          step={1}
                          isDisabled={runningStep !== null}
                          onChange={(_, valueAsNumber) => {
                            if (Number.isFinite(valueAsNumber)) {
                              setDePopsize(Math.max(1, Math.floor(valueAsNumber)))
                            }
                          }}
                        >
                          <NumberInputField />
                          <NumberInputStepper>
                            <NumberIncrementStepper />
                            <NumberDecrementStepper />
                          </NumberInputStepper>
                        </NumberInput>
                        <Text fontSize="sm" color="gray.600" mt={1}>
                          Differential Evolution population multiplier. Default is 15.
                        </Text>
                      </Box>

                      <Box>
                        <Text fontWeight="medium" mb={1}>DE Max Iterations</Text>
                        <NumberInput
                          value={deMaxiter}
                          min={1}
                          max={20000}
                          step={50}
                          isDisabled={runningStep !== null}
                          onChange={(_, valueAsNumber) => {
                            if (Number.isFinite(valueAsNumber)) {
                              setDeMaxiter(Math.max(1, Math.floor(valueAsNumber)))
                            }
                          }}
                        >
                          <NumberInputField />
                          <NumberInputStepper>
                            <NumberIncrementStepper />
                            <NumberDecrementStepper />
                          </NumberInputStepper>
                        </NumberInput>
                        <Text fontSize="sm" color="gray.600" mt={1}>
                          Maximum Differential Evolution iterations in Step A. Default is 1000.
                        </Text>
                      </Box>

                      <Box>
                        <Text fontWeight="medium" mb={1}>DE Seed</Text>
                        <NumberInput
                          value={deSeed}
                          min={0}
                          max={1000000000}
                          step={1}
                          isDisabled={runningStep !== null}
                          onChange={(_, valueAsNumber) => {
                            if (Number.isFinite(valueAsNumber)) {
                              setDeSeed(Math.max(0, Math.floor(valueAsNumber)))
                            }
                          }}
                        >
                          <NumberInputField />
                          <NumberInputStepper>
                            <NumberIncrementStepper />
                            <NumberDecrementStepper />
                          </NumberInputStepper>
                        </NumberInput>
                        <Text fontSize="sm" color="gray.600" mt={1}>
                          Random seed for Differential Evolution in Step A. Default is 426.
                        </Text>
                      </Box>

                      <Box>
                        <Text fontWeight="medium" mb={1}>Boundary upper band LIM (%)</Text>
                        <NumberInput
                          value={phase3TolerancePct}
                          min={0}
                          max={100}
                          step={0.1}
                          precision={2}
                          isDisabled={runningStep !== null || !useNonLinearModel}
                          onChange={(_, valueAsNumber) => {
                            if (Number.isFinite(valueAsNumber)) {
                              const clamped = Math.max(0, Math.min(100, valueAsNumber))
                              setPhase3TolerancePct(clamped)
                            }
                          }}
                        >
                          <NumberInputField />
                          <NumberInputStepper>
                            <NumberIncrementStepper />
                            <NumberDecrementStepper />
                          </NumberInputStepper>
                        </NumberInput>
                        <Text fontSize="sm" color="gray.600" mt={1}>
                          Upper boundary cap uses z_cap = z_star + z_star * LIM. Default is 1%.
                        </Text>
                      </Box>

                      <Checkbox
                        isChecked={useNonLinearModel}
                        onChange={(e) => setUseNonLinearModel(e.target.checked)}
                        isDisabled={runningStep !== null}
                      >
                        Use non-linear model
                      </Checkbox>
                      <Text fontSize="sm" color="gray.600">
                        (Non-linear model allows for evaluation of weight space, linear model return a single weight set)
                      </Text>
                    </VStack>
                  }
                  statusInfo={null}
                >
                  <VStack spacing={6} align="stretch">
                    {weightsComputed && (
                    <VStack spacing={3} align="stretch">
                      <HStack spacing={3}>
                        <Text fontWeight="bold">View weight space for:</Text>
                        <Select
                          value={selectedWeightSession}
                          onChange={(e) => setSelectedWeightSession(e.target.value)}
                          width="300px"
                        >
                          {selectedSessions.map((sid) => {
                            const s = sessions.find((ss) => ss._id === sid)
                            return (
                              <option key={sid} value={sid}>
                                {getSessionLabel(s, sid)}
                              </option>
                            )
                          })}
                        </Select>
                      </HStack>

                      <WeightSpacePlot
                        data={weightSpaceData}
                        isNonLinearModel={useNonLinearModel}
                        isHierarchicalStudy={isHierarchicalStudy}
                        solutionCount={weightSpaceSolutionCount}
                        onDownloadPng={handleDownloadWeightSpacePng}
                        orderedCriteria={(criteria || [])
                          .map((criterion) => criterion?.criterion_name)
                          .filter((name) => typeof name === 'string' && name.length > 0)}
                      />

                      <Button
                        mt={4}
                        variant="ghost"
                        justifyContent="flex-start"
                        leftIcon={showDeclaredVsComputed ? <ChevronDownIcon /> : <ChevronRightIcon />}
                        onClick={() => setShowDeclaredVsComputed((prev) => !prev)}
                      >
                        Declared vs Computed Ratios
                      </Button>
                      <Collapse in={showDeclaredVsComputed} animateOpacity>
                        {step1ConsistencyData.length > 0 ? (
                          <Box borderWidth={1} borderRadius="md" p={3} bg="white" position="relative" data-export-id="step1_declared_computed_ratios">
                            <Tooltip label="Download image as PNG" hasArrow>
                              <IconButton
                                aria-label="Download declared vs computed ratios image"
                                icon={<DownloadIcon />}
                                size="sm"
                                variant="ghost"
                                position="absolute"
                                top={2}
                                right={2}
                                zIndex={2}
                                onClick={() => handleDownloadChartPng('step1_declared_computed_ratios', 'declared_computed_ratios', ['Declared vs Computed Ratios'])}
                              />
                            </Tooltip>
                            <ResponsiveContainer width="100%" height={Math.max(300, step1ConsistencyComparisons.length * 28 + 100)}>
                              <ScatterChart
                                margin={{ top: 35, right: 20, left: 10, bottom: 5 }}
                              >
                                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                                <XAxis 
                                  type="number" 
                                  dataKey="value"
                                  name="Ratio"
                                  label={{ value: 'Ratio Value', position: 'insideBottom', offset: -3, fontSize: 11 }}
                                  tick={{ fontSize: 10 }}
                                />
                                <YAxis
                                  type="number"
                                  dataKey="yPlot"
                                  name="Comparison"
                                  width={240}
                                  tick={{ fontSize: 10 }}
                                  interval={0}
                                  domain={[
                                    -0.5,
                                    Math.max(0, step1ConsistencyComparisons.length - 1) + 0.5,
                                  ]}
                                  ticks={step1ConsistencyComparisons.map((_, idx) => idx)}
                                  tickFormatter={(value) => step1ConsistencyComparisons[Math.round(value)] || ''}
                                />
                                <RechartsTooltip
                                  cursor={{ strokeDasharray: '3 3' }}
                                  wrapperStyle={{ pointerEvents: 'auto' }}
                                  isAnimationActive={false}
                                  content={({ active, payload }) => {
                                    if (!active || !payload || payload.length === 0) return null
                                    const data = payload[0].payload
                                    return (
                                      <Box bg="white" p={2} borderWidth={1} borderRadius="md" boxShadow="md">
                                        <Text fontSize="xs" fontWeight="bold" mb={1}>{data.comparison}</Text>
                                        <Text fontSize="xs" color={payload[0].color}>
                                          {payload[0].name}: {Number(data.value).toFixed(4)}
                                        </Text>
                                        {data.type === 'computed' && Number.isInteger(data.solutionIndex) && (
                                          <Text fontSize="xs" color="gray.600">
                                            Solution #{data.solutionIndex + 1}
                                          </Text>
                                        )}
                                      </Box>
                                    )
                                  }}
                                />
                                <RechartsLegend 
                                  verticalAlign="top"
                                  height={30}
                                  iconSize={10}
                                />
                                <Scatter 
                                  name="Computed (w_adj / w_ref)" 
                                  data={step1ConsistencyData.filter(d => d.type === 'computed')}
                                  fill="#48BB78"
                                  fillOpacity={0.6}
                                  shape="circle"
                                />
                                <Scatter 
                                  name="Declared (1 / vf(value))" 
                                  data={step1ConsistencyData.filter(d => d.type === 'declared')}
                                  fill="#DD6B20"
                                  shape={(props) => {
                                    const { cx, cy } = props
                                    const size = 6
                                    return (
                                      <polygon
                                        points={`${cx},${cy-size} ${cx+size},${cy} ${cx},${cy+size} ${cx-size},${cy}`}
                                        fill="#DD6B20"
                                        stroke="#DD6B20"
                                        strokeWidth={1}
                                      />
                                    )
                                  }}
                                />
                              </ScatterChart>
                            </ResponsiveContainer>
                          </Box>
                        ) : (
                          <Box bg="gray.100" h={200} borderRadius="md" display="flex" alignItems="center" justifyContent="center">
                            <Text color="gray.500">No comparable declared/computed ratio data available for this elicitation.</Text>
                          </Box>
                        )}
                      </Collapse>
                    </VStack>
                    )}

                    <VStack align="stretch" spacing={4}>
                      <VStack spacing={1} align="stretch">
                        <Heading as="h3" size="md">
                          Confidence Review
                        </Heading>
                        <Box color="gray.600">
                          Review the self-declared confidence reported by each expert and apply practitioner-side corrections for underestimation or overestimation. Adjustments are applied hierarchically, the resulting confidence values are clipped to the 0-4 range, and these corrections are not shown in the expert-facing interface.
                        </Box>
                      </VStack>

                      {selectedSessions.length > 0 ? (
                        <VStack align="stretch" spacing={3}>
                          {selectedSessions.map((sessionId) => {
                            const session = sessions.find((entry) => entry._id === sessionId)
                            if (!session) return null

                            const practitionerSettings = normalizePractitionerSettings(
                              criteria,
                              practitionerSettingsById[sessionId] || session.practitioner_settings
                            )
                            const adjustments = practitionerSettings.confidence_adjustments
                            const qiCriteriaEntries = Object.entries(adjustments.qi_criteria)
                            const vfCriteriaEntries = Object.entries(adjustments.vf_criteria)
                            const overallDeclaredAverage = averageConfidence(getSessionDeclaredConfidenceValues(session, criteria, 'all'))
                            const qiDeclaredAverage = averageConfidence(getSessionDeclaredConfidenceValues(session, criteria, 'qi'))
                            const vfDeclaredAverage = averageConfidence(getSessionDeclaredConfidenceValues(session, criteria, 'vf'))
                            const saveState = practitionerSettingsSaveStateById[sessionId]
                            const expertDescription = String(practitionerSettings.notes || '').trim()
                            const isOpen = Boolean(expandedConfidenceSections[sessionId]?.session)

                            // One row per adjustable "scope": the three bulk knobs (Overall, all-QI,
                            // all-VF) followed by one row per criterion for fine-grained overrides.
                            // All of it lives in a single table so the column headers - notably
                            // "Adjustment" - are set once instead of repeated (and wrapping) on every row.
                            const bulkRows = [
                              {
                                key: 'overall',
                                scope: 'Overall (all criteria)',
                                category: null,
                                declared: overallDeclaredAverage,
                                value: adjustments.overall,
                                effective: applyConfidenceAdjustment(overallDeclaredAverage, adjustments.overall),
                                onChange: (valueAsNumber) => handlePractitionerSettingsChange(sessionId, (current) => ({
                                  ...current,
                                  confidence_adjustments: {
                                    ...current.confidence_adjustments,
                                    overall: normalizeConfidenceAdjustment(valueAsNumber, current.confidence_adjustments.overall),
                                  },
                                })),
                              },
                              {
                                key: 'qi',
                                scope: 'All Qualitative Indicators',
                                category: 'QI',
                                declared: qiDeclaredAverage,
                                value: adjustments.qi,
                                effective: applyConfidenceAdjustment(qiDeclaredAverage, adjustments.overall, adjustments.qi),
                                onChange: (valueAsNumber) => handlePractitionerSettingsChange(sessionId, (current) => ({
                                  ...current,
                                  confidence_adjustments: {
                                    ...current.confidence_adjustments,
                                    qi: normalizeConfidenceAdjustment(valueAsNumber, current.confidence_adjustments.qi),
                                  },
                                })),
                              },
                              {
                                key: 'vf',
                                scope: 'All Value Functions',
                                category: 'VF',
                                declared: vfDeclaredAverage,
                                value: adjustments.vf,
                                effective: applyConfidenceAdjustment(vfDeclaredAverage, adjustments.overall, adjustments.vf),
                                onChange: (valueAsNumber) => handlePractitionerSettingsChange(sessionId, (current) => ({
                                  ...current,
                                  confidence_adjustments: {
                                    ...current.confidence_adjustments,
                                    vf: normalizeConfidenceAdjustment(valueAsNumber, current.confidence_adjustments.vf),
                                  },
                                })),
                              },
                            ]

                            const criterionRows = [
                              ...qiCriteriaEntries.map(([criterionName, value]) => {
                                const declared = averageConfidence(getQualitativeDeclaredConfidences(session, criterionName))
                                return {
                                  key: `qi-${criterionName}`,
                                  scope: criterionName,
                                  category: 'QI',
                                  declared,
                                  value,
                                  effective: applyConfidenceAdjustment(declared, adjustments.overall, adjustments.qi, value),
                                  onChange: (valueAsNumber) => handlePractitionerSettingsChange(sessionId, (current) => ({
                                    ...current,
                                    confidence_adjustments: {
                                      ...current.confidence_adjustments,
                                      qi_criteria: {
                                        ...current.confidence_adjustments.qi_criteria,
                                        [criterionName]: normalizeConfidenceAdjustment(
                                          valueAsNumber,
                                          current.confidence_adjustments.qi_criteria[criterionName]
                                        ),
                                      },
                                    },
                                  })),
                                }
                              }),
                              ...vfCriteriaEntries.map(([criterionName, value]) => {
                                const declared = getValueFunctionDeclaredConfidence(session, criterionName)
                                return {
                                  key: `vf-${criterionName}`,
                                  scope: criterionName,
                                  category: 'VF',
                                  declared,
                                  value,
                                  effective: applyConfidenceAdjustment(declared, adjustments.overall, adjustments.vf, value),
                                  onChange: (valueAsNumber) => handlePractitionerSettingsChange(sessionId, (current) => ({
                                    ...current,
                                    confidence_adjustments: {
                                      ...current.confidence_adjustments,
                                      vf_criteria: {
                                        ...current.confidence_adjustments.vf_criteria,
                                        [criterionName]: normalizeConfidenceAdjustment(
                                          valueAsNumber,
                                          current.confidence_adjustments.vf_criteria[criterionName]
                                        ),
                                      },
                                    },
                                  })),
                                }
                              }),
                            ]

                            const allRows = [...bulkRows, ...criterionRows]
                            const adjustedCount = allRows.filter((row) => Math.abs(row.value) > 0.0001).length

                            const renderAdjustmentRow = (row, { bold = false } = {}) => {
                              const isUp = row.effective !== null && row.declared !== null && row.effective > row.declared
                              const isDown = row.effective !== null && row.declared !== null && row.effective < row.declared
                              return (
                                <Tr key={row.key} bg={bold ? 'gray.50' : undefined}>
                                  <Td>
                                    <Text fontSize="sm" fontWeight={bold ? 'semibold' : 'normal'} noOfLines={1}>
                                      {row.scope}
                                    </Text>
                                  </Td>
                                  <Td>
                                    {row.category && (
                                      <Badge colorScheme={row.category === 'QI' ? 'blue' : 'purple'} fontSize="0.65rem">
                                        {row.category}
                                      </Badge>
                                    )}
                                  </Td>
                                  <Td isNumeric fontSize="sm" color="gray.600">{formatConfidenceValue(row.declared)}</Td>
                                  <Td isNumeric>
                                    <NumberInput
                                      size="sm"
                                      step={0.1}
                                      min={-4}
                                      max={4}
                                      precision={1}
                                      value={Number(row.value).toFixed(1)}
                                      onChange={(_, valueAsNumber) => {
                                        if (!Number.isFinite(valueAsNumber)) return
                                        row.onChange(valueAsNumber)
                                      }}
                                      maxW="90px"
                                      ml="auto"
                                    >
                                      <NumberInputField textAlign="right" />
                                      <NumberInputStepper>
                                        <NumberIncrementStepper />
                                        <NumberDecrementStepper />
                                      </NumberInputStepper>
                                    </NumberInput>
                                  </Td>
                                  <Td
                                    isNumeric
                                    fontSize="sm"
                                    fontWeight={isUp || isDown ? 'bold' : bold ? 'semibold' : 'normal'}
                                    color={isUp ? 'green.600' : isDown ? 'orange.600' : 'gray.700'}
                                  >
                                    {formatConfidenceValue(row.effective)}
                                  </Td>
                                </Tr>
                              )
                            }

                            return (
                              <Box key={sessionId} borderWidth={1} borderRadius="md" bg="white" overflow="hidden">
                                <HStack
                                  justify="space-between"
                                  align="center"
                                  spacing={3}
                                  px={4}
                                  py={3}
                                  cursor="pointer"
                                  _hover={{ bg: 'gray.50' }}
                                  onClick={() => handleToggleConfidenceSection(sessionId, 'session')}
                                >
                                  <HStack spacing={2} align="center" minW={0}>
                                    <ChevronRightIcon
                                      boxSize={4}
                                      color="gray.400"
                                      transform={isOpen ? 'rotate(90deg)' : 'rotate(0deg)'}
                                      transition="transform 0.15s ease"
                                    />
                                    <Text fontWeight="semibold" noOfLines={1}>
                                      {getSessionLabel(session, sessionId)}
                                      {expertDescription ? (
                                        <Text as="span" fontWeight="normal" color="gray.600">
                                          {' - '}{expertDescription}
                                        </Text>
                                      ) : null}
                                    </Text>
                                  </HStack>
                                  <HStack spacing={2} flexShrink={0}>
                                    {Boolean(savingPractitionerSettingsById[sessionId]) && <Spinner size="sm" />}
                                    {saveState === 'saving' && (
                                      <Text fontSize="xs" color="gray.500">Saving changes...</Text>
                                    )}
                                    {saveState === 'error' && (
                                      <Text fontSize="xs" color="red.500">Save failed</Text>
                                    )}
                                    <Badge fontFamily="mono" fontWeight="normal" colorScheme="gray" fontSize="0.7rem">
                                      Overall {formatConfidenceValue(overallDeclaredAverage)} {'→'} {formatConfidenceValue(bulkRows[0].effective)}
                                    </Badge>
                                    <Badge
                                      fontFamily="mono"
                                      colorScheme={adjustedCount > 0 ? 'teal' : 'gray'}
                                      fontSize="0.7rem"
                                    >
                                      {adjustedCount} of {allRows.length} adjusted
                                    </Badge>
                                  </HStack>
                                </HStack>

                                <Collapse in={isOpen} animateOpacity>
                                  <Box borderTopWidth={1} borderColor="gray.100" px={4} py={3}>
                                    <TableContainer>
                                      <Table size="sm" variant="simple">
                                        <Thead>
                                          <Tr>
                                            <Th>Scope</Th>
                                            <Th>Category</Th>
                                            <Th isNumeric>Declared</Th>
                                            <Th isNumeric>Adjustment</Th>
                                            <Th isNumeric>Effective</Th>
                                          </Tr>
                                        </Thead>
                                        <Tbody>
                                          {bulkRows.map((row) => renderAdjustmentRow(row, { bold: true }))}
                                          {criterionRows.map((row) => renderAdjustmentRow(row))}
                                        </Tbody>
                                      </Table>
                                    </TableContainer>
                                  </Box>
                                </Collapse>
                              </Box>
                            )
                          })}
                        </VStack>
                      ) : (
                        <Text fontSize="sm" color="gray.500">
                          Select at least one completed and locked session to edit confidence adjustments here.
                        </Text>
                      )}
                    </VStack>
                  </VStack>
                  </StepSection>
                </VStack>
              </TabPanel>

              {/* Step 2: Aggregation */}
              <TabPanel>
                <StepSection
                  title="Aggregation Analysis"
                  description={(
                    <Text>
                      Select one or more aggregation methods and run NSMC to compare ranking behavior. For methods with α, α = 0 is fully compensatory; moving α toward 1 penalizes poor criterion performance more, while moving α toward -1 rewards strong criterion performance more.
                      {' '}These α-parameterized methods follow{' '}
                      <Link href="https://doi.org/10.1016/j.omega.2018.05.011" isExternal color="blue.600" textDecoration="underline">
                        Haag et al. (2019) <ExternalLinkIcon mx="2px" />
                      </Link>
                      .
                    </Text>
                  )}
                  onRun={() => handleRunStep(4, 'Aggregation')}
                  onStop={handleStopExecution}
                  isRunning={runningStep === 'Aggregation'}
                  isDisabled={isButtonDisabled(2) || selectedSessions.length === 0 || aggregationStepMethods.length === 0}
                  showConsole={showConsole}
                  consoleOutput={consoleOutput}
                  onToggleConsole={() => setShowConsole(!showConsole)}
                  statusInfo={
                    getStepStatus(4)?.completed ? (
                      <HStack spacing={3}>
                        <Badge colorScheme="green" fontSize="sm" px={2} py={1}>Step 2 completed</Badge>
                        <Text fontSize="sm" color="gray.500">{formatTimestamp(getStepStatus(4)?.timestamp)}</Text>
                      </HStack>
                    ) : null
                  }
                  parameters={
                    <VStack spacing={3} align="stretch">
                      {renderAggregationChecklist()}
                      <HStack spacing={3}>
                        <Text fontWeight="bold">MC Iterations:</Text>
                        <NumberInput
                          value={mcIterations[4]}
                          min={100}
                          max={5000}
                          step={100}
                          onChange={(_, val) => updateMcIterations(4, val)}
                          isDisabled={runningStep !== null}
                          width="120px"
                        >
                          <NumberInputField />
                          <NumberInputStepper>
                            <NumberIncrementStepper />
                            <NumberDecrementStepper />
                          </NumberInputStepper>
                        </NumberInput>
                      </HStack>
                    </VStack>
                  }
                >
                  {(() => {
                    const byAggregation = step4Results?.results_by_aggregation
                    if (byAggregation && typeof byAggregation === 'object') {
                      const methodOrder = AGGREGATION_METHODS.map((entry) => entry.backendMethod)
                      const orderedEntries = Object.entries(byAggregation).sort((a, b) => {
                        const aIdx = methodOrder.indexOf(a[0])
                        const bIdx = methodOrder.indexOf(b[0])
                        if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx
                        if (aIdx >= 0) return -1
                        if (bIdx >= 0) return 1
                        return String(a[0]).localeCompare(String(b[0]))
                      })
                      return (
                        <SimpleGrid columns={{ base: 1, xl: orderedEntries.length >= 3 ? 3 : 2 }} spacing={5}>
                          {orderedEntries.map(([backendMethod, result]) => {
                            const plotLabel = getAggregationPlotLabel(
                              backendMethod,
                              step4Results?.aggregation_alphas,
                              step4Results?.aggregation_alpha
                            )
                            const fileBase = `step4_${sanitizeFilename(backendMethod)}_aggregation_heatmap`
                            const isChosen = chosenAggregationMeta?.backendMethod === backendMethod
                            const heatmapTitle = `${plotLabel} Aggregation Heatmap${isChosen ? ' — chosen for next steps' : ''}`
                            return (
                              <RankingHeatmap
                                key={backendMethod}
                                title={heatmapTitle}
                                results={result}
                                onDownloadPng={() => handleDownloadHeatmapPng(result, heatmapTitle, fileBase)}
                              />
                            )
                          })}
                        </SimpleGrid>
                      )
                    }

                    if (step4Results?.aggregated_results) {
                      const plotLabel = getAggregationPlotLabel(
                        step4Results?.aggregation_method,
                        step4Results?.aggregation_alphas,
                        step4Results?.aggregation_alpha
                      ) || 'Aggregation'
                      return (
                        <VStack spacing={4} align="stretch">
                          <RankingHeatmap
                            title={`${plotLabel} Aggregation Heatmap`}
                            results={step4Results}
                            onDownloadPng={() => handleDownloadHeatmapPng(step4Results, `${plotLabel} Aggregation Heatmap`, `step4_${sanitizeFilename(plotLabel)}_aggregation_heatmap`)}
                          />
                        </VStack>
                      )
                    }

                    return (
                      <VStack spacing={4} align="stretch">
                        <Box bg="gray.100" h={220} borderRadius="md" display="flex" alignItems="center" justifyContent="center">
                          <Text color="gray.500">Run Step 2 to display aggregation ranking heatmaps.</Text>
                        </Box>
                      </VStack>
                    )
                  })()}
                </StepSection>
              </TabPanel>

              {/* Step 3: Uncertainty (SMC, strict) */}
              <TabPanel>
                <StepSection
                  title="Uncertainty Analysis"
                  description="By running the SMC with the preferred aggregation method, the practitioner can assess the overall uncertainty of the resulting distributions. This step can reveal insights that might otherwise be obscured by the final aggregated results."
                  onRun={() => handleRunStep(5, 'Uncertainty')}
                  onStop={handleStopExecution}
                  isRunning={runningStep === 'Uncertainty'}
                  isDisabled={isButtonDisabled(3) || !chosenAggregationMethod || selectedSessions.length === 0}
                  showConsole={showConsole}
                  consoleOutput={consoleOutput}
                  onToggleConsole={() => setShowConsole(!showConsole)}
                  statusInfo={
                    getStepStatus(5)?.completed ? (
                      <HStack spacing={3}>
                        <Badge colorScheme="green" fontSize="sm" px={2} py={1}>Step 3 completed</Badge>
                        <Text fontSize="sm" color="gray.500">{formatTimestamp(getStepStatus(5)?.timestamp)}</Text>
                      </HStack>
                    ) : null
                  }
                  parameters={
                    <VStack spacing={3} align="stretch">
                      {renderChosenAggregationSummary()}
                      <HStack spacing={3}>
                        <Text fontWeight="bold">MC Iterations:</Text>
                        <NumberInput
                          value={mcIterations[5]}
                          min={100}
                          max={5000}
                          step={100}
                          onChange={(_, val) => updateMcIterations(5, val)}
                          isDisabled={runningStep !== null}
                          width="120px"
                        >
                          <NumberInputField />
                          <NumberInputStepper>
                            <NumberIncrementStepper />
                            <NumberDecrementStepper />
                          </NumberInputStepper>
                        </NumberInput>
                      </HStack>
                    </VStack>
                  }
                >
                  {step5Results ? (
                    <VStack spacing={8} align="stretch">
                      {(() => {
                        const legendItems = getLegendItems(step5Results)
                        return (
                          <HStack spacing={4} flexWrap="wrap">
                            <Text fontSize="sm" fontWeight="semibold">Elicitation:</Text>
                            {legendItems.map((item, idx) => (
                              <HStack key={`${item.label}-${idx}`} spacing={2}>
                                <Box
                                  w={3}
                                  h={3}
                                  bg={STEP2_COLORS[idx % STEP2_COLORS.length]}
                                  opacity={0.45}
                                  borderRadius="sm"
                                />
                                <Text fontSize="sm">{item.label}</Text>
                              </HStack>
                            ))}
                          </HStack>
                        )
                      })()}
                      <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={5}>
                        {step5Results.alternative_names?.map((altName, altIndex) => {
                          const distData = getDistributionDataForAlternative(step5Results, altIndex)
                          if (!distData) return null
                          const legendItems = getLegendItems(step5Results)
                          const legendLabelByExpert = Object.fromEntries(
                            legendItems.map((item) => [item.expertName, item.label])
                          )
                          return (
                            <Box key={`${altName}-${altIndex}`} borderWidth={1} borderRadius="md" p={3} bg="gray.50" position="relative" data-export-id={`step5_distribution_${altIndex}`}>
                              <Tooltip label="Download image as PNG" hasArrow>
                                <IconButton
                                  aria-label={`Download uncertainty distribution image for ${altName}`}
                                  icon={<DownloadIcon />}
                                  size="sm"
                                  variant="ghost"
                                  position="absolute"
                                  top={2}
                                  right={2}
                                  zIndex={2}
                                  onClick={() => handleDownloadChartPng(`step5_distribution_${altIndex}`, `step3_uncertainty_analysis_distribution_${altName}`, [`Uncertainty Distribution for ${altName}`])}
                                />
                              </Tooltip>
                              {renderDistributionStatsTable({
                                stepPrefix: 'step5',
                                altIndex,
                                distData,
                                title: `Step 3 uncertainty analysis stats - ${altName}`,
                                filenameBase: `step3_uncertainty_analysis_stats_${altName}`,
                                defaultOpen: true,
                              })}
                              <ResponsiveContainer width="100%" height={250}>
                                <AreaChart data={distData.densityData} margin={{ top: 10, right: 12, left: 14, bottom: 24 }}>
                                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} />
                                  <XAxis
                                    type="number"
                                    dataKey="x"
                                    domain={[0, 1]}
                                    ticks={[0, 0.2, 0.4, 0.6, 0.8, 1]}
                                    tickFormatter={(v) => Number(v).toFixed(1)}
                                    tick={{ fontSize: 11 }}
                                    label={{ value: 'Value', position: 'insideBottom', offset: -10 }}
                                  />
                                  <YAxis
                                    tickFormatter={(v) => `${(Number(v) * 100).toFixed(1)}%`}
                                    tick={{ fontSize: 11 }}
                                    label={{ value: 'Probability', angle: -90, position: 'insideLeft' }}
                                  />
                                  <RechartsTooltip
                                    wrapperStyle={{ pointerEvents: 'auto' }}
                                    isAnimationActive={false}
                                    formatter={(value, name) => [`${(Number(value) * 100).toFixed(2)}%`, String(name)]}
                                    labelFormatter={(v) => `Value ${Number(v).toFixed(3)}`}
                                  />
                                  <RechartsLegend
                                    verticalAlign="top"
                                    height={22}
                                    iconSize={8}
                                    wrapperStyle={{ fontSize: 10 }}
                                  />
                                  {distData.expertNames.map((expertName, idx) => (
                                    <Area
                                      key={`${expertName}-${idx}`}
                                      dataKey={expertName}
                                      fill={STEP2_COLORS[idx % STEP2_COLORS.length]}
                                      fillOpacity={0.22}
                                      stroke={STEP2_COLORS[idx % STEP2_COLORS.length]}
                                      strokeWidth={2}
                                      type="monotone"
                                      dot={false}
                                      isAnimationActive={false}
                                      name={legendLabelByExpert[expertName] || expertName}
                                    />
                                  ))}
                                </AreaChart>
                              </ResponsiveContainer>
                            </Box>
                          )
                        })}
                      </SimpleGrid>
                    </VStack>
                  ) : (
                    <VStack spacing={3} align="stretch">
                      <Text color="gray.600" fontSize="sm">Run Step 3 to display uncertainty distributions for each alternative.</Text>
                    </VStack>
                  )}
                </StepSection>
              </TabPanel>

              {/* Step 4: Consensus (SMC, strict) */}
              <TabPanel>
                <StepSection
                  title="Consensus Analysis"
                  description={(
                    <Text>
                      The output of the SMC can be used to assess the consensus or agreement among experts. Consensus is quantified as{' '}
                      <InlineMath math={'C = \\frac{A}{N-1}'} />
                      , with{' '}
                      <InlineMath math={'A = \\sum_x \\left|\\max_i p_i(x) - \\sum_i p_i(x)\\right|'} />
                      . If distributions overlap strongly, consensus is high; otherwise, aggregating divergent opinions requires caution.
                    </Text>
                  )}
                  onRun={() => handleRunStep(2, 'Consensus')}
                  onStop={handleStopExecution}
                  isRunning={runningStep === 'Consensus'}
                  isDisabled={isButtonDisabled(4) || !chosenAggregationMethod || selectedSessions.length === 0}
                  showConsole={showConsole}
                  consoleOutput={consoleOutput}
                  onToggleConsole={() => setShowConsole(!showConsole)}
                  statusInfo={
                    getStepStatus(2)?.completed ? (
                      <HStack spacing={3}>
                        <Badge colorScheme="green" fontSize="sm" px={2} py={1}>Step 4 completed</Badge>
                        <Text fontSize="sm" color="gray.500">{formatTimestamp(getStepStatus(2)?.timestamp)}</Text>
                      </HStack>
                    ) : null
                  }
                  parameters={
                    <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={6}>
                      <VStack spacing={3} align="stretch">
                        {renderChosenAggregationSummary()}
                        <HStack spacing={3}>
                          <Text fontWeight="bold">MC Iterations:</Text>
                          <NumberInput
                            value={mcIterations[2]}
                            min={100}
                            max={5000}
                            step={100}
                            onChange={(_, val) => updateMcIterations(2, val)}
                            isDisabled={runningStep !== null}
                            width="120px"
                          >
                            <NumberInputField />
                            <NumberInputStepper>
                              <NumberIncrementStepper />
                              <NumberDecrementStepper />
                            </NumberInputStepper>
                          </NumberInput>
                        </HStack>
                      </VStack>

                      <Box borderLeftWidth={{ base: 0, lg: 1 }} borderColor="gray.200" pl={{ base: 0, lg: 6 }}>
                        {renderSessionSelector({
                          heading: 'Included Sessions',
                          helperText: "If a decision-maker's judgments diverge sharply from the rest in the distributions below, you may want to exclude their session here and re-run the analysis. This selection also carries forward to Step 5: Final Results.",
                          showManageLink: false,
                          showInfoAlert: false,
                        })}
                      </Box>
                    </SimpleGrid>
                  }
                >
                  {step2Results ? (
                    <VStack spacing={8} align="stretch">
                      {(() => {
                        const legendItems = getLegendItems(step2Results)
                        return (
                          <HStack spacing={4} flexWrap="wrap">
                            <Text fontSize="sm" fontWeight="semibold">Elicitation:</Text>
                            {legendItems.map((item, idx) => (
                              <HStack key={`${item.label}-${idx}`} spacing={2}>
                                <Box
                                  w={3}
                                  h={3}
                                  bg={STEP2_COLORS[idx % STEP2_COLORS.length]}
                                  opacity={0.45}
                                  borderRadius="sm"
                                />
                                <Text fontSize="sm">{item.label}</Text>
                              </HStack>
                            ))}
                          </HStack>
                        )
                      })()}
                      <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={5}>
                        {step2Results.alternative_names?.map((altName, altIndex) => {
                          const distData = getDistributionDataForAlternative(step2Results, altIndex)
                          if (!distData) return null
                          const legendItems = getLegendItems(step2Results)
                          const legendLabelByExpert = Object.fromEntries(
                            legendItems.map((item) => [item.expertName, item.label])
                          )
                          return (
                            <Box key={`${altName}-${altIndex}`} borderWidth={1} borderRadius="md" p={3} bg="gray.50" position="relative" data-export-id={`step2_distribution_${altIndex}`}>
                              <Tooltip label="Download image as PNG" hasArrow>
                                <IconButton
                                  aria-label={`Download distribution image for ${altName}`}
                                  icon={<DownloadIcon />}
                                  size="sm"
                                  variant="ghost"
                                  position="absolute"
                                  top={2}
                                  right={2}
                                  zIndex={2}
                                  onClick={() => handleDownloadChartPng(`step2_distribution_${altIndex}`, `step4_consensus_analysis_distribution_${altName}`, [
                                    `Distribution of Values for ${altName}`,
                                    `Consensus = ${Number(distData.consensus?.consensusPercent || 0).toFixed(2)}%`,
                                  ])}
                                />
                              </Tooltip>
                              <HStack justify="space-between" align="center" mb={2} pr={12}>
                                <HStack spacing={3}>
                                  <Text fontWeight="semibold" fontSize="sm">{`Distribution of Values for ${altName}`}</Text>
                                  <Badge colorScheme="blue" variant="subtle">
                                    {`Consensus = ${Number(distData.consensus?.consensusPercent || 0).toFixed(2)}%`}
                                  </Badge>
                                </HStack>
                              </HStack>
                              <ResponsiveContainer width="100%" height={250}>
                                <AreaChart data={distData.densityData} margin={{ top: 10, right: 12, left: 14, bottom: 24 }}>
                                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} />
                                  <XAxis
                                    type="number"
                                    dataKey="x"
                                    domain={[0, 1]}
                                    ticks={[0, 0.2, 0.4, 0.6, 0.8, 1]}
                                    tickFormatter={(v) => Number(v).toFixed(1)}
                                    tick={{ fontSize: 11 }}
                                    label={{ value: 'Value', position: 'insideBottom', offset: -10 }}
                                  />
                                  <YAxis
                                    tickFormatter={(v) => `${(Number(v) * 100).toFixed(1)}%`}
                                    tick={{ fontSize: 11 }}
                                    label={{ value: 'Probability', angle: -90, position: 'insideLeft' }}
                                  />
                                  <RechartsTooltip
                                    wrapperStyle={{ pointerEvents: 'auto' }}
                                    isAnimationActive={false}
                                    formatter={(value, name) => [`${(Number(value) * 100).toFixed(2)}%`, String(name)]}
                                    labelFormatter={(v) => `Value ${Number(v).toFixed(3)}`}
                                  />
                                  <RechartsLegend
                                    verticalAlign="top"
                                    height={22}
                                    iconSize={8}
                                    wrapperStyle={{ fontSize: 10 }}
                                  />
                                  {distData.expertNames.map((expertName, idx) => (
                                    <Area
                                      key={`${expertName}-${idx}`}
                                      dataKey={expertName}
                                      fill={STEP2_COLORS[idx % STEP2_COLORS.length]}
                                      fillOpacity={0.22}
                                      stroke={STEP2_COLORS[idx % STEP2_COLORS.length]}
                                      strokeWidth={2}
                                      type="monotone"
                                      dot={false}
                                      isAnimationActive={false}
                                      name={legendLabelByExpert[expertName] || expertName}
                                    />
                                  ))}
                                </AreaChart>
                              </ResponsiveContainer>
                            </Box>
                          )
                        })}
                      </SimpleGrid>
                    </VStack>
                  ) : (
                    <VStack spacing={3} align="stretch">
                      <Text color="gray.600" fontSize="sm">Run Step 4 to display one distribution plot per alternative.</Text>
                    </VStack>
                  )}
                </StepSection>
              </TabPanel>

              {/* Step 5: Results (NSMC, non-strict) */}
              <TabPanel>
                <StepSection
                  title="Results"
                  description="The final results are generated using NSMC with the practitioner's chosen aggregation method."
                  onRun={() => handleRunStep(6, 'Results')}
                  onStop={handleStopExecution}
                  isRunning={runningStep === 'Results'}
                  isDisabled={isButtonDisabled(5) || !chosenAggregationMethod || selectedSessions.length === 0}
                  showConsole={showConsole}
                  consoleOutput={consoleOutput}
                  onToggleConsole={() => setShowConsole(!showConsole)}
                  statusInfo={
                    getStepStatus(6)?.completed ? (
                      <HStack spacing={3}>
                        <Badge colorScheme="green" fontSize="sm" px={2} py={1}>Step 5 completed</Badge>
                        <Text fontSize="sm" color="gray.500">{formatTimestamp(getStepStatus(6)?.timestamp)}</Text>
                      </HStack>
                    ) : null
                  }
                  parameters={
                    <VStack spacing={3} align="stretch">
                      {renderChosenAggregationSummary()}
                      <HStack spacing={3}>
                        <Text fontWeight="bold">MC Iterations:</Text>
                        <NumberInput
                          value={mcIterations[6]}
                          min={100}
                          max={10000}
                          step={100}
                          onChange={(_, val) => updateMcIterations(6, val)}
                          isDisabled={runningStep !== null}
                          width="120px"
                        >
                          <NumberInputField />
                          <NumberInputStepper>
                            <NumberIncrementStepper />
                            <NumberDecrementStepper />
                          </NumberInputStepper>
                        </NumberInput>
                      </HStack>
                    </VStack>
                  }
                >
                  {step6Results ? (
                    <RankingHeatmap
                      title="Results Heatmap"
                      results={step6Results}
                      onDownloadPng={() => handleDownloadHeatmapPng(step6Results, 'Results Heatmap', 'results_heatmap')}
                    />
                  ) : (
                    <Box bg="gray.100" h={220} borderRadius="md" display="flex" alignItems="center" justifyContent="center">
                      <Text color="gray.500">Run Step 5 to display the final ranking heatmap.</Text>
                    </Box>
                  )}

                  <Divider my={4} />
                  <VStack spacing={3} align="stretch">
                    <Text color="gray.600" fontSize="sm">
                      Export the selected results artifacts from the full Run UP-MAVT pipeline.
                    </Text>
                    <HStack spacing={3} flexWrap="wrap">
                      <Button
                        leftIcon={<DownloadIcon />}
                        colorScheme="blue"
                        variant="solid"
                        onClick={onExportResultsOpen}
                        isDisabled={!getStepStatus(6)?.completed}
                        alignSelf="flex-start"
                      >
                        Export Results
                      </Button>
                    </HStack>
                  </VStack>
                </StepSection>
              </TabPanel>
            </TabPanels>
          </Tabs>
        </VStack>

        {/* PDF Modals */}
        <PdfModal
          isOpen={isUncertaintiesOpen}
          onClose={onUncertaintiesClose}
          pdfUrl="/uncertainties.pdf"
          title="Sources of Uncertainty in UP-MAVT Framework"
        />
        <PdfModal
          isOpen={isMcModesOpen}
          onClose={onMcModesClose}
          pdfUrl="/mc_modes.pdf"
          title="Monte Carlo Modes: Strict vs Non-Strict"
        />
        <Modal isOpen={isExportResultsOpen} onClose={onExportResultsClose} isCentered>
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>Export Results</ModalHeader>
            <ModalCloseButton />
            <ModalBody>
              <VStack spacing={3} align="stretch">
                <Text fontSize="sm" color="gray.600">
                  Select which outputs to export from the Run UP-MAVT pipeline.
                </Text>
                <Checkbox
                  isChecked={exportIncludeResultsCsv}
                  onChange={(e) => setExportIncludeResultsCsv(e.target.checked)}
                >
                  Final ranking summary CSV
                </Checkbox>
                <Checkbox
                  isChecked={exportIncludeSimulationCsvs}
                  onChange={(e) => setExportIncludeSimulationCsvs(e.target.checked)}
                >
                  Raw simulation CSVs for workflow steps
                </Checkbox>
                <Checkbox
                  isChecked={exportIncludePlotImages}
                  onChange={(e) => setExportIncludePlotImages(e.target.checked)}
                >
                  Plot Images (PNG and SVG)
                </Checkbox>
                <Checkbox
                  isChecked={exportIncludeStep2ConsensusQuantificationCsv}
                  onChange={(e) => setExportIncludeStep2ConsensusQuantificationCsv(e.target.checked)}
                >
                  Step 4 consensus quantification
                </Checkbox>
                <Checkbox
                  isChecked={exportIncludeStep5UncertaintyStatsCsv}
                  onChange={(e) => setExportIncludeStep5UncertaintyStatsCsv(e.target.checked)}
                >
                  Step 3 uncertainty stats
                </Checkbox>
                <Checkbox
                  isChecked={exportIncludeFullData}
                  onChange={(e) => setExportIncludeFullData(e.target.checked)}
                >
                  All data for local replication
                </Checkbox>
              </VStack>
            </ModalBody>
            <ModalFooter>
              <HStack spacing={3}>
                <Button variant="ghost" onClick={onExportResultsClose} isDisabled={exportingResults}>
                  Cancel
                </Button>
                <Button
                  colorScheme="blue"
                  onClick={handleExportFinalResults}
                  isLoading={exportingResults}
                  loadingText="Exporting"
                >
                  Export
                </Button>
              </HStack>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </VStack>
    </Box>
  )
}

function buildRankProbabilityMatrix(results) {
  const alternatives = Array.isArray(results?.alternative_names) ? results.alternative_names : []
  const rows = Array.isArray(results?.aggregated_results) ? results.aggregated_results : []

  if (alternatives.length === 0 || rows.length === 0) return null

  const altCount = alternatives.length
  const rankCounts = Array.from({ length: altCount }, () => Array(altCount).fill(0))

  rows.forEach((scoresRow) => {
    if (!Array.isArray(scoresRow) || scoresRow.length < altCount) return

    const ranked = alternatives
      .map((_, altIndex) => ({
        altIndex,
        score: Number(scoresRow[altIndex]) || 0,
      }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        return a.altIndex - b.altIndex
      })

    ranked.forEach((entry, rankIndex) => {
      rankCounts[rankIndex][entry.altIndex] += 1
    })
  })

  const totalIterations = rows.length
  const probabilities = rankCounts.map((rankRow) => (
    rankRow.map((count) => (totalIterations > 0 ? count / totalIterations : 0))
  ))

  return {
    alternatives,
    probabilities,
  }
}

function getHeatColor(probability) {
  if (probability >= 0.9) return 'blue.900'
  if (probability >= 0.8) return 'blue.800'
  if (probability >= 0.7) return 'blue.700'
  if (probability >= 0.6) return 'blue.600'
  if (probability >= 0.5) return 'blue.500'
  if (probability >= 0.4) return 'blue.400'
  if (probability >= 0.3) return 'blue.300'
  if (probability >= 0.2) return 'blue.200'
  if (probability >= 0.1) return 'blue.100'
  return 'blue.50'
}

function getHeatColorHex(probability) {
  if (probability >= 0.9) return '#1A365D'
  if (probability >= 0.8) return '#2A4365'
  if (probability >= 0.7) return '#2C5282'
  if (probability >= 0.6) return '#2B6CB0'
  if (probability >= 0.5) return '#3182CE'
  if (probability >= 0.4) return '#4299E1'
  if (probability >= 0.3) return '#63B3ED'
  if (probability >= 0.2) return '#90CDF4'
  if (probability >= 0.1) return '#BEE3F8'
  return '#EBF8FF'
}

function escapeSvgText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;')
}

let svgTextMeasurementContext = null
let svgTextMeasurementAttempted = false
function measureSvgTextWidth(text, fontSize = 12, fontWeight = '400', fontFamily = 'Arial, sans-serif') {
  const str = String(text ?? '')
  if (str.length === 0) return 0

  if (!svgTextMeasurementAttempted) {
    svgTextMeasurementAttempted = true
    try {
      svgTextMeasurementContext = typeof document !== 'undefined'
        ? document.createElement('canvas').getContext('2d') || null
        : null
    } catch (error) {
      svgTextMeasurementContext = null
    }
  }

  if (svgTextMeasurementContext) {
    svgTextMeasurementContext.font = `${fontWeight} ${fontSize}px ${fontFamily}`
    const measured = svgTextMeasurementContext.measureText(str).width
    if (Number.isFinite(measured) && measured > 0) return measured
  }

  // Fallback heuristic when canvas measurement is unavailable (e.g. non-browser test runner).
  return str.length * fontSize * 0.55
}

function truncateSvgTextToWidth(text, maxWidth, fontSize = 12, fontWeight = '400') {
  const str = String(text ?? '')
  if (measureSvgTextWidth(str, fontSize, fontWeight) <= maxWidth) return str

  const ellipsis = '…'
  let low = 0
  let high = str.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    const candidate = `${str.slice(0, mid)}${ellipsis}`
    if (measureSvgTextWidth(candidate, fontSize, fontWeight) <= maxWidth) {
      low = mid
    } else {
      high = mid - 1
    }
  }
  return low > 0 ? `${str.slice(0, low)}${ellipsis}` : ellipsis
}

function sanitizeFilename(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'export'
}

// Maps internal step numbers (the order results are computed in) to the workflow-facing step
// numbers/names shown to users. CSV filenameBases are built as `step_${n}_...` (underscore before
// the digit) while image filenameBases were built as `step${n}_...` (no underscore) - both forms
// are accepted here so neither export path silently skips renaming.
const WORKFLOW_STEP_RENAME = {
  1: 'step_1_finalize_elicited_data_',
  2: 'step_4_consensus_analysis_',
  4: 'step_2_choose_aggregation_method_',
  5: 'step_3_uncertainty_analysis_',
  6: 'step_5_final_results_',
}

function toWorkflowStepFilenameBase(filenameBase) {
  const base = String(filenameBase || '')
  const match = base.match(/^step_?([0-9]+)_(.*)$/)
  if (!match) return base
  const [, stepDigits, rest] = match
  const renamedPrefix = WORKFLOW_STEP_RENAME[Number(stepDigits)]
  return renamedPrefix ? `${renamedPrefix}${rest}` : base
}

const HEATMAP_HEADER_FONT_SIZE = 12
const HEATMAP_HEADER_ROTATION_DEG = 40

// Single source of truth for heatmap geometry: both the SVG builder and the
// PNG canvas sizing must agree exactly, or the exported image gets stretched.
function computeRankingHeatmapLayout(results) {
  const matrix = buildRankProbabilityMatrix(results)
  const cellSize = HEATMAP_CELL_SIZE
  const cellGap = HEATMAP_CELL_GAP
  const rowLabelWidth = HEATMAP_ROW_LABEL_WIDTH
  const bottomPad = 18

  if (!matrix) {
    return {
      matrix: null,
      width: HEATMAP_FALLBACK_WIDTH,
      height: HEATMAP_FALLBACK_HEIGHT,
      cellSize,
      cellGap,
      rowLabelWidth,
      topPad: 44,
      needsHeaderRotation: false,
      bottomPad,
    }
  }

  const { alternatives } = matrix
  const maxHeaderWidth = Math.max(
    0,
    ...alternatives.map((name) => measureSvgTextWidth(name, HEATMAP_HEADER_FONT_SIZE, '600'))
  )
  // Column headers overlap their neighbors once the label is wider than the cell; rotate them
  // diagonally (like the matplotlib heatmap export) and grow the top margin to fit.
  const needsHeaderRotation = maxHeaderWidth > cellSize - 10
  const topPad = needsHeaderRotation
    ? Math.ceil(22 + maxHeaderWidth * Math.sin((HEATMAP_HEADER_ROTATION_DEG * Math.PI) / 180) + HEATMAP_HEADER_FONT_SIZE)
    : 44

  const minGridWidth = rowLabelWidth + alternatives.length * (cellSize + cellGap)
  const width = Math.max(HEATMAP_FALLBACK_WIDTH, minGridWidth + 24)
  const height = topPad + alternatives.length * (cellSize + cellGap) + bottomPad

  return { matrix, width, height, cellSize, cellGap, rowLabelWidth, topPad, needsHeaderRotation, bottomPad }
}

function getRankingHeatmapDimensions(results) {
  const { width, height } = computeRankingHeatmapLayout(results)
  return { width, height }
}

function computeConsensusQuantification(densityData, expertNames) {
  if (!Array.isArray(densityData) || densityData.length === 0 || !Array.isArray(expertNames) || expertNames.length === 0) {
    return null
  }

  const normalizedExpertNames = expertNames
    .map((name) => String(name || '').trim())
    .filter((name) => name.length > 0)

  if (normalizedExpertNames.length === 0) return null

  let differenceArea = 0
  densityData.forEach((row) => {
    let distributionSum = 0
    let profile = 0

    normalizedExpertNames.forEach((expertName) => {
      const density = Number(row?.[expertName])
      const value = Number.isFinite(density) ? density : 0
      distributionSum += value
      if (value > profile) profile = value
    })

    differenceArea += Math.abs(profile - distributionSum)
  })

  const elicitationCount = normalizedExpertNames.length
  const rawConsensus = elicitationCount > 1 ? (differenceArea / (elicitationCount - 1)) : 1
  const consensusRatio = Math.max(0, Math.min(1, rawConsensus))

  return {
    differenceArea,
    elicitationCount,
    consensusRatio,
    consensusPercent: consensusRatio * 100,
  }
}

function buildConsensusQuantificationCsv(consensusRows, options = {}) {
  const title = String(options.title || 'Step 4 consensus analysis quantification').trim()
  const placeholderMessage = String(
    options.placeholderMessage || 'Consensus quantification is not available yet.'
  ).trim()

  const lines = [
    `title;${title}`,
    'alternative;elicitation_count;difference_area;consensus_ratio;consensus_percent',
  ]

  if (!Array.isArray(consensusRows) || consensusRows.length === 0) {
    lines.push(`;note;${placeholderMessage}`)
    return `${lines.join('\n')}\n`
  }

  consensusRows.forEach((row) => {
    const altName = String(row?.alternative || '').replace(/;/g, ',')
    const elicitationCount = Number(row?.elicitationCount)
    const differenceArea = Number(row?.differenceArea)
    const consensusRatio = Number(row?.consensusRatio)
    const consensusPercent = Number(row?.consensusPercent)

    lines.push([
      altName,
      Number.isFinite(elicitationCount) ? String(elicitationCount) : '',
      Number.isFinite(differenceArea) ? differenceArea.toFixed(6) : '',
      Number.isFinite(consensusRatio) ? consensusRatio.toFixed(6) : '',
      Number.isFinite(consensusPercent) ? consensusPercent.toFixed(2) : '',
    ].join(';'))
  })

  return `${lines.join('\n')}\n`
}

function buildRankProbabilityCsv(results) {
  const matrix = buildRankProbabilityMatrix(results)
  if (!matrix) return null

  const headers = ['rank', ...matrix.alternatives]
  const rows = matrix.probabilities.map((rankRow, rankIndex) => (
    [rankIndex + 1, ...rankRow.map((probability) => Number(probability).toFixed(6))]
  ))
  return [headers.join(';'), ...rows.map((row) => row.join(';'))].join('\n')
}

function formatSimulationCsvValue(value) {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) return ''
  return numericValue.toFixed(6)
}

function buildSimulationRowsCsv(results) {
  const alternatives = Array.isArray(results?.alternative_names) ? results.alternative_names : []
  const rows = Array.isArray(results?.aggregated_results) ? results.aggregated_results : []

  if (alternatives.length === 0 || rows.length === 0) return null

  const headers = ['iteration', ...alternatives]
  const csvRows = rows.map((scoresRow, iterationIndex) => {
    const scoreValues = alternatives.map((_, altIndex) => formatSimulationCsvValue(scoresRow?.[altIndex]))
    return [iterationIndex + 1, ...scoreValues]
  })

  return [headers.join(';'), ...csvRows.map((row) => row.join(';'))].join('\n')
}

function buildSimulationCsvExports(stepNumber, stepResults) {
  const exports = []

  if (stepNumber === 2 || stepNumber === 5) {
    const alternatives = Array.isArray(stepResults?.alternative_names) ? stepResults.alternative_names : []
    const byElicitation = stepResults?.results_by_elicitation
    if (alternatives.length === 0 || !byElicitation || typeof byElicitation !== 'object') {
      return exports
    }

    Object.entries(byElicitation)
      .sort((a, b) => {
        const aIndex = Number(a[0])
        const bIndex = Number(b[0])
        if (Number.isFinite(aIndex) && Number.isFinite(bIndex)) return aIndex - bIndex
        return String(a[0]).localeCompare(String(b[0]))
      })
      .forEach(([elicitationKey, iterationRows], index) => {
        const csvText = buildSimulationRowsCsv({
          alternative_names: alternatives,
          aggregated_results: iterationRows,
        })
        if (!csvText) return

        exports.push({
          filenameBase: `step_${stepNumber}_elicitation_${index + 1}_${sanitizeFilename(elicitationKey)}`,
          csvText,
        })
      })

    return exports
  }

  if (stepNumber === 4) {
    const byAggregation = stepResults?.results_by_aggregation
    if (byAggregation && typeof byAggregation === 'object') {
      Object.entries(byAggregation)
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
        .forEach(([aggregationName, aggregationResults]) => {
          const csvText = buildSimulationRowsCsv(aggregationResults)
          if (!csvText) return

          exports.push({
            filenameBase: `step_4_aggregation_${sanitizeFilename(aggregationName)}`,
            csvText,
          })
        })

      return exports
    }

    const csvText = buildSimulationRowsCsv(stepResults)
    if (csvText) {
      const stepAggregation = sanitizeFilename(stepResults?.aggregation_method || 'selected')
      exports.push({
        filenameBase: `step_4_aggregation_${stepAggregation}`,
        csvText,
      })
    }
    return exports
  }

  const csvText = buildSimulationRowsCsv(stepResults)
  if (csvText) {
    exports.push({
      filenameBase: `step_${stepNumber}_simulation`,
      csvText,
    })
  }

  return exports
}

function buildRankingHeatmapSvg({ title, results }) {
  const layout = computeRankingHeatmapLayout(results)
  const { matrix, width, height, cellSize, cellGap, rowLabelWidth, topPad, needsHeaderRotation } = layout
  if (!matrix) return null

  const { alternatives, probabilities } = matrix
  const leftPad = 12
  const textY = 24
  const gridX = leftPad + rowLabelWidth
  const gridY = topPad

  const headerCells = alternatives.map((altName, colIndex) => {
    const x = gridX + colIndex * (cellSize + cellGap) + (cellSize / 2)
    const y = gridY - 10
    const label = escapeSvgText(altName)
    if (needsHeaderRotation) {
      // Positive angle swings the start of the (text-anchor="end") label up and away from the
      // grid, matching the matplotlib rotation=45,ha='right' look. A negative angle here would
      // swing the label down into row 1 instead.
      return `<text x="${x}" y="${y}" font-size="${HEATMAP_HEADER_FONT_SIZE}" text-anchor="end" font-weight="600" fill="#1A202C" transform="rotate(${HEATMAP_HEADER_ROTATION_DEG} ${x} ${y})">${label}</text>`
    }
    return `<text x="${x}" y="${y}" font-size="${HEATMAP_HEADER_FONT_SIZE}" text-anchor="middle" font-weight="600" fill="#1A202C">${label}</text>`
  }).join('')

  const rowLabels = probabilities.map((_, rankIndex) => {
    const y = gridY + rankIndex * (cellSize + cellGap) + (cellSize / 2) + 5
    return `<text x="${leftPad + rowLabelWidth - 8}" y="${y}" font-size="12" text-anchor="end" font-weight="600" fill="#2D3748">Rank ${rankIndex + 1}</text>`
  }).join('')

  const cells = probabilities.map((rankRow, rankIndex) => (
    rankRow.map((probability, colIndex) => {
      const x = gridX + colIndex * (cellSize + cellGap)
      const y = gridY + rankIndex * (cellSize + cellGap)
      const color = getHeatColorHex(probability)
      const textColor = probability >= 0.6 ? '#FFFFFF' : '#1A202C'
      return `
        <rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="4" ry="4" fill="${color}" />
        <text x="${x + (cellSize / 2)}" y="${y + (cellSize / 2) + 4}" font-size="12" text-anchor="middle" font-weight="600" fill="${textColor}">
          ${(probability * 100).toFixed(1)}%
        </text>
      `
    }).join('')
  )).join('')

  const svgMarkup = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect x="0" y="0" width="${width}" height="${height}" fill="#FFFFFF" />
      <text x="${leftPad}" y="${textY}" font-size="16" font-weight="700" fill="#1A202C">${escapeSvgText(title)}</text>
      ${cells}
      ${rowLabels}
      ${headerCells}
    </svg>
  `.trim()

  return { svgMarkup, width, height }
}

function buildPipelineChartExportTargets({
  hasWeightSpacePlot = false,
  hasStep1Consistency = false,
  step2AlternativeNames = [],
  step5AlternativeNames = [],
}) {
  const targets = []
  const safeArray = (value) => (Array.isArray(value) ? value : [])
  const addDistributionTargets = (stepPrefix, alternativeNames) => {
    safeArray(alternativeNames).forEach((altName, index) => {
      targets.push({
        exportId: `${stepPrefix}_distribution_${index}`,
        filenameBase: `${stepPrefix}_distribution_${altName || index + 1}`,
      })
    })
  }

  if (hasStep1Consistency) {
    targets.push({
      exportId: 'step1_declared_computed_ratios',
      filenameBase: 'step1_declared_computed_ratios',
    })
  }
  if (hasWeightSpacePlot) {
    targets.push({
      type: 'weight-space',
      filenameBase: 'step1_weight_space_plot',
    })
  }

  addDistributionTargets('step2', step2AlternativeNames)
  addDistributionTargets('step5', step5AlternativeNames)

  return targets
}

function buildPipelineHeatmapExports({ step4Results, step6Results }) {
  const targets = []
  const byAggregation = step4Results?.results_by_aggregation
  if (byAggregation && typeof byAggregation === 'object') {
    const methodOrder = AGGREGATION_METHODS.map((entry) => entry.backendMethod)
    const orderedEntries = Object.entries(byAggregation).sort((a, b) => {
      const aIdx = methodOrder.indexOf(a[0])
      const bIdx = methodOrder.indexOf(b[0])
      if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx
      if (aIdx >= 0) return -1
      if (bIdx >= 0) return 1
      return String(a[0]).localeCompare(String(b[0]))
    })
    orderedEntries.forEach(([backendMethod, result]) => {
      const label = getAggregationPlotLabel(
        backendMethod,
        step4Results?.aggregation_alphas,
        step4Results?.aggregation_alpha
      )
      targets.push({
        title: `${label} Aggregation Heatmap`,
        filenameBase: `step4_${sanitizeFilename(label)}_aggregation_heatmap`,
        results: result,
      })
    })
  }

  if (targets.length === 0 && step4Results?.aggregated_results) {
    const method = step4Results?.aggregation_method
    const label = getAggregationPlotLabel(method, step4Results?.aggregation_alphas, step4Results?.aggregation_alpha) || 'Aggregation'
    targets.push({
      title: `${label} Aggregation Heatmap`,
      filenameBase: `step4_${sanitizeFilename(label)}_aggregation_heatmap`,
      results: step4Results,
    })
  }

  if (step6Results) {
    targets.push({
      title: 'Results Heatmap',
      filenameBase: 'step6_results_heatmap',
      results: step6Results,
    })
  }

  return targets
}

function normalizeWeightSpaceRows(data, orderedCriteria = []) {
  if (!data) return null

  const canon = (value) => String(value || '').trim().toLowerCase()
  const reorderCriteria = (detectedCriteria) => {
    const detectedByCanon = new Map(detectedCriteria.map((name) => [canon(name), name]))
    const preferred = []
    orderedCriteria.forEach((name) => {
      const match = detectedByCanon.get(canon(name))
      if (match && !preferred.includes(match)) {
        preferred.push(match)
      }
    })
    const remainder = detectedCriteria.filter((name) => !preferred.includes(name))
    return [...preferred, ...remainder]
  }

  if (!Array.isArray(data) && typeof data === 'object' && Object.keys(data).length > 0) {
    const criteria = reorderCriteria(Object.keys(data))
    const criterionToValues = criteria.reduce((acc, criterion) => {
      const rawValues = Array.isArray(data[criterion]) ? data[criterion] : [data[criterion]]
      acc[criterion] = rawValues
        .map((value) => (typeof value === 'number' ? value : Number(value)))
        .filter((value) => Number.isFinite(value))
      return acc
    }, {})
    const maxWeight = Math.max(0.001, ...criteria.flatMap((criterion) => criterionToValues[criterion]))
    return { criteria, criterionToValues, maxWeight }
  }

  if (!Array.isArray(data) || data.length === 0) return null

  const allDetected = Array.from(
    new Set(
      data
        .filter((row) => row && typeof row === 'object')
        .flatMap((row) => Object.keys(row))
    )
  )
  const criteria = reorderCriteria(allDetected)
  const criterionToValues = criteria.reduce((acc, criterion) => {
    acc[criterion] = data
      .map((solution) => (typeof solution?.[criterion] === 'number' ? solution[criterion] : Number(solution?.[criterion] || 0)))
      .filter((value) => Number.isFinite(value))
    return acc
  }, {})
  const maxWeight = Math.max(0.001, ...criteria.flatMap((criterion) => criterionToValues[criterion]))
  return { criteria, criterionToValues, maxWeight }
}

function buildWeightSpacePlotSvg({
  data,
  orderedCriteria = [],
  isNonLinearModel = false,
  isHierarchicalStudy = false,
  solutionCount = 0,
}) {
  const normalized = normalizeWeightSpaceRows(data, orderedCriteria)
  if (!normalized || normalized.criteria.length === 0) return null

  const methodLabel = isHierarchicalStudy ? 'PILE-BWT' : 'BWT'
  const explanationText = isNonLinearModel
    ? `${methodLabel} non-linear model (${solutionCount} solution${solutionCount === 1 ? '' : 's'})`
    : `${methodLabel} linear model`

  const rowHeight = 24
  const topPad = 58
  const rowFontSize = 12
  const minLeftLabel = 140
  const maxLeftLabel = 460
  const labelPadding = 30
  // Size the label column to fit the longest criterion name (capped), instead of a fixed
  // width that clips or overlaps long names against the bars.
  const measuredMaxLabelWidth = Math.max(
    0,
    ...normalized.criteria.map((criterion) => measureSvgTextWidth(criterion, rowFontSize, '400'))
  )
  const leftLabel = Math.min(maxLeftLabel, Math.max(minLeftLabel, measuredMaxLabelWidth + labelPadding))
  const plotWidth = 760
  const width = leftLabel + plotWidth + 20
  const height = topPad + normalized.criteria.length * rowHeight + 50
  const axisMax = normalized.maxWeight * 1.1

  const rowsMarkup = normalized.criteria.map((criterion, rowIndex) => {
    const y = topPad + rowIndex * rowHeight
    const values = normalized.criterionToValues[criterion] || []
    const marks = values.map((weight) => {
      const x = leftLabel + (Number(weight) / axisMax) * plotWidth
      return `<rect x="${x}" y="${y + 3}" width="5" height="16" rx="2" ry="2" fill="#3182CE" fill-opacity="0.75" />`
    }).join('')
    const label = truncateSvgTextToWidth(criterion, leftLabel - labelPadding + 10, rowFontSize, '400')

    return `
      <text x="${leftLabel - 10}" y="${y + 15}" text-anchor="end" font-size="${rowFontSize}" fill="#1A202C"><title>${escapeSvgText(criterion)}</title>${escapeSvgText(label)}</text>
      <rect x="${leftLabel}" y="${y + 2}" width="${plotWidth}" height="18" rx="4" ry="4" fill="#F7FAFC" />
      ${marks}
    `
  }).join('')

  return {
    width,
    height,
    svgMarkup: `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <rect x="0" y="0" width="${width}" height="${height}" fill="#FFFFFF" />
        <text x="16" y="24" font-size="16" font-weight="700" fill="#1A202C">Weight Space Plot</text>
        <text x="16" y="42" font-size="12" fill="#4A5568">${escapeSvgText(explanationText)}</text>
        ${rowsMarkup}
        <text x="${leftLabel}" y="${height - 16}" font-size="11" fill="#718096">0</text>
        <text x="${leftLabel + plotWidth}" y="${height - 16}" text-anchor="end" font-size="11" fill="#718096">${axisMax.toFixed(2)}</text>
      </svg>
    `.trim(),
  }
}

function RankingHeatmap({ title, results, onDownloadPng }) {
  const matrix = buildRankProbabilityMatrix(results)

  if (!matrix) {
    return (
      <Box bg="gray.100" h={220} borderRadius="md" display="flex" alignItems="center" justifyContent="center">
        <Text color="gray.500">No ranking data available.</Text>
      </Box>
    )
  }

  const { alternatives, probabilities } = matrix
  const cellSize = HEATMAP_CELL_SIZE
  const cellGap = HEATMAP_CELL_GAP
  const rowLabelWidth = HEATMAP_ROW_LABEL_WIDTH
  const minGridWidth = rowLabelWidth + alternatives.length * (cellSize + cellGap)

  return (
    // minW={0} overrides the flex/grid-item default of min-width:auto - without it, a heatmap
    // wider than its grid column refuses to shrink and bleeds into the next column instead of
    // scrolling inside its own overflowX box.
    <VStack spacing={2} align="stretch" minW={0}>
      <HStack justify="space-between" align="center">
        <Text fontWeight="bold">{title}</Text>
        {onDownloadPng && (
          <Tooltip label="Download image as PNG" hasArrow>
            <IconButton
              aria-label={`Download ${title} image`}
              icon={<DownloadIcon />}
              size="sm"
              variant="ghost"
              onClick={onDownloadPng}
            />
          </Tooltip>
        )}
      </HStack>

      <Box overflowX="auto" overflowY="hidden" pb={1}>
        <VStack spacing={cellGap / 4} align="stretch" minW={`${minGridWidth}px`}>
          <HStack spacing={1} align="stretch">
            <Box minW={`${rowLabelWidth}px`} />
            {alternatives.map((altName, colIndex) => (
              <Box key={`header-${altName}-${colIndex}`} w={`${cellSize}px`} textAlign="center" px={1}>
                <Text fontSize="xs" fontWeight="semibold" noOfLines={2}>{altName}</Text>
              </Box>
            ))}
          </HStack>

          {probabilities.map((rankRow, rankIndex) => (
            <HStack key={`rank-row-${rankIndex}`} spacing={1} align="stretch">
              <Box minW={`${rowLabelWidth}px`} display="flex" alignItems="center" justifyContent="flex-end" pr={2}>
                <Text fontSize="xs" fontWeight="medium">Rank {rankIndex + 1}</Text>
              </Box>

              {rankRow.map((probability, colIndex) => {
                const cellColor = getHeatColor(probability)
                const textColor = probability >= 0.6 ? 'white' : 'gray.800'
                return (
                  <Box
                    key={`cell-${rankIndex}-${colIndex}`}
                    w={`${cellSize}px`}
                    h={`${cellSize}px`}
                    borderRadius="sm"
                    bg={cellColor}
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                  >
                    <Text fontSize="xs" color={textColor} fontWeight="semibold">
                      {(probability * 100).toFixed(1)}%
                    </Text>
                  </Box>
                )
              })}
            </HStack>
          ))}
        </VStack>
      </Box>
    </VStack>
  )
}

// ============================================================================
// WEIGHT SPACE PLOT COMPONENT
// ============================================================================
function WeightSpacePlot({ data, orderedCriteria = [], isNonLinearModel = false, isHierarchicalStudy = false, solutionCount = 0, onDownloadPng }) {
  const reorderCriteria = (detectedCriteria) => {
    const canon = (value) => String(value || '').trim().toLowerCase()
    const detectedByCanon = new Map(detectedCriteria.map((name) => [canon(name), name]))

    const preferred = []
    orderedCriteria.forEach((name) => {
      const match = detectedByCanon.get(canon(name))
      if (match && !preferred.includes(match)) {
        preferred.push(match)
      }
    })

    const remainder = detectedCriteria.filter((name) => !preferred.includes(name))
    return [...preferred, ...remainder]
  }

  const methodLabel = isHierarchicalStudy ? 'PILE-BWT' : 'BWT'
  const explanationText = isNonLinearModel
    ? `${methodLabel} with the non-linear model returns multiple solutions that define the weight space. This run found ${solutionCount} solution${solutionCount === 1 ? '' : 's'}.`
    : `${methodLabel} with the linear model returns a single solution that defines the weight space.`

  const header = (
    <VStack spacing={1} align="stretch">
      <Text fontSize="sm" fontWeight="semibold" color="gray.700">
        Weight Space Plot
      </Text>
      <Text fontSize="sm" color="gray.600">
        {explanationText}
      </Text>
    </VStack>
  )

  if (!data) {
    return (
      <VStack spacing={3} align="stretch">
        {header}
        <Box bg="gray.100" h={300} borderRadius="md" display="flex" alignItems="center" justifyContent="center">
          <Text color="gray.500">No weight space data available</Text>
        </Box>
      </VStack>
    )
  }

  if (!Array.isArray(data) && typeof data === 'object' && Object.keys(data).length > 0) {
    const criteria = reorderCriteria(Object.keys(data))
    const maxWeight = Math.max(...criteria.flatMap((criterion) => data[criterion]))

    return (
      <VStack spacing={3} align="stretch">
        {header}
        <Box bg="white" border="1px" borderColor="gray.200" borderRadius="md" p={4} position="relative">
          {onDownloadPng && (
            <Tooltip label="Download image as PNG" hasArrow>
              <IconButton
                aria-label="Download weight space plot image"
                icon={<DownloadIcon />}
                size="sm"
                variant="ghost"
                position="absolute"
                top={2}
                right={2}
                zIndex={2}
                onClick={onDownloadPng}
              />
            </Tooltip>
          )}
          <VStack spacing={2} align="stretch">
            {criteria.map((criterion) => {
              const weights = data[criterion]
              return (
                <HStack key={criterion} spacing={3} align="center">
                  <Text
                    fontSize="xs"
                    fontWeight="medium"
                    width="180px"
                    textAlign="right"
                    flexShrink={0}
                    isTruncated
                    title={criterion}
                  >
                    {criterion}
                  </Text>
                  <Box flex={1} h="20px" position="relative" bg="gray.50" borderRadius="sm">
                    {weights.map((w, i) => (
                      <Tooltip
                        key={i}
                        label={w.toFixed(3)}
                        placement="top"
                        openDelay={0}
                        closeDelay={0}
                        hasArrow
                      >
                        <Box
                          position="absolute"
                          left={`${(w / (maxWeight * 1.1)) * 100}%`}
                          top="2px"
                          width="6px"
                          height="16px"
                          bg="blue.500"
                          borderRadius="sm"
                          opacity={0.7}
                        />
                      </Tooltip>
                    ))}
                  </Box>
                </HStack>
              )
            })}
            <HStack spacing={3} mt={2}>
              <Box width="180px" />
              <HStack flex={1} justify="space-between">
                <Text fontSize="xs" color="gray.400">0</Text>
                <Text fontSize="xs" color="gray.400">{(maxWeight * 1.1).toFixed(2)}</Text>
              </HStack>
            </HStack>
          </VStack>
        </Box>
      </VStack>
    )
  }

  if (!Array.isArray(data) || data.length === 0) {
    return (
      <VStack spacing={3} align="stretch">
        {header}
        <Box bg="gray.100" h={300} borderRadius="md" display="flex" alignItems="center" justifyContent="center">
          <Text color="gray.500">No weight space data available</Text>
        </Box>
      </VStack>
    )
  }

  const allDetected = Array.from(
    new Set(
      data
        .filter((row) => row && typeof row === 'object')
        .flatMap((row) => Object.keys(row))
    )
  )
  const criteria = reorderCriteria(allDetected)
  const criterionToValues = criteria.reduce((acc, criterion) => {
    acc[criterion] = data
      .map((solution) => (typeof solution?.[criterion] === 'number' ? solution[criterion] : Number(solution?.[criterion] || 0)))
      .filter((value) => Number.isFinite(value))
    return acc
  }, {})

  const maxWeight = Math.max(0.001, ...criteria.flatMap((criterion) => criterionToValues[criterion]))

  return (
    <VStack spacing={3} align="stretch">
      {header}
      <Box bg="white" border="1px" borderColor="gray.200" borderRadius="md" p={4} position="relative">
        {onDownloadPng && (
          <Tooltip label="Download image as PNG" hasArrow>
            <IconButton
              aria-label="Download weight space plot image"
              icon={<DownloadIcon />}
              size="sm"
              variant="ghost"
              position="absolute"
              top={2}
              right={2}
              zIndex={2}
              onClick={onDownloadPng}
            />
          </Tooltip>
        )}
        <VStack spacing={2} align="stretch">
          {criteria.map((criterion) => {
            const weights = criterionToValues[criterion]
            return (
              <HStack key={criterion} spacing={3} align="center">
                <Text
                  fontSize="xs"
                  fontWeight="medium"
                  width="180px"
                  textAlign="right"
                  flexShrink={0}
                  isTruncated
                  title={criterion}
                >
                  {criterion}
                </Text>
                <Box flex={1} h="20px" position="relative" bg="gray.50" borderRadius="sm">
                  {weights.map((w, i) => (
                    <Tooltip
                      key={i}
                      label={w.toFixed(3)}
                      placement="top"
                      openDelay={0}
                      closeDelay={0}
                      hasArrow
                    >
                      <Box
                        position="absolute"
                        left={`${(w / (maxWeight * 1.1)) * 100}%`}
                        top="2px"
                        width="6px"
                        height="16px"
                        bg="blue.500"
                        borderRadius="sm"
                        opacity={0.7}
                      />
                    </Tooltip>
                  ))}
                </Box>
              </HStack>
            )
          })}
          <HStack spacing={3} mt={2}>
            <Box width="180px" />
            <HStack flex={1} justify="space-between">
              <Text fontSize="xs" color="gray.400">0</Text>
              <Text fontSize="xs" color="gray.400">{(maxWeight * 1.1).toFixed(2)}</Text>
            </HStack>
          </HStack>
        </VStack>
      </Box>
    </VStack>
  )
}

// ============================================================================
// STEP SECTION COMPONENT
// ============================================================================
function StepSection({
  title,
  description,
  onRun,
  onStop,
  isRunning,
  isDisabled,
  controlMeta,
  showConsole,
  consoleOutput,
  onToggleConsole,
  parameters,
  parametersTitle = 'Parameters',
  parametersCollapsible = false,
  statusInfo,
  children,
}) {
  const consoleBodyRef = useRef(null)

  useEffect(() => {
    if (showConsole && consoleBodyRef.current) {
      // Keep the console scrolled to the latest output without moving the page viewport.
      consoleBodyRef.current.scrollTop = consoleBodyRef.current.scrollHeight
    }
  }, [consoleOutput, showConsole])

  return (
    <VStack spacing={4} align="stretch">
      <VStack spacing={1} align="stretch">
        <Heading as="h3" size="md">
          {title}
        </Heading>
        <Box color="gray.600">{description}</Box>
      </VStack>

      {/* Status Info */}
      {statusInfo && (
        <Box bg="green.50" p={3} borderRadius="md" borderLeft="3px solid" borderColor="green.400">
          {statusInfo}
        </Box>
      )}

      {/* Parameters Section */}
      {parameters && (
        <Box bg="gray.50" p={4} borderRadius="md">
          {parametersCollapsible ? (
            <Box as="details">
              <Box as="summary" fontWeight="semibold" cursor="pointer" userSelect="none">
                {parametersTitle}
              </Box>
              <Box mt={3}>{parameters}</Box>
            </Box>
          ) : (
            parameters
          )}
        </Box>
      )}

      {/* Control Buttons */}
      <HStack spacing={3}>
        <Button
          colorScheme="blue"
          onClick={onRun}
          isDisabled={isDisabled}
          isLoading={isRunning}
          loadingText={isRunning ? 'Running...' : undefined}
        >
          Run {title}
        </Button>
        {isRunning && (
          <Button colorScheme="red" variant="outline" onClick={onStop}>
            Stop
          </Button>
        )}
        <Button variant="outline" onClick={onToggleConsole}>
          {showConsole ? 'Hide' : 'View'} Console Output
        </Button>
        {controlMeta}
      </HStack>

      {/* Console Output Panel */}
      {showConsole && (
        <Box bg="gray.900" p={4} borderRadius="md" color="green.300" fontFamily="monospace" fontSize="sm">
          <Box
            ref={consoleBodyRef}
            maxH="350px"
            overflowY="auto"
            whiteSpace="pre-wrap"
            wordBreak="break-word"
            fontFamily="monospace"
            fontSize="xs"
          >
            {consoleOutput || 'No output yet...'}
          </Box>
        </Box>
      )}

      {/* Content/Plots Section */}
      <VStack spacing={4} align="stretch" mt={4}>
        {children}
      </VStack>
    </VStack>
  )
}

export {
  buildRankProbabilityMatrix,
  buildRankProbabilityCsv,
  computeConsensusQuantification,
  buildConsensusQuantificationCsv,
  buildSimulationRowsCsv,
  buildSimulationCsvExports,
  buildRankingHeatmapSvg,
  getRankingHeatmapDimensions,
  buildPipelineChartExportTargets,
  buildPipelineHeatmapExports,
  buildWeightSpacePlotSvg,
  inlineSvgComputedStyles,
  toWorkflowStepFilenameBase,
}

export default RunUpMavtPage
