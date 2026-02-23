import { useState, useEffect } from 'react'
import {
  Box,
  Heading,
  VStack,
  HStack,
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
} from '@chakra-ui/react'
import { ExternalLinkIcon } from '@chakra-ui/icons'
import axios from 'axios'
import PdfModal from '../components/PdfModal'

const API_URL = 'http://localhost:5000/api'

const isInputComplete = (criteria) => {
  if (!Array.isArray(criteria) || criteria.length === 0) return false
  return criteria.every((crit) => {
    if (!crit?.criterion_name || !crit?.unit) return false
    const alts = Array.isArray(crit?.alternatives) ? crit.alternatives : []
    if (alts.length === 0) return false
    return alts.every((alt) => alt?.name)
  })
}

const isQualitativeComplete = (criteria, qualitativeIndicators) => {
  if (!Array.isArray(criteria)) return false
  const qualitativeCriteria = criteria.filter((crit) => crit?.is_qualitative)
  if (qualitativeCriteria.length === 0) return true
  if (!qualitativeIndicators || typeof qualitativeIndicators !== 'object') return false
  return qualitativeCriteria.every((crit) => {
    const name = crit?.criterion_name
    const data = name ? qualitativeIndicators[name] : null
    const ranking = data?.ranking
    const values = data?.values
    return ranking && values && Object.keys(ranking).length > 0 && Object.keys(values).length > 0
  })
}

const isValueFunctionsComplete = (criteria, valueFunctions) => {
  if (!Array.isArray(criteria)) return false
  const criteriaMap = valueFunctions?.criteria || {}
  const nonQualitative = criteria.filter((crit) => !crit?.is_qualitative)
  if (nonQualitative.length === 0) return true
  return nonQualitative.every((crit) => {
    const name = crit?.criterion_name
    const cfg = name ? criteriaMap[name] : null
    const points = Array.isArray(cfg?.points) ? cfg.points : []
    return points.length > 0
  })
}

const isPileBwtComplete = (criteria, bwtData) => {
  if (!Array.isArray(criteria) || criteria.length === 0) return false
  const comparisons = Array.isArray(bwtData?.comparisons) ? bwtData.comparisons : []
  const groupMap = criteria.reduce((acc, crit) => {
    const groupName = crit?.group || 'Ungrouped'
    if (!acc[groupName]) acc[groupName] = []
    acc[groupName].push(crit)
    return acc
  }, {})

  const baseGroups = Object.entries(groupMap).map(([name, groupCriteria]) => ({
    name,
    criteria: groupCriteria,
  }))

  const completedBaseGroups = baseGroups.every(({ name, criteria: groupCriteria }) => {
    const expected = Math.max(1, 2 * groupCriteria.length - 3)
    const groupComps = comparisons.filter((c) => c?.group === name)
    return groupComps.length >= expected
  })

  const hasMultipleGroups = baseGroups.length > 1
  const intraBExpected = hasMultipleGroups ? Math.max(1, 2 * baseGroups.length - 3) : 0
  const intraWExpected = hasMultipleGroups ? Math.max(1, 2 * baseGroups.length - 3) : 0
  const intraBComps = comparisons.filter((c) => c?.group === 'intra-B')
  const intraWComps = comparisons.filter((c) => c?.group === 'intra-W')
  const completedIntraB = !hasMultipleGroups || intraBComps.length >= intraBExpected
  const completedIntraW = !hasMultipleGroups || intraWComps.length >= intraWExpected

  return baseGroups.length > 0 && completedBaseGroups && completedIntraB && completedIntraW
}

const isSessionComplete = (session, criteria) => {
  if (!session) return false
  const sessionCriteria = Array.isArray(session?.criteria) && session.criteria.length > 0
    ? session.criteria
    : criteria

  return (
    isInputComplete(sessionCriteria) &&
    isQualitativeComplete(sessionCriteria, session?.qualitative_indicators) &&
    isValueFunctionsComplete(sessionCriteria, session?.value_functions) &&
    isPileBwtComplete(sessionCriteria, session?.bwt)
  )
}

function RunUpMavtPage({ studySessionId, onNavigate }) {
  const toast = useToast()

  // State for sessions
  const [sessions, setSessions] = useState([])
  const [criteria, setCriteria] = useState([])
  const [selectedSessions, setSelectedSessions] = useState([])
  const [loadingStudy, setLoadingStudy] = useState(true)

  // State for workflow
  const [weightsComputed, setWeightsComputed] = useState(false)
  const [activeStep, setActiveStep] = useState(0)
  const [runningStep, setRunningStep] = useState(null)
  const [consoleOutput, setConsoleOutput] = useState('')
  const [showConsole, setShowConsole] = useState(false)

  // Step parameters
  const [consensusAggregation, setConsensusAggregation] = useState('SUM')
  const [dominanceAggregation, setDominanceAggregation] = useState('SUM')
  const [uncertaintyAggregation, setUncertaintyAggregation] = useState('')
  const [resultsAggregation, setResultsAggregation] = useState('')

  // PDF Modal states
  const { isOpen: isUncertaintiesOpen, onOpen: onUncertaintiesOpen, onClose: onUncertaintiesClose } = useDisclosure()
  const { isOpen: isMcModesOpen, onOpen: onMcModesOpen, onClose: onMcModesClose } = useDisclosure()

  // Load study sessions on mount
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
        
        // Auto-select completed and locked sessions
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
  }, [studySessionId, toast])

  const completedAndLockedSessions = sessions.filter((s) => 
    isSessionComplete(s, criteria) && s.session_locked === true
  )
  const completedAndLockedCount = completedAndLockedSessions.length
  const totalSessionCount = sessions.length
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

  // Dummy weight save function for testing
  const handleComputeWeights = async () => {
    setRunningStep('weights')
    setConsoleOutput('Computing weights...\nGenerating weight distributions...\nSaving to database...\nWeights computed successfully!')
    setShowConsole(true)
    // Simulate async work
    setTimeout(() => {
      setWeightsComputed(true)
      setRunningStep(null)
      toast({ title: 'Weights computed and saved', status: 'success' })
    }, 1500)
  }

  const handleExecuteStep = (stepName) => {
    if (runningStep) return // Prevent running multiple steps
    if (!weightsComputed) return // Prevent running if weights not computed

    setRunningStep(stepName)
    setConsoleOutput(`Starting ${stepName}...\nExecuting simulation...\n${stepName} completed!`)
    setShowConsole(true)

    // Simulate async work
    setTimeout(() => {
      setRunningStep(null)
      toast({ title: `${stepName} completed and saved`, status: 'success' })
    }, 1500)
  }

  const handleStopExecution = () => {
    // For now, just stop the simulation
    setRunningStep(null)
    setConsoleOutput(consoleOutput + '\n[Execution stopped by user]')
    toast({ title: 'Execution stopped', status: 'info' })
  }

  const isStepDisabled = (stepIndex) => {
    if (stepIndex === 0) return false // First step always enabled
    return !weightsComputed || runningStep !== null
  }

  const isButtonDisabled = (stepIndex) => {
    return isStepDisabled(stepIndex) || runningStep !== null
  }

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
          </Text>
          <Text color="gray.700">
            This method uses Monte Carlo simulations to propagate uncertainties arising from any component of the analysis.{' '}
            <Link color="blue.600" textDecoration="underline" cursor="pointer" onClick={onUncertaintiesOpen}>
              This diagram illustrates the sources of uncertainty considered in the framework.
            </Link>
          </Text>
          <Text color="gray.700">
            The workflow is designed to examine all aspects of the framework, including consensus among multiple opinions, dominance patterns, 
            compensatory dynamics for selecting the aggregation model, overall uncertainty assessment, and the final results. 
            The UP-MAVT code implements two Monte Carlo approaches—"strict" and "non-strict", each serving a distinct purpose.{' '}
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

        <Divider />

        {/* Session Selection Section */}
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
                        {session.name || session.code || `Session ${session._id}`} <Text as="span" color="gray.500" ml={2}>{statusText}</Text>
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
                Step 1: Weights {weightsComputed && <Badge ml={2} colorScheme="green">✓</Badge>}
              </Tab>
              <Tab isDisabled={isStepDisabled(1)}>
                Step 2: Consensus
              </Tab>
              <Tab isDisabled={isStepDisabled(2)}>
                Step 3: Dominance
              </Tab>
              <Tab isDisabled={isStepDisabled(3)}>
                Step 4: Compensation
              </Tab>
              <Tab isDisabled={isStepDisabled(4)}>
                Step 5: Uncertainty
              </Tab>
              <Tab isDisabled={isStepDisabled(5)}>
                Step 6: Results
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
                          Due to the complexity of the search, this process may take some time. For example, with 15 criteria organized into 4 groups, 
                          the computation typically requires between 10 and 15 minutes. Your patience is appreciated.
                        </AlertDescription>
                      </Alert>
                    </VStack>
                  }
                  onRun={() => handleComputeWeights()}
                  onStop={handleStopExecution}
                  isRunning={runningStep === 'weights'}
                  isDisabled={isButtonDisabled(0)}
                  showConsole={showConsole}
                  consoleOutput={consoleOutput}
                  onToggleConsole={() => setShowConsole(!showConsole)}
                >
                  <VStack spacing={3} align="stretch">
                    <Text>Vertical Bar Plot - Weight Distribution</Text>
                    <Box bg="gray.100" h={200} borderRadius="md" display="flex" alignItems="center" justifyContent="center">
                      <Text color="gray.500">[Vertical Bar Plot Placeholder]</Text>
                    </Box>

                    <Text mt={4}>Horizontal Bar Plot - Weight Distribution</Text>
                    <Box bg="gray.100" h={200} borderRadius="md" display="flex" alignItems="center" justifyContent="center">
                      <Text color="gray.500">[Horizontal Bar Plot Placeholder]</Text>
                    </Box>
                  </VStack>
                </StepSection>
              </TabPanel>

              {/* Step 2: Consensus */}
              <TabPanel>
                <StepSection
                  title="Consensus Analysis"
                  description="The output of the SMC can be used to assess the consensus or agreement among experts. If the distributions largely overlap, consensus can be considered reached. Otherwise, it is important to reflect on the implications of aggregating divergent opinions."
                  onRun={() => handleExecuteStep('Consensus')}
                  onStop={handleStopExecution}
                  isRunning={runningStep === 'Consensus'}
                  isDisabled={isButtonDisabled(1)}
                  showConsole={showConsole}
                  consoleOutput={consoleOutput}
                  onToggleConsole={() => setShowConsole(!showConsole)}
                  parameters={
                    <HStack spacing={3}>
                      <Text fontWeight="bold">Aggregation Method:</Text>
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
                  }
                >
                  <VStack spacing={3} align="stretch">
                    <Text>Distribution Plot 1</Text>
                    <Box bg="gray.100" h={200} borderRadius="md" display="flex" alignItems="center" justifyContent="center">
                      <Text color="gray.500">[Distribution Histogram Placeholder]</Text>
                    </Box>

                    <Text mt={4}>Distribution Plot 2</Text>
                    <Box bg="gray.100" h={200} borderRadius="md" display="flex" alignItems="center" justifyContent="center">
                      <Text color="gray.500">[Distribution Histogram Placeholder]</Text>
                    </Box>
                  </VStack>
                </StepSection>
              </TabPanel>

              {/* Step 3: Dominance */}
              <TabPanel>
                <StepSection
                  title="Dominance Analysis"
                  description="Dominance patterns can be observed in the NSMC heatmaps when using random weights. If an alternative consistently dominates others regardless of the weights assigned to its criteria, this should prompt reflection: while it is possible that the alternative is genuinely superior across all preferences, such behavior may also suggest a bias in the indicator definitions."
                  onRun={() => handleExecuteStep('Dominance')}
                  onStop={handleStopExecution}
                  isRunning={runningStep === 'Dominance'}
                  isDisabled={isButtonDisabled(2)}
                  showConsole={showConsole}
                  consoleOutput={consoleOutput}
                  onToggleConsole={() => setShowConsole(!showConsole)}
                  parameters={
                    <HStack spacing={3}>
                      <Text fontWeight="bold">Aggregation Method:</Text>
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
                  }
                >
                  <VStack spacing={3} align="stretch">
                    <Text>Dominance Heatmap</Text>
                    <Box bg="gray.100" h={300} borderRadius="md" display="flex" alignItems="center" justifyContent="center">
                      <Text color="gray.500">[Heatmap Placeholder]</Text>
                    </Box>
                  </VStack>
                </StepSection>
              </TabPanel>

              {/* Step 4: Compensation */}
              <TabPanel>
                <StepSection
                  title="Compensation Analysis"
                  description="The code offers a choice of three aggregation methods: SUM (weighted sum), which is fully compensatory, and GEO (geometric mean) and HAR (harmonic mean), which are partially compensatory. By comparing the differences in the NSMC heatmaps, the practitioner can determine which aggregation method is most appropriate for their study."
                  onRun={() => handleExecuteStep('Compensation')}
                  onStop={handleStopExecution}
                  isRunning={runningStep === 'Compensation'}
                  isDisabled={isButtonDisabled(3)}
                  showConsole={showConsole}
                  consoleOutput={consoleOutput}
                  onToggleConsole={() => setShowConsole(!showConsole)}
                >
                  <VStack spacing={4} align="stretch">
                    <VStack spacing={2} align="stretch">
                      <Text fontWeight="bold">SUM Aggregation Heatmap</Text>
                      <Box bg="gray.100" h={250} borderRadius="md" display="flex" alignItems="center" justifyContent="center">
                        <Text color="gray.500">[Heatmap Placeholder]</Text>
                      </Box>
                    </VStack>

                    <VStack spacing={2} align="stretch">
                      <Text fontWeight="bold">GEO Aggregation Heatmap</Text>
                      <Box bg="gray.100" h={250} borderRadius="md" display="flex" alignItems="center" justifyContent="center">
                        <Text color="gray.500">[Heatmap Placeholder]</Text>
                      </Box>
                    </VStack>

                    <VStack spacing={2} align="stretch">
                      <Text fontWeight="bold">HAR Aggregation Heatmap</Text>
                      <Box bg="gray.100" h={250} borderRadius="md" display="flex" alignItems="center" justifyContent="center">
                        <Text color="gray.500">[Heatmap Placeholder]</Text>
                      </Box>
                    </VStack>
                  </VStack>
                </StepSection>
              </TabPanel>

              {/* Step 5: Uncertainty */}
              <TabPanel>
                <StepSection
                  title="Uncertainty Analysis"
                  description="By running the SMC with the preferred aggregation method, the practitioner can assess the overall uncertainty of the resulting distributions. This step can reveal insights that might otherwise be obscured by the final aggregated results."
                  onRun={() => handleExecuteStep('Uncertainty')}
                  onStop={handleStopExecution}
                  isRunning={runningStep === 'Uncertainty'}
                  isDisabled={isButtonDisabled(4) || !uncertaintyAggregation}
                  showConsole={showConsole}
                  consoleOutput={consoleOutput}
                  onToggleConsole={() => setShowConsole(!showConsole)}
                  parameters={
                    <HStack spacing={3}>
                      <Text fontWeight="bold">Aggregation Method:</Text>
                      <Select
                        placeholder="Select aggregation method"
                        value={uncertaintyAggregation}
                        onChange={(e) => setUncertaintyAggregation(e.target.value)}
                        width="200px"
                        isDisabled={runningStep !== null}
                      >
                        <option value="SUM">SUM</option>
                        <option value="GEO">GEO</option>
                        <option value="HAR">HAR</option>
                      </Select>
                      {!uncertaintyAggregation && <Text color="red.500" fontSize="sm">Required</Text>}
                    </HStack>
                  }
                >
                  <VStack spacing={3} align="stretch">
                    <Text>Uncertainty Distribution Plot 1</Text>
                    <Box bg="gray.100" h={200} borderRadius="md" display="flex" alignItems="center" justifyContent="center">
                      <Text color="gray.500">[Distribution Histogram Placeholder]</Text>
                    </Box>

                    <Text mt={4}>Uncertainty Distribution Plot 2</Text>
                    <Box bg="gray.100" h={200} borderRadius="md" display="flex" alignItems="center" justifyContent="center">
                      <Text color="gray.500">[Distribution Histogram Placeholder]</Text>
                    </Box>
                  </VStack>
                </StepSection>
              </TabPanel>

              {/* Step 6: Results */}
              <TabPanel>
                <StepSection
                  title="Results"
                  description="The final results are generated using NSMC with the practitioner's chosen aggregation method."
                  onRun={() => handleExecuteStep('Results')}
                  onStop={handleStopExecution}
                  isRunning={runningStep === 'Results'}
                  isDisabled={isButtonDisabled(5) || !resultsAggregation}
                  showConsole={showConsole}
                  consoleOutput={consoleOutput}
                  onToggleConsole={() => setShowConsole(!showConsole)}
                  parameters={
                    <HStack spacing={3}>
                      <Text fontWeight="bold">Aggregation Method:</Text>
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
                  }
                >
                  <VStack spacing={3} align="stretch">
                    <Text>Results Heatmap</Text>
                    <Box bg="gray.100" h={300} borderRadius="md" display="flex" alignItems="center" justifyContent="center">
                      <Text color="gray.500">[Heatmap Placeholder]</Text>
                    </Box>
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

/**
 * Reusable StepSection component for each workflow step
 */
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
  children,
}) {
  return (
    <VStack spacing={4} align="stretch">
      <VStack spacing={1} align="stretch">
        <Heading as="h3" size="md">
          {title}
        </Heading>
        <Box color="gray.600">{description}</Box>
      </VStack>

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
            maxH="250px"
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

export default RunUpMavtPage
