import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const h = vi.hoisted(() => ({
  goToLibrary: vi.fn(),
}));

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: {},
    appService: { isMobile: true, hasSafeAreaInset: true },
  }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      globalReadSettings: {
        highlightStyle: 'default',
        highlightStyles: { default: 'yellow' },
      },
    },
  }),
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    isDarkMode: false,
    systemUIVisible: false,
    statusBarHeight: 0,
  }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    hoveredBookKey: 'book-1',
    getView: () => ({ renderer: { getContents: () => [] } }),
    getViewSettings: () => ({ enableAnnotationQuickActions: false }),
    setHoveredBookKey: vi.fn(),
  }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => ({}),
    getConfig: () => ({}),
  }),
}));
vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({ isSideBarVisible: false, getIsSideBarVisible: () => false }),
}));
vi.mock('@/store/trafficLightStore', () => ({
  useTrafficLightStore: () => ({
    trafficLightInFullscreen: false,
    setTrafficLightVisibility: vi.fn(),
  }),
}));
vi.mock('@/hooks/useTrafficLight', () => ({
  useTrafficLight: () => ({ isTrafficLightVisible: false }),
}));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/app/reader/hooks/useSpatialNavigation', () => ({ useSpatialNavigation: vi.fn() }));
vi.mock('@/app/reader/utils/annotatorUtil', () => ({ getHighlightColorHex: () => '#ffff00' }));
vi.mock('@/app/reader/components/annotator/AnnotationTools', () => ({
  annotationToolQuickActions: [{ type: 'highlight', Icon: () => null }],
}));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: vi.fn() }));
vi.mock('@/components/Dropdown', () => ({ default: () => null }));
vi.mock('@/components/WindowButtons', () => ({ default: () => null }));
vi.mock('@/app/reader/components/SidebarToggler', () => ({ default: () => null }));
vi.mock('@/app/reader/components/BookmarkToggler', () => ({ default: () => null }));
vi.mock('@/app/reader/components/NotebookToggler', () => ({ default: () => null }));
vi.mock('@/app/reader/components/SettingsToggler', () => ({ default: () => null }));
vi.mock('@/app/reader/components/TranslationToggler', () => ({ default: () => null }));

import HeaderBar from '@/app/reader/components/HeaderBar';

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
});

describe('HeaderBar mobile library navigation', () => {
  test('shows the go-to-library button on a phone-sized screen', () => {
    render(
      <HeaderBar
        bookKey='book-1'
        bookTitle='Test book'
        isTopLeft={true}
        isHoveredAnim={false}
        gridInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
        screenInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
        onCloseBook={vi.fn()}
        onGoToLibrary={h.goToLibrary}
      />,
    );

    expect(screen.getByTitle('Go to Library').className.split(' ')).not.toContain('hidden');
  });
});
