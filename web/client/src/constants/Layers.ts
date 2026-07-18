export const Z_INDEX = {
  DEFAULT: 'z-[-1]',
  HEADER: 'z-[1]',
  CONNECTION_PILL: 'z-[2]',
  NODE_BASE: 'z-[5]',
  NODE_BORDER: 'z-[6]',
  CONTENT_LOW: 'z-[10]',
  CONTENT_MID: 'z-[20]',
  CONTENT_HIGH: 'z-[30]',
  TOOLTIP_BASE: 'z-[40]',
  UI_OVERLAY: 'z-[50]',
  TRAY: 'z-[55]',
  SEARCH_ACTIVE: 'z-[65]',
  MOBILE_SUMMARY: 'z-[60]',
  HANDLE: 'z-[98]',
  RESTRICTED_NODE: 'z-[100]',
  EDITOR_TRAY: 'z-[100]',
  CHAIN_ID_PILL: 'z-[101]',
  TUTORIAL_EXIT: 'z-[1000]',
  DEBUG_SHAPE: 'z-[1100]',
  HANDLE_OVERLAY: 'z-[2000]',
  POPOVER_ACTIVE: 'z-[7000]',
  // OVERLAY is persistent page chrome (title bar, settings cog/tray, copyright
  // notice, full-screen click-catchers). It must sit BELOW MODAL so dialogs
  // always render on top of it — otherwise the settings tray pokes through the
  // modal backdrop (notably on mobile). See ChangePasswordModal/LockRoomModal.
  OVERLAY: 'z-[9990]',
  MODAL: 'z-[9999]',
  TOAST: 'z-[11000]',
} as const;
