import { HStack, Button, Heading } from '@chakra-ui/react'

function Navigation({ currentPage, onPageChange, sessionId }) {
  const pages = [
    { id: 'input', label: 'Input' },
    { id: 'qualitative', label: 'Qualitative Indicators', requiresSession: true },
    { id: 'value', label: 'Value Functions', requiresSession: true },
    { id: 'pile', label: 'PILE-BWT', requiresSession: true },
    { id: 'output', label: 'Output' },
    { id: 'admin', label: 'Admin' },
  ]

  return (
    <HStack as="nav" bg="blue.600" color="white" px={8} py={4} spacing={4} overflowX="auto">
      {pages.map((page) => {
        const isDisabled = page.requiresSession && !sessionId
        return (
          <Button
            key={page.id}
            variant={currentPage === page.id ? 'solid' : 'ghost'}
            colorScheme={currentPage === page.id ? 'whiteAlpha' : undefined}
            size="sm"
            onClick={() => onPageChange(page.id)}
            whiteSpace="nowrap"
            isDisabled={isDisabled}
            opacity={isDisabled ? 0.4 : 1}
            cursor={isDisabled ? 'not-allowed' : 'pointer'}
          >
            {page.label}
          </Button>
        )
      })}
    </HStack>
  )
}

export default Navigation
