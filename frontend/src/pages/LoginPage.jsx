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
import { useEffect, useRef, useState } from 'react'
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
  const [emailEnabled, setEmailEnabled] = useState(true)
  const uploadFileRef = useRef(null)
  const toast = useToast()

  // Fetch email status on component mount
  useEffect(() => {
    const fetchEmailStatus = async () => {
      try {
        const response = await axios.get(`${API_URL}/config/email-status`)
        setEmailEnabled(response.data.email_enabled)
      } catch (error) {
        // If error, assume email is enabled (graceful fallback)
        setEmailEnabled(true)
      }
    }
    fetchEmailStatus()
  }, [])

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
        description: 'Please enter a session code',
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
          description: 'No active session is linked to this code. If you are a participant, please ask your practitioner for access. If you are the practitioner, check your email for the confirmation sent when you created the case study (search for "mcda-up.psi.ch").',
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
    // When email is disabled, we can create directly without email verification
    if (!emailEnabled) {
      setLoading(true)
      try {
        const response = await axios.post(`${API_URL}/study-session`, {
          auto_generate: true,
        })
        const createdStudyId = response.data?.study_session_id || ''
        onLogin(createdStudyId, createdStudyId, 'practitioner')
        toast({
          title: 'Study session created',
          description: `Study code: ${createdStudyId}`,
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
      return
    }

    // When email is enabled, require email and verification
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
        description: `Study code: ${createdStudyId}`,
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
    if (emailEnabled && (!email.trim() || !isEmailVerified)) {
      setVerificationError('Verify your email before uploading a case study backup.')
      return
    }

    const file = uploadFileRef.current?.files?.[0]
    if (!file) return

    setLoading(true)
    const formData = new FormData()
    formData.append('file', file)
    if (emailEnabled) {
      formData.append('contact_email', email.trim())
    }

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
        description: `Study code: ${importedStudyId}`,
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
    if (!emailEnabled) {
      return 'Create case study'
    }
    if (!verificationCodeSent) return 'Send code'
    if (!isEmailVerified) return 'Verify code'
    return 'Create case study'
  }

  const getPrimaryInstruction = () => {
    if (!emailEnabled) {
      return 'Click the button to create a new case study without email verification.'
    }
    if (!verificationCodeSent) {
      return 'Enter your email, then click the button to send a verification code.'
    }
    if (!isEmailVerified) {
      return 'Enter the verification code you received, then click the button to verify.'
    }
    return 'Choose whether to create a new case study or upload an existing ZIP backup.'
  }

  const handlePrimaryAction = async () => {
    if (!emailEnabled) {
      await handleCreatePractitionerSession()
      return
    }
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
                <Text fontWeight="semibold" mb={1}>1. Define the Input</Text>
                <Text fontSize="sm" color="gray.600">
                  Practitioners create case studies, define indicators and input data, and set up elicitation sessions for decision-makers.
                </Text>
              </Box>
              <Box bg="blue.50" borderRadius="md" p={4} borderWidth={1} borderColor="blue.100">
                <Text fontWeight="semibold" mb={1}>2. Elicitation</Text>
                <Text fontSize="sm" color="gray.600">
                  Decision makers complete the elicitation sessions.
                </Text>
              </Box>
              <Box bg="blue.50" borderRadius="md" p={4} borderWidth={1} borderColor="blue.100">
                <Text fontWeight="semibold" mb={1}>3. Review outcomes</Text>
                <Text fontSize="sm" color="gray.600">
                  The practitioner uses the UP-MAVT workflow to compute results and consolidate evidence, supporting informed final decisions.
                </Text>
              </Box>
            </SimpleGrid>

            <VStack align="start" spacing={1}>
              <Text color="gray.400" fontWeight="semibold">
                Read the publication about this software. (coming soon)
              </Text>
              <Text color="gray.400" fontWeight="semibold">
                Read the publication about the UP-MAVT method (work in progress)
              </Text>
            </VStack>
            <VStack align="start" spacing={2}>
              <Text fontWeight="semibold">Example case studies</Text>
              <VStack align="start" spacing={2} pt={1}>
                <Box>
                  <Link href={`${API_URL}/example-case-study/1`} color="blue.700" fontWeight="semibold">
                    Reference case study
                  </Link>
                  <Text fontSize="sm" color="gray.600">
                    Case study from Liang et al. used for validation (
                    <Link href="https://doi.org/10.1016/j.ins.2022.07.097" isExternal color="blue.700">
                      DOI
                    </Link>
                    ).
                  </Text>
                </Box>
                <Box>
                  <Link href={`${API_URL}/example-case-study/2`} color="blue.700" fontWeight="semibold">
                    Uncertain case study with two decision makers
                  </Link>
                  <Text fontSize="sm" color="gray.600">
                    A variation of the reference case with artificial uncertainty and an additional decision maker, used to showcase UP-MAVT features.
                  </Text>
                </Box>
                <Box>
                  <Link href={`${API_URL}/example-case-study/3`} color="blue.700" fontWeight="semibold">
                    Large hierarchical uncertain case study
                  </Link>
                  <Text fontSize="sm" color="gray.600">
                    A complete example, with hierarchical structure and real uncertainty, from the original UP-MAVT study (DOI coming soon).
                  </Text>
                </Box>
              </VStack>
            </VStack>
          </VStack>
        </GridItem>

        <GridItem p={{ base: 6, md: 10 }} bg="white">
          <VStack spacing={6} align="stretch">
            <Box>
              <Heading size="md" mb={2}>Access Existing Session</Heading>
              <Text color="gray.600" fontSize="sm">
                Enter the session code provided by your practitioner to continue.
                <br />
                If you are a practitioner, enter the session code you received by email when you
                created the case study, or create a new one.
              </Text>
            </Box>

            <Box>
              <FormLabel fontWeight="medium" mb={2}>
                Session code
              </FormLabel>
              <HStack spacing={3}>
                <Input
                  placeholder="Enter session code"
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
                {getPrimaryInstruction()}
              </Text>
              {emailEnabled && !isEmailVerified && (
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
              {emailEnabled && isEmailVerified && (
                <Text color="green.700" fontSize="sm">
                  Verified email: {email}
                </Text>
              )}
              {emailEnabled && verificationError && (
                <Text color="red.600" fontSize="sm">
                  {verificationError}
                </Text>
              )}
              <HStack spacing={3}>
                {emailEnabled && verificationCodeSent && !isEmailVerified && (
                  <Button
                    variant="ghost"
                    onClick={handleBack}
                    isDisabled={loading || verificationLoading}
                    w="50%"
                  >
                    Back
                  </Button>
                )}
                {(!emailEnabled || isEmailVerified) && (
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
                  variant={emailEnabled && isEmailVerified ? 'solid' : (emailEnabled ? 'outline' : 'solid')}
                  isLoading={loading || verificationLoading}
                  onClick={handlePrimaryAction}
                  w={(!emailEnabled || (emailEnabled && verificationCodeSent)) ? '50%' : '100%'}
                >
                  {getPrimaryActionLabel()}
                </Button>
              </HStack>
              {emailEnabled && (
                <Text color="gray.600" fontSize="sm">
                  No account is created in this process. Your email is used only for essential case-study
                  notifications (session confirmation, elicitation progress, completion alerts, and inactivity
                  warnings) and to send you a backup copy of your data before it is deleted. Your email address
                  is stored on servers operated by the Paul Scherrer Institute (PSI) in Switzerland and is
                  automatically and permanently deleted together with all case-study data after{' '}
                  <strong>12 months of inactivity</strong>. You may request erasure at any time by contacting
                  mcda-up@psi.ch.
                </Text>
              )}
              {!emailEnabled && (
                <Text color="gray.600" fontSize="sm">
                  Email notifications are disabled. You can create and manage case studies directly without providing an email address.
                </Text>
              )}
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
            <Link color="blue.700" onClick={onDocumentation}>Software documentation</Link>
          </VStack>

          <VStack align="start" spacing={1}>
            <Text fontWeight="semibold">Disclaimers</Text>
            <Text fontSize="sm" color="gray.600">This software open-source, licensed under MIT license</Text>
            <Text fontSize="sm" color="gray.600">No warranty or guarantee of fitness for purpose.</Text>
            {emailEnabled && (
              <Text fontSize="sm" color="gray.600">
                Practitioner email addresses are stored solely for operational notifications and are
                automatically deleted after 12 months of inactivity in accordance with EU GDPR and the
                Swiss nFADP.
              </Text>
            )}
          </VStack>

          <VStack align="start" spacing={1}>
            <Text fontWeight="semibold">Legal and policy links</Text>
            <Link href="https://www.psi.ch/en/disclaimer-and-privacy-policy" isExternal color="blue.700">Privacy notice</Link>
            <Link href="https://www.psi.ch/en/disclaimer-and-privacy-policy" isExternal color="blue.700">Terms of use</Link>
          </VStack>
        </SimpleGrid>
      </Box>
    </Box>
  )
}

export default LoginPage
