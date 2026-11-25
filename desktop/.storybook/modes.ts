// The widths the app is drawn at: a phone, which is the window's smallest width (`minWidth` in
// electron/main.ts), and the window's width when it first opens. They are the Viewport menu in
// Storybook's toolbar.
export const viewports = {
	phone: { name: "Phone (360)", styles: { width: "360px", height: "780px" }, type: "mobile" },
	desktop: { name: "Desktop (1280)", styles: { width: "1280px", height: "820px" }, type: "desktop" },
} as const;
