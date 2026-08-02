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

const PSI_TERMS_OF_USE_URL = 'https://www.psi.ch/en/nutzungsbedingungen'

function LoginPage({ onLogin, onDocumentation }) {
  const [code, setCode] = useState('')
  const [selectedFlow, setSelectedFlow] = useState('')
  const [emailConsent, setEmailConsent] = useState(null)
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
  const requiresEmailVerification = emailEnabled && emailConsent === true
  const isCreateFlow = selectedFlow === 'create'
  const isUploadFlow = selectedFlow === 'upload'

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
        description: `${data.type === 'stakeholder' ? 'Decision-maker' : 'Practitioner'} session ready`,
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
    if (!requiresEmailVerification) {
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
    if (requiresEmailVerification && (!email.trim() || !isEmailVerified)) {
      setVerificationError('Verify your email before uploading a case study backup.')
      return
    }

    const file = uploadFileRef.current?.files?.[0]
    if (!file) return

    setLoading(true)
    const formData = new FormData()
    formData.append('file', file)
    if (requiresEmailVerification) {
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

  const handleFlowSelection = (nextFlow) => {
    setCode('')
    setSelectedFlow(nextFlow)
    setEmailConsent(null)
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
    if (!requiresEmailVerification) {
      return isCreateFlow ? 'Create new empty session' : 'Upload case study (.zip)'
    }
    if (!verificationCodeSent) return 'Send code'
    if (!isEmailVerified) return 'Verify code'
    return isCreateFlow ? 'Create new empty session' : 'Upload case study (.zip)'
  }

  const getPrimaryInstruction = () => {
    if (!requiresEmailVerification) {
      return isCreateFlow
        ? 'Create a new empty session directly without email verification.'
        : 'Upload a ZIP backup directly without email verification.'
    }
    if (!verificationCodeSent) {
      return 'Enter your email, then click the button to send a verification code.'
    }
    if (!isEmailVerified) {
      return 'Enter the verification code you received, then click the button to verify.'
    }
    return isCreateFlow
      ? 'Email verified. Click to create a new empty session.'
      : 'Email verified. Upload your ZIP backup file.'
  }

  const handlePrimaryAction = async () => {
    if (!requiresEmailVerification) {
      if (isCreateFlow) {
        await handleCreatePractitionerSession()
      } else if (isUploadFlow) {
        uploadFileRef.current?.click()
      }
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
    if (isCreateFlow) {
      await handleCreatePractitionerSession()
      return
    }
    uploadFileRef.current?.click()
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
            <VStack spacing={4} align="stretch">
              <Box>
                <Heading size="md" mb={2}>
                  Start here
                </Heading>
              </Box>
              <VStack spacing={3} align="stretch">
                <Button
                  variant={selectedFlow === 'access' ? 'solid' : 'outline'}
                  colorScheme="blue"
                  size="lg"
                  w="full"
                  onClick={() => handleFlowSelection('access')}
                >
                  Access an existing session
                </Button>
                <Button
                  variant={isCreateFlow ? 'solid' : 'outline'}
                  colorScheme="blue"
                  size="lg"
                  w="full"
                  onClick={() => handleFlowSelection('create')}
                >
                  Create a new empty case study
                </Button>
                <Button
                  variant={isUploadFlow ? 'solid' : 'outline'}
                  colorScheme="blue"
                  size="lg"
                  w="full"
                  onClick={() => handleFlowSelection('upload')}
                >
                  Upload a case study (.zip file)
                </Button>
              </VStack>
            </VStack>

            {selectedFlow === 'access' && (
              <>
                <Divider />
                <Box>
                  <Heading size="sm" mb={2}>Access Existing Session</Heading>
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
              </>
            )}

            {(isCreateFlow || isUploadFlow) && (
              <>
                <Divider />
                <VStack spacing={3} align="stretch">
                  <Heading size="sm">{isCreateFlow ? 'Create New Session' : 'Upload Case Study'}</Heading>
                  <Text color="gray.600" fontSize="sm">
                    Do you agree to share your email?
                  </Text>
                  <Text color="gray.600" fontSize="sm">
                    Without your email, you may permanently lose access to this case study if you do not save your
                    code. Your email also helps with session recovery, updates, and support. By providing your email,
                    you agree to the{' '}
                    <Link href={PSI_TERMS_OF_USE_URL} isExternal color="blue.700">
                      PSI terms of use
                    </Link>
                    .
                  </Text>
                  <HStack spacing={3}>
                    <Button
                      variant={emailConsent === true ? 'solid' : 'outline'}
                      colorScheme="blue"
                      onClick={() => {
                        setEmailConsent(true)
                        setEmail('')
                        resetEmailVerificationState()
                      }}
                    >
                      Yes, share email
                    </Button>
                    <Button
                      variant={emailConsent === false ? 'solid' : 'outline'}
                      onClick={() => {
                        setEmailConsent(false)
                        setEmail('')
                        resetEmailVerificationState()
                      }}
                    >
                      No, continue without email
                    </Button>
                  </HStack>

                  {emailConsent !== null && (
                    <>
                      <Text color="gray.600" fontSize="sm">
                        {getPrimaryInstruction()}
                      </Text>
                      {requiresEmailVerification && !isEmailVerified && (
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
                      {requiresEmailVerification && isEmailVerified && (
                        <Text color="green.700" fontSize="sm">
                          Verified email: {email}
                        </Text>
                      )}
                      {requiresEmailVerification && verificationError && (
                        <Text color="red.600" fontSize="sm">
                          {verificationError}
                        </Text>
                      )}
                      {!emailEnabled && emailConsent === true && (
                        <Text color="gray.600" fontSize="sm">
                          Email verification is currently unavailable, so you can continue without email.
                        </Text>
                      )}
                      <HStack spacing={3}>
                        {requiresEmailVerification && verificationCodeSent && !isEmailVerified && (
                          <Button
                            variant="ghost"
                            onClick={handleBack}
                            isDisabled={loading || verificationLoading}
                            w="50%"
                          >
                            Back
                          </Button>
                        )}
                        <Button
                          colorScheme="blue"
                          variant="solid"
                          isLoading={loading || verificationLoading}
                          onClick={handlePrimaryAction}
                          w={requiresEmailVerification && verificationCodeSent && !isEmailVerified ? '50%' : '100%'}
                        >
                          {getPrimaryActionLabel()}
                        </Button>
                      </HStack>
                    </>
                  )}
                </VStack>
              </>
            )}

            <Input
              ref={uploadFileRef}
              type="file"
              accept=".zip"
              display="none"
              onChange={handleUploadCaseStudy}
            />
          </VStack>
        </GridItem>
      </Grid>

      <Box borderTopWidth={1} borderColor="gray.200" bg="gray.100" px={{ base: 6, md: 10 }} py={5} mt="auto">
        <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4}>
          <VStack align="start" spacing={1}>
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
            <Link href={PSI_TERMS_OF_USE_URL} isExternal color="blue.700">PSI terms of use</Link>
          </VStack>
        </SimpleGrid>
      </Box>
    </Box>
  )
}

export default LoginPage
