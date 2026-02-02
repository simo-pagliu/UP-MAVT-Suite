import { AddIcon, DeleteIcon } from '@chakra-ui/icons'
import { useRef } from 'react'
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
} from '@chakra-ui/react'
import axios from 'axios'
import { useState, useEffect } from 'react'

const API_URL = 'http://localhost:5000/api'

function InputPage({ onSessionCreated, sessionId }) {
  const [name, setName] = useState('')
  const [criteria, setCriteria] = useState([])
  const [loading, setLoading] = useState(false)
  const [nameChecked, setNameChecked] = useState(false)
  const [existingSessionId, setExistingSessionId] = useState(null)
  const [isExistingSession, setIsExistingSession] = useState(false)
  const [showCodeInput, setShowCodeInput] = useState(false)
  const [isLocked, setIsLocked] = useState(false)
  const toast = useToast()
  const fileInputRef = useRef(null)

  const normalizeCriteria = (items) => {
    if (!Array.isArray(items)) return []
    return items.map((c) => ({
      criterion_name: c.criterion_name || '',
      unit: c.unit || '',
      group: c.group || '',
      description: c.description || '',
      alternatives: Array.isArray(c.alternatives) ? c.alternatives : [],
    }))
  }

  useEffect(() => {
    if (sessionId) {
      const fetchSession = async () => {
        try {
          const response = await axios.get(`${API_URL}/session/${sessionId}`)
          const session = response.data
          if (session.name) {
            setName(session.name)
            setNameChecked(true)
          }
          if (session.criteria && Array.isArray(session.criteria)) {
                  setCriteria(normalizeCriteria(session.criteria))
          }
          setIsLocked(session.locked || false)
          setExistingSessionId(sessionId)
          setIsExistingSession(true)
        } catch (error) {
          console.error('Failed to fetch session:', error)
        }
      }
      fetchSession()
    }
  }, [sessionId])

  const generateRandomCode = () => {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    let code = ''
    for (let i = 0; i < 8; i++) {
      code += characters.charAt(Math.floor(Math.random() * characters.length))
    }
    return code
  }

  const handleNewSession = () => {
    const code = generateRandomCode()
    setName(code)
    setNameChecked(true)
    setIsExistingSession(false)
    setCriteria([])
    toast({
      title: 'New session created',
      description: `Session code: ${code}`,
      status: 'success',
      duration: 3000,
      isClosable: true,
    })
  }

  const handleCheckName = async () => {
    if (!name.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a session code',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
      return
    }

    setLoading(true)
    try {
      const response = await axios.get(`${API_URL}/session/by-name/${encodeURIComponent(name)}`)
      const data = response.data
      
      if (data.exists) {
        // Session exists, load it
        if (data.criteria && Array.isArray(data.criteria)) {
          setCriteria(normalizeCriteria(data.criteria))
        }
        setIsLocked(data.locked || false)
        setExistingSessionId(data._id)
        setIsExistingSession(true)
        toast({
          title: 'Session found',
          description: 'Loaded existing criteria for this session code',
          status: 'info',
          duration: 3000,
          isClosable: true,
        })
      } else {
        // New session
        setIsExistingSession(false)
        setIsLocked(false)
        setCriteria([])
        toast({
          title: 'New session',
          description: 'Upload a CSV to create criteria',
          status: 'info',
          duration: 3000,
          isClosable: true,
        })
      }
      setNameChecked(true)
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to check session code',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      setLoading(false)
    }
  }

  const handleFileUpload = (event) => {
    if (isLocked) {
      toast({
        title: 'Error',
        description: 'This session is locked. You cannot modify the criteria.',
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
      const rows = lines.map(line => line.split(',').map(cell => cell.trim()))
      
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
          value: row[idx + 1] || ''
        }))
        return {
          criterion_name: name,
          group: groups[idx] || '',
          description: descriptions[idx] || '',
          unit: units[idx],
          alternatives
        }
      })

      setCriteria(parsedCriteria)
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
  }

  const handleAlternativeChange = (criterionIdx, altIdx, value) => {
    setCriteria((prev) => {
      const updated = [...prev]
      const updatedAlts = [...updated[criterionIdx].alternatives]
      updatedAlts[altIdx] = { ...updatedAlts[altIdx], value }
      updated[criterionIdx] = { ...updated[criterionIdx], alternatives: updatedAlts }
      return updated
    })
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
      unit: '',
      alternatives: Array(alternativeCount).fill(null).map((_, idx) => ({
        name: criteria[0].alternatives[idx].name,
        value: ''
      }))
    }
    setCriteria((prev) => [...prev, newCriterion])
  }

  const handleRemoveAlternative = (altIdx) => {
    setCriteria((prev) => prev.map(criterion => ({
      ...criterion,
      alternatives: criterion.alternatives.filter((_, idx) => idx !== altIdx)
    })))
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

    // Build CSV content
    const rows = []
    
    // Header row: Alternative, Criterion1, Criterion2, ...
    const headerRow = ['Alternative', ...criteria.map(c => c.criterion_name)]
    rows.push(headerRow.join(','))

    // Group row
    const groupRow = ['Group', ...criteria.map(c => c.group || '')]
    rows.push(groupRow.join(','))

    // Description row
    const descriptionRow = ['Description', ...criteria.map(c => c.description || '')]
    rows.push(descriptionRow.join(','))
    
    // Alternative rows: name, value1, value2, ...
    const alternativeCount = criteria[0]?.alternatives.length || 0
    for (let i = 0; i < alternativeCount; i++) {
      const row = [
        criteria[0].alternatives[i].name,
        ...criteria.map(c => c.alternatives[i]?.value || '')
      ]
      rows.push(row.join(','))
    }
    
    // Unit row: Unit, unit1, unit2, ...
    const unitRow = ['Unit', ...criteria.map(c => c.unit)]
    rows.push(unitRow.join(','))
    
    // Create CSV string
    const csvContent = rows.join('\n')
    
    // Create download link
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', `${name || 'criteria'}_export.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    
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
    const hasEmptyAlternatives = criteria.some(criterion =>
      criterion.alternatives.some(alt => !alt.name || alt.value === '')
    )
    if (hasEmptyAlternatives) {
      toast({
        title: 'Error',
        description: 'All alternatives must have names and values',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
      return
    }

    setLoading(true)
    try {
      if (isExistingSession && existingSessionId) {
        // If locked, just proceed without updating
        if (isLocked) {
          toast({
            title: 'Proceeding',
            description: 'Session is locked, proceeding to elicitation',
            status: 'info',
            duration: 2,
            isClosable: true,
          })
          onSessionCreated(existingSessionId)
        } else {
          // Update existing session criteria
          await axios.put(`${API_URL}/session/${existingSessionId}/criteria`, { criteria })
          toast({
            title: 'Success',
            description: 'Session updated',
            status: 'success',
            duration: 2,
            isClosable: true,
          })
          onSessionCreated(existingSessionId)
        }
      } else {
        // Create new session
        const response = await axios.post(`${API_URL}/session`, { name, criteria })
        toast({
          title: 'Success',
          description: 'Session created',
          status: 'success',
          duration: 2,
          isClosable: true,
        })
        onSessionCreated(response.data.session_id)
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to create session',
        status: 'error',
        duration: 3,
        isClosable: true,
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box bg="white" p={8} borderRadius="lg" boxShadow="sm">
      <VStack spacing={6} align="stretch">
        <HStack justify="space-between" align="center" mb={4}>
          <Heading as="h1" size="lg">Input</Heading>
          {nameChecked && (
            <Button
              colorScheme="blue"
              isLoading={loading}
              onClick={handleSubmit}
              size="lg"
            >
              Continue
            </Button>
          )}
        </HStack>
        <FormControl>
          <FormLabel>Session Code</FormLabel>
          
          {!nameChecked && !showCodeInput && (
            <VStack spacing={4} align="stretch">
              <Text fontSize="sm" color="gray.600">
                Start a new session or continue with an existing session code.
              </Text>
              <HStack spacing={4} justify="center">
                <Button 
                  colorScheme="blue" 
                  onClick={handleNewSession}
                  size="lg"
                  px={8}
                >
                  New Empty Session
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => setShowCodeInput(true)}
                  size="lg"
                  px={8}
                >
                  I Have a Code
                </Button>
              </HStack>
            </VStack>
          )}

          {!nameChecked && showCodeInput && (
            <VStack spacing={3} align="stretch">
              <Text fontSize="sm" color="gray.600">
                Enter your session code below.
              </Text>
              <HStack>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowCodeInput(false)
                    setName('')
                  }}
                >
                  ← Back
                </Button>
              </HStack>
              <HStack>
                <Input
                  placeholder="Enter session code"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleCheckName()}
                  autoFocus
                />
                <Button
                  colorScheme="blue"
                  onClick={handleCheckName}
                  isLoading={loading}
                  minW="100px"
                >
                  Next
                </Button>
              </HStack>
            </VStack>
          )}

          {nameChecked && (
            <HStack mb={4}>
              <Text fontSize="sm" fontWeight="medium">Session Code: {name}</Text>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setNameChecked(false)
                  setShowCodeInput(false)
                  setCriteria([])
                  setIsExistingSession(false)
                  setExistingSessionId(null)
                  setName('')
                }}
              >
                Change
              </Button>
            </HStack>
          )}
        </FormControl>

        {nameChecked && (
          <>
            <Divider />

            {isLocked && (
              <Box bg="yellow.50" p={3} borderRadius="md" borderLeft="4px" borderLeftColor="yellow.400">
                <Text fontSize="sm" color="yellow.800" fontWeight="semibold">
                  🔒 This session is locked. You can view the criteria but cannot modify them.
                </Text>
              </Box>
            )}

            <VStack align="stretch" spacing={4}>
          <Heading as="h2" size="md">Criteria & Alternatives</Heading>
          <Text fontSize="sm" color="gray.600">
            Upload a CSV where the first column contains alternative names, other columns are criteria. First row has criterion names, last row has units.
          </Text>
          {!isLocked && (
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
                      <Th key={idx} minW="180px">
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
                      {criteria.map((criterion, critIdx) => (
                        <Td key={critIdx} minW="180px">
                          <Input
                            value={criterion.alternatives[altIdx]?.value || ''}
                            onChange={(e) => handleAlternativeChange(critIdx, altIdx, e.target.value)}
                            placeholder="Value"
                            size="sm"
                            type="number"
                            isDisabled={isLocked}
                          />
                        </Td>
                      ))}
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
    </Box>
  )
}

export default InputPage
