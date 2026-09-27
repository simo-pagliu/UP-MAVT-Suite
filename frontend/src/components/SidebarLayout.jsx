import { useEffect, useRef } from 'react'
import {
  Box,
  Button,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerOverlay,
  Flex,
  Text,
  useDisclosure,
} from '@chakra-ui/react'
import { HamburgerIcon } from '@chakra-ui/icons'
import { useIsMobile } from '../hooks/useIsMobile'

/**
 * Two-pane shell shared by the elicitation pages (list of items on the left,
 * work area on the right).
 *
 * Desktop: fixed 320px sidebar next to the main area, each scrolling on its own.
 * Mobile: one column with normal page scroll. While nothing is selected the list
 * is shown inline; once something is selected it moves into a Drawer opened
 * from a sticky "list" button, and the Drawer closes whenever `activeKey` changes.
 *
 * @param {string}    title       Name of the list, shown on the mobile list button.
 * @param {ReactNode} sidebar     Sidebar content (rendered in the pane or the Drawer).
 * @param {*}         activeKey   Identifies the current selection; null/undefined = none.
 * @param {string}    activeLabel Human label of the current selection (mobile button).
 * @param {object}    mainRef     Optional ref attached to the main area.
 */
function SidebarLayout({ title, sidebar, activeKey, activeLabel, mainRef, children }) {
  const isMobile = useIsMobile()
  const { isOpen, onOpen, onClose } = useDisclosure()
  const previousKeyRef = useRef(activeKey)

  useEffect(() => {
    if (previousKeyRef.current === activeKey) return
    previousKeyRef.current = activeKey
    onClose()
    // On mobile the whole page scrolls, so bring the new selection into view.
    if (isMobile) window.scrollTo({ top: 0 })
  }, [activeKey, isMobile, onClose])

  const hasSelection = activeKey !== null && activeKey !== undefined

  let sidebarSlot
  if (!isMobile) {
    sidebarSlot = (
      <Box
        w="320px"
        flexShrink={0}
        bg="gray.100"
        p={4}
        borderRight="1px"
        borderColor="gray.300"
        maxH="100vh"
        overflowY="auto"
      >
        {sidebar}
      </Box>
    )
  } else if (hasSelection) {
    sidebarSlot = (
      <Box position="sticky" top={0} zIndex="sticky" bg="app.bg" py={2} mt={-2}>
        <Button
          onClick={onOpen}
          leftIcon={<HamburgerIcon />}
          variant="outline"
          size="sm"
          w="100%"
          justifyContent="flex-start"
          bg="white"
        >
          <Text as="span" isTruncated>
            {title}{activeLabel ? `: ${activeLabel}` : ''}
          </Text>
        </Button>
      </Box>
    )
  } else {
    sidebarSlot = (
      <Box bg="gray.100" p={4} borderRadius="md" borderWidth="1px" borderColor="gray.200">
        {sidebar}
      </Box>
    )
  }

  // One element tree for both layouts: the main area keeps its position, so crossing the
  // breakpoint (e.g. rotating a tablet) does not remount the page and lose in-progress input.
  return (
    <Flex
      direction={isMobile ? 'column' : 'row'}
      align="stretch"
      gap={isMobile ? 4 : 0}
      h={isMobile ? 'auto' : '100vh'}
      overflow={isMobile ? 'visible' : 'hidden'}
    >
      {sidebarSlot}

      <Box
        ref={mainRef}
        flex={isMobile ? 'none' : 1}
        minW={0}
        bg={isMobile ? undefined : 'white'}
        p={isMobile ? 0 : 4}
        maxH={isMobile ? 'none' : '100vh'}
        overflowY={isMobile ? 'visible' : 'auto'}
      >
        {children}
      </Box>

      {isMobile && (
        <Drawer isOpen={isOpen} placement="left" onClose={onClose} size="sm">
          <DrawerOverlay />
          <DrawerContent bg="gray.100">
            <DrawerCloseButton />
            <DrawerBody px={4} pt={12} pb={6}>
              {sidebar}
            </DrawerBody>
          </DrawerContent>
        </Drawer>
      )}
    </Flex>
  )
}

export default SidebarLayout
