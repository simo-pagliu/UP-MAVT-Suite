import { Box, Button, Heading, VStack, Input, FormControl, FormLabel, useToast } from '@chakra-ui/react'
import axios from 'axios'
import { useState } from 'react'

const API_URL = 'http://localhost:5000/api'

function ValueFunctionsPage({ sessionId }) {
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(false)
  const toast = useToast()

  const handleSubmit = async () => {
    if (value === '') {
      toast({
        title: 'Error',
        description: 'Please enter a number',
        status: 'error',
        duration: 3,
        isClosable: true,
      })
      return
    }

    setLoading(true)
    try {
      await axios.put(`${API_URL}/session/${sessionId}/value`, {
        value: parseFloat(value)
      })
      toast({
        title: 'Success',
        description: 'Data saved',
        status: 'success',
        duration: 2,
        isClosable: true,
      })
      setValue('')
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to save',
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
        <Heading as="h1" size="lg">Value Functions</Heading>
        <FormControl>
          <FormLabel>Enter a number</FormLabel>
          <Input
            type="number"
            placeholder="0"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </FormControl>
        <Button
          colorScheme="blue"
          isLoading={loading}
          onClick={handleSubmit}
        >
          Save & Continue
        </Button>
      </VStack>
    </Box>
  )
}

export default ValueFunctionsPage
