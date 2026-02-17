import { AddIcon, DeleteIcon } from '@chakra-ui/icons'
import { useRef, forwardRef, useImperativeHandle } from 'react'
import {
  Box,
  Button,
  Heading,
  VStack,
  Input,
  FormControl,
  FormLabel,
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

const API_URL = 'http://localhost:5000/api'

function InputPage({ studySessionId }, ref) {
  const [name, setName] = useState('')
  const [criteria, setCriteria] = useState([])
  const [loading, setLoading] = useState(false)
  const [isExistingStudySession, setIsExistingStudySession] = useState(false)
  const [isLocked, setIsLocked] = useState(false)
  const [isSessionLocked, setIsSessionLocked] = useState(false)
  const [hasModifiedInput, setHasModifiedInput] = useState(false)
  
  // Distribution modal state
  const { isOpen: isDistModalOpen, onOpen: onDistModalOpen, onClose: onDistModalClose } = useDisclosure()
  const [editingCell, setEditingCell] = useState(null) // {criterionIdx, altIdx}
  const [currentCellValue, setCurrentCellValue] = useState('')
  
  const toast = useToast()
  const fileInputRef = useRef(null)

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
  
  useImperativeHandle(ref, () => ({
    async saveBeforeNavigate() {
      // InputPage does not have persistent state
    },
  }))
  
  const isInputLocked = isLocked || isSessionLocked

  const normalizeCriteria = (items) => {
    if (!Array.isArray(items)) return []
    return items.map((c) => ({
      criterion_name: c.criterion_name || '',
      unit: c.unit || '',
      group: c.group || '',
      description: c.description || '',
      is_qualitative: c.is_qualitative || false,
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
      setCriteria([])
      setIsExistingStudySession(false)
      return
    }

    const fetchStudy = async () => {
      try {
        const response = await axios.get(`${API_URL}/study-session/${studySessionId}`)
        const study = response.data
        if (study.code) {
          setName(study.code)
        }
        if (study.criteria && Array.isArray(study.criteria)) {
          setCriteria(normalizeCriteria(study.criteria))
        }
        setIsLocked(false)
        setIsSessionLocked(false)
        setIsExistingStudySession(true)
        setHasModifiedInput(false)
      } catch (error) {
        console.error('Failed to fetch study session:', error)
      }
    }
    fetchStudy()
  }, [studySessionId])

  const handleFileUpload = (event) => {
    if (isInputLocked) {
      toast({
        title: 'Error',
        description: isSessionLocked
          ? 'This session is locked. You cannot modify the criteria.'
          : 'This input is locked. You cannot modify the criteria.',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
      return
    }

    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result
      if (typeof text !== 'string') return

      const lines = text.trim().split(/\r?\n/).filter(Boolean)
      if (lines.length < 3) {
        toast({
          title: 'Error',
          description: 'CSV must have at least criterion names, one alternative, and units',
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
          title: 'Error',
          description: 'No criteria columns found',
          status: 'error',
          duration: 3000,
          isClosable: true,
        })
        return
      }

      // Optional second row: groups
      let groups = Array(criterionNames.length).fill('')
      let descriptions = Array(criterionNames.length).fill('')
      let alternativesStartIndex = 1
      if (rows[1] && rows[1][0] && rows[1][0].toLowerCase() === 'group') {
        groups = rows[1].slice(1)
        alternativesStartIndex = 2
        if (groups.length !== criterionNames.length) {
          toast({
            title: 'Error',
            description: 'Number of groups must match number of criteria',
            status: 'error',
            duration: 3000,
            isClosable: true,
          })
          return
        }
      }

      // Optional third row: descriptions
      if (rows[alternativesStartIndex] && rows[alternativesStartIndex][0] && rows[alternativesStartIndex][0].toLowerCase() === 'description') {
        descriptions = rows[alternativesStartIndex].slice(1)
        alternativesStartIndex += 1
        if (descriptions.length !== criterionNames.length) {
          toast({
            title: 'Error',
            description: 'Number of descriptions must match number of criteria',
            status: 'error',
            duration: 3000,
            isClosable: true,
          })
          return
        }
      }

      // Last row: units (first cell should be "Unit")
      const unitRow = rows[rows.length - 1]
      const units = unitRow.slice(1) // Skip first column
      
      if (units.length !== criterionNames.length) {
        toast({
          title: 'Error',
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
          title: 'Error',
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
        return {
          criterion_name: name,
          group: groups[idx] || '',
          description: descriptions[idx] || '',
          unit: units[idx],
          is_qualitative: false,
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
        title: 'Error',
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
      
      if (isExistingStudySession && studySessionId && !isInputLocked) {
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
            duration: 2,
            isClosable: true,
          })
        } catch (error) {
          toast({
            title: 'Error',
            description: error.response?.data?.error || 'Failed to save distribution',
            status: 'error',
            duration: 3,
            isClosable: true,
          })
        }
      } else {
        toast({
          title: 'Distribution Updated',
          description: 'Click "Confirm input to continue" to save all changes to the database',
          status: 'success',
          duration: 3,
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
        title: 'Error',
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
        title: 'Error',
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
        title: 'Error',
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
      title: 'Success',
      description: 'CSV file downloaded',
      status: 'success',
      duration: 2000,
      isClosable: true,
    })
  }

  const handleSubmit = async () => {
    if (criteria.length === 0) {
      toast({
        title: 'Error',
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
        title: 'Error',
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
        title: 'Error',
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
        await axios.put(`${API_URL}/study-session/${studySessionId}/input`, { criteria })
        toast({
          title: 'Success',
          description: 'Study input updated and saved',
          status: 'success',
          duration: 3,
          isClosable: true,
        })
        setHasModifiedInput(false)
      } else {
        toast({
          title: 'Missing study session',
          description: 'Access or create a study session before saving input.',
          status: 'error',
          duration: 3,
          isClosable: true,
        })
      }
    } catch (error) {
      console.error('Save error:', error)
      toast({
        title: 'Error',
        description: error.response?.data?.error || error.message || 'Failed to save session',
        status: 'error',
        duration: 5,
        isClosable: true,
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box bg="white" p={6} borderRadius="lg" boxShadow="sm">
      <VStack spacing={6} align="stretch">
        <HStack justify="space-between" align="center" mb={4}>
          <Heading as="h1" size="lg">Input Definition</Heading>
          {studySessionId && !isInputLocked && (hasModifiedInput || !isExistingStudySession || criteria.length === 0) && (
            <Button
              colorScheme="blue"
              isLoading={loading}
              onClick={handleSubmit}
              size="lg"
            >
              Save input
            </Button>
          )}
        </HStack>
        {!studySessionId && (
          <Box borderWidth={1} borderRadius="md" p={4} bg="gray.50">
            <Text fontSize="sm" color="gray.600">
              Access a study session first to define the input.
            </Text>
          </Box>
        )}

        {studySessionId && (
          <>
            <Divider />

            <VStack align="stretch" spacing={4}>
              <Heading as="h2" size="md">Criteria & Alternatives</Heading>
              <Text fontSize="sm" color="gray.600">
                Upload a CSV where the first column contains alternative names, other columns are criteria. First row has criterion names, last row has units.
              </Text>
              {!isInputLocked && (
                <FormControl>
                  <FormLabel>Upload CSV</FormLabel>
                  <Input
                    type="file"
                    accept=".csv"
                    onChange={handleFileUpload}
                    ref={fileInputRef}
                    display="none"
                  />
                  <Button
                    onClick={() => fileInputRef.current?.click()}
                    colorScheme="blue"
                    variant="outline"
                    width="full"
                  >
                    Choose File
                  </Button>
                </FormControl>
              )}

              <HStack justify="space-between">
                <HStack spacing={2}>
                  <Button
                    leftIcon={<AddIcon />}
                    size="sm"
                    onClick={handleAddAlternative}
                    isDisabled={isInputLocked}
                  >
                    Add Alternative
                  </Button>
                  <Button
                    leftIcon={<AddIcon />}
                    size="sm"
                    onClick={handleAddCriterion}
                    isDisabled={isInputLocked}
                  >
                    Add Criterion
                  </Button>
                </HStack>
                <Button size="sm" onClick={downloadCSV}>
                  Download CSV
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
                            isDisabled={isInputLocked}
                          />
                          <Input
                            value={criterion.group || ''}
                            onChange={(e) => handleCellChange(idx, 'group', e.target.value)}
                            placeholder="Group"
                            size="sm"
                            fontSize="xs"
                            bg="white"
                            isDisabled={isInputLocked}
                          />
                          <Input
                            value={criterion.description || ''}
                            onChange={(e) => handleCellChange(idx, 'description', e.target.value)}
                            placeholder="Description"
                            size="sm"
                            fontSize="xs"
                            bg="white"
                            isDisabled={isInputLocked}
                          />
                          <Input
                            value={criterion.unit}
                            onChange={(e) => handleCellChange(idx, 'unit', e.target.value)}
                            placeholder="Unit"
                            size="sm"
                            fontSize="xs"
                            bg="white"
                            isDisabled={isInputLocked}
                          />
                          <Checkbox
                            isChecked={criterion.is_qualitative}
                            onChange={(e) => handleCellChange(idx, 'is_qualitative', e.target.checked)}
                            isDisabled={isInputLocked}
                            size="sm"
                          >
                            <Text fontSize="xs">Qualitative</Text>
                          </Checkbox>
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
                          isDisabled={isInputLocked}
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
                            ) : isInputLocked ? (
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
                                  ⚙
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
                          isDisabled={isInputLocked}
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
    </Box>
  )
}

export default forwardRef(InputPage)
