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
  FormLabel,
  IconButton,
  Drawer,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  DrawerContent,
  DrawerCloseButton,
  Badge,
  Tooltip,
  Icon
} from '@chakra-ui/react'
import { LockIcon, UnlockIcon, SettingsIcon } from '@chakra-ui/icons'
import { useRef } from 'react'

function AdminPage() {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [deleteId, setDeleteId] = useState(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [password, setPassword] = useState('')
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const { isOpen, onOpen, onClose } = useDisclosure()
  const {
    isOpen: isDrawerOpen,
    onOpen: onDrawerOpen,
    onClose: onDrawerClose,
  } = useDisclosure()
  const cancelRef = useRef()
  const toast = useToast()
  const [selectedSession, setSelectedSession] = useState(null)

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
      if (selectedSession) {
        const updated = data.find((s) => s._id === selectedSession._id)
        setSelectedSession(updated || null)
      }
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

  const handleRowClick = (session) => {
    setSelectedSession(session)
    onDrawerOpen()
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

  const handleToggleInputLock = async (sessionId) => {
    try {
      const response = await fetch(`http://localhost:5000/api/session/${sessionId}/lock`, {
        method: 'PUT',
      })
      
      if (!response.ok) throw new Error('Failed to toggle lock')
      
      const data = await response.json()
      
      toast({
        title: 'Success',
        description: data.locked ? 'Input locked' : 'Input unlocked',
        status: 'success',
        duration: 2000,
        isClosable: true,
      })
      
      // Refresh the sessions list
      fetchSessions()
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to toggle lock',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    }
  }

  const handleToggleSessionLock = async (sessionId) => {
    try {
      const response = await fetch(`http://localhost:5000/api/session/${sessionId}/lock-session`, {
        method: 'PUT',
      })

      if (!response.ok) throw new Error('Failed to toggle session lock')

      const data = await response.json()

      toast({
        title: 'Success',
        description: data.session_locked ? 'Session locked' : 'Session unlocked',
        status: 'success',
        duration: 2000,
        isClosable: true,
      })

      // Refresh the sessions list
      fetchSessions()
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to toggle session lock',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    }
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
                <Th>Locks</Th>
                <Th>Qualitative</Th>
                <Th>Value Functions</Th>
                <Th>BWT</Th>
                <Th>PILE-BWT</Th>
                <Th></Th>
              </Tr>
            </Thead>
            <Tbody>
              {sessions.map((session) => (
                <Tr key={session._id} _hover={{ bg: 'gray.50' }}>
                  <Td>{session.name}</Td>
                  <Td>{formatDate(session.created_at)}</Td>
                  <Td>{session.criteria?.length || 0}</Td>
                  <Td>
                    <HStack spacing={2}>
                      <Tooltip
                        label={
                          session.session_locked
                            ? 'Session locked: all edits disabled; downloads allowed.'
                            : session.locked
                              ? 'Input locked: criteria edits disabled; other steps allowed.'
                              : 'Unlocked.'
                        }
                        hasArrow
                      >
                        <Badge
                          colorScheme={session.session_locked ? 'red' : session.locked ? 'orange' : 'green'}
                          display="inline-flex"
                          alignItems="center"
                          gap={1}
                        >
                          <Icon as={session.session_locked || session.locked ? LockIcon : UnlockIcon} boxSize={3} />
                          {session.session_locked ? 'Session' : session.locked ? 'Input' : 'Unlocked'}
                        </Badge>
                      </Tooltip>
                    </HStack>
                  </Td>
                  <Td>{session.qualitative_indicators !== null ? '✓' : '—'}</Td>
                  <Td>{session.value_functions !== null ? '✓' : '—'}</Td>
                  <Td>{session.bwt !== null ? '✓' : '—'}</Td>
                  <Td>{session.bwt !== null ? '✓' : '—'}</Td>
                  <Td>
                    <IconButton
                      aria-label="Open session menu"
                      icon={<SettingsIcon />}
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRowClick(session)}
                    />
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

      <Drawer isOpen={isDrawerOpen} placement="right" onClose={onDrawerClose} size="md">
        <DrawerOverlay />
        <DrawerContent>
          <DrawerCloseButton />
          <DrawerHeader>Session Details</DrawerHeader>
          <DrawerBody>
            {selectedSession ? (
              <VStack align="stretch" spacing={4}>
                <Box>
                  <Text fontSize="sm" color="gray.500" textAlign="left">Session Code</Text>
                  <Heading size="md" textAlign="left">{selectedSession.name}</Heading>
                </Box>
                <Text fontSize="sm" color="gray.500" textAlign="left">
                  Created {formatDate(selectedSession.created_at)}
                </Text>

                <Box as="hr" borderColor="gray.200" />

                <Box>
                  <Text fontSize="sm" color="gray.500" mb={2} textAlign="left">Locks</Text>
                  <VStack spacing={2} align="stretch">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleToggleInputLock(selectedSession._id)}
                      isDisabled={selectedSession.session_locked}
                      justifyContent="flex-start"
                    >
                      {selectedSession.session_locked
                        ? 'Input locked by session'
                        : (selectedSession.locked ? 'Unlock Input' : 'Lock Input')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleToggleSessionLock(selectedSession._id)}
                      justifyContent="flex-start"
                    >
                      {selectedSession.session_locked ? 'Unlock Session' : 'Lock Session'}
                    </Button>
                  </VStack>
                </Box>

                <Box as="hr" borderColor="gray.200" />

                <Box>
                  <Text fontSize="sm" color="gray.500" mb={2} textAlign="left">Downloads</Text>
                  <VStack spacing={2} align="stretch">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDownloadInput(selectedSession._id, selectedSession.name)}
                      justifyContent="flex-start"
                    >
                      Input
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDownloadOutput(selectedSession._id, selectedSession.name)}
                      justifyContent="flex-start"
                    >
                      Output
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDownloadBWT(selectedSession._id, selectedSession.name)}
                      justifyContent="flex-start"
                    >
                      BWT
                    </Button>
                  </VStack>
                </Box>

                <Box as="hr" borderColor="gray.200" />

                <Box>
                  <Text fontSize="sm" color="gray.500" mb={2} textAlign="left">Danger Zone</Text>
                  <Button
                    colorScheme="red"
                    size="sm"
                    onClick={() => handleDeleteClick(selectedSession._id)}
                    justifyContent="flex-start"
                  >
                    Delete Session
                  </Button>
                </Box>
              </VStack>
            ) : (
              <Text>Select a session to view details.</Text>
            )}
          </DrawerBody>
          <DrawerFooter>
            <Button variant="outline" onClick={onDrawerClose}>Close</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </Box>
  )
}

export default AdminPage
