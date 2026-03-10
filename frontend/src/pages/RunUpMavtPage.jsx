import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Box,
  Heading,
  VStack,
  HStack,
  SimpleGrid,
  Button,
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
} from '@chakra-ui/react'
import { DownloadIcon, ExternalLinkIcon } from '@chakra-ui/icons'
import axios from 'axios'
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

  // Step 2 results state
  const [step2Results, setStep2Results] = useState(null)
  const [step5Results, setStep5Results] = useState(null)
  const [step3Results, setStep3Results] = useState(null)
  const [step4Results, setStep4Results] = useState(null)
  const [step6Results, setStep6Results] = useState(null)
  const [exportingDataZip, setExportingDataZip] = useState(false)
  // PDF Modal states
  const { isOpen: isUncertaintiesOpen, onOpen: onUncertaintiesOpen, onClose: onUncertaintiesClose } = useDisclosure()
  const { isOpen: isMcModesOpen, onOpen: onMcModesOpen, onClose: onMcModesClose } = useDisclosure()

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
    const v = Math.max(100, Math.min(5000, parseInt(value) || 1000))
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
      const expertName = sessions[parseInt(expertIdx)]?.name || `Expert ${parseInt(expertIdx) + 1}`
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
        sessions[parseInt(expertIdx)]?.name || `Expert ${parseInt(expertIdx) + 1}`
      )),
    }
  }

  const getLegendItems = (stepResults) => {
    if (!stepResults?.results_by_elicitation) return []
    return Object.entries(stepResults.results_by_elicitation)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([expertIdx], idx) => ({
        label: `E${idx + 1}`,
        expertName: sessions[parseInt(expertIdx)]?.name || `Expert ${parseInt(expertIdx) + 1}`,
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

  const getConsistencyPlotData = () => {
    const sessionDoc = sessions.find((session) => session?._id === selectedWeightSession)
    const comparisons = Array.isArray(sessionDoc?.bwt?.comparisons) ? sessionDoc.bwt.comparisons : []
    const weightSamples = normalizeWeightSamples(weightSpaceData)

    if (!sessionDoc || comparisons.length === 0 || weightSamples.length === 0) return { data: [], comparisons: [] }

    const valueFunctionMap = sessionDoc?.value_functions?.criteria || {}
    const allDataPoints = []
    const comparisonLabels = []

    comparisons.forEach((comparison, idx) => {
      const referenceCriterion = comparison?.reference_criterion
      const adjustedCriterion = comparison?.adjusted_criterion
      const comparisonValue = Number(comparison?.data_value)

      if (!referenceCriterion || !adjustedCriterion || !Number.isFinite(comparisonValue)) return

      const adjustedVFPoints = valueFunctionMap?.[adjustedCriterion]?.points
      const vfValue = interpolateValueFunction(adjustedVFPoints, comparisonValue)
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
        value: Number(declaredRatio.toFixed(4)),
        type: 'declared'
      })

      // Add all computed ratios as individual points
      computedRatios.forEach((ratio) => {
        allDataPoints.push({
          comparison: comparisonLabel,
          yIndex: idx,
          value: Number(ratio.toFixed(4)),
          type: 'computed'
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

  const handleExportWorkflowDataZip = async () => {
    if (!studySessionId) return

    setExportingDataZip(true)
    try {
      const response = await axios.get(
        `${API_URL}/study-session/${studySessionId}/workflow-export/data`,
        { responseType: 'blob' }
      )

      const disposition = response.headers['content-disposition'] || ''
      const filenameMatch = disposition.match(/filename="?([^";]+)"?/i)
      const filename = filenameMatch?.[1] || 'upmavt_data.zip'
      triggerDownloadFromBlob(response.data, filename)

      toast({
        title: 'Data ZIP exported',
        description: 'The Run UP-MAVT data bundle was downloaded.',
        status: 'success',
        duration: 3500,
      })
    } catch (error) {
      toast({
        title: 'Unable to export data ZIP',
        description: error.response?.data?.error || error.message,
        status: 'error',
        duration: 5000,
      })
    } finally {
      setExportingDataZip(false)
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
            The UP-MAVT code implements two Monte Carlo approaches — "strict" and "non-strict", each serving a distinct purpose.{' '}
            <Link color="blue.600" textDecoration="underline" cursor="pointer" onClick={onMcModesOpen}>
              The logic behind these methods is detailed in this image.
            </Link>
          </Text>
        </VStack>

        {/* Important Publication Reference */}
        <Box bg="blue.50" p={5} borderRadius="md" borderLeft="4px solid" borderColor="blue.500">
          <Text fontWeight="bold">
            For a comprehensive explanation, an overview of the workflow, and an example case study, please refer to the publication{' '}
            <Link href="https://www.sciencedirect.com" isExternal color="blue.600" textDecoration="underline">
              PLACEHOLDER <ExternalLinkIcon mx="2px" />
            </Link>
            .
          </Text>
        </Box>

        <Text color="gray.700">
          If you want to do stuff offline or run the analysis locally, check our{' '}
          <Link href="https://github.com/your-repo/elicitation-tools/tree/main/local" isExternal color="blue.600" textDecoration="underline">
            repository <ExternalLinkIcon mx="2px" />
          </Link>
          {' '}where there is a local version of the code as well.
        </Text>

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
                        {session.name || session.code || `Session ${session._id}`}{' '}
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
                        The PILE-BWT method computes weights by solving an optimization problem, as described in{' '}
                        <Link href="https://www.sciencedirect.com" isExternal color="blue.600" textDecoration="underline">
                          PLACEHOLDER <ExternalLinkIcon mx="2px" />
                        </Link>
                        . The process begins with a local solver based on{' '}
                        <Link href="https://www.sciencedirect.com" isExternal color="blue.600" textDecoration="underline">
                          PLACEHOLDER <ExternalLinkIcon mx="2px" />
                        </Link>
                        {' '}to obtain an initial valid solution. Following this, the Differential Evolution algorithm ({' '}
                        <Link href="https://www.sciencedirect.com" isExternal color="blue.600" textDecoration="underline">
                          PLACEHOLDER <ExternalLinkIcon mx="2px" />
                        </Link>
                        ) is applied to explore the full range of possible weights, thereby defining the weight space.
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
                  parameters={
                    <VStack spacing={2} align="stretch">
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
                  statusInfo={
                    weightsComputed ? (
                      <HStack spacing={3}>
                        <Badge colorScheme="green" fontSize="sm" px={2} py={1}>Weights computed</Badge>
                        <Text fontSize="sm" color="gray.500">{formatTimestamp(weightsTimestamp)}</Text>
                        <Button size="xs" colorScheme="orange" variant="outline" onClick={handleResetWeights}>
                          Reset Weights
                        </Button>
                      </HStack>
                    ) : null
                  }
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
                                {s?.name || sid}
                              </option>
                            )
                          })}
                        </Select>
                      </HStack>

                      <Text>Weight Space Plot</Text>
                      <WeightSpacePlot data={weightSpaceData} />

                      <Text mt={4}>Declared vs Computed Ratios</Text>
                      {step1ConsistencyData.length > 0 ? (
                        <Box borderWidth={1} borderRadius="md" p={3} bg="white">
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
                                type="category"
                                dataKey="comparison"
                                name="Comparison"
                                width={240}
                                tick={{ fontSize: 10 }}
                                interval={0}
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
                            <Box key={`${altName}-${altIndex}`} borderWidth={1} borderRadius="md" p={3} bg="gray.50">
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
                      />
                      <RankingHeatmap
                        title="GEO Aggregation Heatmap"
                        results={step4Results.results_by_aggregation.geometric_mean}
                      />
                      <RankingHeatmap
                        title="HAR Aggregation Heatmap"
                        results={step4Results.results_by_aggregation.harmonic_mean}
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
                            <Box key={`${altName}-${altIndex}`} borderWidth={1} borderRadius="md" p={3} bg="gray.50">
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
                          max={5000}
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
                    />
                  ) : (
                    <Box bg="gray.100" h={220} borderRadius="md" display="flex" alignItems="center" justifyContent="center">
                      <Text color="gray.500">Run Step 6 to display the final ranking heatmap.</Text>
                    </Box>
                  )}

                  <Divider my={4} />
                  <VStack spacing={3} align="stretch">
                    <Text color="gray.600" fontSize="sm">
                      Download the complete workflow data ZIP after Step 6 is completed.
                    </Text>
                    <Button
                      leftIcon={<DownloadIcon />}
                      colorScheme="blue"
                      variant="solid"
                      onClick={handleExportWorkflowDataZip}
                      isLoading={exportingDataZip}
                      loadingText="Preparing Data ZIP"
                      isDisabled={!getStepStatus(6)?.completed}
                      alignSelf="flex-start"
                    >
                      Download Data ZIP
                    </Button>
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

function RankingHeatmap({ title, results }) {
  const matrix = buildRankProbabilityMatrix(results)

  if (!matrix) {
    return (
      <Box bg="gray.100" h={220} borderRadius="md" display="flex" alignItems="center" justifyContent="center">
        <Text color="gray.500">No ranking data available.</Text>
      </Box>
    )
  }

  const { alternatives, probabilities } = matrix
  const cellSize = 70
  const cellGap = 4
  const rowLabelWidth = 90
  const minGridWidth = rowLabelWidth + alternatives.length * (cellSize + cellGap)

  return (
    <VStack spacing={2} align="stretch">
      <Text fontWeight="bold">{title}</Text>

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
function WeightSpacePlot({ data }) {
  if (!data) {
    return (
      <Box bg="gray.100" h={300} borderRadius="md" display="flex" alignItems="center" justifyContent="center">
        <Text color="gray.500">No weight space data available</Text>
      </Box>
    )
  }

  if (!Array.isArray(data) && typeof data === 'object' && Object.keys(data).length > 0) {
    const criteria = Object.keys(data)
    const maxWeight = Math.max(...criteria.flatMap((criterion) => data[criterion]))

    return (
      <Box bg="white" border="1px" borderColor="gray.200" borderRadius="md" p={4}>
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
                <Text fontSize="xs" color="gray.500" width="50px" flexShrink={0}>
                  {weights.length} pts
                </Text>
              </HStack>
            )
          })}
          <HStack spacing={3} mt={2}>
            <Box width="180px" />
            <HStack flex={1} justify="space-between">
              <Text fontSize="xs" color="gray.400">0</Text>
              <Text fontSize="xs" color="gray.400">{(maxWeight * 1.1).toFixed(2)}</Text>
            </HStack>
            <Box width="50px" />
          </HStack>
        </VStack>
      </Box>
    )
  }

  if (!Array.isArray(data) || data.length === 0) {
    return (
      <Box bg="gray.100" h={300} borderRadius="md" display="flex" alignItems="center" justifyContent="center">
        <Text color="gray.500">No weight space data available</Text>
      </Box>
    )
  }

  const criteria = Object.keys(data[0] || {})
  const criterionToValues = criteria.reduce((acc, criterion) => {
    acc[criterion] = data
      .map((solution) => (typeof solution?.[criterion] === 'number' ? solution[criterion] : Number(solution?.[criterion] || 0)))
      .filter((value) => Number.isFinite(value))
    return acc
  }, {})

  const maxWeight = Math.max(0.001, ...criteria.flatMap((criterion) => criterionToValues[criterion]))

  return (
    <Box bg="white" border="1px" borderColor="gray.200" borderRadius="md" p={4}>
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
              <Text fontSize="xs" color="gray.500" width="50px" flexShrink={0}>
                {weights.length} pts
              </Text>
            </HStack>
          )
        })}
        <HStack spacing={3} mt={2}>
          <Box width="180px" />
          <HStack flex={1} justify="space-between">
            <Text fontSize="xs" color="gray.400">0</Text>
            <Text fontSize="xs" color="gray.400">{(maxWeight * 1.1).toFixed(2)}</Text>
          </HStack>
          <Box width="50px" />
        </HStack>
      </VStack>
    </Box>
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
  showConsole,
  consoleOutput,
  onToggleConsole,
  parameters,
  statusInfo,
  children,
}) {
  const consoleEndRef = useRef(null)

  useEffect(() => {
    if (showConsole && consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' })
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
          {parameters}
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
      </HStack>

      {/* Console Output Panel */}
      {showConsole && (
        <Box bg="gray.900" p={4} borderRadius="md" color="green.300" fontFamily="monospace" fontSize="sm">
          <Box
            maxH="350px"
            overflowY="auto"
            whiteSpace="pre-wrap"
            wordBreak="break-word"
            fontFamily="monospace"
            fontSize="xs"
          >
            {consoleOutput || 'No output yet...'}
            <div ref={consoleEndRef} />
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

export default RunUpMavtPage
