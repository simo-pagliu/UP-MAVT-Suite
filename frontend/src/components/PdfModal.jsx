import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  Box,
  Button,
  Text,
  VStack,
} from '@chakra-ui/react'
import { ExternalLinkIcon } from '@chakra-ui/icons'
import { useIsMobile } from '../hooks/useIsMobile'

function PdfModal({ isOpen, onClose, pdfUrl, title }) {
  const isMobile = useIsMobile()

  // Mobile browsers mostly cannot render a PDF inside an iframe (blank page or
  // first page only), so offer to open it in the browser's own viewer instead.
  if (isMobile) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} size="full">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader pr={12}>{title}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack spacing={4} align="stretch" py={4}>
              <Text color="gray.600">
                This document opens in your browser&apos;s PDF viewer.
              </Text>
              <Button
                as="a"
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                colorScheme="blue"
                rightIcon={<ExternalLinkIcon />}
              >
                Open PDF
              </Button>
            </VStack>
          </ModalBody>
        </ModalContent>
      </Modal>
    )
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="6xl" isCentered>
      <ModalOverlay />
      <ModalContent maxW="90vw" maxH="90vh">
        <ModalHeader>{title}</ModalHeader>
        <ModalCloseButton />
        <ModalBody p={0}>
          <Box height="80vh" width="100%">
            <iframe
              src={pdfUrl}
              style={{
                width: '100%',
                height: '100%',
                border: 'none',
              }}
              title={title}
            />
          </Box>
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}

export default PdfModal
