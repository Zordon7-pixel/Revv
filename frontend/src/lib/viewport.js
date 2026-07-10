function getViewportMetrics(targetWindow) {
  const root = targetWindow?.document?.documentElement
  const visualViewport = targetWindow?.visualViewport
  const width = Math.round(visualViewport?.width || targetWindow?.innerWidth || root?.clientWidth || 0)
  const height = Math.round(visualViewport?.height || targetWindow?.innerHeight || root?.clientHeight || 0)
  const offsetTop = Math.round(visualViewport?.offsetTop || 0)
  const offsetLeft = Math.round(visualViewport?.offsetLeft || 0)
  const layoutWidth = Math.round(targetWindow?.innerWidth || root?.clientWidth || width || 0)
  const layoutHeight = Math.round(targetWindow?.innerHeight || root?.clientHeight || height || 0)
  const keyboardInset = Math.max(0, layoutHeight - height - offsetTop)
  return {
    width,
    height,
    offsetTop,
    offsetLeft,
    layoutWidth,
    layoutHeight,
    keyboardInset,
    shortestSide: Math.min(layoutWidth, layoutHeight),
    longestSide: Math.max(layoutWidth, layoutHeight),
  }
}

function hasCoarsePointer(targetWindow) {
  try {
    return Boolean(targetWindow?.matchMedia?.('(pointer: coarse)').matches)
  } catch {
    return false
  }
}

export function detectViewportProfile(targetWindow = window) {
  const { width, height, offsetTop, offsetLeft, layoutHeight, keyboardInset, shortestSide, longestSide } = getViewportMetrics(targetWindow)
  const navigatorRef = targetWindow?.navigator || {}
  const userAgent = String(navigatorRef.userAgent || '')
  const platform = String(navigatorRef.platform || '')
  const maxTouchPoints = Number(navigatorRef.maxTouchPoints || 0)
  const touch = hasCoarsePointer(targetWindow) || maxTouchPoints > 0 || 'ontouchstart' in targetWindow
  const screenWidth = Math.round(Number(targetWindow?.screen?.width || 0))
  const screenHeight = Math.round(Number(targetWindow?.screen?.height || 0))
  const stableShortestSide = touch && screenWidth > 0 && screenHeight > 0
    ? Math.min(screenWidth, screenHeight)
    : shortestSide
  const stableLongestSide = touch && screenWidth > 0 && screenHeight > 0
    ? Math.max(screenWidth, screenHeight)
    : longestSide
  const isIOS = /iPad|iPhone|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)
  const isTabletAgent = /iPad|Tablet|Android(?!.*Mobile)/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)
  const isPhoneAgent = !isTabletAgent && /iPhone|Android.+Mobile|Mobile/i.test(userAgent)

  let deviceMode = 'desktop'
  if (touch && (isPhoneAgent || stableShortestSide <= 767)) {
    deviceMode = 'phone'
  } else if (touch && (isTabletAgent || (stableShortestSide <= 1100 && stableLongestSide <= 1400))) {
    deviceMode = 'tablet'
  }

  return {
    width,
    height,
    offsetTop,
    offsetLeft,
    layoutHeight,
    keyboardInset,
    shortestSide: stableShortestSide,
    longestSide: stableLongestSide,
    touch,
    isIOS,
    deviceMode,
  }
}

export function applyViewportProfile(profile, targetDocument = document) {
  const root = targetDocument?.documentElement
  if (!root) return profile

  root.style.setProperty('--app-viewport-height', `${profile.height}px`)
  root.style.setProperty('--app-viewport-width', `${profile.width}px`)
  root.style.setProperty('--app-viewport-offset-top', `${profile.offsetTop || 0}px`)
  root.style.setProperty('--app-viewport-offset-left', `${profile.offsetLeft || 0}px`)
  root.style.setProperty('--app-viewport-short', `${profile.shortestSide}px`)
  root.style.setProperty('--app-viewport-long', `${profile.longestSide}px`)
  root.style.setProperty('--app-keyboard-inset', `${profile.keyboardInset || 0}px`)
  root.dataset.deviceMode = profile.deviceMode
  root.dataset.touch = profile.touch ? 'true' : 'false'
  root.dataset.platform = profile.isIOS ? 'ios' : 'default'
  root.dataset.keyboardOpen = profile.keyboardInset > 80 ? 'true' : 'false'

  return profile
}

export function syncViewportProfile(targetWindow = window) {
  return applyViewportProfile(detectViewportProfile(targetWindow), targetWindow?.document)
}

export function watchViewportProfile(targetWindow = window) {
  if (!targetWindow?.document) return () => {}

  const sync = () => {
    syncViewportProfile(targetWindow)
  }

  sync()
  targetWindow.addEventListener('resize', sync)
  targetWindow.addEventListener('orientationchange', sync)
  targetWindow.visualViewport?.addEventListener('resize', sync)
  targetWindow.visualViewport?.addEventListener('scroll', sync)

  return () => {
    targetWindow.removeEventListener('resize', sync)
    targetWindow.removeEventListener('orientationchange', sync)
    targetWindow.visualViewport?.removeEventListener('resize', sync)
    targetWindow.visualViewport?.removeEventListener('scroll', sync)
  }
}
