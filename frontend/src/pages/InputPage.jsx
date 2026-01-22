import { Box, Button, Heading, VStack, Input, FormControl, FormLabel, useToast } from '@chakra-ui/react'
import axios from 'axios'
import { useState } from 'react'

const API_URL = 'http://localhost:5000/api'

function InputPage({ onSessionCreated }) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const toast = useToast()

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a name',
        status: 'error',
        duration: 3,
        isClosable: true,
      })
      return
    }

    setLoading(true)
    try {
      const response = await axios.post(`${API_URL}/session`, { name })
      toast({
        title: 'Success',
        description: 'Session created',
        status: 'success',
        duration: 2,
        isClosable: true,
      })
      onSessionCreated(response.data.session_id)
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
          <Input
            placeholder="Enter your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </FormControl>
        <Button
          colorScheme="blue"
          isLoading={loading}
          onClick={handleSubmit}
        >
          Continue
        </Button>
      </VStack>
    </Box>
  )
}

export default InputPage
