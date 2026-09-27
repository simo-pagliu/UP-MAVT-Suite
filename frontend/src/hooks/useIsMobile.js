import { useBreakpointValue, useMediaQuery } from '@chakra-ui/react'

/**
 * True below the `lg` breakpoint (992px): phones and portrait tablets.
 *
 * Use this only where the markup itself has to change (drawers, chart props,
 * modal sizes). For spacing or stacking prefer Chakra responsive props such as
 * `direction={{ base: 'column', md: 'row' }}`, which are pure CSS.
 */
export function useIsMobile() {
  // ssr:false reads matchMedia on the first render, so there is no desktop→mobile flash.
  return useBreakpointValue({ base: true, lg: false }, { ssr: false }) ?? false
}

/** True on devices with a mouse-like pointer that can hover (desktop). */
export function useCanHover() {
  const [canHover] = useMediaQuery('(hover: hover) and (pointer: fine)', { ssr: false })
  return canHover
}

export default useIsMobile
