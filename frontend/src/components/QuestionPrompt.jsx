import { Text } from '@chakra-ui/react'

function QuestionPrompt({ children, mb = 3 }) {
  return (
    <Text fontSize="md" color="gray.800" fontWeight="medium" lineHeight="tall" mb={mb}>
      {children}
    </Text>
  )
}

export default QuestionPrompt
