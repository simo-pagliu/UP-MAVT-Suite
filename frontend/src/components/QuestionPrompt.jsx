import { Box } from '@chakra-ui/react'

function QuestionPrompt({ children, mb = 3 }) {
  return (
    <Box fontSize="md" color="gray.800" fontWeight="medium" lineHeight="tall" mb={mb}>
      {children}
    </Box>
  )
}

export default QuestionPrompt
