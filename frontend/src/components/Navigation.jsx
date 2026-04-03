import { Box, Button, Heading, HStack, IconButton, Image, Spacer } from '@chakra-ui/react'
import { InfoIcon } from '@chakra-ui/icons'

function Navigation({
  isLoggedIn,
  currentRole,
  currentPage,
  onPageChange,
  sessionId,
  studySessionId,
  features = { qi: false, vf: false, bwt: false },
  onLogout,
  onDocumentation,
}) {
  const baseStakeholderPages = [
    { id: 'recap', label: 'Overview', requiresSession: true },
    { id: 'qualitative', label: 'Qualitative Indicators', requiresSession: true, featureKey: 'qi' },
    { id: 'value', label: 'Quantitative Indicators', requiresSession: true, featureKey: 'vf' },
    { id: 'pile', label: 'Weights', requiresSession: true, featureKey: 'bwt' },
  ]

  // Filter pages based on enabled features
  const stakeholderPages = baseStakeholderPages.filter(page => {
    if (page.featureKey) {
      return features[page.featureKey]
    }
    return true // Overview always shown
  })

  const practitionerPages = [
    { id: 'input-definition', label: 'Input Definition', requiresStudy: true },
    { id: 'case-study', label: 'Manage Case Studies' },
    { id: 'run-up-mavt', label: 'Run UP-MAVT', requiresStudy: true },
  ]

  const pages = currentRole === 'stakeholder' ? stakeholderPages : practitionerPages

  return (
    <Box
      as="header"
      bg="#0f3155"
      color="white"
      px={{ base: 4, md: 8 }}
      py={4}
      boxShadow="sm"
    >
      <HStack spacing={6} align="center" wrap="wrap">
        <HStack spacing={3} align="center">
          <Image
            src="/psi_01_sn.svg"
            alt="PSI logo"
            boxSize={{ base: '34px', md: '40px' }}
            objectFit="contain"
          />
          <Heading size="md" letterSpacing="wide">UP-MAVT Suite</Heading>
        </HStack>
        
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
        ) : null}
      </HStack>
    </Box>
  )
}

export default Navigation
