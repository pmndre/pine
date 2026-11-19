import { Html, Line, OrbitControls, QuadraticBezierLine } from "@react-three/drei";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import isChromatic from "chromatic/isChromatic";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Fog, type Group, type Mesh, QuadraticBezierCurve3, Vector3 } from "three";
import type { BirdviewModel, Pulse, State } from "../birdview.ts";
import type { DrawProps } from "../Birdview.tsx";

/** How long an event takes to fly from its source to the agents it wakes, ms. */
const TRAVEL = 1600;
/** How long the ripple of an arrival or a flash on a node lasts, ms. */
const RIPPLE = 1100;
/** The ring the agents stand on, and the outer ring of sources and schedules, in scene units. */
const INNER = 4.6;
const OUTER = 9.4;

// The app's tokens, read from the page so that light and dark follow the theme. three.js wants
// plain colours, so each token is resolved by the browser and read back as one pixel.
const TOKENS = {
	background: "--background",
	foreground: "--foreground",
	muted: "--muted-foreground",
	border: "--border",
	primary: "--primary",
	info: "--chart-2",
	plan: "--chart-3",
	warn: "--chart-4",
	error: "--destructive",
} as const;
type Tokens = Record<keyof typeof TOKENS, string>;

function useTokens(ref: RefObject<HTMLElement | null>): Tokens | undefined {
	const [tokens, setTokens] = useState<Tokens>();
	useLayoutEffect(() => {
		const host = ref.current;
		if (!host) return;
		const canvas = document.createElement("canvas");
		canvas.width = canvas.height = 1;
		const ctx = canvas.getContext("2d", { willReadFrequently: true });
		const read = () => {
			const probe = document.createElement("span");
			probe.style.display = "none";
			host.appendChild(probe);
			const out = {} as Tokens;
			for (const [key, name] of Object.entries(TOKENS) as Array<[keyof Tokens, string]>) {
				probe.style.color = `var(${name})`;
				const css = getComputedStyle(probe).color;
				if (!ctx) {
					out[key] = css;
					continue;
				}
				ctx.clearRect(0, 0, 1, 1);
				ctx.fillStyle = "#000";
				ctx.fillStyle = css;
				ctx.fillRect(0, 0, 1, 1);
				const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
				out[key] = `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
			}
			probe.remove();
			setTokens((prev) => (prev && JSON.stringify(prev) === JSON.stringify(out) ? prev : out));
		};
		read();
		const watch = new MutationObserver(read);
		watch.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
		watch.observe(document.head, { childList: true, subtree: true, characterData: true });
		return () => watch.disconnect();
	}, [ref]);
	return tokens;
}

type V3 = [number, number, number];

/**
 * Where the labels go: the view's own element, which is there before the canvas is. drei's Html
 * otherwise goes into the element the canvas listens on, which changes once the controls connect,
 * and a label drawn before that stays empty until it draws again.
 */
const Overlay = createContext<RefObject<HTMLElement> | undefined>(undefined);

const STATE_HEIGHT: Record<State, number> = { idle: 0.4, queued: 0.9, working: 2.1, waiting: 1.8 };

function stateColor(t: Tokens, s: State): string {
	return s === "working" ? t.primary : s === "waiting" ? t.warn : t.muted;
}

function pulseColor(t: Tokens, kind: Pulse["kind"]): string {
	if (kind === "failed") return t.error;
	if (kind === "approval") return t.warn;
	if (kind === "tool") return t.plan;
	if (kind === "queued") return t.muted;
	return t.primary;
}

/** One colour per kind of source; amber and red stay for approvals and failures. */
function lineColor(t: Tokens, types: string[], type: string): string {
	const lines = [t.info, t.primary, t.plan];
	return lines[Math.max(0, [...new Set(types)].sort().indexOf(type)) % lines.length];
}

/** The angle of a point on the ground plane, as seen from above. */
const angleOf = (p: { x: number; z: number }) => Math.atan2(p.z, p.x);

interface Layout {
	agents: Map<string, { x: number; z: number; height: number; activity: number }>;
	/** Sources and schedules on the outer ring. */
	outer: Map<string, { x: number; z: number; angle: number }>;
	/** A satellite's place at this moment: orbiting its agent. */
	moons: Map<string, V3>;
}

/**
 * Where everything stands. Agents on a ring ordered by name, the main one in the middle, so that
 * nothing moves unless something comes or goes. Each source or schedule sits on the outer ring at
 * the mean angle of what it wakes, then pushed apart from its neighbours. Moons orbit by the
 * model's clock, so a still frame is always the same frame.
 */
function layout(m: BirdviewModel): Layout {
	const agents = new Map<string, { x: number; z: number; height: number; activity: number }>();
	const main = m.agents.find((a) => a.main);
	const ring = m.agents.filter((a) => a !== main).sort((a, b) => a.id.localeCompare(b.id));
	const heat = new Map<string, number>();
	for (const p of m.pulses) {
		for (const to of p.to) {
			const agent = to.startsWith("agent:") ? to.slice(6) : to.startsWith("conv:") ? to.slice(5).split("/")[0] : m.satellites.find((s) => s.id === to)?.agent;
			if (agent) heat.set(agent, (heat.get(agent) ?? 0) + p.opacity);
		}
	}
	for (const a of m.agents) {
		const i = ring.indexOf(a);
		const angle = i < 0 ? 0 : (i / ring.length) * Math.PI * 2 - Math.PI / 2 + (ring.length === 2 ? Math.PI / 2 : 0);
		const r = i < 0 ? 0 : main ? INNER : ring.length > 1 ? INNER : 0;
		const activity = Math.min(1, (heat.get(a.id) ?? 0) / 6);
		agents.set(a.id, { x: Math.cos(angle) * r, z: Math.sin(angle) * r, height: STATE_HEIGHT[a.state] + activity * 1.1, activity });
	}

	const outerIds = [...m.sources.map((s) => s.id), ...m.schedules.map((s) => s.id)];
	const wanted = new Map<string, number>();
	for (const [n, id] of outerIds.entries()) {
		const ends = m.links.filter((l) => l.from === id).map((l) => agentOfId(m, l.to));
		let x = 0;
		let z = 0;
		for (const e of ends) {
			const a = e && agents.get(e);
			if (a && (a.x || a.z)) {
				x += Math.cos(angleOf(a));
				z += Math.sin(angleOf(a));
			}
		}
		wanted.set(id, x || z ? Math.atan2(z, x) : (n / Math.max(1, outerIds.length)) * Math.PI * 2 + Math.PI / 5);
	}
	const order = [...outerIds].sort((a, b) => wanted.get(a)! - wanted.get(b)!);
	const angles = order.map((id) => wanted.get(id)!);
	const gap = Math.min(0.5, (Math.PI * 2) / Math.max(1, order.length));
	for (let pass = 0; pass < 40; pass++) {
		for (let i = 0; i < angles.length; i++) {
			const j = (i + 1) % angles.length;
			if (i === j) break;
			let d = angles[j] - angles[i];
			if (j === 0) d += Math.PI * 2;
			if (d < gap) {
				const push = (gap - d) / 2;
				angles[i] -= push;
				angles[j] += push;
			}
		}
	}
	const outer = new Map<string, { x: number; z: number; angle: number }>();
	order.forEach((id, i) => outer.set(id, { x: Math.cos(angles[i]) * OUTER, z: Math.sin(angles[i]) * OUTER, angle: angles[i] }));

	const moons = new Map<string, V3>();
	const byAgent = new Map<string, string[]>();
	for (const s of m.satellites) byAgent.set(s.agent, [...(byAgent.get(s.agent) ?? []), s.id]);
	for (const [agent, ids] of byAgent) {
		const a = agents.get(agent);
		if (!a) continue;
		ids.forEach((id, k) => {
			const radius = 1.05 + (k % 2) * 0.35;
			const angle = (m.now / 1000) * (0.55 - (k % 2) * 0.2) + (k / ids.length) * Math.PI * 2;
			moons.set(id, [a.x + Math.cos(angle) * radius, a.height * 0.62 + (k % 3) * 0.18, a.z + Math.sin(angle) * radius]);
		});
	}
	return { agents, outer, moons };
}

function agentOfId(m: BirdviewModel, id: string): string | undefined {
	if (id.startsWith("agent:")) return id.slice(6);
	if (id.startsWith("conv:")) return id.slice(5).split("/")[0];
	return m.satellites.find((s) => s.id === id)?.agent;
}

/** Where a node is in the scene: the top of an agent's tower, a moon, an emitter. */
function placeOf(m: BirdviewModel, l: Layout, id: string): V3 | undefined {
	const moon = l.moons.get(id);
	if (moon) return moon;
	const o = l.outer.get(id);
	if (o) return [o.x, 0.9, o.z];
	const agent = agentOfId(m, id);
	const a = agent ? l.agents.get(agent) : undefined;
	return a ? [a.x, a.height + 0.35, a.z] : undefined;
}

/** The control point of an arc between two places: halfway, lifted by how far apart they are. */
function midOf(a: V3, b: V3, lift = 0.32): V3 {
	const d = Math.hypot(a[0] - b[0], a[2] - b[2]);
	return [(a[0] + b[0]) / 2, Math.max(a[1], b[1]) + 0.8 + d * lift, (a[2] + b[2]) / 2];
}

interface Pointer {
	onPointerOver: (e: ThreeEvent<PointerEvent>) => void;
	onPointerOut: (e: ThreeEvent<PointerEvent>) => void;
	onClick: (e: ThreeEvent<MouseEvent>) => void;
}

function Label({ position, name, note, faint }: { position: V3; name: string; note?: string; faint?: boolean }) {
	const overlay = useContext(Overlay);
	return (
		<Html portal={overlay} position={position} center zIndexRange={[20, 0]} className="pointer-events-none select-none">
			<div className={`flex flex-col items-center whitespace-nowrap leading-tight ${faint ? "opacity-70" : ""}`}>
				<span className="rounded-sm bg-background/70 px-1 text-xs font-medium text-foreground backdrop-blur-sm">{name}</span>
				{note ? <span className="mt-0.5 font-mono text-[10px] text-muted-foreground">{note}</span> : null}
			</div>
		</Html>
	);
}

/** An agent: a tower whose height follows its state and how much reached it, a glowing orb on top, its name above. */
function Tower({ t, id, main, state, tool, outside, idle, x, z, height, activity, hovered, pointer, now, narrow }: {
	t: Tokens;
	id: string;
	main: boolean;
	state: State;
	tool?: string;
	outside: boolean;
	idle: number;
	x: number;
	z: number;
	height: number;
	activity: number;
	hovered: boolean;
	pointer: Pointer;
	now: number;
	/** A narrow window: the name only, no note under it. */
	narrow: boolean;
}) {
	const shaft = useRef<Mesh>(null);
	const sleeve = useRef<Mesh>(null);
	const top = useRef<Group>(null);
	const current = useRef(height);
	useFrame((_, dt) => {
		current.current += (height - current.current) * Math.min(1, dt * 3);
		const h = current.current;
		if (shaft.current) {
			shaft.current.scale.y = h;
			shaft.current.position.y = h / 2;
		}
		if (sleeve.current) {
			sleeve.current.scale.y = h * 0.92;
			sleeve.current.position.y = (h * 0.92) / 2;
		}
		if (top.current) top.current.position.y = h + 0.35;
	});
	const color = stateColor(t, state);
	const radius = main ? 0.36 : 0.27;
	const beat = state === "working" ? 1 + Math.sin(now / 160) * 0.08 : state === "waiting" ? 1 + Math.max(0, Math.sin(now / 260)) * 0.25 : 1;
	const glow = state === "idle" ? 0.06 + activity * 0.08 : state === "queued" ? 0.1 : 0.16 + activity * 0.1;
	const wave = (now % 1400) / 1400;
	return (
		<group position={[x, 0, z]}>
			{/* The footprint: a disc that brightens with activity, and for an approval an amber wave that keeps coming. */}
			<mesh rotation-x={-Math.PI / 2} position-y={0.01}>
				<circleGeometry args={[radius * 2.2, 48]} />
				<meshBasicMaterial color={color} transparent opacity={0.08 + activity * 0.18} depthWrite={false} />
			</mesh>
			{state === "waiting" ? (
				<mesh rotation-x={-Math.PI / 2} position-y={0.02} scale={1 + wave * 2.4}>
					<ringGeometry args={[radius * 1.6, radius * 1.85, 64]} />
					<meshBasicMaterial color={t.warn} transparent opacity={0.85 * (1 - wave)} depthWrite={false} />
				</mesh>
			) : null}
			<mesh ref={shaft} {...pointer}>
				<cylinderGeometry args={[radius * 0.7, radius, 1, 32]} />
				<meshStandardMaterial color={color} emissive={color} emissiveIntensity={state === "idle" ? 0.15 : 0.55} roughness={0.5} transparent opacity={state === "idle" ? 0.55 : 0.92} />
			</mesh>
			{outside ? (
				// Outside content is a tint around the tower, as if something had seeped in.
				<mesh ref={sleeve}>
					<cylinderGeometry args={[radius * 1.25, radius * 1.45, 1, 32, 1, true]} />
					<meshBasicMaterial color={t.error} transparent opacity={0.22} depthWrite={false} side={2} />
				</mesh>
			) : null}
			<group ref={top}>
				<mesh scale={beat * (hovered ? 1.25 : 1)} {...pointer}>
					<sphereGeometry args={[radius * 1.05, 32, 16]} />
					<meshBasicMaterial color={color} />
				</mesh>
				<mesh scale={beat * (1.6 + activity * 0.5)}>
					<sphereGeometry args={[radius * 1.05, 32, 16]} />
					<meshBasicMaterial color={color} transparent opacity={glow} depthWrite={false} />
				</mesh>
				<Label position={[0, radius + 0.55, 0]} name={id} note={narrow ? undefined : [tool, state === "idle" ? undefined : state, idle ? `+${idle} idle` : undefined].filter(Boolean).join(" · ") || undefined} />
			</group>
		</group>
	);
}

/** A source: an emitter on the outer ring, a crystal turning over a pole. */
function Emitter({ t, name, color, running, x, z, hovered, pointer, now }: { t: Tokens; name: string; color: string; running: boolean; x: number; z: number; hovered: boolean; pointer: Pointer; now: number }) {
	const c = running ? color : t.muted;
	return (
		<group position={[x, 0, z]}>
			<mesh position-y={0.35}>
				<cylinderGeometry args={[0.03, 0.06, 0.7, 8]} />
				<meshBasicMaterial color={t.muted} transparent opacity={0.6} />
			</mesh>
			<mesh position-y={0.9} rotation-y={now / 900} scale={hovered ? 1.3 : 1} {...pointer}>
				<octahedronGeometry args={[0.28, 0]} />
				<meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.6} flatShading />
			</mesh>
			<mesh position-y={0.9} scale={2.2}>
				<sphereGeometry args={[0.2, 16, 8]} />
				<meshBasicMaterial color={c} transparent opacity={0.1} depthWrite={false} />
			</mesh>
			<Label position={[0, -0.05, 0]} name={name} faint />
		</group>
	);
}

/** A schedule: a ring standing on the outer ring, a dot running round it like a hand. */
function Clock({ t, name, x, z, angle, hovered, pointer, now }: { t: Tokens; name: string; x: number; z: number; angle: number; hovered: boolean; pointer: Pointer; now: number }) {
	const hand = now / 1500;
	return (
		<group position={[x, 0.9, z]} rotation-y={-angle + Math.PI / 2} scale={hovered ? 1.25 : 1}>
			<mesh {...pointer}>
				<torusGeometry args={[0.3, 0.05, 8, 40]} />
				<meshStandardMaterial color={t.muted} emissive={t.muted} emissiveIntensity={0.4} />
			</mesh>
			<mesh position={[Math.cos(hand) * 0.3, Math.sin(hand) * 0.3, 0]}>
				<sphereGeometry args={[0.07, 12, 8]} />
				<meshBasicMaterial color={t.foreground} />
			</mesh>
			<Label position={[0, -0.95, 0]} name={name} faint />
		</group>
	);
}

/** An event in flight: a comet with a tail along the arc. */
function Comet({ from, to, progress, color, opacity, pointer }: { from: V3; to: V3; progress: number; color: string; opacity: number; pointer: Pointer }) {
	const curve = new QuadraticBezierCurve3(new Vector3(...from), new Vector3(...midOf(from, to)), new Vector3(...to));
	return (
		<group>
			{[0, 1, 2, 3, 4, 5].map((k) => {
				const at = progress - k * 0.035;
				if (at < 0) return null;
				const p = curve.getPoint(Math.min(1, at));
				return (
					<mesh key={k} position={p} {...(k === 0 ? pointer : {})}>
						<sphereGeometry args={[k === 0 ? 0.13 : 0.1 - k * 0.012, 12, 8]} />
						<meshBasicMaterial color={color} transparent opacity={opacity * (1 - k / 6)} depthWrite={false} />
					</mesh>
				);
			})}
		</group>
	);
}

/** Something that happened on a node: a ring that opens and fades. */
function Flash({ at, color, age, ground }: { at: V3; color: string; age: number; ground?: boolean }) {
	const k = age / RIPPLE;
	return (
		<mesh position={ground ? [at[0], 0.03, at[2]] : at} rotation-x={ground ? -Math.PI / 2 : 0} scale={ground ? 0.6 + k * 2.4 : 0.6 + k * 1.2}>
			<ringGeometry args={[0.45, 0.55, 48]} />
			<meshBasicMaterial color={color} transparent opacity={(1 - k) * 0.9} depthWrite={false} side={2} />
		</mesh>
	);
}

/** Keeps the whole scene in view: a narrow window gets the camera further back. */
function Rig({ still, background }: { still: boolean; background: string }) {
	const { camera, size, scene } = useThree();
	useEffect(() => {
		const aspect = size.width / Math.max(1, size.height);
		const back = aspect < 1 ? 1.4 / Math.max(0.4, aspect) : aspect < 1.4 ? 1.3 : 1;
		camera.position.set(0, 22.5 * back, 23.5 * back);
		camera.lookAt(0, 0.4, 0);
		// The far side of the world fades into the page, at whatever distance the camera stands.
		const d = camera.position.length();
		scene.fog = new Fog(background, d * 0.8, d * 1.6);
	}, [camera, scene, background, size.width, size.height]);
	return <OrbitControls autoRotate={!still} autoRotateSpeed={0.35} enablePan={false} enableDamping minDistance={8} maxDistance={140} maxPolarAngle={1.35} target={[0, 0.4, 0]} />;
}

function Scene({ t, model: m, hovered, onHover, onPick, still }: DrawProps & { t: Tokens; still: boolean }) {
	const l = layout(m);
	const overlay = useContext(Overlay);
	const narrow = useThree((s) => s.size.width) < 560;
	const now = m.now;
	const types = m.sources.map((s) => s.type);
	const pointer = (id: string): Pointer => ({
		onPointerOver: (e) => {
			e.stopPropagation();
			onHover(id);
			document.body.style.cursor = "pointer";
		},
		onPointerOut: (e) => {
			e.stopPropagation();
			onHover(undefined);
			document.body.style.cursor = "";
		},
		onClick: (e) => {
			e.stopPropagation();
			onPick(id);
		},
	});
	const sourceColor = (id: string) => {
		const s = m.sources.find((x) => x.id === id);
		return s ? lineColor(t, types, s.type) : t.muted;
	};
	// How much passed over a lasting link in the window: the trail makes it brighter.
	const traffic = (from: string, to: string) => {
		let n = 0;
		for (const p of m.pulses) if (p.from === from && p.to.includes(to)) n += p.opacity;
		return Math.min(1, n / 3);
	};

	return (
		<>
			<ambientLight intensity={0.9} />
			<directionalLight position={[6, 12, 8]} intensity={1.4} />

			{/* The ground: a disc, the agents' ring and the outer ring. */}
			<mesh rotation-x={-Math.PI / 2} position-y={-0.01}>
				<circleGeometry args={[OUTER + 2.2, 96]} />
				<meshBasicMaterial color={t.foreground} transparent opacity={0.035} depthWrite={false} />
			</mesh>
			{[INNER, OUTER].map((r) => (
				<Line
					key={r}
					points={Array.from({ length: 129 }, (_, i) => [Math.cos((i / 128) * Math.PI * 2) * r, 0.005, Math.sin((i / 128) * Math.PI * 2) * r] as V3)}
					color={t.muted}
					lineWidth={1}
					transparent
					opacity={r === OUTER ? 0.35 : 0.2}
					dashed={r === OUTER}
					dashSize={0.25}
					gapSize={0.25}
				/>
			))}

			{/* Lasting links: subscriptions and schedules, arcs that glow with what passed over them. */}
			{m.links
				.filter((k) => k.kind === "subscription" || k.kind === "schedule")
				.map((k) => {
					const a = placeOf(m, l, k.from);
					const b = placeOf(m, l, k.to);
					if (!a || !b) return null;
					const id = `link:${k.id}`;
					const on = hovered === id;
					const color = k.kind === "schedule" ? t.muted : sourceColor(k.from);
					return (
						<QuadraticBezierLine
							key={k.id}
							start={a}
							end={b}
							mid={midOf(a, b)}
							color={color}
							lineWidth={on ? 3 : 1.2 + traffic(k.from, k.to) * 1.5}
							transparent
							opacity={on ? 0.95 : 0.22 + traffic(k.from, k.to) * 0.45}
							dashed={k.kind === "schedule"}
							dashSize={0.2}
							gapSize={0.15}
							{...pointer(id)}
						/>
					);
				})}

			{/* Delegations and sub-agents: beams of light between agents, with light running along them. */}
			{m.links
				.filter((k) => k.kind === "delegation" || k.kind === "subagent")
				.map((k) => {
					const a = placeOf(m, l, k.from);
					const b = placeOf(m, l, k.to);
					if (!a || !b) return null;
					const id = `link:${k.id}`;
					const mid = midOf(a, b, k.kind === "delegation" ? 0.45 : 0.6);
					const curve = new QuadraticBezierCurve3(new Vector3(...a), new Vector3(...mid), new Vector3(...b));
					return (
						<group key={k.id}>
							<QuadraticBezierLine start={a} end={b} mid={mid} color={t.plan} lineWidth={hovered === id ? 9 : 7} transparent opacity={0.18 * k.opacity} depthWrite={false} {...pointer(id)} />
							<QuadraticBezierLine start={a} end={b} mid={mid} color={t.plan} lineWidth={2} transparent opacity={0.95 * k.opacity} />
							{k.opacity > 0.6
								? [0, 1, 2].map((n) => (
										<mesh key={n} position={curve.getPoint(((now / 900 + n / 3) % 1 + 1) % 1)}>
											<sphereGeometry args={[0.09, 12, 8]} />
											<meshBasicMaterial color={t.plan} />
										</mesh>
									))
								: null}
						</group>
					);
				})}

			{m.agents.map((a) => {
				const p = l.agents.get(a.id)!;
				const id = `agent:${a.id}`;
				return <Tower key={a.id} t={t} id={a.id} main={a.main} state={a.state} tool={a.tool} outside={a.outside} idle={a.idle} x={p.x} z={p.z} height={p.height} activity={p.activity} hovered={hovered === id} pointer={pointer(id)} now={now} narrow={narrow} />;
			})}

			{/* Conversations, sub-agents and delegated tasks: moons round their agent. */}
			{m.satellites.map((s) => {
				const at = l.moons.get(s.id);
				if (!at) return null;
				const color = s.ended === "failed" ? t.error : stateColor(t, s.state);
				const on = hovered === s.id;
				const size = s.kind === "conversation" ? 0.17 : 0.13;
				const blink = s.state === "waiting" ? 1 + Math.max(0, Math.sin(now / 260)) * 0.6 : 1;
				return (
					<group key={s.id} position={at}>
						<mesh scale={(on ? 1.4 : 1) * blink} {...pointer(s.id)}>
							{s.kind === "conversation" ? <sphereGeometry args={[size, 20, 12]} /> : <octahedronGeometry args={[size * 1.2, 0]} />}
							<meshBasicMaterial color={color} transparent opacity={0.25 + 0.75 * s.opacity} />
						</mesh>
						{s.outside ? (
							<mesh scale={1.9}>
								<sphereGeometry args={[size, 20, 12]} />
								<meshBasicMaterial color={t.error} transparent opacity={0.3 * s.opacity} depthWrite={false} />
							</mesh>
						) : null}
						{!narrow && s.opacity > 0.5 && s.state !== "idle" ? (
							<Html portal={overlay} position={[0, size + 0.22, 0]} center zIndexRange={[20, 0]} className="pointer-events-none select-none">
								<span className="whitespace-nowrap font-mono text-[10px] text-muted-foreground">{s.session}</span>
							</Html>
						) : null}
					</group>
				);
			})}

			{m.sources.map((s) => {
				const o = l.outer.get(s.id);
				return o ? <Emitter key={s.id} t={t} name={s.scope === "global" ? s.name : `${s.name}@${s.scope}`} color={sourceColor(s.id)} running={s.running} x={o.x} z={o.z} hovered={hovered === s.id} pointer={pointer(s.id)} now={now} /> : null;
			})}
			{m.schedules.map((s) => {
				const o = l.outer.get(s.id);
				return o ? <Clock key={s.id} t={t} name={s.scope === "global" ? s.name : `${s.name}@${s.scope}`} x={o.x} z={o.z} angle={o.angle} hovered={hovered === s.id} pointer={pointer(s.id)} now={now} /> : null;
			})}

			{/* Events: comets from a source to what it wakes, back for a send; a ripple where they land; flashes on nodes. */}
			{m.pulses.flatMap((p) => {
				const out: ReactNode[] = [];
				const id = `pulse:${p.id}`;
				const faint = p.replayed ? 0.5 : 1;
				if (p.from && (p.kind === "source" || p.kind === "schedule" || p.kind === "send")) {
					const a = placeOf(m, l, p.from);
					const color = p.kind === "schedule" ? t.foreground : p.kind === "send" ? sourceColor(p.to[0]) : sourceColor(p.from);
					for (const [n, to] of p.to.entries()) {
						const b = placeOf(m, l, to);
						if (!a || !b) continue;
						if (p.age < TRAVEL) out.push(<Comet key={`${p.id}-${n}`} from={a} to={b} progress={p.age / TRAVEL} color={color} opacity={faint} pointer={pointer(id)} />);
						else if (p.age < TRAVEL + RIPPLE) out.push(<Flash key={`${p.id}-${n}`} at={b} color={color} age={p.age - TRAVEL} ground={p.kind !== "send"} />);
					}
				} else if (p.age < RIPPLE && p.kind !== "event") {
					for (const [n, to] of p.to.entries()) {
						const at = placeOf(m, l, to);
						if (at) out.push(<Flash key={`${p.id}-${n}`} at={at} color={pulseColor(t, p.kind)} age={p.age} />);
					}
				}
				return out;
			})}

			<Rig still={still} background={t.background} />
		</>
	);
}

/**
 * Direction "space": pine as a small world seen from a slowly orbiting camera. Agents are glowing
 * towers on a plane, taller and brighter as they work and as events reach them; their
 * conversations orbit them as moons; sources and schedules stand on an outer ring as emitters;
 * events fly as comets along arcs from a source to the agents it wakes; a delegation is a beam of
 * light between two agents; an approval sends amber waves from the tower; outside content tints
 * the tower and the moon it entered. Labels are pine's names only; hover and click go through the
 * frame.
 */
export function Space(props: DrawProps) {
	const host = useRef<HTMLDivElement>(null);
	const t = useTokens(host);
	const still = isChromatic();
	return (
		<div ref={host} data-slot="birdview-space" className="absolute inset-0 overflow-hidden">
			{t ? (
				<Canvas flat dpr={[1, 2]} camera={{ fov: 30, position: [0, 22.5, 23.5], near: 0.1, far: 200 }} onPointerMissed={() => props.onHover(undefined)}>
					<Overlay value={host as RefObject<HTMLElement>}>
						<Scene {...props} t={t} still={still} />
					</Overlay>
				</Canvas>
			) : null}
		</div>
	);
}
