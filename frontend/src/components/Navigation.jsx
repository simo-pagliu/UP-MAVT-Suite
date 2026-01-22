import { HStack, Button, Heading } from '@chakra-ui/react'

function Navigation({ currentPage, onPageChange }) {
  const pages = [
    { id: 'input', label: 'Input' },
    { id: 'qualitative', label: 'Qualitative Indicators' },
    { id: 'value', label: 'Value Functions' },
    { id: 'pile', label: 'PILE-BWT' },
    { id: 'output', label: 'Output' },
  ]

  return (
    <HStack as="nav" bg="blue.600" color="white" px={8} py={4} spacing={4} overflowX="auto">
      {pages.map((page) => (
        <Button
          key={page.id}
          variant={currentPage === page.id ? 'solid' : 'ghost'}
          colorScheme={currentPage === page.id ? 'whiteAlpha' : undefined}
          size="sm"
          onClick={() => onPageChange(page.id)}
          whiteSpace="nowrap"
        >
          {page.label}
        </Button>
      ))}
    </HStack>
  )
}

export default Navigation
