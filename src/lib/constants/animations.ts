/**
 * Shared animation constants for consistent transitions across components
 */

export const TRANSITION_DURATIONS = {
    // Quick transitions for micro-interactions
    FAST: 200,
    // Standard transitions for most UI elements
    NORMAL: 300,
    // Slower transitions for page/card transitions
    SLOW: 600,
    // Header and brand elements
    HEADER: 800,
} as const;

export const ANIMATION_DELAYS = {
    NONE: 0,
    SHORT: 100,
    MEDIUM: 200,
    LONG: 400,
} as const;

export const EASING = {
    EASE_OUT: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
    EASE_IN_OUT: 'cubic-bezier(0.4, 0.0, 0.2, 1)',
    BOUNCE: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
} as const;

export const SLIDE_DISTANCE = {
    SMALL: 10,
    MEDIUM: 20,
    LARGE: 40,
} as const;
