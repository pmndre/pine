import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import { BookmarkList as List, type BookmarkRow } from "./bookmark-list.tsx";

const meta = { title: "Components/BookmarkList", component: List } satisfies Meta<typeof List>;
export default meta;
type Story = StoryObj<typeof meta>;

const bookmarks: BookmarkRow[] = [
	{ id: "a", text: "The first failed because the cache held an old copy of the lockfile, so the install took the versions of last week." },
	{ id: "b", text: "Clearing the cache before the install keeps it from happening again." },
	{ id: "c", text: "npm ci --prefer-offline" },
	{ id: "d", text: "The build passed on the second run, in four minutes and twelve seconds, which is about a minute longer than it took before the cache was cleared, and the test job took as long as it always did." },
];

function Head({ start, open }: { start: BookmarkRow[]; open?: boolean }) {
	const [list, setList] = useState(start);
	return (
		<div className="flex h-10 max-w-xl items-center gap-2 rounded-xl border bg-background pr-2 pl-4 text-xs">
			<span className="min-w-0 flex-1 truncate">Fix the flaky build</span>
			<List bookmarks={list} defaultOpen={open} onOpen={fn()} onRemove={(b) => setList((all) => all.filter((x) => x.id !== b.id))} />
		</div>
	);
}

export const BookmarkList: Story = { args: { bookmarks, onOpen: fn(), onRemove: fn() }, render: () => <Head start={bookmarks} /> };

export const Open: Story = { args: { bookmarks, onOpen: fn(), onRemove: fn() }, render: () => <Head start={bookmarks} open /> };

export const One: Story = { args: { bookmarks: bookmarks.slice(1, 2), onOpen: fn(), onRemove: fn() }, render: () => <Head start={bookmarks.slice(1, 2)} open /> };
