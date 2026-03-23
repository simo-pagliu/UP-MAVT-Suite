import { AddIcon, DeleteIcon, SettingsIcon } from '@chakra-ui/icons'
import { useRef, forwardRef, useImperativeHandle } from 'react'
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  Box,
  Button,
  Heading,
  VStack,
  Input,
  FormControl,
  FormLabel,
  Textarea,
  useToast,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  IconButton,
  HStack,
  Text,
  Divider,
  Checkbox,
  useDisclosure,
} from '@chakra-ui/react'
import axios from 'axios'
import { useState, useEffect } from 'react'
import { DistributionModal } from '../components/DistributionModal'
import {
  parseDistribution,
  distributionToString,
  getDistributionTypeLabel,
  getDistributionSummary,
  computeDistributionBounds,
} from '../utils/distributionUtils'
import { generateInputCSV, downloadCSVFile } from '../utils/csvExport'
import { API_URL } from '../config'

function InputPage({ studySessionId }, ref) {
  const [name, setName] = useState('')
  const [metadataDefaults, setMetadataDefaults] = useState({ title: '', description: '' })
  const [metadataFormKey, setMetadataFormKey] = useState(0)
  const [criteria, setCriteria] = useState([])
  const [originalCriteria, setOriginalCriteria] = useState([])
  const [loading, setLoading] = useState(false)
  const [isExistingStudySession, setIsExistingStudySession] = useState(false)
  const [isLocked, setIsLocked] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const [hasExistingSessions, setHasExistingSessions] = useState(false)
  const [hasModifiedInput, setHasModifiedInput] = useState(false)
  const [savingMetadata, setSavingMetadata] = useState(false)
  
  // Distribution modal state
  const { isOpen: isDistModalOpen, onOpen: onDistModalOpen, onClose: onDistModalClose } = useDisclosure()
  const [editingCell, setEditingCell] = useState(null) // {criterionIdx, altIdx}
  const [currentCellValue, setCurrentCellValue] = useState('')

  // Unlock confirmation dialog
  const { isOpen: isUnlockOpen, onOpen: onUnlockOpen, onClose: onUnlockClose } = useDisclosure()
  const unlockCancelRef = useRef()
  
  const toast = useToast()
  const fileInputRef = useRef(null)
  const studyTitleRef = useRef(null)
  const studyDescriptionRef = useRef(null)

  const parseCsvLine = (line) => {
    const values = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i]
      if (char === '"') {
        const nextChar = line[i + 1]
        if (inQuotes && nextChar === '"') {
          current += '"'
          i += 1
        } else {
          inQuotes = !inQuotes
        }
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    values.push(current.trim())
    return values
  }

  const parseBooleanCell = (value) => {
    const normalized = String(value || '').trim().toLowerCase()
    return normalized === 'true' || normalized === '1' || normalized === 'yes'
  }
  
  useImperativeHandle(ref, () => ({
    async saveBeforeNavigate() {
      // InputPage does not have persistent state
    },
  }))

  const normalizeCriteria = (items) => {
    if (!Array.isArray(items)) return []
    return items.map((c) => ({
      criterion_name: c.criterion_name || '',
      unit: c.unit || '',
      group: c.group || '',
      description: c.description || '',
      is_qualitative: c.is_qualitative || false,
      use_mid_splitting: c.use_mid_splitting !== undefined ? c.use_mid_splitting : true,
      use_custom_min_max: c.use_custom_min_max || false,
      min_value: c.min_value || '',
      max_value: c.max_value || '',
      alternatives: Array.isArray(c.alternatives) 
        ? c.alternatives.map(alt => ({
            name: alt.name || '',
            value: alt.value || ''
          }))
        : [],
    }))
  }

  useEffect(() => {
    if (!studySessionId) {
      setName('')
      setMetadataDefaults({ title: '', description: '' })
      setMetadataFormKey((prev) => prev + 1)
      setCriteria([])
      setOriginalCriteria([])
      setIsExistingStudySession(false)
      setIsLocked(true)
      setHasExistingSessions(false)
      return
    }

    const fetchStudy = async () => {
      try {
        const studyResponse = await axios.get(`${API_URL}/study-session/${studySessionId}`)
        const study = studyResponse.data
        setName(studySessionId)
        setMetadataDefaults({
          title: study.title || '',
          description: study.description || '',
        })
        setMetadataFormKey((prev) => prev + 1)
        if (study.criteria && Array.isArray(study.criteria)) {
          const normalized = normalizeCriteria(study.criteria)
          setCriteria(normalized)
          setOriginalCriteria(JSON.parse(JSON.stringify(normalized)))
        }
        
        // Check if there are existing elicitation sessions
        const sessionsResponse = await axios.get(`${API_URL}/study-session/${studySessionId}/elicitation-sessions`)
        const sessions = sessionsResponse.data.sessions || []
        setHasExistingSessions(sessions.length > 0)
        
        setIsLocked(true)
        setIsEditing(false)
        setIsExistingStudySession(true)
        setHasModifiedInput(false)
      } catch (error) {
        console.error('Failed to fetch study session:', error)
      }
    }
    fetchStudy()
  }, [studySessionId])

  const handleUnlock = () => {
    if (hasExistingSessions) {
      onUnlockOpen()
    } else {
      setIsEditing(true)
      setIsLocked(false)
    }
  }

  const handleUnlockConfirm = () => {
    onUnlockClose()
    setIsEditing(true)
    setIsLocked(false)
  }

  const handleCancel = () => {
    // Restore original criteria
    setCriteria(JSON.parse(JSON.stringify(originalCriteria)))
    setIsEditing(false)
    setIsLocked(true)
    setHasModifiedInput(false)
  }

  const detectCriteriaChanges = (oldCriteria, newCriteria) => {
    // Returns { affectedCriteria: [...criterion_names], affectedGroups: [...group_names] }
    const affectedCriteria = []
    const affectedGroups = new Set()
    
    // Create maps by name
    const oldMap = new Map(oldCriteria.map(c => [c.criterion_name, c]))
    const newMap = new Map(newCriteria.map(c => [c.criterion_name, c]))
    
    // Check for removed criteria
    for (const oldCrit of oldCriteria) {
      if (!newMap.has(oldCrit.criterion_name)) {
        affectedCriteria.push(oldCrit.criterion_name)
        if (oldCrit.group) affectedGroups.add(oldCrit.group)
      }
    }
    
    // Check for added or changed criteria
    for (const newCrit of newCriteria) {
      const oldCrit = oldMap.get(newCrit.criterion_name)
      
      if (!oldCrit) {
        // New criterion - no need to reset anything
        continue
      }
      
      // Check for "dangerous" changes that affect data
      let hasDataChange = false
      
      // Check if group changed
      if (oldCrit.group !== newCrit.group) {
        hasDataChange = true
        if (oldCrit.group) affectedGroups.add(oldCrit.group)
        if (newCrit.group) affectedGroups.add(newCrit.group)
      }
      
      // Check if qualitative flag changed
      if (oldCrit.is_qualitative !== newCrit.is_qualitative) {
        hasDataChange = true
      }
      
      // Check if min/max changed
      if (oldCrit.min_value !== newCrit.min_value || oldCrit.max_value !== newCrit.max_value) {
        hasDataChange = true
      }
      
      if (oldCrit.use_custom_min_max !== newCrit.use_custom_min_max) {
        hasDataChange = true
      }
      
      // Check if alternatives changed (count, names, or values)
      const oldAlts = oldCrit.alternatives || []
      const newAlts = newCrit.alternatives || []
      
      if (oldAlts.length !== newAlts.length) {
        hasDataChange = true
      } else {
        for (let i = 0; i < oldAlts.length; i++) {
          if (oldAlts[i].name !== newAlts[i].name || oldAlts[i].value !== newAlts[i].value) {
            hasDataChange = true
            break
          }
        }
      }
      
      if (hasDataChange) {
        affectedCriteria.push(newCrit.criterion_name)
        if (newCrit.group) affectedGroups.add(newCrit.group)
      }
    }
    
    return {
      affectedCriteria,
      affectedGroups: Array.from(affectedGroups)
    }
  }

  const handleFileUpload = (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result
      if (typeof text !== 'string') return

      const lines = text.trim().split(/\r?\n/).filter(Boolean)
      if (lines.length < 8) {
        toast({
          title: 'Request failed',
          description: 'CSV must include header, group, description, is_qi, vf_method, min, max, alternatives, and unit rows',
          status: 'error',
          duration: 3000,
          isClosable: true,
        })
        return
      }

      // Parse all rows
      const rows = lines.map((line) => parseCsvLine(line))
      
      // First row: criterion names (first cell should be something like "Alternative")
      const headerRow = rows[0]
      const criterionNames = headerRow.slice(1) // Skip first column
      
      if (criterionNames.length === 0) {
        toast({
          title: 'Request failed',
          description: 'No criteria columns found',
          status: 'error',
          duration: 3000,
          isClosable: true,
        })
        return
      }

      const expectedRows = [
        { index: 1, label: 'group' },
        { index: 2, label: 'description' },
        { index: 3, label: 'is_qi' },
        { index: 4, label: 'vf_method' },
        { index: 5, label: 'min' },
        { index: 6, label: 'max' },
      ]

      for (const expected of expectedRows) {
        const rowLabel = (rows[expected.index]?.[0] || '').toLowerCase()
        if (rowLabel !== expected.label) {
          toast({
            title: 'Request failed',
            description: `Invalid CSV format: expected row ${expected.index + 1} to start with "${expected.label}"`,
            status: 'error',
            duration: 4000,
            isClosable: true,
          })
          return
        }
      }

      const groups = rows[1].slice(1)
      const descriptions = rows[2].slice(1)
      const qiFlags = rows[3].slice(1)
      const vfMethodFlags = rows[4].slice(1)
      const minValues = rows[5].slice(1)
      const maxValues = rows[6].slice(1)
      const alternativesStartIndex = 7

      const rowLengthsValid = [groups, descriptions, qiFlags, vfMethodFlags, minValues, maxValues]
        .every((row) => row.length === criterionNames.length)
      if (!rowLengthsValid) {
        toast({
          title: 'Request failed',
          description: 'All metadata rows must have the same number of values as criteria columns',
          status: 'error',
          duration: 4000,
          isClosable: true,
        })
        return
      }

      // Last row: units (first cell should be "Unit")
      const unitRow = rows[rows.length - 1]
      const units = unitRow.slice(1) // Skip first column
      
      if (units.length !== criterionNames.length) {
        toast({
          title: 'Request failed',
          description: 'Number of units must match number of criteria',
          status: 'error',
          duration: 3000,
          isClosable: true,
        })
        return
      }

      // Middle rows: alternatives
      const alternativeRows = rows.slice(alternativesStartIndex, rows.length - 1)
      
      if (alternativeRows.length === 0) {
        toast({
          title: 'Request failed',
          description: 'No alternatives found',
          status: 'error',
          duration: 3000,
          isClosable: true,
        })
        return
      }

      // Transform to criteria structure
      const parsedCriteria = criterionNames.map((name, idx) => {
        const alternatives = alternativeRows.map(row => ({
          name: row[0],
          value: row[idx + 1] || '' // This can be a distribution string
        }))
        const isQi = parseBooleanCell(qiFlags[idx])
        const useMidSplitting = parseBooleanCell(vfMethodFlags[idx])
        const hasCustomMinMax = (minValues[idx] && minValues[idx] !== '') || (maxValues[idx] && maxValues[idx] !== '')
        return {
          criterion_name: name,
          group: groups[idx] || '',
          description: descriptions[idx] || '',
          unit: units[idx],
          is_qualitative: isQi,
          use_mid_splitting: useMidSplitting,
          use_custom_min_max: hasCustomMinMax,
          min_value: minValues[idx] || '',
          max_value: maxValues[idx] || '',
          alternatives
        }
      })

      setCriteria(parsedCriteria)
      setHasModifiedInput(true)
      toast({
        title: 'File loaded',
        description: `${criterionNames.length} criteria and ${alternativeRows.length} alternatives imported`,
        status: 'success',
        duration: 2000,
        isClosable: true,
      })
    }

    reader.onerror = () => {
      toast({
        title: 'Request failed',
        description: 'Could not read the file',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    }

    reader.readAsText(file)
  }

  const handleCellChange = (criterionIdx, field, value) => {
    setCriteria((prev) => {
      const updated = [...prev]
      updated[criterionIdx] = { ...updated[criterionIdx], [field]: value }
      return updated
    })
    setHasModifiedInput(true)
  }

  const handleAlternativeChange = (criterionIdx, altIdx, value) => {
    setCriteria((prev) => {
      const updated = [...prev]
      const updatedAlts = [...updated[criterionIdx].alternatives]
      updatedAlts[altIdx] = { ...updatedAlts[altIdx], value }
      updated[criterionIdx] = { ...updated[criterionIdx], alternatives: updatedAlts }
      return updated
    })
    setHasModifiedInput(true)
  }

  const handleDistributionModalOpen = (criterionIdx, altIdx) => {
    setEditingCell({ criterionIdx, altIdx })
    setCurrentCellValue(criteria[criterionIdx].alternatives[altIdx].value)
    onDistModalOpen()
  }

  const handleDistributionSave = async (distribution) => {
    if (editingCell) {
      const { criterionIdx, altIdx } = editingCell
      const valueString = distributionToString(distribution)
      handleAlternativeChange(criterionIdx, altIdx, valueString)
      
      if (isExistingStudySession && studySessionId && !isLocked) {
        // Update the criteria array immediately
        const updatedCriteria = criteria.map((crit, idx) => {
          if (idx === criterionIdx) {
            return {
              ...crit,
              alternatives: crit.alternatives.map((alt, altIdx2) => 
                altIdx2 === altIdx ? { ...alt, value: valueString } : alt
              )
            }
          }
          return crit
        })
        
        try {
          await axios.put(`${API_URL}/study-session/${studySessionId}/input`, { criteria: updatedCriteria })
          toast({
            title: 'Saved',
            description: 'Distribution saved to study input',
            status: 'success',
            duration: 2000,
            isClosable: true,
          })
        } catch (error) {
          toast({
            title: 'Request failed',
            description: error.response?.data?.error || 'Failed to save distribution',
            status: 'error',
            duration: 3000,
            isClosable: true,
          })
        }
      } else {
        toast({
          title: 'Distribution Updated',
          description: 'Click "Confirm input to continue" to save all changes to the database',
          status: 'success',
          duration: 3000,
          isClosable: true,
        })
      }
    }
  }

  const handleAlternativeNameChange = (altIdx, value) => {
    setCriteria((prev) => {
      return prev.map(criterion => ({
        ...criterion,
        alternatives: criterion.alternatives.map((alt, idx) => 
          idx === altIdx ? { ...alt, name: value } : alt
        )
      }))
    })
    setHasModifiedInput(true)
  }

  const handleAddAlternative = () => {
    if (criteria.length === 0) {
      toast({
        title: 'Request failed',
        description: 'Upload a CSV first to define criteria',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
      return
    }
    setCriteria((prev) => prev.map(criterion => ({
      ...criterion,
      alternatives: [...criterion.alternatives, { name: '', value: '' }]
    })))
    setHasModifiedInput(true)
  }

  const handleAddCriterion = () => {
    if (criteria.length === 0) {
      toast({
        title: 'Request failed',
        description: 'Upload a CSV first to define initial structure',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
      return
    }
    // Create a new criterion with the same alternatives as existing criteria
    const alternativeCount = criteria[0]?.alternatives.length || 0
    const newCriterion = {
      criterion_name: '',
      group: '',
      description: '',
      is_qualitative: false,
      use_mid_splitting: true,
      unit: '',
      alternatives: Array(alternativeCount).fill(null).map((_, idx) => ({
        name: criteria[0].alternatives[idx].name,
        value: ''
      }))
    }
    setCriteria((prev) => [...prev, newCriterion])
    setHasModifiedInput(true)
  }

  const handleRemoveAlternative = (altIdx) => {
    setCriteria((prev) => prev.map(criterion => ({
      ...criterion,
      alternatives: criterion.alternatives.filter((_, idx) => idx !== altIdx)
    })))
    setHasModifiedInput(true)
  }

  const downloadCSV = () => {
    if (criteria.length === 0) {
      toast({
        title: 'Request failed',
        description: 'No data to download',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
      return
    }

    const csvContent = generateInputCSV(criteria)
    downloadCSVFile(csvContent, `input_${name || 'criteria'}.csv`)
    
    toast({
      title: 'Completed',
      description: 'CSV file downloaded',
      status: 'success',
      duration: 2000,
      isClosable: true,
    })
  }

  const handleSave = async () => {
    if (criteria.length === 0) {
      toast({
        title: 'Request failed',
        description: 'Please upload a CSV',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
      return
    }

    // Validate all criteria have names and units
    const hasEmptyCriteria = criteria.some(
      (criterion) => !criterion.criterion_name || !criterion.unit
    )
    if (hasEmptyCriteria) {
      toast({
        title: 'Request failed',
        description: 'All criteria must have a name and unit',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
      return
    }

    // Validate all alternatives have names and values
    const hasEmptyAlternatives = criteria.some(criterion => {
      if (criterion.is_qualitative) {
        // Qualitative criteria should have empty values
        return criterion.alternatives.some(alt => !alt.name)
      } else {
        // Non-qualitative criteria must have names and values
        return criterion.alternatives.some(alt => !alt.name || alt.value === '')
      }
    })
    if (hasEmptyAlternatives) {
      toast({
        title: 'Request failed',
        description: 'All alternatives must have names. Non-qualitative criteria must have values.',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
      return
    }

    setLoading(true)
    try {
      if (isExistingStudySession && studySessionId) {
        // If there are existing sessions and input was modified, selectively reset affected data
        if (hasExistingSessions && hasModifiedInput) {
          const changes = detectCriteriaChanges(originalCriteria, criteria)
          
          if (changes.affectedCriteria.length > 0 || changes.affectedGroups.length > 0) {
            // Selective reset: only reset affected criteria and groups
            await axios.post(`${API_URL}/study-session/${studySessionId}/selective-reset`, {
              criteria: changes.affectedCriteria,
              groups: changes.affectedGroups
            })
          }
          // If no affected criteria/groups, don't reset anything
        }
        
        await axios.put(`${API_URL}/study-session/${studySessionId}/input`, { criteria })
        
        // Update original criteria and state
        setOriginalCriteria(JSON.parse(JSON.stringify(criteria)))
        setIsLocked(true)
        setIsEditing(false)
        setHasModifiedInput(false)
        
        // Refresh session count
        const sessionsResponse = await axios.get(`${API_URL}/study-session/${studySessionId}/elicitation-sessions`)
        const sessions = sessionsResponse.data.sessions || []
        setHasExistingSessions(sessions.length > 0)
        
        toast({
          title: 'Completed',
          description: hasExistingSessions && hasModifiedInput
            ? 'Input saved and elicitation sessions reset'
            : 'Input saved successfully',
          status: 'success',
          duration: 3000,
          isClosable: true,
        })
      } else {
        toast({
          title: 'Missing study session',
          description: 'Access or create a study session before saving input.',
          status: 'error',
          duration: 3000,
          isClosable: true,
        })
      }
    } catch (error) {
      console.error('Save error:', error)
      toast({
        title: 'Request failed',
        description: error.response?.data?.error || error.message || 'Failed to save input',
        status: 'error',
        duration: 5000,
        isClosable: true,
      })
    } finally {
      setLoading(false)
    }
  }

  const handleSaveStudyMetadata = async () => {
    if (!studySessionId) return
    setSavingMetadata(true)
    try {
      const title = studyTitleRef.current?.value ?? ''
      const description = studyDescriptionRef.current?.value ?? ''
      await axios.patch(`${API_URL}/study-session/${studySessionId}`, {
        title,
        description,
      })

      // Keep defaults in sync with saved values without introducing per-keystroke re-renders.
      setMetadataDefaults({ title, description })
      toast({
        title: 'Completed',
        description: 'Case study details saved',
        status: 'success',
        duration: 2500,
        isClosable: true,
      })
    } catch (error) {
      toast({
        title: 'Request failed',
        description: error.response?.data?.error || 'Failed to save case study details',
        status: 'error',
        duration: 4000,
        isClosable: true,
      })
    } finally {
      setSavingMetadata(false)
    }
  }

  return (
    <Box bg="white" p={6} borderRadius="lg" boxShadow="sm">
      <VStack spacing={6} align="stretch">
        <Heading as="h1" size="lg">Input Definition</Heading>
        {!studySessionId && (
          <Box borderWidth={1} borderRadius="md" p={4} bg="gray.50">
            <Text fontSize="sm" color="gray.600">
              Access a study session first to define the input.
            </Text>
          </Box>
        )}

        {studySessionId && (
          <>
            <VStack align="stretch" spacing={3}>
              <Heading as="h2" size="sm">Case Study Details</Heading>
              <FormControl>
                <FormLabel mb={1}>Title</FormLabel>
                <Input
                  key={`title-${metadataFormKey}`}
                  ref={studyTitleRef}
                  defaultValue={metadataDefaults.title}
                  placeholder="Enter case study title"
                />
              </FormControl>
              <FormControl>
                <FormLabel mb={1}>Description</FormLabel>
                <Textarea
                  key={`description-${metadataFormKey}`}
                  ref={studyDescriptionRef}
                  defaultValue={metadataDefaults.description}
                  placeholder="Enter a short description of this case study"
                  rows={4}
                />
              </FormControl>
              <HStack justify="flex-end">
                <Button
                  colorScheme="blue"
                  onClick={handleSaveStudyMetadata}
                  isLoading={savingMetadata}
                >
                  Save Details
                </Button>
              </HStack>
            </VStack>

            <Divider />

            <VStack align="stretch" spacing={4}>
              <Text fontSize="sm" color="gray.600">
                You can either define the input in a CSV and upload it, or use the editor below.
              </Text>
              
              {/* Action Buttons */}
              <HStack spacing={3} wrap="wrap">
                <Input
                  type="file"
                  accept=".csv"
                  onChange={handleFileUpload}
                  ref={fileInputRef}
                  display="none"
                />
                
                {!isEditing ? (
                  <Button
                    variant="outline"
                    onClick={handleUnlock}
                    minW="120px"
                  >
                    Unlock to Edit
                  </Button>
                ) : (
                  <>
                    <Button
                      colorScheme="blue"
                      onClick={handleSave}
                      isLoading={loading}
                      minW="120px"
                    >
                      Save
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleCancel}
                      minW="120px"
                    >
                      Cancel
                    </Button>
                  </>
                )}
                
                <Button
                  variant="outline"
                  onClick={downloadCSV}
                  minW="140px"
                >
                  Download CSV
                </Button>
                
                <Button
                  variant="outline"
                  as="a"
                  href="/example_input.csv"
                  download="example_input.csv"
                  minW="180px"
                >
                  Download Example CSV
                </Button>
                
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  isDisabled={isLocked}
                  minW="140px"
                >
                  Upload CSV
                </Button>
              </HStack>

              <HStack spacing={2}>
                <Button
                  leftIcon={<AddIcon />}
                  size="sm"
                  onClick={handleAddAlternative}
                  isDisabled={isLocked}
                >
                  Add Alternative
                </Button>
                <Button
                  leftIcon={<AddIcon />}
                  size="sm"
                  onClick={handleAddCriterion}
                  isDisabled={isLocked}
                >
                  Add Criterion
                </Button>
              </HStack>

          {criteria.length > 0 ? (
            <Box overflowX="auto" borderWidth={1} borderRadius="md">
              <Table size="sm" variant="simple">
                <Thead bg="gray.50">
                  <Tr>
                    <Th minW="150px">Alternative</Th>
                    {criteria.map((criterion, idx) => (
                      <Th key={idx} minW="220px">
                        <VStack spacing={2} align="stretch">
                          <Input
                            value={criterion.criterion_name}
                            onChange={(e) => handleCellChange(idx, 'criterion_name', e.target.value)}
                            placeholder="Criterion"
                            size="sm"
                            fontWeight="bold"
                            bg="white"
                            isDisabled={isLocked}
                          />
                          <Input
                            value={criterion.group || ''}
                            onChange={(e) => handleCellChange(idx, 'group', e.target.value)}
                            placeholder="Group"
                            size="sm"
                            fontSize="xs"
                            bg="white"
                            isDisabled={isLocked}
                          />
                          <Input
                            value={criterion.description || ''}
                            onChange={(e) => handleCellChange(idx, 'description', e.target.value)}
                            placeholder="Description"
                            size="sm"
                            fontSize="xs"
                            bg="white"
                            isDisabled={isLocked}
                          />
                          <Input
                            value={criterion.unit}
                            onChange={(e) => handleCellChange(idx, 'unit', e.target.value)}
                            placeholder="Unit"
                            size="sm"
                            fontSize="xs"
                            bg="white"
                            isDisabled={isLocked}
                          />
                          <Checkbox
                            isChecked={criterion.is_qualitative}
                            onChange={(e) => handleCellChange(idx, 'is_qualitative', e.target.checked)}
                            isDisabled={isLocked}
                            size="sm"
                          >
                            <Text fontSize="xs">Qualitative</Text>
                          </Checkbox>
                          <Checkbox
                            isChecked={criterion.use_custom_min_max}
                            onChange={(e) => handleCellChange(idx, 'use_custom_min_max', e.target.checked)}
                            isDisabled={isLocked}
                            size="sm"
                          >
                            <Text fontSize="xs">Custom Min/Max</Text>
                          </Checkbox>
                          <Checkbox
                            isChecked={criterion.use_mid_splitting}
                            onChange={(e) => handleCellChange(idx, 'use_mid_splitting', e.target.checked)}
                            isDisabled={isLocked || criterion.is_qualitative}
                            size="sm"
                          >
                            <Text fontSize="xs">Mid-value splitting</Text>
                          </Checkbox>
                          {criterion.use_custom_min_max && (
                            <>
                              <Input
                                value={criterion.min_value || ''}
                                onChange={(e) => handleCellChange(idx, 'min_value', e.target.value)}
                                placeholder="Min value"
                                size="sm"
                                fontSize="xs"
                                bg="white"
                                isDisabled={isLocked}
                                type="number"
                              />
                              <Input
                                value={criterion.max_value || ''}
                                onChange={(e) => handleCellChange(idx, 'max_value', e.target.value)}
                                placeholder="Max value"
                                size="sm"
                                fontSize="xs"
                                bg="white"
                                isDisabled={isLocked}
                                type="number"
                              />
                            </>
                          )}
                        </VStack>
                      </Th>
                    ))}
                    <Th minW="90px">Actions</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {criteria[0]?.alternatives.map((_, altIdx) => (
                    <Tr key={altIdx}>
                      <Td minW="150px">
                        <Input
                          value={criteria[0].alternatives[altIdx].name}
                          onChange={(e) => handleAlternativeNameChange(altIdx, e.target.value)}
                          placeholder="Alternative name"
                          size="sm"
                          isDisabled={isLocked}
                        />
                      </Td>
                      {criteria.map((criterion, critIdx) => {
                        const altValue = criterion.alternatives[altIdx]?.value || ''
                        const isQualitative = criterion.is_qualitative
                        const distribution = parseDistribution(altValue)
                        const summary = getDistributionSummary(distribution)
                        const typeLabel = distribution ? getDistributionTypeLabel(distribution.type) : 'Empty'
                        
                        return (
                          <Td key={critIdx} minW="180px">
                            {isQualitative ? (
                              // Qualitative: gray out and disabled
                              <Box
                                bg="gray.100"
                                p={2}
                                borderRadius="md"
                                cursor="not-allowed"
                                opacity={0.5}
                                textAlign="center"
                              >
                                <Text fontSize="sm" color="gray.500">
                                  (QI Page)
                                </Text>
                              </Box>
                            ) : isLocked ? (
                              // Locked: gray out and disabled
                              <Box
                                bg="gray.100"
                                p={2}
                                borderRadius="md"
                                cursor="not-allowed"
                                opacity={0.5}
                              >
                                <Text fontSize="xs" fontWeight="semibold" color="gray.600">
                                  {typeLabel}
                                </Text>
                                <Text fontSize="sm" fontWeight="bold" noOfLines={1}>
                                  {summary || '—'}
                                </Text>
                              </Box>
                            ) : (
                              // Non-qualitative and unlocked: clickable distribution editor
                              <HStack
                                spacing={1}
                                p={2}
                                borderWidth={1}
                                borderRadius="md"
                                borderColor={altValue ? 'blue.300' : 'gray.200'}
                                bg={altValue ? 'blue.50' : 'white'}
                                cursor="pointer"
                                _hover={{ borderColor: 'blue.400', bg: 'blue.100' }}
                                onClick={() => handleDistributionModalOpen(critIdx, altIdx)}
                                transition="all 0.2s"
                              >
                                <Box flex={1} minW={0}>
                                  <Text fontSize="xs" fontWeight="semibold" color="gray.600">
                                    {typeLabel}
                                  </Text>
                                  <Text fontSize="sm" fontWeight="bold" noOfLines={1}>
                                    {summary || '—'}
                                  </Text>
                                </Box>
                                <Box
                                  fontSize="lg"
                                  color="blue.600"
                                  flexShrink={0}
                                >
                                  <SettingsIcon boxSize={3} />
                                </Box>
                              </HStack>
                            )}
                          </Td>
                        )
                      })}
                      <Td width="90px" minW="90px">
                        <IconButton
                          aria-label="Remove alternative"
                          icon={<DeleteIcon />}
                          size="sm"
                          variant="ghost"
                          colorScheme="red"
                          onClick={() => handleRemoveAlternative(altIdx)}
                          isDisabled={isLocked}
                        />
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </Box>
          ) : (
            <Box borderWidth={1} borderRadius="md" p={4} bg="gray.50">
              <Text fontSize="sm" color="gray.600">No data loaded yet. Upload a CSV.</Text>
            </Box>
          )}
            </VStack>
          </>
        )}
      </VStack>

      {/* Distribution Modal */}
      <DistributionModal
        isOpen={isDistModalOpen}
        onClose={onDistModalClose}
        initialValue={currentCellValue}
        onSave={handleDistributionSave}
        title="Edit Distribution"
      />

      {/* Unlock confirmation dialog */}
      <AlertDialog
        isOpen={isUnlockOpen}
        leastDestructiveRef={unlockCancelRef}
        onClose={onUnlockClose}
      >
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              Modify Input
            </AlertDialogHeader>
            <AlertDialogBody>
              Are you sure you want to modify the input?
              <br /><br />
              Warning: All existing elicitation sessions will be reset when you save changes.
            </AlertDialogBody>
            <AlertDialogFooter>
              <Button ref={unlockCancelRef} onClick={onUnlockClose}>
                Cancel
              </Button>
              <Button colorScheme="orange" onClick={handleUnlockConfirm} ml={3}>
                Continue
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </Box>
  )
}

export default forwardRef(InputPage)
