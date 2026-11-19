// First: in the preview (`npm run dev:preview`) the page's stand-in for the bridge, which
// bridge.ts reads when it is first evaluated. Nothing anywhere else.
import "./preview-bridge.ts";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./index.css";
import { store, useModel } from "./model.ts";
import { applyAgentAccent } from "./theme.ts";
import { Toaster } from "@/components/ui/toast";

/**
 * While the conversation of an agent with a colour of its own is in front, the window's accent is that
 * colour, over the theme's (theme.ts); any other tab gives the theme's back. The owner can turn it off
 * (Settings > App: `agentAccent` in the app's preferences).
 */
function AgentAccent() {
	const s = useModel(store);
	const front = s.agentInFront();
	const color = s.prefs.agentAccent !== false && front ? s.agent(front)?.color : undefined;
	useEffect(() => applyAgentAccent(color), [color]);
	return null;
}

// The notices sit beside the app, not in it: the app draws again on every change of the store, and
// the toaster measures its pile each time it is drawn, which would slow every key typed.
createRoot(document.getElementById("root")!).render(
	<>
		<App />
		<AgentAccent />
		<Toaster />
	</>,
);
