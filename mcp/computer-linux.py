# The helper of pine's bundled MCP server "computer" (mcp/computer.ts), for Linux with X11.
#
# It does what Node cannot do (read an app's accessibility tree over AT-SPI, find windows and
# where they are on the X server, move the pointer and press keys with xdotool, take a picture
# of the screen with ImageMagick's import) and decides nothing. Which app may be operated, what
# a result says and how a picture's coordinates become a point on the screen is all in
# computer.ts, where it is tested. It speaks the protocol of computer.swift: one JSON request per
# line on stdin ({"id", "cmd", ...}), one answer per line on stdout ({"id", "ok", ...} or
# {"id", "ok": false, "code", "error"}).
#
# pine runs it with the system's python3, isolated (-I), and every program it starts by its
# absolute path with fixed arguments. Points are pixels of the X screen, origin top left.
#
# X11 sends keys and clicks to whatever window is in front or under the pointer, not to a
# process. So where a request names the app (`pid`), this helper looks right before each piece
# of input that the app is still in front, or under the position, and stops when it is not
# (code "moved"): that is what "the keys go to this app and to no other" means on X11.
#
# Started with --demo it opens a small GTK window of its own ("Pine Demo") and does nothing
# else, for the tests.
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import warnings

# libatspi calls its interface functions on an accessible deprecated, and says so on every call.
warnings.filterwarnings("ignore", category=DeprecationWarning)

XDOTOOL = "/usr/bin/xdotool"
IMPORT = "/usr/bin/import"
DEMO = "Pine Demo"


class Fail(Exception):
	def __init__(self, code, message=""):
		super().__init__(message)
		self.code = code
		self.message = message


# ---- the demo window ------------------------------------------------------------------------------


def demo():
	import gi

	gi.require_version("Gtk", "3.0")
	gi.require_version("Gdk", "3.0")
	from gi.repository import Gdk, GLib, Gtk

	GLib.set_application_name(DEMO)
	GLib.set_prgname(DEMO)
	win = Gtk.Window(title=DEMO)
	win.set_default_size(360, 220)
	box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
	bar = Gtk.MenuBar()
	top = Gtk.MenuItem(label="Demo")
	menu = Gtk.Menu()
	reset = Gtk.MenuItem(label="Reset")
	accel = Gtk.AccelGroup()
	win.add_accel_group(accel)
	reset.add_accelerator("activate", accel, ord("r"), Gdk.ModifierType.CONTROL_MASK, Gtk.AccelFlags.VISIBLE)
	menu.append(reset)
	top.set_submenu(menu)
	bar.append(top)
	field = Gtk.Entry()
	field.set_placeholder_text("A word")
	button = Gtk.Button(label="Shout")
	loud = Gtk.CheckButton(label="Loud")
	result = Gtk.Label(label="Nothing yet")

	def shout(_):
		result.set_text(field.get_text().upper() + ("!!!" if loud.get_active() else "!"))

	def clear(_):
		field.set_text("")
		result.set_text("Nothing yet")

	button.connect("clicked", shout)
	reset.connect("activate", clear)
	for w in (bar, field, button, loud, result):
		box.pack_start(w, False, False, 0)
	win.add(box)
	win.connect("destroy", Gtk.main_quit)
	win.show_all()
	Gtk.main()


if "--demo" in sys.argv:
	demo()
	sys.exit(0)

import gi  # noqa: E402

gi.require_version("Atspi", "2.0")
from gi.repository import Atspi, GLib  # noqa: E402
from Xlib import X, Xatom, display  # noqa: E402
from Xlib.error import XError  # noqa: E402

# ---- the X server ---------------------------------------------------------------------------------

d = display.Display()
root = d.screen().root
_atoms = {}


def atom(name):
	if name not in _atoms:
		_atoms[name] = d.intern_atom(name)
	return _atoms[name]


def prop(w, name, kind=X.AnyPropertyType):
	try:
		p = w.get_full_property(atom(name), kind)
	except XError:
		return None
	return p.value if p is not None else None


def window(wid):
	return d.create_resource_object("window", int(wid))


def wm_pid(w):
	v = prop(w, "_NET_WM_PID", Xatom.CARDINAL)
	return int(v[0]) if v is not None and len(v) else 0


def title(w):
	v = prop(w, "_NET_WM_NAME", atom("UTF8_STRING"))
	if v is None:
		v = prop(w, "WM_NAME")
	if v is None:
		return ""
	return v.decode("utf-8", "replace") if isinstance(v, bytes) else str(v)


def wm_class(w):
	try:
		c = w.get_wm_class()
	except XError:
		return None
	return c


def has_wm():
	return prop(root, "_NET_SUPPORTING_WM_CHECK") is not None


def clients():
	"""The windows of apps, from the back to the front."""
	v = prop(root, "_NET_CLIENT_LIST_STACKING", Xatom.WINDOW)
	if v is None:
		v = prop(root, "_NET_CLIENT_LIST", Xatom.WINDOW)
	if v is not None:
		return [window(x) for x in v]
	# Without a window manager the apps' windows are the screen's own children.
	out = []
	for w in root.query_tree().children:
		try:
			if w.get_attributes().map_state == X.IsViewable and wm_pid(w):
				out.append(w)
		except XError:
			pass
	return out


def kind_ok(w):
	types = prop(w, "_NET_WM_WINDOW_TYPE", Xatom.ATOM)
	if types is None:
		return True
	bad = {atom(n) for n in ("_NET_WM_WINDOW_TYPE_DOCK", "_NET_WM_WINDOW_TYPE_DESKTOP", "_NET_WM_WINDOW_TYPE_TOOLBAR", "_NET_WM_WINDOW_TYPE_MENU", "_NET_WM_WINDOW_TYPE_SPLASH", "_NET_WM_WINDOW_TYPE_NOTIFICATION")}
	return not any(t in bad for t in types)


def minimized(w):
	state = prop(w, "_NET_WM_STATE", Xatom.ATOM)
	if state is not None and atom("_NET_WM_STATE_HIDDEN") in state:
		return True
	s = prop(w, "WM_STATE")
	return s is not None and len(s) and int(s[0]) == 3


def viewable(w):
	try:
		return w.get_attributes().map_state == X.IsViewable
	except XError:
		return False


def rect(w):
	"""Where a window is on the screen, with the frame the window manager draws around it."""
	g = w.get_geometry()
	t = root.translate_coords(w, 0, 0)
	x, y, width, height = t.x, t.y, g.width, g.height
	frame = prop(w, "_NET_FRAME_EXTENTS", Xatom.CARDINAL)
	if frame is not None and len(frame) == 4:
		left, right, top, bottom = (int(n) for n in frame)
		x, y, width, height = x - left, y - top, width + left + right, height + top + bottom
	# A window that draws its own frame has a shadow around it that is no part of it.
	gtk = prop(w, "_GTK_FRAME_EXTENTS", Xatom.CARDINAL)
	if gtk is not None and len(gtk) == 4:
		left, right, top, bottom = (int(n) for n in gtk)
		x, y, width, height = x + left, y + top, width - left - right, height - top - bottom
	return (x, y, max(0, width), max(0, height))


def screen_rect():
	g = root.get_geometry()
	return (0, 0, g.width, g.height)


def displays():
	out = []
	try:
		mons = d.xrandr_get_monitors(root).monitors
		for i, m in enumerate(sorted(mons, key=lambda m: 0 if m.primary else 1)):
			out.append({"index": i + 1, "x": m.x, "y": m.y, "w": m.width_in_pixels, "h": m.height_in_pixels, "main": bool(m.primary) or i == 0})
	except Exception:
		pass
	if not out:
		_, _, w, h = screen_rect()
		out = [{"index": 1, "x": 0, "y": 0, "w": w, "h": h, "main": True}]
	return out


def toplevel(w):
	"""The app window a window belongs to: itself, or the one above it that is an app's."""
	ids = {c.id for c in clients()}
	for _ in range(32):
		if w is None or w.id == root.id:
			return None
		if w.id in ids:
			return w
		try:
			p = w.query_tree().parent
		except XError:
			return None
		w = p
	return None


def active():
	"""The app window in front."""
	v = prop(root, "_NET_ACTIVE_WINDOW", Xatom.WINDOW)
	if v is not None and len(v) and v[0]:
		return window(v[0])
	try:
		f = d.get_input_focus().focus
	except XError:
		return None
	if not hasattr(f, "id"):
		return None
	return toplevel(f)


def front_pid():
	w = active()
	return wm_pid(w) if w is not None else 0


def window_at(x, y):
	"""The app window on top at a point."""
	for w in reversed(clients()):
		try:
			if not viewable(w) or minimized(w):
				continue
			wx, wy, ww, wh = rect(w)
		except XError:
			continue
		if wx <= x < wx + ww and wy <= y < wy + wh:
			return w
	return None


# ---- processes and apps ---------------------------------------------------------------------------


def parent_of(pid):
	try:
		with open("/proc/%d/stat" % pid) as f:
			return int(f.read().rsplit(")", 1)[1].split()[1])
	except (OSError, ValueError, IndexError):
		return 0


def comm(pid):
	try:
		with open("/proc/%d/comm" % pid) as f:
			return f.read().strip()
	except OSError:
		return ""


def exe(pid):
	try:
		return os.readlink("/proc/%d/exe" % pid)
	except OSError:
		return ""


def alive(pid):
	return pid > 0 and os.path.exists("/proc/%d" % pid)


def windows_by_pid():
	out = {}
	for w in clients():
		try:
			pid = wm_pid(w)
			if pid and kind_ok(w):
				out.setdefault(pid, []).append(w)
		except XError:
			pass
	# The front window first, as on a Mac.
	for pid in out:
		out[pid].reverse()
	return out


def atspi_apps():
	out = {}
	try:
		desk = Atspi.get_desktop(0)
		for i in range(desk.get_child_count()):
			a = desk.get_child_at_index(i)
			if a is None:
				continue
			try:
				out[a.get_process_id()] = a
			except GLib.Error:
				pass
	except GLib.Error:
		pass
	return out


def host_pids():
	"""The app pine runs in: the first process above this one that has a window, and the terminal window named in WINDOWID."""
	wins = windows_by_pid()
	found = []
	pid = os.getppid()
	for _ in range(32):
		if pid <= 1:
			break
		if pid in wins:
			found.append(pid)
			break
		pid = parent_of(pid)
	wid = os.environ.get("WINDOWID", "")
	if wid.isdigit():
		try:
			p = wm_pid(window(int(wid)))
			if p and p not in found:
				found.append(p)
		except XError:
			pass
	return found


HOST = host_pids()


def name_of(pid, app=None):
	if app is None:
		app = atspi_apps().get(pid)
	if app is not None:
		try:
			n = app.get_name()
			if n:
				return n
		except GLib.Error:
			pass
	wins = windows_by_pid().get(pid) or []
	for w in wins:
		c = wm_class(w)
		if c and c[1]:
			return c[1]
	return comm(pid) or ("pid %d" % pid)


def info(pid, app=None):
	return {"name": name_of(pid, app), "pid": pid, "bundle": exe(pid), "host": pid in HOST, "front": front_pid() == pid, "hidden": False}


def names(pid, app=None):
	out = [name_of(pid, app), comm(pid), os.path.basename(exe(pid))]
	for w in windows_by_pid().get(pid) or []:
		c = wm_class(w)
		if c:
			out.extend(c)
	return {n.lower() for n in out if n}


def look_up(query):
	q = query.strip().lower()
	if not q:
		return None
	wins = windows_by_pid()
	apps = atspi_apps()
	# An app with windows before one without.
	for pid in list(wins) + [p for p in apps if p not in wins]:
		if q in names(pid, apps.get(pid)):
			return pid
	return None


def running(p):
	pid = int(p.get("pid") or 0)
	if not alive(pid):
		raise Fail("not_running", "the app is not running any more")
	return pid


# ---- references -----------------------------------------------------------------------------------

elements = {}
refs = {}
counter = [0]


def ref_for(acc):
	r = refs.get(acc)
	if r:
		return r
	if len(elements) > 50000:
		elements.clear()
		refs.clear()
	counter[0] += 1
	r = "e%d" % counter[0]
	refs[acc] = r
	elements[r] = acc
	return r


def element(p):
	acc = elements.get(str(p.get("ref", "")))
	if acc is None:
		raise Fail("gone", "no control has this reference")
	return acc


def win_ref(w):
	return "x%d" % w.id


def win_of(p):
	r = str(p.get("ref", ""))
	if not r.startswith("x") or not r[1:].isdigit():
		return None
	w = window(int(r[1:]))
	try:
		w.get_geometry()
	except XError:
		raise Fail("gone", "this window does not exist any more")
	return w


def describe(w, index, front=None):
	x, y, width, height = rect(w)
	out = {"index": index, "ref": win_ref(w), "title": title(w), "x": x, "y": y, "w": width, "h": height}
	if minimized(w):
		out["minimized"] = True
	if front is not None and front.id == w.id:
		out["main"] = True
	return out


def window_list(pid):
	f = active()
	return [describe(w, i + 1, f) for i, w in enumerate(windows_by_pid().get(pid) or [])]


# ---- the outline ----------------------------------------------------------------------------------

# AT-SPI's roles in the words of macOS's accessibility, which computer.ts turns into an outline.
ROLES = {
	"push-button": "AXButton", "button": "AXButton", "toggle-button": ("AXCheckBox", "AXToggle"), "check-box": "AXCheckBox", "radio-button": "AXRadioButton",
	"text": "AXTextField", "entry": "AXTextField", "password-text": ("AXTextField", "AXSecureTextField"), "label": "AXStaticText", "static": "AXStaticText",
	"paragraph": "AXStaticText", "caption": "AXStaticText", "link": "AXLink", "panel": "AXGroup", "filler": "AXGroup", "section": "AXGroup", "form": "AXGroup",
	"grouping": "AXGroup", "viewport": "AXGroup", "scroll-pane": "AXScrollArea", "split-pane": "AXSplitGroup", "layered-pane": "AXGroup", "internal-frame": "AXGroup",
	"table": "AXTable", "tree-table": "AXTable", "tree": "AXOutline", "list": "AXList", "list-box": "AXList", "table-row": "AXRow", "list-item": "AXRow",
	"tree-item": "AXRow", "table-cell": "AXCell", "menu": "AXMenu", "menu-item": "AXMenuItem", "check-menu-item": "AXMenuItem", "radio-menu-item": "AXMenuItem",
	"tool-bar": "AXToolbar", "page-tab-list": "AXTabGroup", "page-tab": ("AXButton", "AXTabButton"), "slider": "AXSlider", "spin-button": "AXIncrementor",
	"combo-box": "AXComboBox", "heading": "AXHeading", "document-web": "AXWebArea", "document-frame": "AXWebArea", "document-text": "AXTextArea",
	"image": "AXImage", "icon": "AXImage", "progress-bar": "AXProgressIndicator", "dialog": "AXSheet", "alert": ("AXSheet", "AXDialog"), "file-chooser": "AXSheet",
	"frame": "AXWindow", "window": "AXWindow", "status-bar": "AXStatusBar", "column-header": "AXColumnHeader", "row-header": "AXRowHeader",
}
SKIPPED = {"scroll-bar", "separator", "menu-bar", "tear-off-menu-item", "redundant-object"}
PRESS = ("click", "press", "activate", "toggle", "jump", "open", "select")
EDITABLE = {"text", "entry", "password-text", "combo-box", "spin-button", "slider", "document-text", "paragraph", "terminal"}
ROWS = {"table-row", "list-item", "tree-item", "page-tab"}
# What holds rows: only those that can be seen are listed, the rest is reached by scrolling.
HOLDERS = {"table", "tree-table", "tree", "list", "list-box"}


def nick(acc):
	try:
		return acc.get_role().value_nick
	except (GLib.Error, AttributeError):
		return "unknown"


def role_of(r):
	m = ROLES.get(r)
	if m is None:
		return ("AX" + "".join(p.capitalize() for p in r.split("-")), None)
	return m if isinstance(m, tuple) else (m, None)


def interfaces(acc):
	try:
		return set(acc.get_interfaces())
	except GLib.Error:
		return set()


def states(acc):
	try:
		s = acc.get_state_set()
	except GLib.Error:
		return set()
	return {t for t in ("SENSITIVE", "ENABLED", "FOCUSED", "SELECTED", "CHECKED", "INDETERMINATE", "EDITABLE", "SHOWING", "VISIBLE", "PRESSED", "EXPANDABLE", "DEFUNCT") if s.contains(getattr(Atspi.StateType, t))}


def action_names(acc, ifs):
	if "Action" not in ifs:
		return []
	try:
		return [Atspi.Action.get_action_name(acc, i) for i in range(Atspi.Action.get_n_actions(acc))]
	except GLib.Error:
		return []


def text_of(acc, ifs, limit=6000):
	if "Text" not in ifs:
		return None, 0
	try:
		n = Atspi.Text.get_character_count(acc)
		return Atspi.Text.get_text(acc, 0, min(n, limit)), max(0, n - limit)
	except GLib.Error:
		return None, 0


def extents(acc):
	try:
		e = Atspi.Component.get_extents(acc, Atspi.CoordType.SCREEN)
		return (e.x, e.y, e.width, e.height)
	except (GLib.Error, AttributeError):
		return None


def node(acc, depth, walk, holder=False):
	if walk["count"] >= walk["limit"] or depth > 60:
		walk["cut"] = True
		return None
	r = nick(acc)
	if r in SKIPPED:
		return None
	st = states(acc)
	if "DEFUNCT" in st or (holder and "SHOWING" not in st):
		return None
	walk["count"] += 1
	role, subrole = role_of(r)
	n = {"role": role}
	if subrole:
		n["subrole"] = subrole
	try:
		name = acc.get_name() or ""
		desc = acc.get_description() or ""
	except GLib.Error:
		name, desc = "", ""
	if name:
		n["title"] = name
	if desc and desc != name:
		n["desc"] = desc
	ifs = interfaces(acc)
	if r in EDITABLE or role == "AXTextField":
		value, more = text_of(acc, ifs)
		if subrole == "AXSecureTextField":
			value = None
		if value:
			n["value"] = value
			if more:
				n["more"] = more
	if "Value" in ifs and r in ("slider", "spin-button", "progress-bar", "scroll-bar"):
		try:
			n["value"] = Atspi.Value.get_current_value(acc)
		except GLib.Error:
			pass
	if role in ("AXCheckBox", "AXRadioButton"):
		n["value"] = 2 if "INDETERMINATE" in st else 1 if ("CHECKED" in st or "PRESSED" in st) else 0
	if "SENSITIVE" not in st and "ENABLED" not in st:
		n["disabled"] = True
	if "FOCUSED" in st:
		n["focused"] = True
	if "SELECTED" in st:
		n["selected"] = True
	acts = action_names(acc, ifs)
	press = any(a in PRESS for a in acts) and r not in ("frame", "window", "panel", "filler", "scroll-pane", "label")
	edit = ("EditableText" in ifs and "EDITABLE" in st) or ("Value" in ifs and r in ("slider", "spin-button"))
	if press:
		n["press"] = True
	if edit:
		n["edit"] = True
	if press or edit or r in ROWS or r in EDITABLE and ("EDITABLE" in st):
		n["ref"] = ref_for(acc)
	children = []
	try:
		count = acc.get_child_count()
	except GLib.Error:
		count = 0
	# A list of thousands is its rows on the screen.
	for i in range(min(count, 5000)):
		try:
			kid = acc.get_child_at_index(i)
		except GLib.Error:
			continue
		if kid is None:
			continue
		c = node(kid, depth + 1, walk, r in HOLDERS)
		if c is not None:
			children.append(c)
	if children:
		n["children"] = children
	return n


def frame_for(pid, w):
	"""The accessible of an app that is a window of the X server."""
	apps = atspi_apps()
	app = apps.get(pid)
	if app is None:
		raise Fail("undescribed", "")
	want = title(w)
	wx, wy, ww, wh = rect(w)
	frames = []
	try:
		for i in range(app.get_child_count()):
			c = app.get_child_at_index(i)
			if c is not None:
				frames.append(c)
	except GLib.Error:
		pass
	best = None
	for c in frames:
		try:
			if want and c.get_name() == want:
				return c
		except GLib.Error:
			continue
	for c in frames:
		e = extents(c)
		if e and abs(e[0] - wx) < 60 and abs(e[1] - wy) < 60 and abs(e[2] - ww) < 120 and abs(e[3] - wh) < 120:
			best = best or c
	if best is not None:
		return best
	if len(frames) == 1:
		return frames[0]
	raise Fail("undescribed", "")


def descendant(acc, roles, depth=0):
	if depth > 8:
		return None
	try:
		count = acc.get_child_count()
	except GLib.Error:
		return None
	for i in range(min(count, 200)):
		try:
			kid = acc.get_child_at_index(i)
		except GLib.Error:
			continue
		if kid is None:
			continue
		if nick(kid) in roles:
			return kid
		found = descendant(kid, roles, depth + 1)
		if found is not None:
			return found
	return None


MODS_SHORT = {"control": "ctrl", "primary": "ctrl", "ctrl": "ctrl", "alt": "alt", "mod1": "alt", "shift": "shift", "super": "super", "meta": "meta"}


def shortcut(acc, ifs):
	"""A menu entry's shortcut as GTK writes it ("<Control>s", the third of "mnemonic;sequence;shortcut") in pine's words."""
	if "Action" not in ifs:
		return None
	try:
		raw = Atspi.Action.get_key_binding(acc, 0) or ""
	except GLib.Error:
		return None
	parts = raw.split(";")
	key = parts[2] if len(parts) > 2 and parts[2] else (parts[0] if len(parts) == 1 and "<" in parts[0] else "")
	if not key:
		return None
	mods = [MODS_SHORT.get(m.lower(), m.lower()) for m in re.findall(r"<([^>]+)>", key)]
	rest = re.sub(r"<[^>]+>", "", key).lower()
	return "+".join(mods + [rest]) if rest else None


def menu_items(parent):
	out = []
	try:
		count = parent.get_child_count()
	except GLib.Error:
		return out
	for i in range(min(count, 200)):
		try:
			kid = parent.get_child_at_index(i)
		except GLib.Error:
			continue
		if kid is None:
			continue
		r = nick(kid)
		if r not in ("menu", "menu-item", "check-menu-item", "radio-menu-item"):
			continue
		try:
			t = kid.get_name() or ""
		except GLib.Error:
			continue
		if not t:
			continue
		st = states(kid)
		item = {"ref": ref_for(kid), "title": t}
		if "SENSITIVE" not in st and "ENABLED" not in st:
			item["disabled"] = True
		if "CHECKED" in st:
			item["mark"] = "✓"
		s = shortcut(kid, interfaces(kid))
		if s:
			item["shortcut"] = s
		if r == "menu":
			item["submenu"] = True
		out.append(item)
	return out


# ---- input ----------------------------------------------------------------------------------------


def xdo(*args, timeout=10):
	try:
		p = subprocess.run([XDOTOOL] + [str(a) for a in args], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
	except subprocess.TimeoutExpired:
		raise Fail("failed", "xdotool did not finish")
	return p.returncode, p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace")


def must(*args, timeout=10):
	code, out, err = xdo(*args, timeout=timeout)
	if code != 0:
		raise Fail("failed", "xdotool: " + (err.strip().splitlines() or ["it failed"])[-1])
	return out


def in_front(pid):
	"""Keys go to the window in front: before each piece of them, the app that was named has to be there."""
	if pid and front_pid() != pid:
		raise Fail("moved", "")


def under(pid, x, y):
	if not pid:
		return
	w = window_at(x, y)
	if w is None or wm_pid(w) != pid:
		raise Fail("moved", "")
	in_front(pid)


NAMED = {
	"return": "Return", "enter": "Return", "tab": "Tab", "space": "space", "delete": "BackSpace", "backspace": "BackSpace", "forwarddelete": "Delete",
	"escape": "Escape", "esc": "Escape", "left": "Left", "right": "Right", "up": "Up", "down": "Down", "home": "Home", "end": "End",
	"pageup": "Prior", "pagedown": "Next",
}
for _n in range(1, 13):
	NAMED["f%d" % _n] = "F%d" % _n
MODKEYS = {"ctrl": "ctrl", "alt": "alt", "shift": "shift"}


def keysym(key):
	if key in NAMED:
		return NAMED[key]
	if len(key) == 1:
		if key.isalnum() and key.isascii():
			return key
		# Any other character by its Unicode keysym: xdotool finds the key for it on the layout in use.
		return "U%04X" % ord(key)
	raise Fail("unknown_key", 'there is no key "%s" on this keyboard' % key)


def type_text(text, pid):
	run = []

	def flush():
		while run:
			part = "".join(run[:16])
			del run[:16]
			in_front(pid)
			must("type", "--clearmodifiers", "--delay", "12", "--", part, timeout=30)

	for ch in text.replace("\r\n", "\n"):
		if ch in "\n\r\t":
			flush()
			in_front(pid)
			must("key", "--clearmodifiers", "Return" if ch != "\t" else "Tab")
		else:
			run.append(ch)
	flush()


# ---- pictures -------------------------------------------------------------------------------------


def clip(r):
	sx, sy, sw, sh = screen_rect()
	x0, y0 = max(r[0], sx), max(r[1], sy)
	x1, y1 = min(r[0] + r[2], sx + sw), min(r[1] + r[3], sy + sh)
	if x1 - x0 < 2 or y1 - y0 < 2:
		return None
	return (x0, y0, x1 - x0, y1 - y0)


def picture(area, directory, edge, most):
	x, y, w, h = area
	scale = min(1.0, edge / max(w, h), (most / (w * h)) ** 0.5)
	pw, ph = max(1, round(w * scale)), max(1, round(h * scale))
	name = os.path.join(directory, "shot-%d-%d.jpg" % (os.getpid(), int(time.time() * 1000)))
	try:
		p = subprocess.run([IMPORT, "-silent", "-window", "root", "-crop", "%dx%d+%d+%d" % (w, h, x, y), "+repage", "-resize", "%dx%d!" % (pw, ph), "-quality", "80", "jpg:" + name], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=20)
	except subprocess.TimeoutExpired:
		raise Fail("failed", "the picture could not be taken: import did not finish")
	if p.returncode != 0 or not os.path.exists(name):
		raise Fail("failed", "the picture could not be taken: " + p.stderr.decode("utf-8", "replace").strip()[-300:])
	return name, pw, ph


# ---- commands -------------------------------------------------------------------------------------


def num(p, key):
	v = p.get(key)
	if not isinstance(v, (int, float)):
		raise Fail("failed", "%s is missing" % key)
	return v


def bounded(fn, seconds=3.0):
	"""A press that opens a dialog may not be answered until the dialog is closed: then it is said to be unsure."""
	box = {}

	def run():
		try:
			box["value"] = fn()
		except Exception as e:  # noqa: BLE001
			box["error"] = e

	t = threading.Thread(target=run, daemon=True)
	t.start()
	t.join(seconds)
	if t.is_alive():
		return None, True
	if "error" in box:
		raise box["error"]
	return box.get("value"), False


def handle(cmd, p):
	if cmd == "status":
		ok = True
		try:
			Atspi.get_desktop(0).get_child_count()
		except GLib.Error:
			ok = False
		r = {"accessibility": ok, "screen": True, "pid": os.getpid(), "system": "linux"}
		if HOST:
			r["host"] = info(HOST[0])
		return r

	if cmd == "apps":
		wins = windows_by_pid()
		apps = atspi_apps()
		f = active()
		out = []
		for pid, ws in wins.items():
			a = info(pid, apps.get(pid))
			a["windows"] = [describe(w, i + 1, f) for i, w in enumerate(ws)]
			out.append(a)
		return {"apps": out, "displays": displays(), "accessibility": True}

	if cmd == "find":
		pid = look_up(str(p.get("app", "")))
		if not pid:
			return {"running": False}
		r = info(pid, atspi_apps().get(pid))
		r["running"] = True
		return r

	if cmd == "open":
		query = str(p.get("app", "")).strip()
		if not query:
			raise Fail("failed", "app is missing")
		pid = look_up(query)
		if pid:
			r = info(pid)
			r["launched"] = False
			return r
		names_seen = open_app(query)
		for _ in range(150):
			for n in names_seen:
				pid = look_up(n)
				if pid and windows_by_pid().get(pid):
					r = info(pid)
					r["launched"] = True
					return r
			time.sleep(0.1)
		raise Fail("failed", "the app was started but did not appear")

	if cmd == "activate":
		pid = running(p)
		w = win_of(p) if p.get("ref") else None
		ws = windows_by_pid().get(pid) or []
		if w is None:
			shown = [x for x in ws if not minimized(x)]
			w = shown[0] if shown else (ws[0] if ws else None)
		was = front_pid() == pid
		if w is None:
			return {"front": was}
		if not was or p.get("ref"):
			code, _, _ = xdo("windowactivate", "--sync", w.id, timeout=4)
			if code != 0:
				# Without a window manager that speaks EWMH: raised and given the keyboard.
				xdo("windowmap", w.id, "windowraise", w.id, "windowfocus", "--sync", w.id, timeout=4)
		for _ in range(30):
			if front_pid() == pid:
				if not was:
					# An app that has just come forward drops the keys of its first moment.
					time.sleep(0.2)
				return {"front": True}
			time.sleep(0.05)
		return {"front": False}

	if cmd == "windows":
		return {"windows": window_list(running(p))}

	if cmd == "frame":
		w = win_of(p)
		if w is not None:
			x, y, width, height = rect(w)
		else:
			e = extents(element(p))
			if not e:
				raise Fail("gone", "this control does not exist any more")
			x, y, width, height = e
		return {"x": x, "y": y, "w": width, "h": height}

	if cmd == "tree":
		pid = running(p)
		ws = windows_by_pid().get(pid) or []
		r = {"windows": window_list(pid)}
		chosen = None
		n = p.get("window")
		if isinstance(n, int):
			if n < 1 or n > len(ws):
				raise Fail("not_found", "there is no window %d" % n)
			chosen = ws[n - 1]
		else:
			f = active()
			chosen = f if f is not None and wm_pid(f) == pid else (next((x for x in ws if not minimized(x)), None) or (ws[0] if ws else None))
		if chosen is None:
			return r
		index = next(i for i, x in enumerate(ws) if x.id == chosen.id) + 1
		r["window"] = describe(chosen, index, active())
		acc = frame_for(pid, chosen)
		walk = {"count": 0, "cut": False, "limit": int(p.get("max") or 2500)}
		root_node = node(acc, 0, walk)
		if root_node is not None:
			root_node["role"] = "AXWindow"
			root_node["title"] = title(chosen) or root_node.get("title", "")
			root_node.pop("ref", None)
			r["root"] = root_node
		r["cut"] = walk["cut"]
		return r

	if cmd == "menu":
		pid = running(p)
		if p.get("ref"):
			parent = element(p)
		else:
			ws = windows_by_pid().get(pid) or []
			f = active()
			w = f if f is not None and wm_pid(f) == pid else (ws[0] if ws else None)
			if w is None:
				return {"items": []}
			parent = descendant(frame_for(pid, w), {"menu-bar"})
			if parent is None:
				return {"items": []}
		return {"items": menu_items(parent)}

	if cmd == "whose":
		acc = element(p)
		try:
			pid = acc.get_process_id()
		except GLib.Error:
			raise Fail("gone", "this control does not exist any more")
		role, subrole = role_of(nick(acc))
		r = {"pid": pid, "role": role}
		if subrole:
			r["subrole"] = subrole
		try:
			t = acc.get_name() or acc.get_description()
		except GLib.Error:
			t = ""
		if t:
			r["title"] = t
		return r

	if cmd == "press":
		acc = element(p)
		ifs = interfaces(acc)
		acts = action_names(acc, ifs)
		for want in PRESS:
			if want in acts:
				i = acts.index(want)
				done, unsure = bounded(lambda: Atspi.Action.do_action(acc, i))
				if unsure:
					return {"done": True, "unsure": True}
				return {"done": True}
		# A row or a tab is selected by what holds it.
		try:
			parent = acc.get_parent()
			if parent is not None and "Selection" in interfaces(parent):
				if Atspi.Selection.select_child(parent, acc.get_index_in_parent()):
					return {"done": True, "selected": True}
		except GLib.Error:
			pass
		e = extents(acc)
		if not e or e[2] <= 0 or e[3] <= 0:
			raise Fail("failed", "this control cannot be pressed")
		return {"done": False, "x": e[0] + e[2] / 2, "y": e[1] + e[3] / 2}

	if cmd == "set":
		acc = element(p)
		text = p.get("text")
		if not isinstance(text, str):
			raise Fail("failed", "text is missing")
		ifs = interfaces(acc)
		try:
			acc.grab_focus()
		except GLib.Error:
			pass
		try:
			if "EditableText" in ifs and "EDITABLE" in states(acc):
				if Atspi.EditableText.set_text_contents(acc, text):
					return {"done": True}
			if "Value" in ifs:
				try:
					if Atspi.Value.set_current_value(acc, float(text)):
						return {"done": True}
				except ValueError:
					pass
		except GLib.Error as e:
			raise Fail("failed", "writing did not work: %s" % e.message)
		e = extents(acc)
		if not e or e[2] <= 0 or e[3] <= 0:
			raise Fail("failed", "this control takes no text")
		return {"done": False, "x": e[0] + e[2] / 2, "y": e[1] + e[3] / 2}

	if cmd == "at":
		x, y = num(p, "x"), num(p, "y")
		r = {}
		w = window_at(x, y)
		if w is None:
			return r
		wpid = wm_pid(w)
		r["wpid"] = wpid
		r["wname"] = name_of(wpid)
		try:
			acc = frame_for(wpid, w)
			r["pid"] = acc.get_process_id()
			r["name"] = name_of(r["pid"])
			for _ in range(60):
				kid = Atspi.Component.get_accessible_at_point(acc, int(x), int(y), Atspi.CoordType.SCREEN) if "Component" in interfaces(acc) else None
				if kid is None:
					break
				acc = kid
			role, subrole = role_of(nick(acc))
			r["role"] = role
			if subrole:
				r["subrole"] = subrole
			t = acc.get_name()
			if t:
				r["title"] = t
		except (Fail, GLib.Error):
			pass
		return r

	if cmd == "click":
		x, y = round(num(p, "x")), round(num(p, "y"))
		pid = int(p.get("pid") or 0)
		count = max(1, min(3, int(p.get("count") or 1)))
		button = 3 if p.get("button") == "right" else 1
		under(pid, x, y)
		must("mousemove", "--sync", x, y)
		under(pid, x, y)
		must("click", "--repeat", count, "--delay", 80, button)
		return {}

	if cmd == "drag":
		x, y = round(num(p, "x")), round(num(p, "y"))
		x2, y2 = round(num(p, "x2")), round(num(p, "y2"))
		pid = int(p.get("pid") or 0)
		under(pid, x, y)
		steps = []
		# In steps: an app only takes a drag for one when the pointer travels.
		for i in range(1, 13):
			steps += ["mousemove", round(x + (x2 - x) * i / 12), round(y + (y2 - y) * i / 12), "sleep", "0.015"]
		must("mousemove", "--sync", x, y, "mousedown", 1, "sleep", "0.08", *steps, "sleep", "0.06", "mouseup", 1)
		return {}

	if cmd == "scroll":
		x, y = round(num(p, "x")), round(num(p, "y"))
		pid = int(p.get("pid") or 0)
		dx, dy = int(p.get("dx") or 0), int(p.get("dy") or 0)
		under(pid, x, y)
		must("mousemove", "--sync", x, y)
		# One turn of a wheel is about three lines.
		for amount, back, forth in ((dy, 4, 5), (dx, 6, 7)):
			if amount:
				must("click", "--repeat", max(1, round(abs(amount) / 3)), "--delay", 20, back if amount > 0 else forth)
		return {}

	if cmd == "type":
		text = p.get("text")
		if not isinstance(text, str):
			raise Fail("failed", "text is missing")
		type_text(text, int(p.get("pid") or 0))
		return {}

	if cmd == "key":
		key = str(p.get("key") or "").lower()
		if not key:
			raise Fail("failed", "key is missing")
		mods = [str(m) for m in (p.get("mods") or [])]
		for m in mods:
			if m not in MODKEYS:
				raise Fail("unknown_key", 'the modifier key "%s" is not pressed here: shortcuts use ctrl, alt and shift' % m)
		combo = "+".join([MODKEYS[m] for m in mods] + [keysym(key)])
		in_front(int(p.get("pid") or 0))
		must("key", "--clearmodifiers", combo)
		return {}

	if cmd == "shot":
		directory = p.get("dir")
		if not isinstance(directory, str):
			raise Fail("failed", "dir is missing")
		edge = float(p.get("edge") or 1280)
		most = float(p.get("area") or 1150000)
		r = {}
		if p.get("ref"):
			w = win_of(p)
			if w is None:
				raise Fail("gone", "this window does not exist any more")
			if minimized(w):
				raise Fail("minimized", "")
			pid = wm_pid(w)
			# A picture of the screen shows the window only while it is in front.
			f = active()
			if f is None or f.id != w.id or front_pid() != pid:
				raise Fail("behind", "this window is behind another one")
			whole = rect(w)
			area = clip(whole)
			if area is None:
				raise Fail("failed", "this window is not on a screen")
			r["wx"], r["wy"] = whole[0], whole[1]
		else:
			all_ = displays()
			n = int(p.get("display") or 1)
			if n < 1 or n > len(all_):
				raise Fail("not_found", "there is no screen %d; there %s" % (n, "is 1 screen" if len(all_) == 1 else "are %d screens" % len(all_)))
			s = all_[n - 1]
			area = (s["x"], s["y"], s["w"], s["h"])
			r["display"] = n
			r["displays"] = len(all_)
		name, pw, ph = picture(area, directory, edge, most)
		r.update({"file": name, "width": pw, "height": ph, "x": area[0], "y": area[1], "w": area[2], "h": area[3]})
		return r

	raise Fail("failed", "unknown command %s" % cmd)


# ---- opening an app -------------------------------------------------------------------------------

APP_DIRS = ["/usr/share/applications", "/usr/local/share/applications", os.path.expanduser("~/.local/share/applications"), "/var/lib/flatpak/exports/share/applications", os.path.expanduser("~/.local/share/flatpak/exports/share/applications"), "/var/lib/snapd/desktop/applications"]
BIN_DIRS = ["/usr/bin", "/usr/local/bin", "/bin", "/snap/bin"]


def open_app(query):
	"""Starts an app by its name: its menu entry (a .desktop file) or a program of that name in the system's folders. Returns the names it may show up under."""
	if not re.match(r"^[A-Za-z0-9][A-Za-z0-9 ._+-]*$", query):
		raise Fail("not_found", "no app is called that")
	q = query.lower()
	from gi.repository import Gio

	for folder in APP_DIRS:
		try:
			files = sorted(os.listdir(folder))
		except OSError:
			continue
		for f in files:
			if not f.endswith(".desktop"):
				continue
			path = os.path.join(folder, f)
			try:
				a = Gio.DesktopAppInfo.new_from_filename(path)
			except (TypeError, GLib.Error):
				a = None
			if a is None:
				continue
			stem = f[: -len(".desktop")].lower()
			called = {(a.get_name() or "").lower(), stem, stem.rsplit(".", 1)[-1], (a.get_executable() or "").lower(), os.path.basename(a.get_executable() or "").lower()}
			if q not in called:
				continue
			if not a.launch([], None):
				raise Fail("failed", "the app could not be started")
			seen = {query, a.get_name() or "", os.path.basename(a.get_executable() or ""), a.get_startup_wm_class() or ""}
			return [s for s in seen if s]
	for folder in BIN_DIRS:
		path = os.path.join(folder, query)
		if os.path.isfile(path) and os.access(path, os.X_OK):
			subprocess.Popen([path], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
			return [query]
	raise Fail("not_found", "no app called %s was found" % query)


# ---- main -----------------------------------------------------------------------------------------


def main():
	Atspi.init()
	# An app that hangs must not hang pine with it.
	try:
		Atspi.set_timeout(3000, 15000)
	except (AttributeError, TypeError):
		pass
	out = sys.stdout
	for line in sys.stdin:
		try:
			msg = json.loads(line)
		except ValueError:
			continue
		if not isinstance(msg, dict) or not isinstance(msg.get("cmd"), str):
			continue
		mid = msg.get("id")
		try:
			r = handle(msg["cmd"], msg)
			r["id"] = mid
			r["ok"] = True
		except Fail as f:
			r = {"id": mid, "ok": False, "code": f.code, "error": f.message}
		except GLib.Error as e:
			gone = any(s in (e.message or "") for s in ("UnknownObject", "ServiceUnknown", "UnknownMethod", "defunct", "no longer exists"))
			r = {"id": mid, "ok": False, "code": "gone" if gone else "failed", "error": "this control does not exist any more" if gone else e.message}
		except XError as e:
			r = {"id": mid, "ok": False, "code": "gone", "error": "this window does not exist any more (%s)" % e.__class__.__name__}
		except Exception as e:  # noqa: BLE001
			r = {"id": mid, "ok": False, "code": "failed", "error": "%s: %s" % (e.__class__.__name__, e)}
		out.write(json.dumps(r) + "\n")
		out.flush()


main()
