import { AddIcon, DeleteIcon } from '@chakra-ui/icons'
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
  const toast = useToast()

  const expectedHeaders = ['criterion_name', 'min', 'max', 'unit']

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
            setCriteria(session.criteria)
          }
          setExistingSessionId(sessionId)
          setIsExistingSession(true)
        } catch (error) {
          console.error('Failed to fetch session:', error)
        }
      }
      fetchSession()
    }
  }, [sessionId])

  const handleCheckName = async () => {
    if (!name.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a name',
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
          setCriteria(data.criteria)
        }
        setExistingSessionId(data._id)
        setIsExistingSession(true)
        toast({
          title: 'Session found',
          description: 'Loaded existing criteria for this name',
          status: 'info',
          duration: 3000,
          isClosable: true,
        })
      } else {
        // New session
        setIsExistingSession(false)
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
        description: error.response?.data?.error || 'Failed to check name',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      setLoading(false)
    }
  }

  const handleFileUpload = (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result
      if (typeof text !== 'string') return

      const lines = text.trim().split(/\r?\n/)
      if (lines.length === 0) {
        toast({
          title: 'Error',
          description: 'The CSV file is empty',
          status: 'error',
          duration: 3000,
          isClosable: true,
        })
        return
      }

      const [headerLine, ...rows] = lines
      const headers = headerLine.split(',').map((h) => h.trim().toLowerCase())
      const missingHeaders = expectedHeaders.filter((h) => !headers.includes(h))

      if (missingHeaders.length > 0) {
        toast({
          title: 'Invalid CSV format',
          description: `Missing columns: ${missingHeaders.join(', ')}`,
          status: 'error',
          duration: 4000,
          isClosable: true,
        })
        return
      }

      const parsedRows = rows
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const cells = line.split(',').map((cell) => cell.trim())
          const row = {}
          expectedHeaders.forEach((header, idx) => {
            row[header] = cells[idx] ?? ''
          })
          return row
        })

      if (parsedRows.length === 0) {
        toast({
          title: 'Invalid CSV',
          description: 'No data rows found under the header',
          status: 'error',
          duration: 3000,
          isClosable: true,
        })
        return
      }

      setCriteria(parsedRows)
      toast({
        title: 'File loaded',
        description: `${parsedRows.length} row(s) imported`,
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

  const handleCellChange = (index, key, value) => {
    setCriteria((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [key]: value }
      return updated
    })
  }

  const handleAddRow = () => {
    setCriteria((prev) => [...prev, { criterion_name: '', min: '', max: '', unit: '' }])
  }

  const handleRemoveRow = (index) => {
    setCriteria((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = async () => {
    if (criteria.length === 0) {
      toast({
        title: 'Error',
        description: 'Please upload a CSV or add at least one row',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
      return
    }

    const hasEmptyFields = criteria.some(
      (row) => !row.criterion_name || row.min === '' || row.max === '' || !row.unit,
    )
    if (hasEmptyFields) {
      toast({
        title: 'Error',
        description: 'All rows must have criterion_name, min, max, and unit',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
      return
    }

    setLoading(true)
    try {
      if (isExistingSession && existingSessionId) {
        // Use existing session
        toast({
          title: 'Success',
          description: 'Using existing session',
          status: 'success',
          duration: 2,
          isClosable: true,
        })
        onSessionCreated(existingSessionId)
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
        <Heading as="h1" size="lg">Input</Heading>
        <FormControl>
          <FormLabel>Name</FormLabel>
          <HStack>
            <Input
              placeholder="Enter your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              isDisabled={nameChecked}
              onKeyPress={(e) => e.key === 'Enter' && !nameChecked && handleCheckName()}
            />
            {!nameChecked && (
              <Button
                colorScheme="blue"
                onClick={handleCheckName}
                isLoading={loading}
                minW="100px"
              >
                Next
              </Button>
            )}
            {nameChecked && (
              <Button
                variant="outline"
                onClick={() => {
                  setNameChecked(false)
                  setCriteria([])
                  setIsExistingSession(false)
                  setExistingSessionId(null)
                }}
                minW="100px"
              >
                Change
              </Button>
            )}
          </HStack>
        </FormControl>

        {nameChecked && (
          <>
            <Divider />

            <VStack align="stretch" spacing={4}>
          <Heading as="h2" size="md">Criteria</Heading>
          <Text fontSize="sm" color="gray.600">
            Upload a CSV with columns: criterion_name, min, max, unit. You can also edit the table below once loaded.
          </Text>
          <FormControl>
            <FormLabel>Upload CSV</FormLabel>
            <Input type="file" accept=".csv" onChange={handleFileUpload} />
          </FormControl>

          <HStack justify="space-between">
            <Button leftIcon={<AddIcon />} size="sm" onClick={handleAddRow}>
              Add Row
            </Button>
            <Text fontSize="xs" color="gray.500">Example format: criterion_name,min,max,unit</Text>
          </HStack>

          {criteria.length > 0 ? (
            <Box overflowX="auto" borderWidth={1} borderRadius="md">
              <Table size="sm" variant="simple">
                <Thead bg="gray.50">
                  <Tr>
                    <Th>Criterion Name</Th>
                    <Th>Min</Th>
                    <Th>Max</Th>
                    <Th>Unit</Th>
                    <Th>Actions</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {criteria.map((row, index) => (
                    <Tr key={`${row.criterion_name}-${index}`}>
                      <Td>
                        <Input
                          value={row.criterion_name}
                          onChange={(e) => handleCellChange(index, 'criterion_name', e.target.value)}
                          placeholder="Length"
                          size="sm"
                        />
                      </Td>
                      <Td>
                        <Input
                          value={row.min}
                          onChange={(e) => handleCellChange(index, 'min', e.target.value)}
                          placeholder="5"
                          size="sm"
                        />
                      </Td>
                      <Td>
                        <Input
                          value={row.max}
                          onChange={(e) => handleCellChange(index, 'max', e.target.value)}
                          placeholder="15"
                          size="sm"
                        />
                      </Td>
                      <Td>
                        <Input
                          value={row.unit}
                          onChange={(e) => handleCellChange(index, 'unit', e.target.value)}
                          placeholder="cm"
                          size="sm"
                        />
                      </Td>
                      <Td width="90px">
                        <IconButton
                          aria-label="Remove row"
                          icon={<DeleteIcon />}
                          size="sm"
                          variant="ghost"
                          colorScheme="red"
                          onClick={() => handleRemoveRow(index)}
                        />
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </Box>
          ) : (
            <Box borderWidth={1} borderRadius="md" p={4} bg="gray.50">
              <Text fontSize="sm" color="gray.600">No data loaded yet. Upload a CSV or add rows manually.</Text>
            </Box>
          )}
            </VStack>

            <Button
              colorScheme="blue"
              isLoading={loading}
              onClick={handleSubmit}
            >
              Continue
            </Button>
          </>
        )}
      </VStack>
    </Box>
  )
}

export default InputPage
