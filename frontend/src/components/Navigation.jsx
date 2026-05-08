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
  onLogoClick,
}) {
  const baseStakeholderPages = [
    { id: 'recap', label: 'Overview', requiresSession: true },
    { id: 'qualitative', label: 'Qualitative Indicators', requiresSession: true, featureKey: 'qi' },
    { id: 'value', label: 'Quantitative', requiresSession: true, featureKey: 'vf' },
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
    { id: 'case-study', label: 'Manage Elicitation Session' },
    { id: 'run-up-mavt', label: 'Run UP-MAVT', requiresStudy: true },
  ]

  const pages = currentRole === 'stakeholder' ? stakeholderPages : practitionerPages

  return (
    <Box
      as="header"
      bg="app.primary"
      color="white"
      px={{ base: 3, md: 4 }}
      py={3}
      boxShadow="md"
      borderBottomWidth="1px"
      borderBottomColor="whiteAlpha.200"
    >
      <HStack spacing={6} align="center" wrap="wrap">
        <Button
          variant="unstyled"
          onClick={onLogoClick}
          display="flex"
          alignItems="center"
          justifyContent="flex-start"
          gap={3}
          _hover={{ opacity: 0.8 }}
          cursor="pointer"
        >
          <Image
            src="/psi_01_sn.svg"
            alt="PSI logo"
            h="38px"
            w="auto"
            maxW="150px"
            objectFit="contain"
            borderRadius="4px"
          />
          <Heading
            size="md"
            letterSpacing="0"
            color="white"
            lineHeight="1"
            mt="3px"
          >
            UP-MAVT Suite
          </Heading>
        </Button>
        
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
                    variant="ghost"
                    bg={isActive ? 'whiteAlpha.200' : 'transparent'}
                    color={isActive ? 'white' : 'whiteAlpha.800'}
                    _hover={{ bg: 'whiteAlpha.200', color: 'white' }}
                    _active={{ bg: 'whiteAlpha.200', color: 'white' }}
                    size="sm"
                    borderRadius="6px"
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
        
        {currentRole !== 'admin' && (
          <IconButton
            aria-label="Documentation"
            icon={<InfoIcon />}
            variant="ghost"
            color="white"
            _hover={{ bg: 'whiteAlpha.200', color: 'white' }}
            _active={{ bg: 'whiteAlpha.200', color: 'white' }}
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
            _hover={{ bg: 'whiteAlpha.200', borderColor: 'whiteAlpha.800' }}
            _active={{ bg: 'whiteAlpha.200', borderColor: 'whiteAlpha.800' }}
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
