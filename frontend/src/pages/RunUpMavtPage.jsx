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
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
  Divider,
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
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  ModalFooter,
} from '@chakra-ui/react'
import { DownloadIcon, ExternalLinkIcon } from '@chakra-ui/icons'
import axios from 'axios'
import JSZip from 'jszip'
import PdfModal from '../components/PdfModal'

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

// ============================================================================
// MAIN COMPONENT
// ============================================================================
function RunUpMavtPage({ studySessionId, onNavigate }) {
  const toast = useToast()

  // State for sessions
  const [sessions, setSessions] = useState([])
  const [criteria, setCriteria] = useState([])
  const [selectedSessions, setSelectedSessions] = useState([])
  const [loadingStudy, setLoadingStudy] = useState(true)

  // Workflow status from DB
  const [workflowStatus, setWorkflowStatus] = useState(null)

  // Current task tracking
  const [activeTaskId, setActiveTaskId] = useState(null)
  const [runningStep, setRunningStep] = useState(null)
  const [consoleOutput, setConsoleOutput] = useState('')
  const [showConsole, setShowConsole] = useState(false)
  const pollRef = useRef(null)

  // Active tab
  const [activeStep, setActiveStep] = useState(0)

  // Step parameters - MC iterations per step
  const [mcIterations, setMcIterations] = useState({
    1: 1000, 2: 1000, 3: 1000, 4: 200, 5: 1000, 6: 1000,
  })

  // Aggregation method per step
  const [consensusAggregation, setConsensusAggregation] = useState('SUM')
  const [dominanceAggregation, setDominanceAggregation] = useState('SUM')
  const [uncertaintyAggregation, setUncertaintyAggregation] = useState('')
  const [resultsAggregation, setResultsAggregation] = useState('')

  // Weight space plot state
  const [selectedWeightSession, setSelectedWeightSession] = useState('')
  const [weightSpaceData, setWeightSpaceData] = useState(null)
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
  const [step3Results, setStep3Results] = useState(null)
  const [step4Results, setStep4Results] = useState(null)
  const [step6Results, setStep6Results] = useState(null)
  const [exportingDataZip, setExportingDataZip] = useState(false)
  const [exportingResults, setExportingResults] = useState(false)
  const [exportIncludeResultsCsv, setExportIncludeResultsCsv] = useState(true)
  const [exportIncludePlotImages, setExportIncludePlotImages] = useState(true)
  const [exportIncludeFullData, setExportIncludeFullData] = useState(false)
  // PDF Modal states
  const { isOpen: isUncertaintiesOpen, onOpen: onUncertaintiesOpen, onClose: onUncertaintiesClose } = useDisclosure()
  const { isOpen: isMcModesOpen, onOpen: onMcModesOpen, onClose: onMcModesClose } = useDisclosure()
  const { isOpen: isExportResultsOpen, onOpen: onExportResultsOpen, onClose: onExportResultsClose } = useDisclosure()

  // Derived state
  const weightsComputed = workflowStatus?.weights?.computed === true
  const weightsTimestamp = workflowStatus?.weights?.timestamp

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

  const fetchStep3Results = useCallback(async () => {
    if (!studySessionId) return
    try {
      const response = await axios.get(`${API_URL}/study-session/${studySessionId}/step-results/3`)
      setStep3Results(response.data)
    } catch (error) {
      console.error('Error fetching step 3 results:', error)
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
    if (workflowStatus?.steps?.['3']?.completed) {
      fetchStep3Results()
    }
  }, [workflowStatus?.steps?.['3']?.completed, fetchStep3Results])

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
          } else if (stepNumber === 3) {
            await fetchStep3Results()
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
  }, [fetchWorkflowStatus, fetchStep2Results, fetchStep3Results, fetchStep4Results, fetchStep5Results, fetchStep6Results, fetchWeightSpace, selectedWeightSession, toast])

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

    // Build step-specific params
    const stepConfigs = {
      2: { mc_mode: 'strict', aggregation_method: consensusAggregation, use_random_weights: false },
      3: { mc_mode: 'non_strict', aggregation_method: dominanceAggregation, use_random_weights: true },
      4: { mc_mode: 'non_strict', aggregation_method: 'weighted_sum', use_random_weights: false },
      5: { mc_mode: 'strict', aggregation_method: uncertaintyAggregation, use_random_weights: false },
      6: { mc_mode: 'non_strict', aggregation_method: resultsAggregation, use_random_weights: false },
    }

    const config = { ...stepConfigs[stepNumber], ...overrides }

    // Clear previous results for this step so they don't linger during the new run
    const stepResultClearers = {
      2: () => setStep2Results(null),
      3: () => setStep3Results(null),
      4: () => setStep4Results(null),
      5: () => setStep5Results(null),
      6: () => setStep6Results(null),
    }
    stepResultClearers[stepNumber]?.()

    setRunningStep(stepName)
    setConsoleOutput(`Submitting Step ${stepNumber} task...\n`)

    try {
      const response = await axios.post(
        `${API_URL}/study-session/${studySessionId}/run-step`,
        {
          step_number: stepNumber,
          selected_session_ids: selectedSessions,
          mc_iterations: mcIterations[stepNumber] || 1000,
          aggregation_method: config.aggregation_method,
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
  const isStepDisabled = (stepIndex) => {
    if (stepIndex === 0) return false
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
    const v = Math.max(100, Math.min(maxAllowed, parseInt(value) || 1000))
    setMcIterations((prev) => ({ ...prev, [step]: v }))
  }

  // ============================================================================
  // STEP 2: DISTRIBUTION PLOT HELPERS
  // ============================================================================
  const getDistributionDataForAlternative = (stepResults, altIndex) => {
    if (!stepResults?.results_by_elicitation || !stepResults?.alternative_names) return null

    const expertValues = {}
    const allValues = []
    const sortedElicitations = Object.entries(stepResults.results_by_elicitation)
      .sort((a, b) => Number(a[0]) - Number(b[0]))

    sortedElicitations.forEach(([expertIdx, iterations]) => {
      const expertName = getSessionLabel(sessions[parseInt(expertIdx)], `Expert ${parseInt(expertIdx) + 1}`)
      const values = iterations.map((row) => Number(row[altIndex])).filter((v) => Number.isFinite(v))
      expertValues[expertName] = values
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
    Object.entries(expertValues).forEach(([expertName, values]) => {
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
      Object.keys(densityByExpert).forEach((expertName) => {
        row[expertName] = densityByExpert[expertName][i] || 0
      })
      return row
    })

    return {
      altName: stepResults.alternative_names[altIndex],
      densityData,
      expertNames: sortedElicitations.map(([expertIdx]) => (
        getSessionLabel(sessions[parseInt(expertIdx)], `Expert ${parseInt(expertIdx) + 1}`)
      )),
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

  const sanitizeFilename = (value) => String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'export'

  const buildSvgMarkupFromElement = (svgElement) => {
    if (!svgElement) return null
    const clonedSvg = svgElement.cloneNode(true)
    const applyInlineComputedStyles = (sourceNode, cloneNode) => {
      if (!(sourceNode instanceof Element) || !(cloneNode instanceof Element)) return
      const computedStyle = window.getComputedStyle(sourceNode)
      SVG_INLINE_STYLE_PROPS.forEach((property) => {
        const value = computedStyle.getPropertyValue(property)
        if (!value) return
        cloneNode.style.setProperty(property, value)
      })

      const sourceChildren = sourceNode.children
      const cloneChildren = cloneNode.children
      const childCount = Math.min(sourceChildren.length, cloneChildren.length)
      for (let childIndex = 0; childIndex < childCount; childIndex += 1) {
        applyInlineComputedStyles(sourceChildren[childIndex], cloneChildren[childIndex])
      }
    }

    applyInlineComputedStyles(svgElement, clonedSvg)
    const bounds = svgElement.getBoundingClientRect()
    const width = Math.max(1, Math.round(bounds.width || DEFAULT_PNG_WIDTH))
    const height = Math.max(1, Math.round(bounds.height || DEFAULT_PNG_HEIGHT))
    clonedSvg.setAttribute('width', String(width))
    clonedSvg.setAttribute('height', String(height))
    if (!clonedSvg.getAttribute('viewBox')) {
      clonedSvg.setAttribute('viewBox', `0 0 ${width} ${height}`)
    }
    clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clonedSvg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
    return new XMLSerializer().serializeToString(clonedSvg)
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

  const escapeSvgText = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

  const createPolylinePath = (points) => points.length > 0
    ? `M ${points.map((point) => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' L ')}`
    : ''

  const createClosedAreaPath = (points, baselineY) => {
    if (points.length === 0) return ''
    const linePart = points.map((point) => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' L ')
    const firstPoint = points[0]
    const lastPoint = points[points.length - 1]
    return `M ${firstPoint.x.toFixed(2)} ${baselineY.toFixed(2)} L ${linePart} L ${lastPoint.x.toFixed(2)} ${baselineY.toFixed(2)} Z`
  }

  const buildConsistencyPlotSvg = ({ title, comparisons, data }) => {
    if (!Array.isArray(comparisons) || comparisons.length === 0 || !Array.isArray(data) || data.length === 0) return null

    const width = 980
    const top = 50
    const right = 30
    const bottom = 55
    const left = 250
    const plotWidth = width - left - right
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

    return `
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
          return `
            <line x1="${left}" y1="${yPos}" x2="${left + plotWidth}" y2="${yPos}" stroke="#f3f4f6" stroke-width="1" />
            <text x="${left - 10}" y="${yPos + 4}" text-anchor="end" font-family="Arial, sans-serif" font-size="11" fill="#374151">${escapeSvgText(label)}</text>
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

        <rect x="${left + plotWidth - 280}" y="${top - 30}" width="260" height="22" rx="4" fill="#ffffff" stroke="#e5e7eb" />
        <circle cx="${left + plotWidth - 262}" cy="${top - 19}" r="4" fill="#48BB78" fill-opacity="0.72" />
        <text x="${left + plotWidth - 250}" y="${top - 15}" font-family="Arial, sans-serif" font-size="11" fill="#374151">Computed</text>
        <polygon points="${left + plotWidth - 198},${top - 24} ${left + plotWidth - 188},${top - 19} ${left + plotWidth - 198},${top - 14} ${left + plotWidth - 208},${top - 19}" fill="#DD6B20" stroke="#DD6B20" />
        <text x="${left + plotWidth - 176}" y="${top - 15}" font-family="Arial, sans-serif" font-size="11" fill="#374151">Declared</text>
      </svg>
    `.replace(/\n\s+/g, '\n').trim()
  }

  const buildDistributionPlotSvg = ({ title, altName, densityData, expertNames }) => {
    if (!Array.isArray(densityData) || densityData.length === 0 || !Array.isArray(expertNames) || expertNames.length === 0) return null

    const width = 980
    const top = 50
    const right = 30
    const bottom = 55
    const left = 70
    const plotWidth = width - left - right
    const plotHeight = 250
    const height = top + plotHeight + bottom

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

    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <rect width="100%" height="100%" fill="#ffffff" />
        <text x="${left}" y="26" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="#1f2937">${escapeSvgText(title)}</text>
        <text x="${left}" y="42" font-family="Arial, sans-serif" font-size="12" fill="#6b7280">${escapeSvgText(altName)}</text>

        ${xTicks.map((tick) => {
          const x = scaleX(tick)
          return `
            <line x1="${x}" y1="${top}" x2="${x}" y2="${top + plotHeight}" stroke="#e5e7eb" stroke-width="1" />
            <text x="${x}" y="${top + plotHeight + 22}" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" fill="#6b7280">${Number(tick).toFixed(1)}</text>
          `
        }).join('')}

        <line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotHeight}" stroke="#9ca3af" stroke-width="1.2" />
        <line x1="${left}" y1="${top + plotHeight}" x2="${left + plotWidth}" y2="${top + plotHeight}" stroke="#9ca3af" stroke-width="1.2" />
        <text x="${left + plotWidth / 2}" y="${height - 16}" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" fill="#4b5563">Value</text>

        ${fillPolygons.map((entry, idx) => `
          <polygon points="${entry.polygonPoints}" fill="${entry.color}" fill-opacity="0.22" stroke="none" />
          <text x="${left + idx * 140}" y="${top - 14}" font-family="Arial, sans-serif" font-size="11" fill="${entry.color}">${escapeSvgText(entry.expertName)}</text>
          <rect x="${left + idx * 140 - 14}" y="${top - 22}" width="10" height="10" fill="${entry.color}" fill-opacity="0.22" stroke="${entry.color}" />
        `).join('')}

        ${series.map((entry) => `
          <path d="${createPolylinePath(entry.points)}" fill="none" stroke="${entry.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
        `).join('')}
      </svg>
    `.replace(/\n\s+/g, '\n').trim()
  }

  const handleDownloadChartPng = async (exportId, filenameBase) => {
    const container = document.querySelector(`[data-export-id="${exportId}"]`)
    const svgElement = getPlotSvgElement(container)
    const svgMarkup = buildSvgMarkupFromElement(svgElement)
    if (!svgMarkup) {
      toast({
        title: 'Image not available',
        description: 'The plot is not ready for download yet.',
        status: 'warning',
        duration: 3500,
      })
      return
    }

    try {
      const bounds = svgElement.getBoundingClientRect()
      const width = Math.max(1, Math.round(bounds.width || DEFAULT_PNG_WIDTH))
      const height = Math.max(1, Math.round(bounds.height || DEFAULT_PNG_HEIGHT))
      const pngBlob = await renderSvgMarkupToPngBlob(svgMarkup, width * PNG_SCALE_FACTOR, height * PNG_SCALE_FACTOR)
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
    const svgMarkup = buildRankingHeatmapSvg({ title, results })
    if (!svgMarkup) {
      toast({
        title: 'Image not available',
        description: 'No ranking heatmap is available yet.',
        status: 'warning',
        duration: 3500,
      })
      return
    }

    try {
      const { width, height } = getRankingHeatmapDimensions(results)
      const pngBlob = await renderSvgMarkupToPngBlob(svgMarkup, width * PNG_SCALE_FACTOR, height * PNG_SCALE_FACTOR)
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
    if (!exportIncludeResultsCsv && !exportIncludePlotImages && !exportIncludeFullData) {
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
          exportZip.file('results/final_results_rank_probabilities.csv', resultsCsv)
          exportedArtifacts += 1
        }

        const finalHeatmapSvg = buildRankingHeatmapSvg({
          title: 'Results Heatmap',
          results: step6Results,
        })
        if (finalHeatmapSvg) {
          const { width, height } = getRankingHeatmapDimensions(step6Results)
          exportZip.file('results/final_ranking_heatmap.svg', finalHeatmapSvg)
          try {
            const finalHeatmapPng = await renderSvgMarkupToPngBlob(
              finalHeatmapSvg,
              width * PNG_SCALE_FACTOR,
              height * PNG_SCALE_FACTOR
            )
            exportZip.file('results/final_ranking_heatmap.png', finalHeatmapPng)
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
        const consistencySvg = buildConsistencyPlotSvg({
          title: 'Declared vs Computed Ratios',
          comparisons: consistencyData.comparisons,
          data: consistencyData.data,
        })
        if (consistencySvg) {
          const width = 980
          const height = Math.max(220, 50 + Math.max(220, consistencyData.comparisons.length * 30) + 55)
          imageTargets.push({
            filenameBase: 'step1_declared_computed_ratios',
            svgMarkup: consistencySvg,
            width,
            height,
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

        const appendDistributionTargets = (stepResults, stepPrefix) => {
          if (!stepResults?.alternative_names) return
          stepResults.alternative_names.forEach((altName, altIndex) => {
            const distData = getDistributionDataForAlternative(stepResults, altIndex)
            if (!distData) return
            const svgMarkup = buildDistributionPlotSvg({
              title: `${stepPrefix === 'step2' ? 'Distribution of Values' : 'Distribution of Values'}`,
              altName,
              densityData: distData.densityData,
              expertNames: distData.expertNames,
            })
            if (!svgMarkup) return
            imageTargets.push({
              filenameBase: `${stepPrefix}_distribution_${altIndex}`,
              svgMarkup,
              width: 980,
              height: 355,
            })
          })
        }

        appendDistributionTargets(step2Results, 'step2')
        appendDistributionTargets(step5Results, 'step5')

        const heatmapTargets = buildPipelineHeatmapExports({
          step3Results,
          step4Results,
          step6Results,
        })

        for (const target of heatmapTargets) {
          const svgMarkup = buildRankingHeatmapSvg({ title: target.title, results: target.results })
          if (!svgMarkup) continue
          const { width, height } = getRankingHeatmapDimensions(target.results)
          imageTargets.push({ filenameBase: target.filenameBase, svgMarkup, width, height })
        }

        if (imageTargets.length > 0) {
          exportedArtifacts += 1
        }

        for (const image of imageTargets) {
          exportZip.file(`images/${sanitizeFilename(image.filenameBase)}.svg`, image.svgMarkup)

          try {
            const pngBlob = await renderSvgMarkupToPngBlob(
              image.svgMarkup,
              image.width * PNG_SCALE_FACTOR,
              image.height * PNG_SCALE_FACTOR
            )
            exportZip.file(`images/${sanitizeFilename(image.filenameBase)}.png`, pngBlob)
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
        <VStack spacing={3} align="stretch">
          <Heading as="h1" size="lg">
            Run UP-MAVT
          </Heading>
          <Text color="gray.700">
            Uncertainty Propagated - Multi-Attribute Value Theory (UP-MAVT) is an extension of traditional MAVT developed by S.P. (see{' '}
            <Link href="https://www.sciencedirect.com" isExternal color="blue.600" textDecoration="underline">
              PLACEHOLDER <ExternalLinkIcon mx="2px" />
            </Link>
            ).
            <Link color="blue.600" textDecoration="underline" cursor="pointer" onClick={onUncertaintiesOpen}>
              This diagram illustrates the sources of uncertainty considered in the framework.
            </Link>
          </Text>
          <Text color="gray.700">
            The workflow is designed to examine all aspects of the framework, including consensus among multiple opinions, dominance patterns,
            compensatory dynamics for selecting the aggregation model, overall uncertainty assessment, and the final results.
            The UP-MAVT code implements two Monte Carlo approaches with distinct roles: Strict Monte Carlo (SMC) and Non-Strict Monte Carlo (NSMC).
            {' '}SMC is used to produce per-decision-maker results, generating a value distribution for each alternative and for each decision maker; these outputs support the analysis phase.
            {' '}NSMC, in contrast, pools subjective information across decision makers to produce one conservative, aggregated value distribution per alternative.{' '}
            <Link color="blue.600" textDecoration="underline" cursor="pointer" onClick={onMcModesOpen}>
              The logic behind these methods is detailed in this image.
            </Link>
            {' '}For a comprehensive explanation, an overview of the workflow, and an example case study, please refer to the publication{' '}
            <Link href="https://www.sciencedirect.com" isExternal color="blue.600" textDecoration="underline">
              PLACEHOLDER <ExternalLinkIcon mx="2px" />
            </Link>
            .
          </Text>
        </VStack>

        <Text color="gray.700">
          To run this study locally, use the <b>Download Data ZIP</b> action in this page. It exports a runnable local bundle with scripts and CSV data for the selected study.
          {' '}For the full project source code, see the{' '}
          <Link href="https://github.com/your-repo/elicitation-tools" isExternal color="blue.600" textDecoration="underline">
            repository <ExternalLinkIcon mx="2px" />
          </Link>
          .
        </Text>

        <HStack>
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

        {/* Session Selection */}
        <VStack spacing={3} align="stretch">
          <HStack justify="space-between" align="center">
            <Heading as="h2" size="md">
              Session Selection
            </Heading>
            <Button
              size="sm"
              variant="outline"
              rightIcon={<ExternalLinkIcon />}
              onClick={() => onNavigate && onNavigate('case-study')}
            >
              Manage Sessions
            </Button>
          </HStack>

          <Alert status="info" borderRadius="md">
            <AlertIcon />
            <VStack align="start" spacing={1} ml={3}>
              <AlertTitle>Session Requirements</AlertTitle>
              <AlertDescription>
                Only completed and locked sessions can be selected. This ensures data integrity during analysis runs.
              </AlertDescription>
            </VStack>
          </Alert>

          {incompleteOrUnlockedSessionsExcluded && (
            <Alert status="warning" borderRadius="md">
              <AlertIcon />
              <VStack align="start" spacing={1} ml={3}>
                <AlertTitle>Using {selectedSessions.length} out of {completedAndLockedCount} available sessions</AlertTitle>
                <AlertDescription>{completedAndLockedCount - selectedSessions.length} completed and locked session(s) not selected</AlertDescription>
              </VStack>
            </Alert>
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

        <Divider />

        {/* Workflow Steps */}
        <VStack spacing={4} align="stretch">
          <Heading as="h2" size="md">
            Workflow
          </Heading>

          <Tabs index={activeStep} onChange={setActiveStep} variant="soft-rounded" colorScheme="blue">
            <TabList overflowX="auto" pb={2}>
              <Tab isDisabled={isStepDisabled(0)}>
                Step 1: Weights {weightsComputed && <Badge ml={2} colorScheme="green">Done</Badge>}
              </Tab>
              <Tab isDisabled={isStepDisabled(1)}>
                Step 2: Consensus {getStepStatus(2)?.completed && <Badge ml={2} colorScheme="green">Done</Badge>}
              </Tab>
              <Tab isDisabled={isStepDisabled(2)}>
                Step 3: Dominance {getStepStatus(3)?.completed && <Badge ml={2} colorScheme="green">Done</Badge>}
              </Tab>
              <Tab isDisabled={isStepDisabled(3)}>
                Step 4: Compensation {getStepStatus(4)?.completed && <Badge ml={2} colorScheme="green">Done</Badge>}
              </Tab>
              <Tab isDisabled={isStepDisabled(4)}>
                Step 5: Uncertainty {getStepStatus(5)?.completed && <Badge ml={2} colorScheme="green">Done</Badge>}
              </Tab>
              <Tab isDisabled={isStepDisabled(5)}>
                Step 6: Results {getStepStatus(6)?.completed && <Badge ml={2} colorScheme="green">Done</Badge>}
              </Tab>
            </TabList>

            <TabPanels>
              {/* Step 1: Compute Weights */}
              <TabPanel>
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
                        For background on the general workflow, see{' '}
                        <Link href="https://www.sciencedirect.com" isExternal color="blue.600" textDecoration="underline">
                          PLACEHOLDER <ExternalLinkIcon mx="2px" />
                        </Link>
                        .
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

                      <Text mt={4}>Declared vs Computed Ratios</Text>
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
                              onClick={() => handleDownloadChartPng('step1_declared_computed_ratios', 'declared_computed_ratios')}
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
                                  const { cx, cy } = props;
                                  const size = 6;
                                  return (
                                    <polygon
                                      points={`${cx},${cy-size} ${cx+size},${cy} ${cx},${cy+size} ${cx-size},${cy}`}
                                      fill="#DD6B20"
                                      stroke="#DD6B20"
                                      strokeWidth={1}
                                    />
                                  );
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
                    </VStack>
                  )}
                </StepSection>
              </TabPanel>

              {/* Step 2: Consensus (SMC, strict) */}
              <TabPanel>
                <StepSection
                  title="Consensus Analysis"
                  description="The output of the SMC can be used to assess the consensus or agreement among experts. If the distributions largely overlap, consensus can be considered reached. Otherwise, it is important to reflect on the implications of aggregating divergent opinions."
                  onRun={() => handleRunStep(2, 'Consensus')}
                  onStop={handleStopExecution}
                  isRunning={runningStep === 'Consensus'}
                  isDisabled={isButtonDisabled(1) || selectedSessions.length === 0}
                  showConsole={showConsole}
                  consoleOutput={consoleOutput}
                  onToggleConsole={() => setShowConsole(!showConsole)}
                  statusInfo={
                    getStepStatus(2)?.completed ? (
                      <HStack spacing={3}>
                        <Badge colorScheme="green" fontSize="sm" px={2} py={1}>Step 2 completed</Badge>
                        <Text fontSize="sm" color="gray.500">{formatTimestamp(getStepStatus(2)?.timestamp)}</Text>
                      </HStack>
                    ) : null
                  }
                  parameters={
                    <HStack spacing={6} flexWrap="wrap">
                      <HStack spacing={3}>
                        <Text fontWeight="bold">Aggregation:</Text>
                        <Select
                          value={consensusAggregation}
                          onChange={(e) => setConsensusAggregation(e.target.value)}
                          width="150px"
                          isDisabled={runningStep !== null}
                        >
                          <option value="SUM">SUM (default)</option>
                          <option value="GEO">GEO</option>
                          <option value="HAR">HAR</option>
                        </Select>
                      </HStack>
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
                    </HStack>
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
                      <Text fontSize="sm" color="gray.600">
                        One plot per alternative with smooth overlapping distributions for each elicitation.
                      </Text>
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
                                  onClick={() => handleDownloadChartPng(`step2_distribution_${altIndex}`, `step2_distribution_${altName}`)}
                                />
                              </Tooltip>
                              <Text fontWeight="semibold" fontSize="sm" mb={2}>{`Distribution of Values for ${altName}`}</Text>
                              <ResponsiveContainer width="100%" height={250}>
                                <AreaChart data={distData.densityData} margin={{ top: 10, right: 12, left: 0, bottom: 24 }}>
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
                                    formatter={(value, name) => [`${(Number(value) * 100).toFixed(2)}%`, String(name)]}
                                    labelFormatter={(v) => `Value ${Number(v).toFixed(3)}`}
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
                      <Text color="gray.600" fontSize="sm">Run Step 2 to display one distribution plot per alternative.</Text>
                    </VStack>
                  )}
                </StepSection>
              </TabPanel>

              {/* Step 3: Dominance (NSMC, random weights) */}
              <TabPanel>
                <StepSection
                  title="Dominance Analysis"
                  description="Dominance patterns can be observed in the NSMC heatmaps when using random weights. If an alternative consistently dominates others regardless of the weights assigned to its criteria, this should prompt reflection: while it is possible that the alternative is genuinely superior across all preferences, such behavior may also suggest a bias in the indicator definitions."
                  onRun={() => handleRunStep(3, 'Dominance')}
                  onStop={handleStopExecution}
                  isRunning={runningStep === 'Dominance'}
                  isDisabled={isButtonDisabled(2) || selectedSessions.length === 0}
                  showConsole={showConsole}
                  consoleOutput={consoleOutput}
                  onToggleConsole={() => setShowConsole(!showConsole)}
                  statusInfo={
                    getStepStatus(3)?.completed ? (
                      <HStack spacing={3}>
                        <Badge colorScheme="green" fontSize="sm" px={2} py={1}>Step 3 completed</Badge>
                        <Text fontSize="sm" color="gray.500">{formatTimestamp(getStepStatus(3)?.timestamp)}</Text>
                      </HStack>
                    ) : null
                  }
                  parameters={
                    <HStack spacing={6} flexWrap="wrap">
                      <HStack spacing={3}>
                        <Text fontWeight="bold">Aggregation:</Text>
                        <Select
                          value={dominanceAggregation}
                          onChange={(e) => setDominanceAggregation(e.target.value)}
                          width="150px"
                          isDisabled={runningStep !== null}
                        >
                          <option value="SUM">SUM (default)</option>
                          <option value="GEO">GEO</option>
                          <option value="HAR">HAR</option>
                        </Select>
                      </HStack>
                      <HStack spacing={3}>
                        <Text fontWeight="bold">MC Iterations:</Text>
                        <NumberInput
                          value={mcIterations[3]}
                          min={100}
                          max={5000}
                          step={100}
                          onChange={(_, val) => updateMcIterations(3, val)}
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
                    </HStack>
                  }
                >
                  {step3Results ? (
                    <RankingHeatmap
                      title="Dominance Heatmap"
                      results={step3Results}
                      onDownloadPng={() => handleDownloadHeatmapPng(step3Results, 'Dominance Heatmap', 'dominance_heatmap')}
                    />
                  ) : (
                    <Box bg="gray.100" h={220} borderRadius="md" display="flex" alignItems="center" justifyContent="center">
                      <Text color="gray.500">Run Step 3 to display the dominance ranking heatmap.</Text>
                    </Box>
                  )}
                </StepSection>
              </TabPanel>

              {/* Step 4: Compensation (NSMC, all 3 aggregation methods, random weights) */}
              <TabPanel>
                <StepSection
                  title="Compensation Analysis"
                  description="The code offers a choice of three aggregation methods: SUM (weighted sum), which is fully compensatory, and GEO (geometric mean) and HAR (harmonic mean), which are partially compensatory. By comparing the differences in the NSMC heatmaps, the practitioner can determine which aggregation method is most appropriate for their study."
                  onRun={() => handleRunStep(4, 'Compensation')}
                  onStop={handleStopExecution}
                  isRunning={runningStep === 'Compensation'}
                  isDisabled={isButtonDisabled(3) || selectedSessions.length === 0}
                  showConsole={showConsole}
                  consoleOutput={consoleOutput}
                  onToggleConsole={() => setShowConsole(!showConsole)}
                  statusInfo={
                    getStepStatus(4)?.completed ? (
                      <HStack spacing={3}>
                        <Badge colorScheme="green" fontSize="sm" px={2} py={1}>Step 4 completed</Badge>
                        <Text fontSize="sm" color="gray.500">{formatTimestamp(getStepStatus(4)?.timestamp)}</Text>
                      </HStack>
                    ) : null
                  }
                  parameters={
                    <HStack spacing={3}>
                      <Text fontWeight="bold">MC Iterations (per method):</Text>
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
                      <Text fontSize="sm" color="gray.500">(runs 3x, once per aggregation method)</Text>
                    </HStack>
                  }
                >
                  {step4Results?.results_by_aggregation ? (
                    <VStack spacing={4} align="stretch">
                      <RankingHeatmap
                        title="SUM Aggregation Heatmap"
                        results={step4Results.results_by_aggregation.weighted_sum}
                        onDownloadPng={() => handleDownloadHeatmapPng(step4Results.results_by_aggregation.weighted_sum, 'SUM Aggregation Heatmap', 'sum_aggregation_heatmap')}
                      />
                      <RankingHeatmap
                        title="GEO Aggregation Heatmap"
                        results={step4Results.results_by_aggregation.geometric_mean}
                        onDownloadPng={() => handleDownloadHeatmapPng(step4Results.results_by_aggregation.geometric_mean, 'GEO Aggregation Heatmap', 'geo_aggregation_heatmap')}
                      />
                      <RankingHeatmap
                        title="HAR Aggregation Heatmap"
                        results={step4Results.results_by_aggregation.harmonic_mean}
                        onDownloadPng={() => handleDownloadHeatmapPng(step4Results.results_by_aggregation.harmonic_mean, 'HAR Aggregation Heatmap', 'har_aggregation_heatmap')}
                      />
                    </VStack>
                  ) : (
                    <Box bg="gray.100" h={220} borderRadius="md" display="flex" alignItems="center" justifyContent="center">
                      <Text color="gray.500">Run Step 4 to display compensation ranking heatmaps.</Text>
                    </Box>
                  )}
                </StepSection>
              </TabPanel>

              {/* Step 5: Uncertainty (SMC, strict) */}
              <TabPanel>
                <StepSection
                  title="Uncertainty Analysis"
                  description="By running the SMC with the preferred aggregation method, the practitioner can assess the overall uncertainty of the resulting distributions. This step can reveal insights that might otherwise be obscured by the final aggregated results."
                  onRun={() => handleRunStep(5, 'Uncertainty')}
                  onStop={handleStopExecution}
                  isRunning={runningStep === 'Uncertainty'}
                  isDisabled={isButtonDisabled(4) || !uncertaintyAggregation || selectedSessions.length === 0}
                  showConsole={showConsole}
                  consoleOutput={consoleOutput}
                  onToggleConsole={() => setShowConsole(!showConsole)}
                  statusInfo={
                    getStepStatus(5)?.completed ? (
                      <HStack spacing={3}>
                        <Badge colorScheme="green" fontSize="sm" px={2} py={1}>Step 5 completed</Badge>
                        <Text fontSize="sm" color="gray.500">{formatTimestamp(getStepStatus(5)?.timestamp)}</Text>
                      </HStack>
                    ) : null
                  }
                  parameters={
                    <HStack spacing={6} flexWrap="wrap">
                      <HStack spacing={3}>
                        <Text fontWeight="bold">Aggregation:</Text>
                        <Select
                          placeholder="Select aggregation method"
                          value={uncertaintyAggregation}
                          onChange={(e) => {
                            setUncertaintyAggregation(e.target.value)
                            if (!resultsAggregation) setResultsAggregation(e.target.value)
                          }}
                          width="200px"
                          isDisabled={runningStep !== null}
                        >
                          <option value="SUM">SUM</option>
                          <option value="GEO">GEO</option>
                          <option value="HAR">HAR</option>
                        </Select>
                        {!uncertaintyAggregation && <Text color="red.500" fontSize="sm">Required</Text>}
                      </HStack>
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
                    </HStack>
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
                      <Text fontSize="sm" color="gray.600">
                        One plot per alternative with smooth overlapping distributions for each elicitation.
                      </Text>
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
                                  onClick={() => handleDownloadChartPng(`step5_distribution_${altIndex}`, `step5_distribution_${altName}`)}
                                />
                              </Tooltip>
                              <Text fontWeight="semibold" fontSize="sm" mb={2}>{`Distribution of Values for ${altName}`}</Text>
                              <ResponsiveContainer width="100%" height={250}>
                                <AreaChart data={distData.densityData} margin={{ top: 10, right: 12, left: 0, bottom: 24 }}>
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
                                    formatter={(value, name) => [`${(Number(value) * 100).toFixed(2)}%`, String(name)]}
                                    labelFormatter={(v) => `Value ${Number(v).toFixed(3)}`}
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
                      <Text color="gray.600" fontSize="sm">Run Step 5 to display uncertainty distributions for each alternative.</Text>
                    </VStack>
                  )}
                </StepSection>
              </TabPanel>

              {/* Step 6: Results (NSMC, non-strict) */}
              <TabPanel>
                <StepSection
                  title="Results"
                  description="The final results are generated using NSMC with the practitioner's chosen aggregation method."
                  onRun={() => handleRunStep(6, 'Results')}
                  onStop={handleStopExecution}
                  isRunning={runningStep === 'Results'}
                  isDisabled={isButtonDisabled(5) || !resultsAggregation || selectedSessions.length === 0}
                  showConsole={showConsole}
                  consoleOutput={consoleOutput}
                  onToggleConsole={() => setShowConsole(!showConsole)}
                  statusInfo={
                    getStepStatus(6)?.completed ? (
                      <HStack spacing={3}>
                        <Badge colorScheme="green" fontSize="sm" px={2} py={1}>Step 6 completed</Badge>
                        <Text fontSize="sm" color="gray.500">{formatTimestamp(getStepStatus(6)?.timestamp)}</Text>
                      </HStack>
                    ) : null
                  }
                  parameters={
                    <HStack spacing={6} flexWrap="wrap">
                      <HStack spacing={3}>
                        <Text fontWeight="bold">Aggregation:</Text>
                        <Select
                          placeholder="Select aggregation method"
                          value={resultsAggregation}
                          onChange={(e) => setResultsAggregation(e.target.value)}
                          width="200px"
                          isDisabled={runningStep !== null}
                        >
                          <option value="SUM">SUM</option>
                          <option value="GEO">GEO</option>
                          <option value="HAR">HAR</option>
                        </Select>
                        {!resultsAggregation && <Text color="red.500" fontSize="sm">Required</Text>}
                      </HStack>
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
                    </HStack>
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
                      <Text color="gray.500">Run Step 6 to display the final ranking heatmap.</Text>
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
                  Final ranking heatmap (CSV and IMAGE)
                </Checkbox>
                <Checkbox
                  isChecked={exportIncludePlotImages}
                  onChange={(e) => setExportIncludePlotImages(e.target.checked)}
                >
                  Plot Images (PNG and SVG)
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
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;')
}

function getRankingHeatmapDimensions(results) {
  const matrix = buildRankProbabilityMatrix(results)
  if (!matrix) {
    return { width: HEATMAP_FALLBACK_WIDTH, height: HEATMAP_FALLBACK_HEIGHT }
  }

  const { alternatives } = matrix
  const cellSize = HEATMAP_CELL_SIZE
  const cellGap = HEATMAP_CELL_GAP
  const rowLabelWidth = HEATMAP_ROW_LABEL_WIDTH
  const minGridWidth = rowLabelWidth + alternatives.length * (cellSize + cellGap)
  const width = Math.max(HEATMAP_FALLBACK_WIDTH, minGridWidth + 24)
  const height = 90 + alternatives.length * (cellSize + cellGap) + 24

  return { width, height }
}

function buildRankProbabilityCsv(results) {
  const matrix = buildRankProbabilityMatrix(results)
  if (!matrix) return null

  const headers = ['rank', ...matrix.alternatives]
  const rows = matrix.probabilities.map((rankRow, rankIndex) => (
    [rankIndex + 1, ...rankRow.map((probability) => Number(probability).toFixed(6))]
  ))
  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n')
}

function buildRankingHeatmapSvg({ title, results }) {
  const matrix = buildRankProbabilityMatrix(results)
  if (!matrix) return null

  const { alternatives, probabilities } = matrix
  const cellSize = HEATMAP_CELL_SIZE
  const cellGap = HEATMAP_CELL_GAP
  const rowLabelWidth = HEATMAP_ROW_LABEL_WIDTH
  const leftPad = 12
  const topPad = 44
  const textY = 24
  const width = Math.max(HEATMAP_FALLBACK_WIDTH, rowLabelWidth + alternatives.length * (cellSize + cellGap) + 24)
  const height = topPad + (alternatives.length + 1) * (cellSize + cellGap) + 18
  const gridX = leftPad + rowLabelWidth
  const gridY = topPad

  const headerCells = alternatives.map((altName, colIndex) => {
    const x = gridX + colIndex * (cellSize + cellGap) + (cellSize / 2)
    return `<text x="${x}" y="${gridY - 10}" font-size="12" text-anchor="middle" font-weight="600" fill="#1A202C">${escapeSvgText(altName)}</text>`
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

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect x="0" y="0" width="${width}" height="${height}" fill="#FFFFFF" />
      <text x="${leftPad}" y="${textY}" font-size="16" font-weight="700" fill="#1A202C">${escapeSvgText(title)}</text>
      ${headerCells}
      ${rowLabels}
      ${cells}
    </svg>
  `.trim()
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

function buildPipelineHeatmapExports({ step3Results, step4Results, step6Results }) {
  const targets = []

  if (step3Results) {
    targets.push({
      title: 'Dominance Heatmap',
      filenameBase: 'step3_dominance_heatmap',
      results: step3Results,
    })
  }

  if (step4Results?.results_by_aggregation?.weighted_sum) {
    targets.push({
      title: 'SUM Aggregation Heatmap',
      filenameBase: 'step4_sum_aggregation_heatmap',
      results: step4Results.results_by_aggregation.weighted_sum,
    })
  }
  if (step4Results?.results_by_aggregation?.geometric_mean) {
    targets.push({
      title: 'GEO Aggregation Heatmap',
      filenameBase: 'step4_geo_aggregation_heatmap',
      results: step4Results.results_by_aggregation.geometric_mean,
    })
  }
  if (step4Results?.results_by_aggregation?.harmonic_mean) {
    targets.push({
      title: 'HAR Aggregation Heatmap',
      filenameBase: 'step4_har_aggregation_heatmap',
      results: step4Results.results_by_aggregation.harmonic_mean,
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
  const leftLabel = 220
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

    return `
      <text x="${leftLabel - 10}" y="${y + 15}" text-anchor="end" font-size="12" fill="#1A202C">${escapeSvgText(criterion)}</text>
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
    <VStack spacing={2} align="stretch">
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
                      <Box
                        key={i}
                        position="absolute"
                        left={`${(w / (maxWeight * 1.1)) * 100}%`}
                        top="2px"
                        width="6px"
                        height="16px"
                        bg="blue.500"
                        borderRadius="sm"
                        opacity={0.7}
                        title={`${w.toFixed(3)}`}
                      />
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
                    <Box
                      key={i}
                      position="absolute"
                      left={`${(w / (maxWeight * 1.1)) * 100}%`}
                      top="2px"
                      width="6px"
                      height="16px"
                      bg="blue.500"
                      borderRadius="sm"
                      opacity={0.7}
                      title={`${w.toFixed(3)}`}
                    />
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
  buildRankingHeatmapSvg,
  getRankingHeatmapDimensions,
  buildPipelineChartExportTargets,
  buildPipelineHeatmapExports,
  buildWeightSpacePlotSvg,
}

export default RunUpMavtPage
