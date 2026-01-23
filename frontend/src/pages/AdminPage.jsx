import { useState, useEffect } from 'react'
import {
  Box,
  Heading,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Button,
  useToast,
  Spinner,
  Center,
  Text,
  AlertDialog,
  AlertDialogBody,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogContent,
  AlertDialogOverlay,
  useDisclosure,
  HStack,
  VStack,
  Input,
  FormControl,
  FormLabel
} from '@chakra-ui/react'
import { useRef } from 'react'

function AdminPage() {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [deleteId, setDeleteId] = useState(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [password, setPassword] = useState('')
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const { isOpen, onOpen, onClose } = useDisclosure()
  const cancelRef = useRef()
  const toast = useToast()

  // Check if already authenticated on mount
  useEffect(() => {
    const authStatus = sessionStorage.getItem('adminAuthenticated')
    if (authStatus === 'true') {
      setIsAuthenticated(true)
    } else {
      setLoading(false)
    }
  }, [])

  const handleLogin = async (e) => {
    e.preventDefault()
    setIsAuthenticating(true)
    
    try {
      const response = await fetch('http://localhost:5000/api/admin/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      })
      
      const data = await response.json()
      
      if (data.success) {
        setIsAuthenticated(true)
        sessionStorage.setItem('adminAuthenticated', 'true')
        setPassword('')
      } else {
        toast({
          title: 'Error',
          description: 'Invalid password',
          status: 'error',
          duration: 3000,
          isClosable: true,
        })
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to authenticate',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      setIsAuthenticating(false)
    }
  }

  const handleLogout = () => {
    setIsAuthenticated(false)
    sessionStorage.removeItem('adminAuthenticated')
    setPassword('')
  }

  const fetchSessions = async () => {
    try {
      setLoading(true)
      const response = await fetch('http://localhost:5000/api/sessions')
      if (!response.ok) throw new Error('Failed to fetch sessions')
      const data = await response.json()
      setSessions(data)
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load sessions',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthenticated) {
      fetchSessions()
    }
  }, [isAuthenticated])

  const handleDeleteClick = (sessionId) => {
    setDeleteId(sessionId)
    onOpen()
  }

  const handleDeleteConfirm = async () => {
    try {
      const response = await fetch(`http://localhost:5000/api/session/${deleteId}`, {
        method: 'DELETE',
      })
      
      if (!response.ok) throw new Error('Failed to delete session')
      
      toast({
        title: 'Success',
        description: 'Session deleted successfully',
        status: 'success',
        duration: 3000,
        isClosable: true,
      })
      
      // Refresh the sessions list
      fetchSessions()
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to delete session',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      onClose()
      setDeleteId(null)
    }
  }

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A'
    return new Date(dateString).toLocaleString()
  }

  const handleDownloadInput = (sessionId, sessionName) => {
    window.open(`http://localhost:5000/api/session/${sessionId}/export-input`, '_blank')
  }

  const handleDownloadOutput = (sessionId, sessionName) => {
    window.open(`http://localhost:5000/api/session/${sessionId}/export`, '_blank')
  }

  const handleDownloadBWT = (sessionId, sessionName) => {
    window.open(`http://localhost:5000/api/session/${sessionId}/bwt/export`, '_blank')
  }

  // Show login form if not authenticated
  if (!isAuthenticated) {
    return (
      <Center h="400px">
        <Box p={8} maxW="md" borderWidth={1} borderRadius="lg" bg="white" boxShadow="md">
          <VStack spacing={4} as="form" onSubmit={handleLogin}>
            <Heading size="lg">Admin Login</Heading>
            <FormControl isRequired>
              <FormLabel>Password</FormLabel>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter admin password"
              />
            </FormControl>
            <Button
              type="submit"
              colorScheme="blue"
              width="100%"
              isLoading={isAuthenticating}
            >
              Login
            </Button>
          </VStack>
        </Box>
      </Center>
    )
  }

  if (loading) {
    return (
      <Center h="400px">
        <Spinner size="xl" />
      </Center>
    )
  }

  return (
    <Box p={8}>
      <HStack justify="space-between" mb={6}>
        <Heading>Admin - Manage Sessions</Heading>
        <Button colorScheme="red" variant="outline" onClick={handleLogout}>
          Logout
        </Button>
      </HStack>
      
      {sessions.length === 0 ? (
        <Text>No sessions found.</Text>
      ) : (
        <Box overflowX="auto">
          <Table variant="simple">
            <Thead>
              <Tr>
                <Th>Name</Th>
                <Th>Created At</Th>
                <Th>Criteria Count</Th>
                <Th>Qualitative</Th>
                <Th>Value Functions</Th>
                <Th>BWT</Th>
                <Th>PILE-BWT</Th>
                <Th>Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {sessions.map((session) => (
                <Tr key={session._id}>
                  <Td>{session.name}</Td>
                  <Td>{formatDate(session.created_at)}</Td>
                  <Td>{session.criteria?.length || 0}</Td>
                  <Td>{session.qualitative_indicators !== null ? '✓' : '—'}</Td>
                  <Td>{session.value_functions !== null ? '✓' : '—'}</Td>
                  <Td>{session.bwt !== null ? '✓' : '—'}</Td>
                  <Td>{session.pile_bwt !== null ? '✓' : '—'}</Td>
                  <Td>
                    <HStack spacing={2}>
                      <Button
                        colorScheme="blue"
                        size="sm"
                        onClick={() => handleDownloadInput(session._id, session.name)}
                      >
                        Input
                      </Button>
                      <Button
                        colorScheme="green"
                        size="sm"
                        onClick={() => handleDownloadOutput(session._id, session.name)}
                      >
                        Output
                      </Button>
                      <Button
                        colorScheme="purple"
                        size="sm"
                        onClick={() => handleDownloadBWT(session._id, session.name)}
                      >
                        BWT
                      </Button>
                      <Button
                        colorScheme="red"
                        size="sm"
                        onClick={() => handleDeleteClick(session._id)}
                      >
                        Delete
                      </Button>
                    </HStack>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Box>
      )}

      <AlertDialog
        isOpen={isOpen}
        leastDestructiveRef={cancelRef}
        onClose={onClose}
      >
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              Delete Session
            </AlertDialogHeader>

            <AlertDialogBody>
              Are you sure you want to delete this session? This action cannot be undone.
            </AlertDialogBody>

            <AlertDialogFooter>
              <Button ref={cancelRef} onClick={onClose}>
                Cancel
              </Button>
              <Button colorScheme="red" onClick={handleDeleteConfirm} ml={3}>
                Delete
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </Box>
  )
}

export default AdminPage
