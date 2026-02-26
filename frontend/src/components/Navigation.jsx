import { Box, Button, Heading, HStack, IconButton, Menu, MenuButton, MenuItem, MenuList, Spacer } from '@chakra-ui/react'
import { ChevronDownIcon, SettingsIcon } from '@chakra-ui/icons'

function Navigation({
  activeRole,
  onRoleChange,
  currentPage,
  onPageChange,
  sessionId,
  studySessionId,
  isAdminView,
  onAdminToggle,
}) {
  const expertPages = [
    { id: 'session-access', label: 'Session Access' },
    { id: 'qualitative', label: 'Qualitative Indicators', requiresSession: true },
    { id: 'value', label: 'Value Functions', requiresSession: true },
    { id: 'pile', label: 'PILE-BWT', requiresSession: true },
    { id: 'recap', label: 'Recap', requiresSession: true },
  ]

  const practitionerPages = [
    { id: 'case-study', label: 'Case Study' },
    { id: 'input-definition', label: 'Input Definition', requiresStudy: true },
    { id: 'run-up-mavt', label: 'Run UP-MAVT', requiresStudy: true },
  ]

  const pages = activeRole === 'expert' ? expertPages : practitionerPages
  const roleLabel = activeRole === 'expert' ? 'Expert' : 'Practitioner'

  return (
    <Box as="header" bg="blue.700" color="white" px={8} py={4} boxShadow="none">
      <HStack spacing={6} align="center" wrap="wrap">
        <Heading size="md" letterSpacing="wide">UP-MAVT</Heading>
        <Menu>
          <MenuButton
            as={Button}
            size="sm"
            variant="outline"
            borderColor="whiteAlpha.700"
            color="white"
            rightIcon={<ChevronDownIcon />}
            _hover={{ bg: 'blue.600', borderColor: 'whiteAlpha.800' }}
            _active={{ bg: 'blue.600', borderColor: 'whiteAlpha.800' }}
          >
            {roleLabel}
          </MenuButton>
          <MenuList bg="blue.700" color="white" borderColor="blue.600" boxShadow="none">
            <MenuItem
              bg="blue.700"
              _hover={{ bg: 'blue.600', color: 'white' }}
              _focus={{ bg: 'blue.600', color: 'white' }}
              onClick={() => onRoleChange('expert')}
            >
              Expert
            </MenuItem>
            <MenuItem
              bg="blue.700"
              _hover={{ bg: 'blue.600', color: 'white' }}
              _focus={{ bg: 'blue.600', color: 'white' }}
              onClick={() => onRoleChange('practitioner')}
            >
              Practitioner
            </MenuItem>
          </MenuList>
        </Menu>
        <HStack as="nav" spacing={2} overflowX="auto">
          {pages.map((page) => {
            const isDisabled =
              (page.requiresSession && !sessionId) ||
              (page.requiresStudy && !studySessionId)
            const isActive = !isAdminView && currentPage === page.id
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
        <Spacer />
        <IconButton
          aria-label="Admin"
          icon={<SettingsIcon />}
          variant={isAdminView ? 'solid' : 'ghost'}
          bg={isAdminView ? 'white' : 'transparent'}
          color={isAdminView ? 'blue.700' : 'white'}
          _hover={{ bg: isAdminView ? 'white' : 'blue.600', color: 'white' }}
          _active={{ bg: isAdminView ? 'white' : 'blue.600', color: 'white' }}
          size="sm"
          onClick={onAdminToggle}
        />
      </HStack>
    </Box>
  )
}

export default Navigation
