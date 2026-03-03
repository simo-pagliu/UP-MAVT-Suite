import { Box, Heading, VStack, Text } from '@chakra-ui/react'

function DocumentationPage() {
  return (
    <Box bg="white" p={8} borderRadius="lg" boxShadow="sm">
      <VStack spacing={4} align="start">
        <Heading as="h1" size="lg">
          Documentation
        </Heading>
        <Text fontSize="md" color="gray.600">
          Documentation coming soon. Check back later for comprehensive guides and tutorials.
        </Text>
      </VStack>
    </Box>
  )
}

export default DocumentationPage
