import {
  IconButton,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Portal,
} from '@chakra-ui/react'
import { QuestionIcon } from '@chakra-ui/icons'
import { useCanHover } from '../hooks/useIsMobile'

/**
 * Help text that works on touch screens.
 *
 * Opens on hover where the device can hover (same feel as a Tooltip on desktop)
 * and on tap everywhere else. By default the trigger is a small "?" icon button;
 * pass `children` to use a custom trigger (it must accept a ref and be focusable).
 */
function InfoTip({
  label,
  children,
  placement = 'top',
  ariaLabel = 'More information',
  icon,
  maxW = '320px',
}) {
  const canHover = useCanHover()

  return (
    <Popover
      trigger={canHover ? 'hover' : 'click'}
      placement={placement}
      openDelay={canHover ? 150 : 0}
      isLazy
    >
      <PopoverTrigger>
        {children ?? (
          <IconButton
            aria-label={ariaLabel}
            icon={icon ?? <QuestionIcon boxSize={3} />}
            variant="ghost"
            color="gray.500"
            size="xs"
            minW={{ base: 8, lg: 5 }}
            h={{ base: 8, lg: 5 }}
            cursor="help"
            _hover={{ bg: 'transparent', color: 'gray.700' }}
          />
        )}
      </PopoverTrigger>
      <Portal>
        <PopoverContent
          w="auto"
          maxW={maxW}
          bg="gray.700"
          color="white"
          borderColor="gray.700"
          fontSize="sm"
          _focusVisible={{ outline: 'none' }}
        >
          <PopoverArrow bg="gray.700" />
          <PopoverBody px={3} py={2}>{label}</PopoverBody>
        </PopoverContent>
      </Portal>
    </Popover>
  )
}

export default InfoTip
