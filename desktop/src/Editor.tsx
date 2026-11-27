// The text editor of the side panel's Files view, of a skill, and of an agent's instruction files (AgentFiles.tsx):
// CodeMirror in pine's colors. A file of its own so that the panel and what the panel shows can both use it.
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { yaml } from "@codemirror/lang-yaml";
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { useEffect, useRef } from "react";

// The editor says what a token is and what it looks like. The colors are tokens of index.css
// (`--code-*`), so light and dark differ there and nowhere else.
const colors = HighlightStyle.define([
	{ tag: [t.comment], color: "var(--code-comment)", fontStyle: "italic" },
	{ tag: [t.meta], color: "var(--code-meta)", fontStyle: "var(--code-meta-style)" },
	{ tag: [t.keyword], color: "var(--code-keyword)" },
	{ tag: [t.definitionKeyword], color: "var(--code-definition)" },
	{ tag: [t.controlKeyword], color: "var(--code-control)" },
	{ tag: [t.moduleKeyword, t.modifier, t.operatorKeyword, t.self], color: "var(--code-modifier)" },
	{ tag: [t.string, t.special(t.string)], color: "var(--code-string)" },
	{ tag: [t.regexp, t.escape], color: "var(--code-regexp)" },
	{ tag: [t.number, t.atom, t.url, t.bool], color: "var(--code-literal)" },
	{ tag: [t.null], color: "var(--code-null)" },
	{ tag: [t.variableName, t.propertyName], color: "var(--code-name)" },
	{ tag: [t.attributeName], color: "var(--code-attribute)", fontStyle: "var(--code-attribute-style)" },
	{ tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--code-call)" },
	{ tag: [t.function(t.definition(t.variableName)), t.definition(t.function(t.propertyName)), t.className, t.definition(t.className)], color: "var(--code-function)" },
	{ tag: [t.typeName], color: "var(--code-type)" },
	{ tag: [t.namespace], color: "var(--code-namespace)" },
	{ tag: [t.tagName], color: "var(--code-tag)" },
	{ tag: [t.heading], color: "var(--code-heading)", fontWeight: "var(--font-weight-semibold)" },
	{ tag: [t.emphasis], color: "var(--code-emphasis)", fontStyle: "italic" },
	{ tag: [t.strong], color: "var(--code-emphasis)", fontWeight: "var(--font-weight-semibold)" },
	{ tag: [t.link], color: "var(--code-link)", textDecoration: "underline" },
	{ tag: [t.inserted], color: "var(--code-inserted)" },
	{ tag: [t.deleted, t.invalid], color: "var(--code-deleted)" },
	{ tag: [t.punctuation, t.bracket], color: "var(--code-punctuation)" },
	{ tag: [t.operator], color: "var(--code-operator)" },
]);

// CodeMirror's own look, in pine's tokens. A theme of CodeMirror's comes after its base theme, so it
// wins without `!important`; the focused selection repeats the base theme's longer selector.
const look = EditorView.theme({
	"&": { height: "100%", minWidth: "0", flex: "1", backgroundColor: "var(--background)", color: "var(--code-text)" },
	"&.cm-focused": { outline: "none" },
	// Lines one and a half times the text apart, as an editor sets code (VS Code's on a Mac); a diff and
	// what a program printed are set the same in the panel (CODE_LINES).
	".cm-scroller": { fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", lineHeight: "var(--leading-normal)" },
	".cm-gutters": { borderRight: "1px solid var(--line-soft)", backgroundColor: "var(--background)", color: "var(--code-gutter)" },
	".cm-activeLine": { backgroundColor: "var(--code-active-line)" },
	".cm-activeLineGutter": { backgroundColor: "var(--code-active-line)", color: "var(--code-gutter-active)" },
	".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": { background: "var(--select)" },
	".cm-cursor": { borderLeftColor: "var(--code-cursor)" },
	".cm-panels": { borderColor: "var(--border)", backgroundColor: "var(--secondary)", color: "var(--foreground)" },
	".cm-textfield, .cm-button": { borderRadius: "calc(var(--radius) * 0.8)", borderColor: "var(--border)", backgroundColor: "var(--card)", backgroundImage: "none", fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)", color: "var(--foreground)" },
	".cm-searchMatch": { backgroundColor: "var(--code-match)", outline: "1px solid var(--code-match-line)" },
});

function language(file: string): Extension {
	const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
	if (["ts", "mts", "cts"].includes(ext)) return javascript({ typescript: true });
	if (ext === "tsx") return javascript({ typescript: true, jsx: true });
	if (["js", "mjs", "cjs", "jsx"].includes(ext)) return javascript({ jsx: true });
	if (["json", "jsonc"].includes(ext)) return json();
	if (["md", "markdown", "mdx"].includes(ext)) return markdown();
	if (["css", "scss"].includes(ext)) return css();
	if (["html", "htm", "vue", "svelte", "xml", "svg"].includes(ext)) return html();
	if (ext === "py") return python();
	if (ext === "rs") return rust();
	if (["yml", "yaml"].includes(ext)) return yaml();
	return [];
}

/** A text editor. `text` is what is on disk; what is typed is told with `onChange`, and ⌘S asks to save. */
export function Editor({ file, text, readOnly, onChange, onSave }: { file: string; text: string; readOnly?: boolean; onChange?: (text: string) => void; onSave?: () => void }) {
	const host = useRef<HTMLDivElement>(null);
	const view = useRef<EditorView>(undefined);
	const lock = useRef(new Compartment());
	const live = useRef({ onChange, onSave });
	live.current = { onChange, onSave };
	useEffect(() => {
		const v = new EditorView({
			parent: host.current!,
			state: EditorState.create({
				doc: text,
				extensions: [
					lineNumbers(),
					highlightActiveLineGutter(),
					highlightActiveLine(),
					history(),
					drawSelection(),
					indentOnInput(),
					bracketMatching(),
					highlightSelectionMatches(),
					search({ top: true }),
					look,
					syntaxHighlighting(colors),
					language(file),
					EditorView.lineWrapping,
					keymap.of([{ key: "Mod-s", run: () => (live.current.onSave?.(), true) }, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
					lock.current.of([EditorState.readOnly.of(Boolean(readOnly)), EditorView.editable.of(!readOnly)]),
					EditorView.updateListener.of((u) => u.docChanged && live.current.onChange?.(u.state.doc.toString())),
				],
			}),
		});
		view.current = v;
		return () => v.destroy();
		// A new file is a new editor; what it shows of the old one is replaced below.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [file]);
	useEffect(() => {
		const v = view.current;
		if (v && v.state.doc.toString() !== text) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } });
	}, [text]);
	useEffect(() => {
		view.current?.dispatch({ effects: lock.current.reconfigure([EditorState.readOnly.of(Boolean(readOnly)), EditorView.editable.of(!readOnly)]) });
	}, [readOnly]);
	return <div className="flex min-h-0 flex-1 overflow-hidden" ref={host} />;
}
