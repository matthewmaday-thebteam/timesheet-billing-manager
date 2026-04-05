import type { AnimationEntry } from '../types';

/**
 * Animation Registry
 *
 * Centralized catalog of all animations and transitions used across the
 * application. Keeping motion consistent and predictable.
 */
export const animations: AnimationEntry[] = [
  // ---------------------------------------------------------------------------
  // Keyframe animations
  // ---------------------------------------------------------------------------
  {
    name: 'spinner-spin',
    description: 'Continuous 360-degree rotation for loading spinners.',
    tailwindClass: 'animate-spin',
    duration: '1s',
    easing: 'linear',
    usedIn: ['Spinner'],
  },
  {
    name: 'skeleton-pulse',
    description: 'Pulsing opacity animation for skeleton loading placeholders.',
    tailwindClass: 'animate-pulse',
    duration: '2s',
    easing: 'ease-in-out',
    usedIn: ['BambooEmployeePanel'],
  },
  {
    name: 'typing-bounce',
    description: 'Bouncing dots animation for AI typing indicator with staggered delays.',
    cssClass: 'typing-bounce',
    keyframes: 'typing-bounce',
    duration: '1.2s',
    easing: 'ease-in-out',
    usedIn: ['TypingIndicator'],
  },
  {
    name: 'typing-enter',
    description: 'Slide-up with fade-in for typing indicator container appearance.',
    cssClass: 'animate-typing-enter',
    keyframes: 'typing-enter',
    duration: '200ms',
    easing: 'ease-out',
    usedIn: ['TypingIndicator'],
  },
  {
    name: 'mesh-blob-1',
    description: 'Organic movement path for first mesh gradient blob.',
    keyframes: 'mesh-blob-1',
    duration: '20s',
    easing: 'ease-in-out',
    usedIn: ['MeshGradientBackground'],
  },
  {
    name: 'mesh-blob-2',
    description: 'Organic movement path for second mesh gradient blob.',
    keyframes: 'mesh-blob-2',
    duration: '20s',
    easing: 'ease-in-out',
    usedIn: ['MeshGradientBackground'],
  },
  {
    name: 'mesh-blob-3',
    description: 'Organic movement path for third mesh gradient blob.',
    keyframes: 'mesh-blob-3',
    duration: '20s',
    easing: 'ease-in-out',
    usedIn: ['MeshGradientBackground'],
  },
  {
    name: 'mesh-blob-4',
    description: 'Organic movement path for fourth mesh gradient blob.',
    keyframes: 'mesh-blob-4',
    duration: '20s',
    easing: 'ease-in-out',
    usedIn: ['MeshGradientBackground'],
  },

  // ---------------------------------------------------------------------------
  // Transition patterns
  // ---------------------------------------------------------------------------
  {
    name: 'color-transition',
    description: 'Smooth background/text/border color change on hover and focus states. The most common transition in the app.',
    tailwindClass: 'transition-colors',
    duration: '150ms',
    easing: 'ease',
    usedIn: [
      'Button', 'Input', 'Select', 'MultiSelect', 'DropdownMenu',
      'NavItem', 'MetricCard', 'Toggle', 'Accordion', 'AccordionNested',
      'AccordionFlat', 'AccordionListTable', 'ResourceTable', 'UserTable',
      'HolidayTable', 'EmployeePerformance', 'RevenueTable',
      'ProjectHierarchyTable', 'BurnGrid', 'MainHeader', 'Footer',
      'DatePicker', 'HolidayCalendar', 'Modal', 'LegalModal',
      'EmployeeEditorModal', 'AvatarUpload',
    ],
  },
  {
    name: 'color-transition-200',
    description: 'Slightly slower color transition for more deliberate visual feedback.',
    tailwindClass: 'transition-colors duration-200 ease-out',
    duration: '200ms',
    easing: 'ease-out',
    usedIn: [
      'Select', 'DropdownMenu', 'ResourceTable', 'UserTable',
      'HolidayTable', 'EmployeeTimeOffList', 'Modal', 'MetricCard',
      'EmployeeEditorModal', 'DatePicker', 'HolidayCalendar',
      'ChatInput',
    ],
  },
  {
    name: 'transform-transition',
    description: 'Smooth rotation/scale transitions for chevron icons and toggle switches.',
    tailwindClass: 'transition-transform',
    duration: '150ms',
    easing: 'ease',
    usedIn: [
      'ChevronIcon', 'Select', 'MultiSelect', 'ResourceRow',
      'Accordion', 'AccordionNested', 'AccordionFlat',
      'AccordionListTable',
    ],
  },
  {
    name: 'transform-transition-200',
    description: 'Smooth rotation for dropdown chevrons with 200ms duration.',
    tailwindClass: 'transition-transform duration-200',
    duration: '200ms',
    easing: 'ease',
    usedIn: ['Select', 'MultiSelect'],
  },
  {
    name: 'opacity-transition',
    description: 'Fade in/out for overlays and hover states.',
    tailwindClass: 'transition-opacity',
    duration: '150ms',
    easing: 'ease',
    usedIn: ['AvatarUpload', 'UsersPage'],
  },
  {
    name: 'opacity-transition-200',
    description: 'Modal backdrop and tooltip fade with 200ms duration.',
    tailwindClass: 'transition-opacity duration-200 ease-out',
    duration: '200ms',
    easing: 'ease-out',
    usedIn: ['Modal', 'HolidayCalendar'],
  },
  {
    name: 'all-transition',
    description: 'Transition all animatable properties. Used for nav items and chat button.',
    tailwindClass: 'transition-all duration-200 ease-out',
    duration: '200ms',
    easing: 'ease-out',
    usedIn: ['NavItem', 'AIChatButton', 'DatePicker'],
  },
  {
    name: 'checkbox-transition',
    description: 'Background-color and border-color transition for checkbox state changes.',
    tailwindClass: 'transition-[background-color,border-color] duration-150 ease-out',
    duration: '150ms',
    easing: 'ease-out',
    usedIn: ['Checkbox'],
  },
];
