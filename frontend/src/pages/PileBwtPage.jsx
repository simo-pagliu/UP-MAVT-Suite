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
import { ChevronLeftIcon, ChevronRightIcon, LockIcon, WarningIcon, InfoIcon, CheckCircleIcon } from '@chakra-ui/icons'
import axios from 'axios'
import { useEffect, useMemo, useState, useRef, forwardRef, useImperativeHandle } from 'react'
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
import { parseDistribution, computeDistributionBounds } from '../utils/distributionUtils'
import { API_URL } from '../config'
import QuestionPrompt from '../components/QuestionPrompt'

function PileBwtPage({ sessionId, onPageChange }, ref) {
  const [criteria, setCriteria] = useState([])
  const [valueFunction, setValueFunction] = useState({})
  const [loading, setLoading] = useState(true)
  const [groups, setGroups] = useState([])
  const [qualitativeIndicators, setQualitativeIndicators] = useState({})
  const [selectedGroupIndex, setSelectedGroupIndex] = useState(null)
  const [step, setStep] = useState('idle')
  const [selectionStep, setSelectionStep] = useState(null) // 'select-best' or 'select-worst'
  const [bestCriterion, setBestCriterion] = useState(null)
  const [worstCriterion, setWorstCriterion] = useState(null)
  const [pairs, setPairs] = useState([])
  const [currentPairIndex, setCurrentPairIndex] = useState(0)
  const [comparisons, setComparisons] = useState([])
  const [sliderValue, setSliderValue] = useState(0)
  const [sliderInputValue, setSliderInputValue] = useState('')
  const [sliderTouched, setSliderTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [bwtSignature, setBwtSignature] = useState(null)
  const [bwtQiSignature, setBwtQiSignature] = useState(null)
  const [bwtVfSignature, setBwtVfSignature] = useState(null)
  const [bwtLockActive, setBwtLockActive] = useState(false)
  const [isSessionLocked, setIsSessionLocked] = useState(false)
  const [qualitativeIncomplete, setQualitativeIncomplete] = useState(false)
  const criteriaMismatch = false
  const criteriaMismatchAcknowledged = true
  const setCriteriaMismatchAcknowledged = () => {}
  const handleCriteriaMismatchReset = () => {}
  // Consistency checking state
  const [bestToWorstValue, setBestToWorstValue] = useState(null) // Value from BEST-to-WORST comparison
  const [consistencyConstraints, setConsistencyConstraints] = useState({}) // Track constraints for each criterion
  const [isConsistencyError, setIsConsistencyError] = useState(false) // Whether current position violates consistency
  const { isOpen: isResetOpen, onOpen: onResetOpen, onClose: onResetClose } = useDisclosure()
  const cancelRef = useRef()
  const mainContentRef = useRef(null)
  const [showUnlockConfirm, setShowUnlockConfirm] = useState(false)
  const toast = useToast()

  // Expose save method for navigation
  useImperativeHandle(ref, () => ({
    async saveBeforeNavigate() {
      // PileBwtPage auto-saves on every action, so nothing extra needed
      // This method is here for consistency with other pages
    },
  }))

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

  const getObjectSignature = (obj) => JSON.stringify(canonicalizeJson(obj || {}))

  const parseSignature = (signature) => {
    if (!signature) return null
    try {
      return JSON.parse(signature)
    } catch {
      return null
    }
  }

  const getChangedCriteriaNames = (savedSignature, currentSignature) => {
    const saved = parseSignature(savedSignature)
    const current = parseSignature(currentSignature)
    if (!Array.isArray(saved) || !Array.isArray(current)) return null

    const toMap = (items) => {
      const map = new Map()
      items.forEach((item) => {
        if (!item?.name) return
        map.set(item.name, JSON.stringify(canonicalizeJson(item)))
      })
      return map
    }

    const savedMap = toMap(saved)
    const currentMap = toMap(current)
    const names = new Set([...savedMap.keys(), ...currentMap.keys()])
    const changed = []

    names.forEach((name) => {
      if (!savedMap.has(name) || !currentMap.has(name) || savedMap.get(name) !== currentMap.get(name)) {
        changed.push(name)
      }
    })

    return changed
  }

  const getChangedObjectKeys = (savedSignature, currentSignature) => {
    const saved = parseSignature(savedSignature)
    const current = parseSignature(currentSignature)
    if (!saved || !current || typeof saved !== 'object' || typeof current !== 'object') return null

    const keys = new Set([...Object.keys(saved), ...Object.keys(current)])
    const changed = []
    keys.forEach((key) => {
      const left = JSON.stringify(canonicalizeJson(saved[key]))
      const right = JSON.stringify(canonicalizeJson(current[key]))
      if (left !== right) changed.push(key)
    })
    return changed
  }

  const getAffectedGroupsForCriteria = (criterionNames, currentCriteria, previousCriteriaSignature) => {
    if (!Array.isArray(criterionNames) || criterionNames.length === 0) return []

    const currentGroupMap = new Map((currentCriteria || []).map((c) => [c.criterion_name, c.group || 'Ungrouped']))
    const previousCriteria = parseSignature(previousCriteriaSignature)
    const previousGroupMap = new Map(
      Array.isArray(previousCriteria)
        ? previousCriteria.map((c) => [c.name, c.group || 'Ungrouped'])
        : []
    )

    const groupsSet = new Set()
    criterionNames.forEach((name) => {
      const currentGroup = currentGroupMap.get(name)
      const previousGroup = previousGroupMap.get(name)
      if (currentGroup) groupsSet.add(currentGroup)
      if (previousGroup) groupsSet.add(previousGroup)
    })

    return [...groupsSet]
  }

  const canonicalizeJson = (value) => {
    if (Array.isArray(value)) {
      return value.map(canonicalizeJson)
    }
    if (value && typeof value === 'object') {
      return Object.keys(value)
        .sort()
        .reduce((acc, key) => {
          acc[key] = canonicalizeJson(value[key])
          return acc
        }, {})
    }
    return value
  }

  const areSignaturesEquivalent = (savedSignature, currentSignature) => {
    if (!savedSignature || !currentSignature) return false
    try {
      const savedParsed = canonicalizeJson(JSON.parse(savedSignature))
      const currentParsed = canonicalizeJson(JSON.parse(currentSignature))
      return JSON.stringify(savedParsed) === JSON.stringify(currentParsed)
    } catch {
      return savedSignature === currentSignature
    }
  }

  const criteriaSignature = useMemo(() => getCriteriaSignature(criteria), [criteria])
  const qiSignature = useMemo(() => getObjectSignature(qualitativeIndicators), [qualitativeIndicators])
  const vfSignature = useMemo(() => getObjectSignature(valueFunction), [valueFunction])

  const getBestWorstByGroupName = (groupName, comps = comparisons) => {
    const groupComps = comps.filter((c) => c.group === groupName && c.type === 'best')
    if (groupComps.length === 0) return { best: null, worst: null }
    const bestName = groupComps[0].adjusted_criterion
    const worstName = groupComps[0].reference_criterion
    const best = criteria.find((c) => c.criterion_name === bestName)
    const worst = criteria.find((c) => c.criterion_name === worstName)
    return { best, worst }
  }

  const allGroups = useMemo(() => {
    if (!groups || groups.length === 0) return []
    const baseGroups = [...groups]
    if (baseGroups.length <= 1) return baseGroups

    const missingGroups = []
    const bests = []
    const worsts = []

    baseGroups.forEach((g) => {
      const { best, worst } = getBestWorstByGroupName(g.name)
      if (best && worst) {
        bests.push(best)
        worsts.push(worst)
      } else {
        missingGroups.push(g.name)
      }
    })

    const isReady = missingGroups.length === 0

    return [
      ...baseGroups,
      {
        name: 'intra-B',
        criteria: bests,
        isIntra: true,
        isReady,
        missingGroups,
      },
      {
        name: 'intra-W',
        criteria: worsts,
        isIntra: true,
        isReady,
        missingGroups,
      },
    ]
  }, [groups, comparisons, criteria])

  const buildQualitativeValueFunctionMap = (criteriaList, qualitativeData) => {
    const vfMap = {}
    const list = Array.isArray(criteriaList) ? criteriaList : []

    list.forEach((criterion) => {
      if (!criterion?.is_qualitative) return
      const name = criterion.criterion_name
      if (!name) return
      const qData = qualitativeData?.[name]
      if (!qData || !qData.values || !qData.ranking) return

      const ranks = Object.values(qData.ranking)
        .map((rank) => Number(rank))
        .filter((rank) => Number.isFinite(rank))

      if (!ranks.length) return

      const uniqueRanks = Array.from(new Set(ranks)).sort((a, b) => a - b)
      const worstToBest = [...uniqueRanks].reverse()
      const denom = Math.max(worstToBest.length - 1, 1)
      const isIncreasing = qData.isIncreasing !== undefined ? qData.isIncreasing : true

      const points = worstToBest
        .map((rank, idx) => {
          const value = Number(qData.values?.[rank])
          if (!Number.isFinite(value)) return null
          const x = denom === 0 ? 0.5 : idx / denom
          return { x, y: value }
        })
        .filter(Boolean)

      // Add hypothetical extremes for qualitative value functions
      const minPoint = { x: 0, y: isIncreasing ? 0 : 1 }
      const maxPoint = { x: 1, y: isIncreasing ? 1 : 0 }
      const withoutEndpoints = points.filter((p) => p.x !== 0 && p.x !== 1)
      const withExtremes = [minPoint, ...withoutEndpoints, maxPoint]

      if (withExtremes.length > 0) {
        vfMap[name] = { points: withExtremes }
      }
    })

    return vfMap
  }

  useEffect(() => {
    const fetchSession = async () => {
      try {
        const response = await axios.get(`${API_URL}/session/${sessionId}`)
        const session = response.data
        setCriteria(Array.isArray(session.criteria) ? session.criteria : [])
        setIsSessionLocked(session?.session_locked || false)

        // Check if qualitative indicators are incomplete
        const qualitativeCriteria = (session.criteria || []).filter((c) => c.is_qualitative)
        if (qualitativeCriteria.length > 0) {
          const qualitativeData = session.qualitative_indicators || {}
          const incompleteIndicators = qualitativeCriteria.some(
            (c) => qualitativeData[c.criterion_name] === undefined
          )
          setQualitativeIncomplete(incompleteIndicators)
          setQualitativeIndicators(qualitativeData)
        } else {
          setQualitativeIndicators({})
        }

        const existingValueFunctions = session.value_functions?.criteria || {}
        const qualitativeVfMap = buildQualitativeValueFunctionMap(session.criteria, session.qualitative_indicators || {})
        setValueFunction({
          ...existingValueFunctions,
          ...qualitativeVfMap,
        })

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
          setBwtQiSignature(session.bwt.qi_signature || null)
          setBwtVfSignature(session.bwt.vf_signature || null)
          setBwtLockActive(Boolean(session.bwt.qi_vf_lock_active))
        } else {
          setBwtSignature(null)
          setBwtQiSignature(null)
          setBwtVfSignature(null)
          setBwtLockActive(false)
        }
      } catch (error) {
        toast({
          title: 'Request failed',
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
    if (!comparisons.length) return

    const criteriaMatch = bwtSignature && criteriaSignature
      ? areSignaturesEquivalent(bwtSignature, criteriaSignature)
      : false
    const qiMatch = bwtQiSignature && qiSignature
      ? areSignaturesEquivalent(bwtQiSignature, qiSignature)
      : false
    const vfMatch = bwtVfSignature && vfSignature
      ? areSignaturesEquivalent(bwtVfSignature, vfSignature)
      : false

    const hasMismatch =
      !bwtSignature ||
      !bwtQiSignature ||
      !bwtVfSignature ||
      !criteriaMatch ||
      !qiMatch ||
      !vfMatch

    if (!hasMismatch) return

    if (isSessionLocked && !bwtLockActive) {
      toast({
        title: 'Session locked by practitioner',
        description: 'BWT updates are disabled until the practitioner/admin unlocks the session.',
        status: 'warning',
        isClosable: true,
      })
      return
    }

    const changedCriteriaFromStructure = getChangedCriteriaNames(bwtSignature, criteriaSignature) || []
    const changedCriteriaFromQi = getChangedObjectKeys(bwtQiSignature, qiSignature) || []
    const changedCriteriaFromVf = getChangedObjectKeys(bwtVfSignature, vfSignature) || []
    const changedCriteriaSet = new Set([
      ...changedCriteriaFromStructure,
      ...changedCriteriaFromQi,
      ...changedCriteriaFromVf,
    ])

    if (changedCriteriaSet.size === 0) {
      resetBwtComparisons()
      return
    }

    resetBwtComparisonsByCriteria([...changedCriteriaSet])
  }, [
    loading,
    comparisons.length,
    bwtSignature,
    bwtQiSignature,
    bwtVfSignature,
    criteriaSignature,
    qiSignature,
    vfSignature,
    isSessionLocked,
    bwtLockActive,
    criteria,
    toast,
  ])

  const buildBwtPayload = (comps, lockActive = bwtLockActive) => ({
    comparisons: comps,
    criteria_signature: criteriaSignature,
    qi_signature: qiSignature,
    vf_signature: vfSignature,
    qi_vf_lock_active: Boolean(lockActive),
  })

  // Track which group the current pairs belong to
  const [pairsGroupName, setPairsGroupName] = useState(null)

  const resetBwtComparisons = async () => {
    setSaving(true)
    try {
      await axios.put(`${API_URL}/session/${sessionId}/bwt`, {
        value: buildBwtPayload([]),
      })
      setComparisons([])
      setPairs([])
      setPairsGroupName(null)
      setBestCriterion(null)
      setWorstCriterion(null)
      setCurrentPairIndex(0)
      setSelectedGroupIndex(0)
      setSelectionStep(null)
      setStep('select-criteria')
      setBwtSignature(criteriaSignature)
      setBwtQiSignature(qiSignature)
      setBwtVfSignature(vfSignature)
      setBestToWorstValue(null)
      setConsistencyConstraints({})
      setIsConsistencyError(false)
      toast({
        title: 'PILE-BWT reset',
        description: 'Outdated comparisons were reset after criteria changes.',
        status: 'warning',
        isClosable: true,
      })
    } catch (error) {
      toast({
        title: 'Request failed',
        description: error.response?.data?.error || 'Failed to reset PILE-BWT data',
        status: 'error',
        isClosable: true,
      })
    } finally {
      setSaving(false)
    }
  }

  const resetBwtComparisonsByCriteria = async (criterionNames) => {
    if (!Array.isArray(criterionNames) || criterionNames.length === 0) {
      await resetBwtComparisons()
      return
    }

    const criterionSet = new Set(criterionNames)
    
    // Filter out comparisons where either reference or adjusted criterion was changed
    const filteredComparisons = comparisons.filter((c) => {
      // Keep comparison only if NEITHER criterion is in the changed set
      const involvesChangedCriterion = 
        criterionSet.has(c.reference_criterion) || 
        criterionSet.has(c.adjusted_criterion)
      
      // Also remove intra-group comparisons since they depend on base group results
      const isIntraGroup = c.group === 'intra-B' || c.group === 'intra-W'
      
      return !involvesChangedCriterion && !isIntraGroup
    })

    const removedCount = comparisons.length - filteredComparisons.length
    if (removedCount === 0) {
      // No comparisons affected, just update signatures
      setBwtSignature(criteriaSignature)
      setBwtQiSignature(qiSignature)
      setBwtVfSignature(vfSignature)
      return
    }

    setSaving(true)
    try {
      await axios.put(`${API_URL}/session/${sessionId}/bwt`, {
        value: buildBwtPayload(filteredComparisons),
      })

      setComparisons(filteredComparisons)
      setPairs([])
      setPairsGroupName(null)
      setBestCriterion(null)
      setWorstCriterion(null)
      setCurrentPairIndex(0)
      setSelectionStep(null)
      setStep('select-criteria')
      setBwtSignature(criteriaSignature)
      setBwtQiSignature(qiSignature)
      setBwtVfSignature(vfSignature)
      setBestToWorstValue(null)
      setConsistencyConstraints({})
      setIsConsistencyError(false)
      
      toast({
        title: 'PILE-BWT partially reset',
        description: `Removed ${removedCount} comparison(s) involving: ${criterionNames.join(', ')}`,
        status: 'warning',
        isClosable: true,
      })
    } catch (error) {
      toast({
        title: 'Request failed',
        description: error.response?.data?.error || 'Failed to reset affected PILE-BWT comparisons',
        status: 'error',
        isClosable: true,
      })
    } finally {
      setSaving(false)
    }
  }

  const resetBwtComparisonsByGroups = async (groupNames) => {
    const baseGroups = new Set((groupNames || []).filter(Boolean))
    if (!baseGroups.size) {
      await resetBwtComparisons()
      return
    }

    // Start with affected base groups
    const groupsToClear = new Set([...baseGroups])
    
    // Only include intra-groups if they have actual comparisons
    const hasIntraB = comparisons.some(c => c.group === 'intra-B')
    const hasIntraW = comparisons.some(c => c.group === 'intra-W')
    if (hasIntraB) groupsToClear.add('intra-B')
    if (hasIntraW) groupsToClear.add('intra-W')

    const filteredComparisons = comparisons.filter((c) => !groupsToClear.has(c.group))

    setSaving(true)
    try {
      await axios.put(`${API_URL}/session/${sessionId}/bwt`, {
        value: buildBwtPayload(filteredComparisons),
      })

      setComparisons(filteredComparisons)
      setPairs([])
      setPairsGroupName(null)
      setBestCriterion(null)
      setWorstCriterion(null)
      setCurrentPairIndex(0)
      setSelectionStep(null)
      setStep('select-criteria')
      setBwtSignature(criteriaSignature)
      setBwtQiSignature(qiSignature)
      setBwtVfSignature(vfSignature)
      setBestToWorstValue(null)
      setConsistencyConstraints({})
      setIsConsistencyError(false)
      
      const resetGroups = [...baseGroups]
      if (hasIntraB) resetGroups.push('intra-B')
      if (hasIntraW) resetGroups.push('intra-W')
      
      toast({
        title: 'PILE-BWT partially reset',
        description: `Reset groups: ${resetGroups.join(', ')} after QI/VF changes.`,
        status: 'warning',
        isClosable: true,
      })
    } catch (error) {
      toast({
        title: 'Request failed',
        description: error.response?.data?.error || 'Failed to reset affected PILE-BWT groups',
        status: 'error',
        isClosable: true,
      })
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (!loading && allGroups.length > 0 && selectedGroupIndex !== null) {
      const selectedGroup = allGroups[selectedGroupIndex]
      if (!selectedGroup) return
      
      const groupName = selectedGroup.name
      
      // Skip if group is not ready
      if (selectedGroup.isIntra && !selectedGroup.isReady) {
        setStep('select-criteria')
        return
      }

      const groupComps = comparisons.filter((c) => c.group === groupName && c.type !== 'intra-best' && c.type !== 'intra-worst')
      const groupCriteria = selectedGroup.criteria
      const hasLocalBestWorst =
        step === 'evaluate-pairs' &&
        bestCriterion &&
        worstCriterion &&
        groupCriteria.some((c) => c.criterion_name === bestCriterion.criterion_name) &&
        groupCriteria.some((c) => c.criterion_name === worstCriterion.criterion_name)

      if (groupComps.length === 0 && !hasLocalBestWorst) {
        setStep('select-criteria')
        return
      }

      // Generate pairs if we don't have them yet OR if we switched to a different group
      if (pairs.length === 0 || pairsGroupName !== groupName) {
        // Generate pairs for this group and load


        const resolvedBestWorst = groupComps.length > 0
          ? getGroupBestWorst(selectedGroupIndex)
          : { best: bestCriterion, worst: worstCriterion }

        const { best, worst } = resolvedBestWorst
        if (best && worst) {
          const others = groupCriteria.filter(
            (c) => c.criterion_name !== best.criterion_name && c.criterion_name !== worst.criterion_name
          )
          const newPairs = [
            { reference: worst, adjusted: best, type: 'best' },
            ...others.map((other) => ({
              reference: other,
              adjusted: best,
              type: 'best',
            })),
            ...others.map((other) => ({
              reference: worst,
              adjusted: other,
              type: 'worst',
            })),
          ]
          setPairs(newPairs)
          setPairsGroupName(groupName)
          setBestCriterion(best)
          setWorstCriterion(worst)
          setStep('evaluate-pairs')

          // Restore bestToWorstValue from DB if it exists
          const firstPair = newPairs[0]
          const bestToWorstComp = groupComps.find(
            (c) =>
              c.reference_criterion === firstPair.reference.criterion_name &&
              c.adjusted_criterion === firstPair.adjusted.criterion_name &&
              c.type === 'best'
          )
          if (bestToWorstComp) {
            const vfValue = interpolateVF(firstPair.adjusted.criterion_name, bestToWorstComp.data_value)
            setBestToWorstValue(vfValue)
          } else {
            setBestToWorstValue(null)
          }

          // Set current pair and slider value
          setCurrentPairIndex(0)
          setConsistencyConstraints({})
          setIsConsistencyError(false)
          const targetPair = newPairs[0]
          const existing = comparisons.find(
            (c) =>
              c.reference_criterion === targetPair.reference.criterion_name &&
              c.adjusted_criterion === targetPair.adjusted.criterion_name &&
              c.group === groupName
          )
          setSliderValue(existing ? existing.data_value : getWorstDataValue(targetPair.adjusted))
        }
      }
    }
  }, [loading, selectedGroupIndex, allGroups, pairsGroupName])

  useEffect(() => {
    if (Number.isFinite(sliderValue)) {
      setSliderInputValue(sliderValue.toFixed(2))
      // Check consistency whenever slider value changes
      if (currentPairIndex !== null && pairs[currentPairIndex]) {
        const { isConsistent } = checkConsistency(currentPairIndex, sliderValue, comparisons)
        setIsConsistencyError(!isConsistent)
      }
    }
  }, [sliderValue, currentPairIndex, pairs, comparisons, bestToWorstValue])

  const ensureSessionUnlocked = () => {
    if (isSessionLocked && !bwtLockActive) {
      toast({
        title: 'Session locked by practitioner',
        description: 'BWT editing is disabled. Ask the practitioner/admin to unlock.',
        status: 'warning',
        isClosable: true,
      })
      return false
    }

    if (!bwtLockActive) {
      toast({
        title: 'Lock required',
        description: 'Please lock QI/VF from the banner above before editing PILE-BWT.',
        status: 'info',
        isClosable: true,
      })
      return false
    }

    return true
  }

  const handleUnlockForModification = async () => {
    setShowUnlockConfirm(false)
    setSaving(true)
    try {
      // Just save BWT with lock flag off - don't touch session_locked (practitioner lock)
      await axios.put(`${API_URL}/session/${sessionId}/bwt`, {
        value: buildBwtPayload(comparisons, false),
      })
      setBwtLockActive(false)
      setSelectionStep(null)
      setStep('select-criteria')
      toast({
        title: 'Unlocked',
        description: 'QI/VF can now be edited. Existing BWT comparisons were kept.',
        status: 'warning',
        isClosable: true,
      })
    } catch (error) {
      toast({
        title: 'Request failed',
        description: error.response?.data?.error || 'Failed to unlock session',
        status: 'error',
        isClosable: true,
      })
    } finally {
      setSaving(false)
    }
  }

  const getGroupCompletionStatus = (groupIndex) => {
    const group = allGroups[groupIndex]
    const groupName = group?.name
    if (!groupName) return 0
    if (group.isIntra && !group.isReady) return 0
    const groupComps = comparisons.filter((c) => c.group === groupName && c.type !== 'intra-best' && c.type !== 'intra-worst')
    const expectedComps = group?.criteria?.length || 0
    const expected = Math.max(1, 2 * expectedComps - 3)
    return groupComps.length > 0 ? Math.min(100, Math.round((groupComps.length / expected) * 100)) : 0
  }

  const getGroupBestWorst = (groupIndex) => {
    const groupName = allGroups[groupIndex]?.name
    if (!groupName) return { best: null, worst: null }
    return getBestWorstByGroupName(groupName)
  }

  const isGroupComplete = (groupIndex) => {
    const group = allGroups[groupIndex]
    const groupName = group?.name
    if (!groupName) return false
    if (group.isIntra && !group.isReady) return false
    const groupComps = comparisons.filter((c) => c.group === groupName && c.type !== 'intra-best' && c.type !== 'intra-worst')
    const expectedComps = group?.criteria?.length || 0
    const expected = Math.max(1, 2 * expectedComps - 3)
    return groupComps.length >= expected
  }

  const handleResetGroup = async () => {
    if (!ensureSessionUnlocked()) return
    const groupName = allGroups[selectedGroupIndex]?.name
    if (!groupName) return
    
    // When resetting a base group, also clear intra-groups since they depend on base groups
    const groupsToRemove = [groupName]
    if (groupName !== 'intra-B' && groupName !== 'intra-W') {
      groupsToRemove.push('intra-B', 'intra-W')
    }
    
    const newComparisons = comparisons.filter((c) => !groupsToRemove.includes(c.group))
    setComparisons(newComparisons)
    setBestCriterion(null)
    setWorstCriterion(null)
    setPairs([])
    setPairsGroupName(null)
    setStep('select-criteria')
    // Reset consistency tracking for this group
    setBestToWorstValue(null)
    setConsistencyConstraints({})
    setIsConsistencyError(false)
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
        title: 'Request failed',
        description: 'Failed to reset group',
        status: 'error',
        isClosable: true,
      })
    } finally {
      setSaving(false)
    }
  }

  const getDataRange = (criterion) => {
    if (criterion?.is_qualitative) {
      return { min: 0, max: 1 }
    }
    
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
        if (isFinite(num)) {
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

  const isVFIncreasing = (criterionName) => {
    const points = valueFunction[criterionName]?.points || []
    if (!points || points.length < 2) return true // Default to increasing
    const sorted = [...points].sort((a, b) => a.x - b.x)
    // Compare first and last y values
    return sorted[sorted.length - 1].y > sorted[0].y
  }

  // Inverse value function: given a y value, find the x (data) value
  const inverseValueFunction = (criterionName, targetY) => {
    if (!valueFunction[criterionName]) return null
    const points = valueFunction[criterionName].points || []
    if (!points || points.length === 0) return null

    // Clamp targetY to [0, 1]
    const clampedY = Math.max(0, Math.min(1, targetY))

    const sorted = [...points].sort((a, b) => a.x - b.x)
    
    // Find min and max y values in the entire sorted array
    const yValues = sorted.map(p => p.y)
    const minY = Math.min(...yValues)
    const maxY = Math.max(...yValues)
    
    // If target is outside the range, return the x at the boundary
    if (clampedY <= minY) {
      // Find the point with minY
      return sorted.find(p => p.y === minY)?.x || sorted[0].x
    }
    if (clampedY >= maxY) {
      // Find the point with maxY
      return sorted.find(p => p.y === maxY)?.x || sorted[sorted.length - 1].x
    }

    // Linear interpolation to find x for given y
    // This works for both increasing and decreasing segments
    for (let i = 0; i < sorted.length - 1; i++) {
      const p1 = sorted[i]
      const p2 = sorted[i + 1]
      
      // Check if clampedY is between p1.y and p2.y (regardless of order)
      const minSegmentY = Math.min(p1.y, p2.y)
      const maxSegmentY = Math.max(p1.y, p2.y)
      
      if (clampedY >= minSegmentY && clampedY <= maxSegmentY) {
        if (Math.abs(p2.y - p1.y) < 1e-10) {
          // Flat segment - return midpoint
          return (p1.x + p2.x) / 2
        }
        const ratio = (clampedY - p1.y) / (p2.y - p1.y)
        return p1.x + ratio * (p2.x - p1.x)
      }
    }
    
    // Should not reach here if logic is correct
    return sorted[sorted.length - 1].x
  }

  // Build ranking induced by BEST comparisons (lower VF means better criterion)
  const getBestComparisonRanking = (comps = comparisons) => {
    const groupName = allGroups[selectedGroupIndex]?.name
    if (!groupName) return {}

    const ranking = {}
    pairs.forEach((pair) => {
      if (pair?.type !== 'best') return
      const comp = comps.find(
        (c) =>
          c.reference_criterion === pair.reference.criterion_name &&
          c.adjusted_criterion === pair.adjusted.criterion_name &&
          c.type === 'best' &&
          c.group === groupName
      )
      if (!comp) return
      ranking[pair.reference.criterion_name] = interpolateVF(pair.adjusted.criterion_name, comp.data_value)
    })

    return ranking
  }

  // For WORST comparisons, compute VF bounds implied by BEST-ranking consistency
  // Returns bounds on current VF value: lowerBound <= currentVF <= upperBound
  const getWorstConsistencyBounds = (pairIndex, comps = comparisons) => {
    const pair = pairs[pairIndex]
    if (!pair || pair.type !== 'worst') return { lowerBound: null, upperBound: null }

    const groupName = allGroups[selectedGroupIndex]?.name
    if (!groupName) return { lowerBound: null, upperBound: null }

    const ranking = getBestComparisonRanking(comps)
    const currentCriterion = pair.adjusted.criterion_name
    const currentRank = ranking[currentCriterion]
    if (currentRank === undefined || currentRank === null) return { lowerBound: null, upperBound: null }

    const epsilon = 1e-10
    // Global rule: all WORST comparisons must stay above BEST-to-WORST VF
    let lowerBound = bestToWorstValue
    let upperBound = null

    // Compare with already-answered WORST comparisons and enforce same ordering as BEST phase
    // Use nearest rank neighbors to keep ordinal consistency without over-constraining from distant criteria.
    const previousWorst = []
    for (let i = 0; i < pairIndex; i++) {
      if (pairs[i]?.type !== 'worst') continue

      const prevPair = pairs[i]
      const prevComp = comps.find(
        (c) =>
          c.reference_criterion === prevPair.reference.criterion_name &&
          c.adjusted_criterion === prevPair.adjusted.criterion_name &&
          c.type === 'worst' &&
          c.group === groupName
      )
      if (!prevComp) continue

      const prevCriterion = prevPair.adjusted.criterion_name
      const prevRank = ranking[prevCriterion]
      if (prevRank === undefined || prevRank === null) continue

      previousWorst.push({
        rank: prevRank,
        vf: interpolateVF(prevCriterion, prevComp.data_value),
      })
    }

    // In BEST phase, larger rank value means better criterion.
    // For WORST phase, better criteria need less compensation (smaller VF),
    // while worse criteria need more compensation (larger VF).
    const nearestBetter = previousWorst
      .filter((item) => item.rank > currentRank + epsilon)
      .sort((a, b) => a.rank - b.rank)[0]

    const nearestWorse = previousWorst
      .filter((item) => item.rank < currentRank - epsilon)
      .sort((a, b) => b.rank - a.rank)[0]

    if (nearestBetter) {
      // Better criterion needs LESS compensation => current must be >= neighbor VF
      lowerBound = lowerBound === null ? nearestBetter.vf : Math.max(lowerBound, nearestBetter.vf)
    }

    if (nearestWorse) {
      // Worse criterion needs MORE compensation => current must be <= neighbor VF
      upperBound = upperBound === null ? nearestWorse.vf : Math.min(upperBound, nearestWorse.vf)
    }

    const equalRank = previousWorst.find((item) => Math.abs(item.rank - currentRank) <= epsilon)
    if (equalRank) {
      lowerBound = lowerBound === null ? equalRank.vf : Math.max(lowerBound, equalRank.vf)
      upperBound = upperBound === null ? equalRank.vf : Math.min(upperBound, equalRank.vf)
    }

    return { lowerBound, upperBound }
  }

  // Get consistency threshold for the current pair
  // Returns a VF lower bound for BEST, and rank-implied VF bounds for WORST
  const getConsistencyThreshold = (pairIndex, comps = comparisons) => {
    if (pairIndex === 0 && pairs[pairIndex]?.type === 'best') {
      // First comparison (BEST-to-WORST) has no constraint
      return { lowerBound: null, upperBound: null }
    }

    const pair = pairs[pairIndex]
    if (!pair) return { lowerBound: null, upperBound: null }

    if (pair.type === 'best') {
      // Phase 2: BEST-to-OTHERS - must be >= bestToWorstValue
      return { lowerBound: bestToWorstValue, upperBound: null }
    } else {
      // Phase 3: OTHERS-to-WORST - must preserve ranking learned in BEST phase
      return getWorstConsistencyBounds(pairIndex, comps)
    }
  }

  // Check if current slider value is consistent
  const checkConsistency = (pairIndex, dataValue, comps = comparisons) => {
    const pair = pairs[pairIndex]
    if (!pair) return { isConsistent: true, threshold: null, thresholdDataValue: null, thresholdKind: null }

    const currentVFValue = interpolateVF(pair.adjusted.criterion_name, dataValue)
    const { lowerBound, upperBound } = getConsistencyThreshold(pairIndex, comps)

    if (lowerBound === null && upperBound === null) {
      // No constraint
      return { isConsistent: true, threshold: null, thresholdDataValue: null, thresholdKind: null }
    }

    const epsilon = 1e-10
    const violatesLower = lowerBound !== null && currentVFValue < lowerBound - epsilon
    const violatesUpper = upperBound !== null && currentVFValue > upperBound + epsilon
    const isConsistent = !violatesLower && !violatesUpper

    let threshold = null
    let thresholdKind = null
    if (violatesLower) {
      threshold = lowerBound
      thresholdKind = 'lower'
    } else if (violatesUpper) {
      threshold = upperBound
      thresholdKind = 'upper'
    } else {
      threshold = lowerBound !== null ? lowerBound : upperBound
      thresholdKind = lowerBound !== null ? 'lower' : 'upper'
    }

    const thresholdDataValue = threshold === null
      ? null
      : inverseValueFunction(pair.adjusted.criterion_name, threshold)

    return { isConsistent, threshold, thresholdDataValue, thresholdKind }
  }

  const getBarChartData = (groupCriteria) => {
    return groupCriteria.map((crit) => {
      const range = getDataRange(crit)
      const isIncreasing = isVFIncreasing(crit.criterion_name)
      return {
        name: crit.criterion_name,
        minLabel: isIncreasing ? range.min.toFixed(2) : range.max.toFixed(2),
        maxLabel: isIncreasing ? range.max.toFixed(2) : range.min.toFixed(2),
        value: 1,
        isIncreasing,
      }
    })
  }

  const handleSelectCriteria = async () => {
    if (isSessionLocked && !bwtLockActive) {
      toast({
        title: 'Session locked by practitioner',
        description: 'BWT editing is disabled. Ask the practitioner/admin to unlock.',
        status: 'warning',
        isClosable: true,
      })
      return
    }

    if (!bwtLockActive) {
      toast({
        title: 'Lock required',
        description: 'Please lock QI/VF from the banner above before starting PILE-BWT.',
        status: 'info',
        isClosable: true,
      })
      return
    }

    setSelectionStep('select-best')
  }

  const handleLockForBwt = async () => {
    setSaving(true)
    try {
      // Save BWT with lock flag - this is a USER lock that only blocks QI/VF
      // Don't call lock-session endpoint (that's for practitioner lock)
      await axios.put(`${API_URL}/session/${sessionId}/bwt`, {
        value: buildBwtPayload(comparisons, true),
      })
      setBwtLockActive(true)
      toast({
        title: 'QI/VF locked',
        description: 'You can now start PILE-BWT elicitation.',
        status: 'success',
        isClosable: true,
      })
    } catch (error) {
      toast({
        title: 'Request failed',
        description: error.response?.data?.error || 'Failed to lock QI/VF',
        status: 'error',
        isClosable: true,
      })
    } finally {
      setSaving(false)
    }
  }

  const handleBestSelected = () => {
    if (!bestCriterion) return
    setSelectionStep('select-worst')
  }

  const handleWorstSelected = () => {
    if (!bestCriterion || !worstCriterion) {
      toast({
        title: 'Please select both best and worst criteria',
        status: 'warning',
        isClosable: true,
      })
      return
    }

    const groupCriteria = allGroups[selectedGroupIndex].criteria
    const others = groupCriteria.filter(
      (c) => c.criterion_name !== bestCriterion.criterion_name && c.criterion_name !== worstCriterion.criterion_name
    )

    const newPairs = [
      { reference: worstCriterion, adjusted: bestCriterion, type: 'best' },
      ...others.map((other) => ({
        reference: other,
        adjusted: bestCriterion,
        type: 'best',
      })),
      ...others.map((other) => ({
        reference: worstCriterion,
        adjusted: other,
        type: 'worst',
      })),
    ]

    setPairs(newPairs)
    setPairsGroupName(allGroups[selectedGroupIndex].name)
    setCurrentPairIndex(0)
    setSelectionStep(null)
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
      group: allGroups[selectedGroupIndex].name,
    }

    const filtered = comps.filter(
      (c) => !(c.reference_criterion === pair.reference.criterion_name &&
        c.adjusted_criterion === pair.adjusted.criterion_name &&
        c.group === allGroups[selectedGroupIndex].name)
    )
    return [...filtered, newComparison]
  }

  const handleNextPair = async () => {
    if (!ensureSessionUnlocked()) return
    
    // Don't save if there's a consistency error
    if (isConsistencyError) {
      return
    }

    const updatedComparisons = upsertComparisonForPair(currentPairIndex, sliderValue)
    
    // Capture the value from the first (BEST-to-WORST) comparison
    if (currentPairIndex === 0 && pairs[0]?.type === 'best' && bestToWorstValue === null) {
      const vfValue = interpolateVF(pairs[0].adjusted.criterion_name, sliderValue)
      setBestToWorstValue(vfValue)
    }
    
    if (currentPairIndex < pairs.length - 1) {
      // Save and then navigate to next pair
      setSaving(true)
      try {
        await axios.put(`${API_URL}/session/${sessionId}/bwt`, {
          value: buildBwtPayload(updatedComparisons),
        })
        setComparisons(updatedComparisons)
        setCurrentPairIndex(currentPairIndex + 1)
        setSliderTouched(false)
        setIsConsistencyError(false)
        const nextComp = getComparisonForPair(currentPairIndex + 1, updatedComparisons)
        setSliderValue(nextComp ? nextComp.data_value : getDataRange(pairs[currentPairIndex + 1].adjusted).min)
        // Scroll to top
        if (mainContentRef.current) {
          mainContentRef.current.scrollTop = 0
        }
      } catch (error) {
        toast({
          title: 'Request failed',
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
      let latestComparisons = comparisons
      
      // Don't save if there's a consistency error
      if (!isConsistencyError) {
        const updated = upsertComparisonForPair(currentPairIndex, sliderValue)
        
        setSaving(true)
        try {
          await axios.put(`${API_URL}/session/${sessionId}/bwt`, {
            value: buildBwtPayload(updated),
          })
          setComparisons(updated)
          latestComparisons = updated
        } catch (error) {
          toast({
            title: 'Request failed',
            description: error.response?.data?.error || 'Failed to save comparison',
            status: 'error',
            isClosable: true,
          })
          setSaving(false)
          return
        } finally {
          setSaving(false)
        }
      }
      
      setCurrentPairIndex(currentPairIndex - 1)
      setSliderTouched(false)
      setIsConsistencyError(false)
      const prevComp = getComparisonForPair(currentPairIndex - 1, latestComparisons)
      setSliderValue(prevComp ? prevComp.data_value : getDataRange(pairs[currentPairIndex - 1].adjusted).min)
      // Scroll to top
      if (mainContentRef.current) {
        mainContentRef.current.scrollTop = 0
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
        title: 'Request failed',
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
    const groupName = allGroups[selectedGroupIndex]?.name
    if (!groupName) return null
    return comps.find(
      (c) => c.reference_criterion === pair.reference.criterion_name &&
        c.adjusted_criterion === pair.adjusted.criterion_name &&
        c.group === groupName
    )
  }

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minH="400px">
        <Spinner size="lg" />
      </Box>
    )
  }

  if (allGroups.length === 0) {
    return (
      <Box bg="white" p={8} borderRadius="lg" boxShadow="sm">
        <Heading>No criteria available</Heading>
      </Box>
    )
  }

  const renderContent = () => {
    if (qualitativeIncomplete) {
      return (
        <Box display="flex" justifyContent="center" alignItems="center" minH="60vh">
          <VStack spacing={4} textAlign="center" maxW="500px">
            <Heading size="lg" color="orange.600">Qualitative Indicators Required</Heading>
            <Text color="gray.700" fontSize="md">
              You must complete the elicitation of all qualitative indicators before proceeding with the PILE-BWT analysis.
            </Text>
            <Button
              colorScheme="blue"
              size="lg"
              onClick={() => onPageChange('qualitative')}
            >
              Go to Qualitative Indicators
            </Button>
          </VStack>
        </Box>
      )
    }

    const selectedGroup = selectedGroupIndex !== null ? allGroups[selectedGroupIndex] : null
    if (selectedGroup?.isIntra && !selectedGroup.isReady) {
      return (
        <Box bg="orange.50" p={6} borderRadius="md" borderLeft="4px" borderLeftColor="orange.400">
          <Heading size="md" mb={2}>Complete elicitation first</Heading>
          <Text color="orange.800">
            Complete elicitation of {selectedGroup.missingGroups.join(', ')}.
          </Text>
        </Box>
      )
    }
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
      // Show selection pages for best/worst
      if (selectionStep === 'select-best' || selectionStep === 'select-worst') {
        const selectedGroup = allGroups[selectedGroupIndex]
        if (!selectedGroup) {
          return (
            <VStack spacing={6} align="stretch">
              <Text color="gray.500">No group selected or available</Text>
            </VStack>
          )
        }
        
        const isSelectingBest = selectionStep === 'select-best'
        const question = isSelectingBest
          ? 'If all these indicators were at their worst performance point, which one would you increase first?'
          : 'Which one would you increase last?'
        const currentSelection = isSelectingBest ? bestCriterion : worstCriterion
        const setCurrentSelection = isSelectingBest ? setBestCriterion : setWorstCriterion
        const barData = getBarChartData(selectedGroup.criteria)

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
              <Heading size="lg">{isSelectingBest ? 'Select Best Criterion' : 'Select Worst Criterion'}</Heading>
              <Badge colorScheme="blue">
                Group {selectedGroupIndex + 1} of {allGroups.length}: {selectedGroup.name}
              </Badge>
            </Box>

            <QuestionPrompt>{question}</QuestionPrompt>

            <HStack align="stretch" spacing={4} flex={1}>
              {/* Left: Bar Chart with Min/Max Labels */}
              <Box flex={2} border="1px" borderColor="gray.200" borderRadius="md" p={4}>
                <Heading size="sm" mb={3}>Criteria Ranges</Heading>
                <ResponsiveContainer width="100%" height={barData.length * 60 + 80}>
                  <BarChart
                    data={barData}
                    layout="vertical"
                    margin={{ top: 10, right: 30, left: 10, bottom: 10 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      type="number" 
                      domain={[0, 1]} 
                      ticks={[0, 1]}
                      tick={{ fontSize: 13, fontWeight: 'bold', fill: '#1a202c' }}
                    />
                    <YAxis
                      dataKey="name"
                      type="category"
                      width={80}
                      tick={{ fontSize: 11 }}
                      interval={0}
                    />
                    <Bar
                      dataKey="value"
                      fill="#cbd5e0"
                      onClick={(data) => {
                        setCurrentSelection(selectedGroup.criteria.find(c => c.criterion_name === data.name))
                      }}
                      cursor="pointer"
                      radius={[0, 4, 4, 0]}
                      maxBarSize={25}
                      isAnimationActive={false}
                      label={(props) => {
                        const data = barData[props.index]
                        const isSelected = currentSelection?.criterion_name === data.name
                        const barStartX = props.x
                        const barEndX = props.x + props.width
                        const barY = props.y + props.height / 2
                        const labelColor = isSelected ? 'white' : '#1a202c'
                        
                        return [
                          // Min label on the left
                          <text
                            key={`min-${props.index}`}
                            x={barStartX + 4}
                            y={barY}
                            fill={labelColor}
                            textAnchor="start"
                            dominantBaseline="middle"
                            fontSize="11"
                            fontWeight="bold"
                          >
                            {data.minLabel}
                          </text>,
                          // Max label on the right
                          <text
                            key={`max-${props.index}`}
                            x={barEndX - 4}
                            y={barY}
                            fill={labelColor}
                            textAnchor="end"
                            dominantBaseline="middle"
                            fontSize="11"
                            fontWeight="bold"
                          >
                            {data.maxLabel}
                          </text>
                        ]
                      }}
                    >
                      {barData.map((item, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={currentSelection?.criterion_name === item.name ? '#4299e1' : '#cbd5e0'}
                          style={{ transition: 'fill 0.3s ease-in-out' }}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Box>
              {/* Right: Clickable List */}
              <Box flex={1} border="1px" borderColor="gray.200" borderRadius="md" p={4}>
                <Heading size="sm" mb={4}>
                  Select
                </Heading>
                <VStack spacing={2} align="stretch">
                  {selectedGroup.criteria.map((crit) => {
                    const isDisabled = !isSelectingBest && bestCriterion?.criterion_name === crit.criterion_name
                    return (
                    <Box
                      key={crit.criterion_name}
                      p={3}
                      borderRadius="md"
                      border="2px"
                      borderColor={
                        currentSelection?.criterion_name === crit.criterion_name
                          ? 'blue.500'
                          : isDisabled ? 'gray.300' : 'gray.200'
                      }
                      bg={
                        currentSelection?.criterion_name === crit.criterion_name
                          ? 'blue.50'
                          : isDisabled ? 'gray.100' : 'white'
                      }
                      cursor={isDisabled ? 'not-allowed' : 'pointer'}
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        !isDisabled && setCurrentSelection(crit)
                      }}
                      _hover={!isDisabled ? { borderColor: 'blue.400', bg: 'gray.50' } : {}}
                      opacity={isDisabled ? 0.6 : 1}
                      transition="all 0.2s"
                    >
                      <Text
                        fontWeight={
                          currentSelection?.criterion_name === crit.criterion_name
                            ? 'bold'
                            : 'normal'
                        }
                        color={
                          currentSelection?.criterion_name === crit.criterion_name
                            ? 'blue.700'
                            : isDisabled ? 'gray.500' : 'black'
                        }
                      >
                        {crit.criterion_name}
                      </Text>
                      <Text fontSize="xs" color={isDisabled ? 'gray.400' : 'gray.600'}>
                        {isDisabled ? '(Already selected as best)' : crit.unit}
                      </Text>
                    </Box>
                    )
                  })}
                </VStack>
              </Box>
            </HStack>

            {/* Navigation Buttons */}
            <HStack spacing={4} justify="space-between" pt={4}>
              <HStack spacing={2}>
                <Button
                  variant="outline"
                  colorScheme="red"
                  onClick={() => {
                    setBestCriterion(null)
                    setWorstCriterion(null)
                    setSelectionStep(null)
                    setStep('select-criteria')
                  }}
                >
                  Reset Group
                </Button>
                <Button
                  isDisabled={!isSelectingBest}
                  onClick={() => setSelectionStep('select-best')}
                >
                  Back
                </Button>
              </HStack>
              <Button
                colorScheme="blue"
                isDisabled={!currentSelection}
                onClick={() => {
                  if (isSelectingBest) {
                    handleBestSelected()
                  } else {
                    handleWorstSelected()
                  }
                }}
                isLoading={saving}
              >
                {isSelectingBest ? 'Next' : 'Confirm'}
              </Button>
            </HStack>
          </VStack>
        )
      }

      // Initial screen to start selection
      const selectedGroup = allGroups[selectedGroupIndex]
      if (!selectedGroup) {
        return (
          <VStack spacing={6} align="stretch">
            <Text color="gray.500">No group selected or available</Text>
          </VStack>
        )
      }
      
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
              Group {selectedGroupIndex + 1} of {allGroups.length}: {selectedGroup.name}
            </Badge>
          </Box>
          <QuestionPrompt>
            Let's start by identifying the best and worst performing criteria in this group. 
            You'll be asked to identify which criterion you'd improve first and which you'd improve last.
          </QuestionPrompt>

          <Box pt={4} display="flex" gap={4} justifyContent="flex-end">
            <Button 
              onClick={handleSelectCriteria} 
              colorScheme="blue"
              size="lg"
            >
              Start Selection
            </Button>
          </Box>
        </VStack>
      )
    }

    if (step === 'evaluate-pairs') {
      const pair = pairs[currentPairIndex]
      
      // Safety check: if pairs array exists but current pair is undefined, return loading
      if (!pair) {
        return (
          <Box display="flex" justifyContent="center" alignItems="center" minH="400px">
            <Spinner size="lg" />
          </Box>
        )
      }
      
      const adjustedRange = getDataRange(pair.adjusted)
      const referenceRange = getDataRange(pair.reference)
      const groupCriteria = allGroups[selectedGroupIndex].criteria
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

          <VStack spacing={1} align="stretch">
            <QuestionPrompt mb={0}>
              On the left, all criteria are at their worst except <strong>{pair.reference.criterion_name}</strong>, which is at its best.
            </QuestionPrompt>
            <QuestionPrompt mb={0}>
              On the right, decide how much <strong>{pair.adjusted.criterion_name}</strong> must improve to compensate the loss of <strong>{pair.reference.criterion_name}</strong>.
            </QuestionPrompt>
          </VStack>

          <Box border="1px" borderColor="gray.200" borderRadius="md" p={4} bg="white">
            <Slider
              min={adjustedRange.min}
              max={adjustedRange.max}
              step={(adjustedRange.max - adjustedRange.min) / 100}
              value={sliderValue}
              onChange={(value) => {
                setSliderValue(value)
                setSliderTouched(true)
              }}
            >
              <SliderTrack bg="gray.200" h="8px" borderRadius="md" border="1px solid" borderColor="gray.300">
                {/* Red zone indicator for inconsistent region */}
                {isConsistencyError && (
                  <Box
                    position="absolute"
                    left="0"
                    top="0"
                    bottom="0"
                    bg="rgba(220, 38, 38, 0.3)"
                    borderRadius="md"
                    pointerEvents="none"
                    style={{
                      width: `${
                        ((Math.min(sliderValue, checkConsistency(currentPairIndex, sliderValue, comparisons).thresholdDataValue || adjustedRange.min) - adjustedRange.min) / (adjustedRange.max - adjustedRange.min)) * 100
                      }%`,
                    }}
                  />
                )}
                <SliderFilledTrack bg={isConsistencyError ? 'red.500' : 'blue.500'} />
              </SliderTrack>
              <SliderThumb w="20px" h="20px" bg="blue.500" borderRadius="full" border="2px solid white" boxShadow="0 2px 4px rgba(0,0,0,0.2)" />
            </Slider>
            <HStack spacing={2} mt={3} fontSize="sm" color="gray.600" justify="space-between">
              <Text>{adjustedRange.min.toFixed(2)}</Text>
              <HStack spacing={3}>
                <FormLabel mb={0} fontWeight="semibold">
                  "{pair.adjusted.criterion_name}" [{pair.adjusted.unit}]: <strong>{sliderInputValue}</strong>
                </FormLabel>
                <NumberInput
                  value={sliderInputValue}
                  min={adjustedRange.min}
                  max={adjustedRange.max}
                  step={(adjustedRange.max - adjustedRange.min) / 100}
                  precision={2}
                  onChange={(valueString) => {
                    setSliderInputValue(valueString)
                    setSliderTouched(true)
                  }}
                  size="sm"
                  w="100px"
                  variant="unstyled"
                >
                  <NumberInputField
                    textAlign="center"
                    fontWeight="bold"
                    fontSize="md"
                    px={2}
                    py={1}
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
                        setSliderTouched(true)
                      } else {
                        setSliderInputValue(Number.isFinite(sliderValue) ? sliderValue.toFixed(2) : adjustedRange.min.toFixed(2))
                      }
                    }}
                  />
                </NumberInput>
              </HStack>
              <Text>{adjustedRange.max.toFixed(2)}</Text>
            </HStack>
          </Box>

          <HStack spacing={4} justify="flex-end" pt={2}>
            <Button
              leftIcon={<ChevronLeftIcon />}
              isDisabled={currentPairIndex === 0}
              onClick={handlePrevPair}
              size="md"
            >
              Back
            </Button>
            <Button 
              colorScheme="blue" 
              rightIcon={<ChevronRightIcon />} 
              onClick={async () => {
                if (currentPairIndex === pairs.length - 1) {
                  // Capture the value from the first (BEST-to-WORST) comparison if not already captured
                  if (currentPairIndex === 0 && pairs[0]?.type === 'best' && bestToWorstValue === null) {
                    const vfValue = interpolateVF(pairs[0].adjusted.criterion_name, sliderValue)
                    setBestToWorstValue(vfValue)
                  }

                  // Don't save if there's a consistency error
                  if (!isConsistencyError) {
                    const updatedComparisons = upsertComparisonForPair(currentPairIndex, sliderValue)
                    await handleSaveAll(updatedComparisons)
                  }
                  
                  if (selectedGroupIndex < allGroups.length - 1) {
                    // Move to next group
                    setSelectedGroupIndex(selectedGroupIndex + 1)
                    setBestCriterion(null)
                    setWorstCriterion(null)
                    setPairs([])
                    setPairsGroupName(null)
                    setStep('select-criteria')
                    // Reset consistency tracking for new group
                    setBestToWorstValue(null)
                    setConsistencyConstraints({})
                    setIsConsistencyError(false)
                    if (mainContentRef.current) {
                      mainContentRef.current.scrollTop = 0
                    }
                  } else {
                    // Last group - go to recap
                    if (onPageChange) {
                      onPageChange('recap')
                    }
                  }
                } else {
                  // Not on last pair - just go to next
                  await handleNextPair()
                }
              }} 
              isDisabled={!sliderTouched || isConsistencyError}
              isLoading={saving}
              size="md"
            >
              {currentPairIndex === pairs.length - 1 
                ? (selectedGroupIndex === allGroups.length - 1 ? 'Complete & Go to Recap' : 'Next Group') 
                : 'Next'}
            </Button>
          </HStack>

          {/* Error tooltip for consistency violation */}
          {isConsistencyError && (
            <Box
              bg="red.50"
              border="2px"
              borderColor="red.400"
              borderRadius="md"
              p={3}
            >
              <HStack spacing={2} alignItems="flex-start">
                <WarningIcon color="red.600" boxSize={5} mt={0.5} />
                <VStack align="start" spacing={1} flex={1}>
                  <Text fontWeight="bold" color="red.700" fontSize="sm">
                    Inconsistent judgment
                  </Text>
                  {(() => {
                    const pair = pairs[currentPairIndex]
                    const { thresholdDataValue, thresholdKind } = checkConsistency(currentPairIndex, sliderValue, comparisons)
                    const isIncreasing = isVFIncreasing(pair.adjusted.criterion_name)
                    // lower VF bound means VF must be >= threshold
                    // upper VF bound means VF must be <= threshold
                    const adjective = thresholdKind === 'upper'
                      ? (isIncreasing ? 'at most' : 'at least')
                      : (isIncreasing ? 'at least' : 'at most')
                    
                    if (pair?.type === 'best') {
                      return (
                        <Text color="red.600" fontSize="sm">
                          Must adjust <strong>{pair.adjusted.criterion_name}</strong> to {adjective} {' '}
                          <strong>{thresholdDataValue?.toFixed(2)}</strong> {pair.adjusted.unit}{' '}
                          to be consistent with <strong>{bestCriterion.criterion_name}</strong>-<strong>{worstCriterion.criterion_name}</strong> comparison
                        </Text>
                      )
                    } else {
                      // OTHERS-to-WORST
                      return (
                        <Text color="red.600" fontSize="sm">
                          Must adjust <strong>{pair.adjusted.criterion_name}</strong> to {adjective} {' '}
                          <strong>{thresholdDataValue?.toFixed(2)}</strong> {pair.adjusted.unit}{' '}
                          to maintain consistency with previous comparisons
                        </Text>
                      )
                    }
                  })()}
                </VStack>
              </HStack>
            </Box>
          )}

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
    <HStack align="stretch" spacing={0} h="100vh" overflow="hidden">
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
          <Heading size="md">Weights</Heading>
          <Text fontSize="sm" color="gray.600">
            Apply the PILE-BWT method, perform pairwise comparisons to determine the weights of each criteria.
          </Text>
        </VStack>
        <VStack spacing={3} align="stretch">
          {allGroups.map((group, idx) => {
            const isActive = selectedGroupIndex === idx
            const completion = getGroupCompletionStatus(idx)
            const isCompleted = completion === 100
            const isBlocked = group.isIntra && !group.isReady
            return (
              <Box key={group.name}>
                <Box
                  p={3}
                  borderRadius="md"
                  cursor="pointer"
                  bg={isBlocked ? 'orange.50' : isActive ? 'blue.500' : isCompleted ? 'green.100' : 'white'}
                  borderWidth="1px"
                  borderColor={isBlocked ? 'orange.300' : isActive ? 'blue.600' : isCompleted ? 'green.300' : 'gray.300'}
                  onClick={() => {
                    setSelectedGroupIndex(idx)
                  }}
                  _hover={{ shadow: 'sm' }}
                >
                  <HStack justify="space-between">
                    <VStack align="start" spacing={0} flex={1}>
                      <Text
                        fontWeight="bold"
                        color={isActive ? 'white' : isBlocked ? 'orange.800' : 'black'}
                        fontSize="sm"
                      >
                        {group.name}
                      </Text>
                      <Text fontSize="xs" color={isActive ? 'whiteAlpha.800' : isBlocked ? 'orange.700' : 'gray.600'}>
                        {isBlocked ? `Complete elicitation of ${group.missingGroups.join(', ')}` : `${completion}% complete`}
                      </Text>
                    </VStack>
                    <Box
                      h="12px"
                      w="12px"
                      borderRadius="full"
                      bg={isBlocked ? 'orange.400' : completion === 100 ? 'green.500' : completion > 0 ? 'blue.500' : 'gray.300'}
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
                        
                        // Find first incomplete pair
                        let firstIncompletePairIndex = pairs.length // Default to all complete
                        for (let i = 0; i < pairs.length; i++) {
                          if (!getComparisonForPair(i)) {
                            firstIncompletePairIndex = i
                            break
                          }
                        }
                        
                        // Disable pairs after the first incomplete one
                        const isDisabled = pairIdx > firstIncompletePairIndex
                        
                        return (
                          <Box
                            key={pairIdx}
                            p={2}
                            borderRadius="sm"
                            bg={isDisabled ? 'gray.100' : isActivePair ? 'blue.400' : comp ? 'green.50' : 'white'}
                            border="1px"
                            borderColor={isDisabled ? 'gray.200' : isActivePair ? 'blue.500' : comp ? 'green.300' : 'gray.200'}
                            cursor={isDisabled ? 'not-allowed' : 'pointer'}
                            opacity={isDisabled ? 0.5 : 1}
                            onClick={async () => {
                              if (pairIdx === currentPairIndex) return
                              if (isDisabled) return
                              if (!ensureSessionUnlocked()) return
                              
                              let latestComparisons = comparisons
                              
                              // Don't save if current pair has consistency error
                              if (!isConsistencyError) {
                                const updated = upsertComparisonForPair(currentPairIndex, sliderValue)
                                setSaving(true)
                                try {
                                  await axios.put(`${API_URL}/session/${sessionId}/bwt`, {
                                    value: buildBwtPayload(updated),
                                  })
                                  setComparisons(updated)
                                  latestComparisons = updated
                                } catch (error) {
                                  toast({
                                    title: 'Request failed',
                                    description: 'Failed to save comparison',
                                    status: 'error',
                                    isClosable: true,
                                  })
                                  setSaving(false)
                                  return
                                } finally {
                                  setSaving(false)
                                }
                              }
                              
                              setCurrentPairIndex(pairIdx)
                              setIsConsistencyError(false)
                              const targetComp = getComparisonForPair(pairIdx, latestComparisons)
                              setSliderValue(targetComp ? targetComp.data_value : getDataRange(pairs[pairIdx].adjusted).min)
                              // Scroll to top
                              if (mainContentRef.current) {
                                mainContentRef.current.scrollTop = 0
                              }
                            }}
                            _hover={isDisabled ? {} : { shadow: 'sm' }}
                          >
                            <Text fontSize="xs" fontWeight="bold" color={isDisabled ? 'gray.400' : isActivePair ? 'white' : 'black'} noOfLines={2}>
                              {pair.reference.criterion_name.substring(0, 12)} → {pair.adjusted.criterion_name.substring(0, 12)}
                            </Text>
                            {comp && (
                              <Text fontSize="xs" color={isDisabled ? 'gray.400' : isActivePair ? 'whiteAlpha.800' : 'green.700'}>
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
        {/* Reset Group Button at the bottom */}
        {selectedGroupIndex !== null && (
          <Box mt="auto" pt={6}>
            <Button
              colorScheme="red"
              size="sm"
              onClick={onResetOpen}
              variant="outline"
              isDisabled={isSessionLocked}
              width="100%"
            >
              Reset Group
            </Button>
          </Box>
        )}
      </Box>

      {/* Reset Group Confirmation Dialog */}
      <AlertDialog
        isOpen={isResetOpen}
        leastDestructiveRef={cancelRef}
        onClose={onResetClose}
      >
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              Reset Group
            </AlertDialogHeader>

            <AlertDialogBody>
              Are you sure you want to reset the "{allGroups[selectedGroupIndex]?.name}" group? This will delete all comparisons for this group and cannot be undone.
            </AlertDialogBody>

            <AlertDialogFooter>
              <Button ref={cancelRef} onClick={onResetClose}>
                Cancel
              </Button>
              <Button 
                colorScheme="red" 
                onClick={() => {
                  handleResetGroup()
                  onResetClose()
                }} 
                ml={3}
                isLoading={saving}
              >
                Reset
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

      {/* Main Content */}
      <Box
        ref={mainContentRef}
        flex={1}
        bg="white"
        p={4}
        maxH="100vh"
        overflowY="auto"
      >
        {/* Persistent lock status banner */}
        {!bwtLockActive && !isSessionLocked ? (
          <Box bg="blue.50" p={3} borderRadius="md" borderLeft="4px" borderLeftColor="blue.400" mb={4}>
            <HStack spacing={2} align="flex-start">
              <InfoIcon color="blue.600" />
              <VStack align="start" spacing={2} flex={1}>
                <Text fontSize="sm" color="blue.800" fontWeight="semibold">
                  To work on PILE-BWT, you need to lock QI and VF pages. PILE-BWT remains editable while locked.
                </Text>
                <Button size="xs" colorScheme="blue" onClick={handleLockForBwt} isLoading={saving}>
                  Lock QI/VF to continue
                </Button>
              </VStack>
            </HStack>
          </Box>
        ) : bwtLockActive ? (
          <Box bg="green.50" p={3} borderRadius="md" borderLeft="4px" borderLeftColor="green.400" mb={4}>
            <HStack spacing={2} align="flex-start">
              <CheckCircleIcon color="green.600" />
              <VStack align="start" spacing={2} flex={1}>
                <Text fontSize="sm" color="green.800" fontWeight="semibold">
                  QI and VF are locked. You can now work on PILE-BWT elicitation.
                </Text>
                {!showUnlockConfirm ? (
                  <Button size="xs" variant="outline" colorScheme="green" onClick={() => setShowUnlockConfirm(true)} isLoading={saving}>
                    Unlock for QI/VF edits
                  </Button>
                ) : (
                  <HStack spacing={2}>
                    <Text fontSize="xs" color="green.800">
                      This will re-enable QI and VF editing. Continue?
                    </Text>
                    <Button size="xs" colorScheme="green" onClick={handleUnlockForModification} isLoading={saving}>
                      Yes, unlock
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => setShowUnlockConfirm(false)}>
                      Cancel
                    </Button>
                  </HStack>
                )}
              </VStack>
            </HStack>
          </Box>
        ) : isSessionLocked ? (
          <Box bg="red.50" p={3} borderRadius="md" borderLeft="4px" borderLeftColor="red.400" mb={4}>
            <HStack spacing={2} align="flex-start">
              <WarningIcon color="red.600" />
              <VStack align="start" spacing={1} flex={1}>
                <Text fontSize="sm" color="red.800" fontWeight="semibold">
                  This session is locked by the practitioner. PILE-BWT editing is disabled.
                </Text>
                <Text fontSize="xs" color="red.700">
                  Ask the practitioner/admin to unlock this session.
                </Text>
              </VStack>
            </HStack>
          </Box>
        ) : null}
        {qualitativeIncomplete && (
          <Alert
            status="warning"
            variant="subtle"
            flexDirection="column"
            alignItems="flex-start"
            mb={4}
            borderRadius="md"
          >
            <HStack alignItems="flex-start">
              <AlertIcon mt={1} />
              <Box>
                <AlertTitle>Qualitative Indicators Required</AlertTitle>
                <AlertDescription>
                  Please complete the elicitation of all qualitative indicators before proceeding with the PILE-BWT analysis.
                </AlertDescription>
              </Box>
            </HStack>
          </Alert>
        )}
        {renderContent()}
      </Box>
    </HStack>
  )
}

export default forwardRef(PileBwtPage)
