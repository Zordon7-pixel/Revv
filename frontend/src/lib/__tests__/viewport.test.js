import { describe, expect, it } from 'vitest'
import { applyViewportProfile, detectViewportProfile } from '../viewport'

function createMockWindow({
  width,
  height,
  visualWidth = width,
  visualHeight = height,
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
    matchMedia: () => ({ matches: coarsePointer }),
    visualViewport: {
      width: visualWidth,
      height: visualHeight,
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
    expect(mockWindow.document.documentElement.dataset.deviceMode).toBe('phone')
    expect(mockWindow.document.documentElement.style.getPropertyValue('--app-viewport-height')).toBe('690px')
  })

  it('keeps iPad-sized touch devices in tablet mode', () => {
    const mockWindow = createMockWindow({
      width: 834,
      height: 1194,
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X)',
      platform: 'iPad',
      maxTouchPoints: 5,
      coarsePointer: true,
    })

    const profile = detectViewportProfile(mockWindow)

    expect(profile.deviceMode).toBe('tablet')
    expect(profile.shortestSide).toBe(834)
  })
})
