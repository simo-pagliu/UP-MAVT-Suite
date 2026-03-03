import { Box, Button, Heading, HStack, IconButton, Menu, MenuButton, MenuItem, MenuList, Spacer } from '@chakra-ui/react'
import { InfoIcon } from '@chakra-ui/icons'

function Navigation({
  isLoggedIn,
  currentRole,
  currentPage,
  onPageChange,
  sessionId,
  studySessionId,
  onLogin,
  onLogout,
  onDocumentation,
}) {
  const stakeholderPages = [
    { id: 'qualitative', label: 'Qualitative Indicators', requiresSession: true },
    { id: 'value', label: 'Value Functions', requiresSession: true },
    { id: 'pile', label: 'PILE-BWT', requiresSession: true },
    { id: 'recap', label: 'Recap', requiresSession: true },
  ]

  const practitionerPages = [
    { id: 'case-study', label: 'Manage Case Studies' },
    { id: 'input-definition', label: 'Input Definition', requiresStudy: true },
    { id: 'run-up-mavt', label: 'Run UP-MAVT', requiresStudy: true },
  ]

  const pages = currentRole === 'stakeholder' ? stakeholderPages : practitionerPages

  return (
    <Box as="header" bg="blue.700" color="white" px={8} py={4} boxShadow="none">
      <HStack spacing={6} align="center" wrap="wrap">
        <Heading size="md" letterSpacing="wide">UP-MAVT Suite</Heading>
        
        {isLoggedIn && currentRole !== 'admin' && (
          <>
            <HStack as="nav" spacing={2} overflowX="auto">
              {pages.map((page) => {
                const isDisabled =
                  (page.requiresSession && !sessionId) ||
                  (page.requiresStudy && !studySessionId)
                const isActive = currentPage === page.id
                return (
                  <Button
                    key={page.id}
                    variant={isActive ? 'solid' : 'ghost'}
                    bg={isActive ? 'white' : 'transparent'}
                    color={isActive ? 'blue.700' : 'white'}
                    _hover={{ bg: isActive ? 'white' : 'blue.600', color: isActive ? 'blue.700' : 'white' }}
                    _active={{ bg: isActive ? 'white' : 'blue.600', color: isActive ? 'blue.700' : 'white' }}
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
          </>
        )}
        
        <Spacer />
        
        {isLoggedIn && currentRole !== 'admin' && (
          <IconButton
            aria-label="Documentation"
            icon={<InfoIcon />}
            variant="ghost"
            color="white"
            _hover={{ bg: 'blue.600', color: 'white' }}
            _active={{ bg: 'blue.600', color: 'white' }}
            size="sm"
            onClick={onDocumentation}
          />
        )}
        
        {isLoggedIn ? (
          <Button
            size="sm"
            variant="outline"
            borderColor="whiteAlpha.700"
            color="white"
            _hover={{ bg: 'blue.600', borderColor: 'whiteAlpha.800' }}
            _active={{ bg: 'blue.600', borderColor: 'whiteAlpha.800' }}
            onClick={onLogout}
          >
            Logout
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            borderColor="whiteAlpha.700"
            color="white"
            _hover={{ bg: 'blue.600', borderColor: 'whiteAlpha.800' }}
            _active={{ bg: 'blue.600', borderColor: 'whiteAlpha.800' }}
            onClick={onLogin}
          >
            Login
          </Button>
        )}
      </HStack>
    </Box>
  )
}

export default Navigation
