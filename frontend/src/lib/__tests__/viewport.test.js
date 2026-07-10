import { describe, expect, it } from 'vitest'
import { applyViewportProfile, detectViewportProfile } from '../viewport'

function createMockWindow({
  width,
  height,
  visualWidth = width,
  visualHeight = height,
  visualOffsetTop = 0,
  visualOffsetLeft = 0,
  screenWidth = width,
  screenHeight = height,
  userAgent,
  platform,
  maxTouchPoints = 0,
  coarsePointer = false,
} = {}) {
  const document = window.document.implementation.createHTMLDocument('viewport-test')
  return {
    innerWidth: width,
    innerHeight: height,
    document,
    navigator: {
      userAgent,
      platform,
      maxTouchPoints,
    },
    screen: {
      width: screenWidth,
      height: screenHeight,
    },
    matchMedia: () => ({ matches: coarsePointer }),
    visualViewport: {
      width: visualWidth,
      height: visualHeight,
      offsetTop: visualOffsetTop,
      offsetLeft: visualOffsetLeft,
    },
  }
}

describe('viewport profile detection', () => {
  it('classifies iPhone-sized touch devices as phones and uses the visual viewport height', () => {
    const mockWindow = createMockWindow({
      width: 390,
      height: 844,
      visualHeight: 690,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)',
      platform: 'iPhone',
      maxTouchPoints: 5,
      coarsePointer: true,
    })

    const profile = detectViewportProfile(mockWindow)
    applyViewportProfile(profile, mockWindow.document)

    expect(profile.deviceMode).toBe('phone')
    expect(profile.isIOS).toBe(true)
    expect(profile.height).toBe(690)
    expect(profile.keyboardInset).toBe(154)
    expect(mockWindow.document.documentElement.dataset.deviceMode).toBe('phone')
    expect(mockWindow.document.documentElement.dataset.keyboardOpen).toBe('true')
    expect(mockWindow.document.documentElement.style.getPropertyValue('--app-viewport-height')).toBe('690px')
    expect(mockWindow.document.documentElement.style.getPropertyValue('--app-keyboard-inset')).toBe('154px')
  })

  it('keeps iPad-sized touch devices in tablet mode', () => {
    const mockWindow = createMockWindow({
      width: 834,
      height: 1194,
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1',
      platform: 'iPad',
      maxTouchPoints: 5,
      coarsePointer: true,
    })

    const profile = detectViewportProfile(mockWindow)

    expect(profile.deviceMode).toBe('tablet')
    expect(profile.shortestSide).toBe(834)
  })

  it('keeps an iPad in tablet mode and tracks its visual viewport while the landscape keyboard is open', () => {
    const mockWindow = createMockWindow({
      width: 1024,
      height: 768,
      visualWidth: 1024,
      visualHeight: 248,
      visualOffsetTop: 74,
      visualOffsetLeft: 0,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 5,
      coarsePointer: true,
    })

    const profile = detectViewportProfile(mockWindow)
    applyViewportProfile(profile, mockWindow.document)

    expect(profile.deviceMode).toBe('tablet')
    expect(profile.shortestSide).toBe(768)
    expect(profile.height).toBe(248)
    expect(profile.offsetTop).toBe(74)
    expect(profile.keyboardInset).toBe(446)
    expect(mockWindow.document.documentElement.dataset.keyboardOpen).toBe('true')
    expect(mockWindow.document.documentElement.style.getPropertyValue('--app-viewport-height')).toBe('248px')
    expect(mockWindow.document.documentElement.style.getPropertyValue('--app-viewport-offset-top')).toBe('74px')
    expect(mockWindow.document.documentElement.style.getPropertyValue('--app-viewport-offset-left')).toBe('0px')
  })

  it('keeps an iPad in tablet mode when Safari shrinks both innerHeight and visualViewport height', () => {
    const mockWindow = createMockWindow({
      width: 1024,
      height: 248,
      visualWidth: 1024,
      visualHeight: 248,
      screenWidth: 1024,
      screenHeight: 768,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 5,
      coarsePointer: true,
    })

    const profile = detectViewportProfile(mockWindow)

    expect(profile.deviceMode).toBe('tablet')
    expect(profile.shortestSide).toBe(768)
    expect(profile.longestSide).toBe(1024)
    expect(profile.height).toBe(248)
  })
})
