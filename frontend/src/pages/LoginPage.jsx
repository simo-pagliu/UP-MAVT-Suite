import {
  Box,
  Button,
  Divider,
  FormLabel,
  Grid,
  GridItem,
  Heading,
  HStack,
  Input,
  Link,
  SimpleGrid,
  Text,
  VStack,
  useToast,
} from '@chakra-ui/react'
import axios from 'axios'
import { useRef, useState } from 'react'
import { API_URL } from '../config'

function LoginPage({ onLogin, onDocumentation }) {
  const [code, setCode] = useState('')
  const [email, setEmail] = useState('')
  const [entryValue, setEntryValue] = useState('')
  const [verificationCodeSent, setVerificationCodeSent] = useState(false)
  const [isEmailVerified, setIsEmailVerified] = useState(false)
  const [verificationToken, setVerificationToken] = useState('')
  const [verificationError, setVerificationError] = useState('')
  const [loading, setLoading] = useState(false)
  const [verificationLoading, setVerificationLoading] = useState(false)
  const uploadFileRef = useRef(null)
  const toast = useToast()

  const validateEmailInput = (value) => {
    if (!String(value || '').trim()) {
      toast({
        title: 'Request failed',
        description: 'Please enter an email address',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
      return false
    }
    return true
  }

  const handleDetectAndLogin = async () => {
    if (!code.trim()) {
      toast({
        title: 'Request failed',
        description: 'Please enter a session UUID',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
      return
    }

    // Check for admin access
    if (code.trim().toLowerCase() === 'admin') {
      onLogin(null, 'admin', 'admin')
      toast({
        title: 'Admin access',
        description: 'Welcome to admin panel',
        status: 'success',
        duration: 2000,
        isClosable: true,
      })
      return
    }

    setLoading(true)
    try {
      const response = await axios.get(`${API_URL}/session/detect/${encodeURIComponent(code)}`)
      const data = response.data

      if (!data.exists) {
        toast({
          title: 'Not found',
          description: 'No session found for this UUID',
          status: 'error',
          duration: 3000,
          isClosable: true,
        })
        setLoading(false)
        return
      }

      // Login with detected type
      onLogin(data._id, data._id, data.type)
      toast({
        title: 'Session loaded',
        description: `${data.type === 'stakeholder' ? 'Stakeholder' : 'Practitioner'} session ready`,
        status: 'success',
        duration: 2000,
        isClosable: true,
      })
    } catch (error) {
      toast({
        title: 'Request failed',
        description: error.response?.data?.error || 'Failed to access session',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
      setLoading(false)
    }
  }

  const handleCreatePractitionerSession = async () => {
    if (!email.trim()) {
      setVerificationError('Enter and verify your email before creating the case study.')
      return
    }
    if (!isEmailVerified || !verificationToken) {
      setVerificationError('Verify the email code before creating the case study.')
      return
    }
    setLoading(true)
    try {
      const response = await axios.post(`${API_URL}/study-session`, {
        auto_generate: true,
        creator_email: email.trim(),
        email_verification_token: verificationToken,
      })
      const createdStudyId = response.data?.study_session_id || ''
      onLogin(createdStudyId, createdStudyId, 'practitioner')
      toast({
        title: 'Study session created',
        description: `Study ID: ${createdStudyId}`,
        status: 'success',
        duration: 3000,
        isClosable: true,
      })
    } catch (error) {
      toast({
        title: 'Request failed',
        description: error.response?.data?.error || 'Failed to create study session',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      setLoading(false)
    }
  }

  const handleUploadCaseStudy = async () => {
    if (!email.trim() || !isEmailVerified) {
      setVerificationError('Verify your email before uploading a case study backup.')
      return
    }

    const file = uploadFileRef.current?.files?.[0]
    if (!file) return

    setLoading(true)
    const formData = new FormData()
    formData.append('file', file)
    formData.append('contact_email', email.trim())

    try {
      const response = await axios.post(
        `${API_URL}/study-session/backup/import?on_conflict=regenerate&preserve_creator_email=0`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      )
      const importedStudyId = response.data?.study_session_id || ''
      onLogin(importedStudyId, importedStudyId, 'practitioner')
      toast({
        title: 'Case study uploaded',
        description: `Study ID: ${importedStudyId}`,
        status: 'success',
        duration: 3000,
        isClosable: true,
      })
    } catch (error) {
      toast({
        title: 'Request failed',
        description: error.response?.data?.error || 'Failed to upload case study',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      if (uploadFileRef.current) {
        uploadFileRef.current.value = ''
      }
      setLoading(false)
    }
  }

  const resetEmailVerificationState = () => {
    setEntryValue('')
    setVerificationCodeSent(false)
    setIsEmailVerified(false)
    setVerificationToken('')
    setVerificationError('')
  }

  const handleBack = () => {
    setEmail('')
    resetEmailVerificationState()
  }

  const handleSendVerificationCode = async () => {
    if (!validateEmailInput(entryValue)) return

    const normalizedEmail = String(entryValue || '').trim()

    setVerificationLoading(true)
    setVerificationError('')
    try {
      await axios.post(`${API_URL}/email-verification/request`, {
        email: normalizedEmail,
      })
      setEmail(normalizedEmail)
      setEntryValue('')
      setVerificationCodeSent(true)
      setIsEmailVerified(false)
      setVerificationToken('')
    } catch (error) {
      setVerificationError(error.response?.data?.error || 'Failed to send verification code')
    } finally {
      setVerificationLoading(false)
    }
  }

  const handleConfirmVerificationCode = async () => {
    if (!email.trim()) {
      setVerificationError('Email missing. Click Back and enter your email again.')
      return
    }
    if (!entryValue.trim()) {
      setVerificationError('Enter the 6-digit verification code.')
      return
    }

    setVerificationLoading(true)
    setVerificationError('')
    try {
      const response = await axios.post(`${API_URL}/email-verification/confirm`, {
        email: email.trim(),
        code: entryValue.trim(),
      })
      setIsEmailVerified(true)
      setVerificationToken(response.data?.verification_token || '')
      setEntryValue(email)
    } catch (error) {
      setIsEmailVerified(false)
      setVerificationToken('')
      setVerificationError(error.response?.data?.error || 'Invalid verification code')
    } finally {
      setVerificationLoading(false)
    }
  }

  const getPrimaryActionLabel = () => {
    if (!verificationCodeSent) return 'Send code'
    if (!isEmailVerified) return 'Verify code'
    return 'Create case study'
  }

  const getPrimaryInstruction = () => {
    if (!verificationCodeSent) {
      return 'Enter your email, then click the button to send a verification code.'
    }
    if (!isEmailVerified) {
      return 'Enter the verification code you received, then click the button to verify.'
    }
    return 'Choose whether to create a new case study or upload an existing ZIP backup.'
  }

  const handlePrimaryAction = async () => {
    if (!verificationCodeSent) {
      await handleSendVerificationCode()
      return
    }
    if (!isEmailVerified) {
      await handleConfirmVerificationCode()
      return
    }
    await handleCreatePractitionerSession()
  }

  return (
    <Box minH={{ base: 'calc(100vh - 68px)', md: 'calc(100vh - 72px)' }} display="flex" flexDirection="column">
      <Grid templateColumns={{ base: '1fr', lg: '1.2fr 1fr' }} flex="1">
        <GridItem p={{ base: 6, md: 10 }} bg="white">
          <VStack align="stretch" spacing={6}>
            <VStack align="stretch" spacing={3}>
              <Heading size="xl" lineHeight="1.2">
                UP-MAVT Suite
              </Heading>
              <Text color="gray.700" fontSize="lg">
                A complete solution for multi-criteria group decision analysis under uncertainty
              </Text>
            </VStack>

            <SimpleGrid columns={1} spacing={4}>
              <Box bg="blue.50" borderRadius="md" p={4} borderWidth={1} borderColor="blue.100">
                <Text fontWeight="semibold" mb={1}>1. Define context</Text>
                <Text fontSize="sm" color="gray.600">
                  Practitioners create a case study and define the indicator structure.
                </Text>
              </Box>
              <Box bg="blue.50" borderRadius="md" p={4} borderWidth={1} borderColor="blue.100">
                <Text fontWeight="semibold" mb={1}>2. Elicit preferences</Text>
                <Text fontSize="sm" color="gray.600">
                  Stakeholders complete Qualitative Indicators, Quantitative Indicators, and Weight Elicitation steps.
                </Text>
              </Box>
              <Box bg="blue.50" borderRadius="md" p={4} borderWidth={1} borderColor="blue.100">
                <Text fontWeight="semibold" mb={1}>3. Review outcomes</Text>
                <Text fontSize="sm" color="gray.600">
                  The team compares results and consolidates evidence for final decisions.
                </Text>
              </Box>
            </SimpleGrid>

            <HStack spacing={5} wrap="wrap">
              <Link
                href="https://example.org/publication-upmavt"
                isExternal
                color="blue.700"
                fontWeight="semibold"
              >
                Read the publication (placeholder)
              </Link>
            </HStack>
            <VStack align="start" spacing={1}>
              <Text fontWeight="semibold">Example case studies</Text>
              <Link href={`${API_URL}/example-case-study/1`} color="blue.700">
                Download example case study 1
              </Link>
              <Link href={`${API_URL}/example-case-study/2`} color="blue.700">
                Download example case study 2
              </Link>
            </VStack>
          </VStack>
        </GridItem>

        <GridItem p={{ base: 6, md: 10 }} bg="white">
          <VStack spacing={6} align="stretch">
            <Box>
              <Heading size="md" mb={2}>Access Existing Session</Heading>
              <Text color="gray.600" fontSize="sm">
                Enter your session UUID to continue elicitation, or create a new case study if you are
                initiating a practitioner workflow.
              </Text>
            </Box>

            <Box>
              <FormLabel fontWeight="medium" mb={2}>
                Session UUID
              </FormLabel>
              <HStack spacing={3}>
                <Input
                  placeholder="Enter session UUID"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleDetectAndLogin()}
                  isDisabled={loading}
                  bg="white"
                  w="50%"
                />
                <Button colorScheme="blue" isLoading={loading} onClick={handleDetectAndLogin} w="50%">
                  Access session
                </Button>
              </HStack>
            </Box>

            <Divider />

            <VStack spacing={3} align="stretch">
              <Heading size="sm">Create New Case Study</Heading>
              <Text color="gray.600" fontSize="sm">
                No account is created in this process. Your email is used only for essential case-study
                notifications (session confirmation, elicitation progress, completion alerts, and inactivity
                warnings) and to send you a backup copy of your data before it is deleted. Your email address
                is stored on servers operated by the Paul Scherrer Institute (PSI) in Switzerland and is
                automatically and permanently deleted together with all case-study data after{' '}
                <strong>12 months of inactivity</strong>. Processing is performed in accordance with the EU
                General Data Protection Regulation (GDPR) and the Swiss Federal Act on Data Protection
                (nFADP). You may request erasure at any time by contacting the PSI data protection officer
                via the privacy notice linked in the footer.
              </Text>

              <Text color="gray.600" fontSize="sm">
                {getPrimaryInstruction()}
              </Text>
              {!isEmailVerified && (
                <Input
                  placeholder={!verificationCodeSent ? 'Email address' : 'Verification code'}
                  value={entryValue}
                  onChange={(e) => {
                    const nextValue = e.target.value
                    setEntryValue(nextValue)
                    setVerificationError('')

                    if (!verificationCodeSent) {
                      setEmail(nextValue)
                      resetEmailVerificationState()
                      setEntryValue(nextValue)
                    }
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handlePrimaryAction()}
                  isDisabled={loading || verificationLoading}
                  bg="white"
                />
              )}
              {isEmailVerified && (
                <Text color="green.700" fontSize="sm">
                  Verified email: {email}
                </Text>
              )}
              {verificationError && (
                <Text color="red.600" fontSize="sm">
                  {verificationError}
                </Text>
              )}
              <HStack spacing={3}>
                {verificationCodeSent && !isEmailVerified && (
                  <Button
                    variant="ghost"
                    onClick={handleBack}
                    isDisabled={loading || verificationLoading}
                    w="50%"
                  >
                    Back
                  </Button>
                )}
                {isEmailVerified && (
                  <Button
                    variant="outline"
                    colorScheme="blue"
                    onClick={() => uploadFileRef.current?.click()}
                    isDisabled={loading || verificationLoading}
                    w="50%"
                  >
                    Upload case study (.zip)
                  </Button>
                )}
                <Button
                  colorScheme="blue"
                  variant={isEmailVerified ? 'solid' : 'outline'}
                  isLoading={loading || verificationLoading}
                  onClick={handlePrimaryAction}
                  w={verificationCodeSent ? '50%' : '100%'}
                >
                  {getPrimaryActionLabel()}
                </Button>
              </HStack>
              <Input
                ref={uploadFileRef}
                type="file"
                accept=".zip"
                display="none"
                onChange={handleUploadCaseStudy}
              />
            </VStack>
          </VStack>
        </GridItem>
      </Grid>

      <Box borderTopWidth={1} borderColor="gray.200" bg="gray.100" px={{ base: 6, md: 10 }} py={5} mt="auto">
        <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4}>
          <VStack align="start" spacing={1}>
            <Text fontWeight="semibold">Software documentation</Text>
            <Link color="blue.700" onClick={onDocumentation}>Open software documentation</Link>
          </VStack>

          <VStack align="start" spacing={1}>
            <Text fontWeight="semibold">Disclaimers</Text>
            <Text fontSize="sm" color="gray.600">For research and decision-support use only.</Text>
            <Text fontSize="sm" color="gray.600">No warranty or guarantee of fitness for purpose.</Text>
            <Text fontSize="sm" color="gray.600">
              Practitioner email addresses are stored solely for operational notifications and are
              automatically deleted after 12 months of inactivity in accordance with EU GDPR and the
              Swiss nFADP.
            </Text>
          </VStack>

          <VStack align="start" spacing={1}>
            <Text fontWeight="semibold">Legal and policy links</Text>
            <Link href="https://www.psi.ch/en/disclaimer-and-privacy-policy" isExternal color="blue.700">Privacy notice (PSI)</Link>
            <Link href="https://www.psi.ch/en/disclaimer-and-privacy-policy" isExternal color="blue.700">Terms of use (PSI)</Link>
          </VStack>
        </SimpleGrid>
      </Box>
    </Box>
  )
}

export default LoginPage
