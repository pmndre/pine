// First: in the preview (`npm run dev:preview`) the page's stand-in for the bridge, which
// bridge.ts reads when it is first evaluated. Nothing anywhere else.
import "./preview-bridge.ts";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./index.css";
import { Toaster } from "@/components/ui/toast";
import { DevicePairing } from "./DevicePairing.tsx";
import { PageMenus } from "@/components/page-menu";

// The notices sit beside the app, not in it: the app draws again on every change of the store, and
// the toaster measures its pile each time it is drawn, which would slow every key typed.
createRoot(document.getElementById("root")!).render(
	<>
		<App />
		<Toaster />
		<PageMenus />
		{/* Adding a device and a device's question show wherever the owner is, not only in Settings. */}
		<DevicePairing />
	</>,
);
