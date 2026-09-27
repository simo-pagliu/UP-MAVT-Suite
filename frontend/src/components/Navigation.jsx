import {
  Box,
  Button,
  Divider,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  Heading,
  HStack,
  IconButton,
  Image,
  Spacer,
  VStack,
  useDisclosure,
} from '@chakra-ui/react'
import { HamburgerIcon, InfoIcon } from '@chakra-ui/icons'
import { useIsMobile } from '../hooks/useIsMobile'

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
  const isMobile = useIsMobile()
  const menu = useDisclosure()

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
  const showPages = isLoggedIn && currentRole !== 'admin'

  /**
   * Renders one page button. The header variant is light-on-blue; the drawer
   * variant is a full-width row on the white drawer surface.
   */
  const renderPageButton = (page, inDrawer = false) => {
    const isDisabled =
      (page.requiresSession && !sessionId) ||
      (page.requiresStudy && !studySessionId)
    const isActive = currentPage === page.id
    const colors = inDrawer
      ? {
          bg: isActive ? 'app.primarySoft' : 'transparent',
          color: 'app.primaryDark',
          _hover: { bg: 'app.primarySoft' },
          _active: { bg: 'app.primarySoft' },
        }
      : {
          bg: isActive ? 'whiteAlpha.200' : 'transparent',
          color: isActive ? 'white' : 'whiteAlpha.800',
          _hover: { bg: 'whiteAlpha.200', color: 'white' },
          _active: { bg: 'whiteAlpha.200', color: 'white' },
        }
    return (
      <Button
        key={page.id}
        variant="ghost"
        {...colors}
        size={inDrawer ? 'md' : 'sm'}
        borderRadius="6px"
        justifyContent={inDrawer ? 'flex-start' : 'center'}
        w={inDrawer ? '100%' : 'auto'}
        onClick={() => {
          onPageChange(page.id)
          if (inDrawer) menu.onClose()
        }}
        whiteSpace="nowrap"
        isDisabled={isDisabled}
        opacity={isDisabled ? 0.4 : 1}
        cursor={isDisabled ? 'not-allowed' : 'pointer'}
        aria-current={isActive ? 'page' : undefined}
      >
        {page.label}
      </Button>
    )
  }

  const logoutButton = (
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
  )

  return (
    <Box
      as="header"
      bg="app.primary"
      color="white"
      px={{ base: 3, md: 4 }}
      py={{ base: 2, lg: 3 }}
      boxShadow="md"
      borderBottomWidth="1px"
      borderBottomColor="whiteAlpha.200"
    >
      <HStack spacing={{ base: 2, lg: 6 }} align="center" wrap={isMobile ? 'nowrap' : 'wrap'}>
        <Button
          variant="unstyled"
          onClick={onLogoClick}
          display="flex"
          alignItems="center"
          justifyContent="flex-start"
          gap={{ base: 2, lg: 3 }}
          minW={0}
          _hover={{ opacity: 0.8 }}
          cursor="pointer"
        >
          <Image
            src="/psi_01_sn.svg"
            alt="PSI logo"
            h={{ base: '30px', lg: '38px' }}
            w="auto"
            maxW="150px"
            objectFit="contain"
            borderRadius="4px"
          />
          <Heading
            size={{ base: 'sm', lg: 'md' }}
            letterSpacing="0"
            color="white"
            lineHeight="1"
            mt="3px"
            whiteSpace="nowrap"
          >
            UP-MAVT Suite
          </Heading>
        </Button>

        {showPages && !isMobile && (
          <HStack as="nav" spacing={2} overflowX="auto">
            {pages.map((page) => renderPageButton(page))}
          </HStack>
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

        {showPages && isMobile ? (
          <IconButton
            aria-label="Open menu"
            icon={<HamburgerIcon boxSize={5} />}
            variant="ghost"
            color="white"
            _hover={{ bg: 'whiteAlpha.200', color: 'white' }}
            _active={{ bg: 'whiteAlpha.200', color: 'white' }}
            size="md"
            onClick={menu.onOpen}
          />
        ) : (
          isLoggedIn && logoutButton
        )}
      </HStack>

      {showPages && isMobile && (
        <Drawer isOpen={menu.isOpen} placement="right" onClose={menu.onClose} size="xs">
          <DrawerOverlay />
          <DrawerContent>
            <DrawerCloseButton />
            <DrawerHeader borderBottomWidth="1px" borderColor="app.border" color="app.primaryDark">
              Menu
            </DrawerHeader>
            <DrawerBody px={3} py={4}>
              <VStack as="nav" align="stretch" spacing={1}>
                {pages.map((page) => renderPageButton(page, true))}
              </VStack>
            </DrawerBody>
            <Divider />
            <DrawerFooter px={3}>
              <Button
                w="100%"
                variant="outline"
                onClick={() => {
                  menu.onClose()
                  onLogout()
                }}
              >
                Logout
              </Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      )}
    </Box>
  )
}

export default Navigation
