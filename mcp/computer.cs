// The helper of pine's bundled MCP server "computer" (mcp/computer.ts), for Windows.
//
// It does what Node cannot do (read an app's UI Automation tree, press its controls, make mouse
// and key input, take a picture of a window) and decides nothing. Which app may be operated, what
// a result says and how a picture's coordinates become a point on the screen is all in
// computer.ts, where it is tested. It speaks the protocol of computer.swift: one JSON request per
// line on stdin ({"id", "cmd", ...}), one answer per line on stdout ({"id", "ok", ...} or
// {"id", "ok": false, "code", "error"}).
//
// pine builds it with the C# compiler of .NET Framework 4 that every Windows carries
// (src/csharp.ts): C# 5, so no string interpolation, no "?.", no expression bodies.
//
// Points are physical pixels of the virtual screen (the helper is aware of each monitor's
// scale), origin at the top left corner of the main display. UI Automation, window rectangles,
// pictures and SendInput all use them.
//
// Windows sends keys and clicks to the window in front, never to a process. So where a request
// names the app (`pid`), this helper looks right before each piece of input that the app is
// still in front, and under the position of a click, and stops when it is not (code "moved").
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using Microsoft.Win32;

class Fail : Exception {
	public string Code;
	public Fail(string code, string message) : base(message) { Code = code; }
}

static class Native {
	public delegate bool EnumProc(IntPtr hwnd, IntPtr data);

	[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
	[StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }

	[StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
	[StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
	[StructLayout(LayoutKind.Explicit)] public struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
	[StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public InputUnion u; }

	[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
	public struct PROCESSENTRY32 {
		public uint dwSize; public uint cntUsage; public uint th32ProcessID; public IntPtr th32DefaultHeapID; public uint th32ModuleID;
		public uint cntThreads; public uint th32ParentProcessID; public int pcPriClassBase; public uint dwFlags;
		[MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
	}

	[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, IntPtr data);
	[DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc proc, IntPtr data);
	[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
	[DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
	[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
	[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr hwnd);
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder text, int max);
	[DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);
	[DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hwnd, int index);
	[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
	[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
	[DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hwnd);
	[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int cmd);
	[DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
	[DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
	[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT r);
	[DllImport("user32.dll")] public static extern uint SendInput(uint count, INPUT[] inputs, int size);
	[DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
	[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from, uint to, bool attach);
	[DllImport("user32.dll")] public static extern short VkKeyScanEx(char ch, IntPtr layout);
	[DllImport("user32.dll")] public static extern IntPtr GetKeyboardLayout(uint thread);
	[DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code, uint type);
	[DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
	[DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint action, uint param, ref uint value, uint ini);
	[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
	[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
	[DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out RECT value, int size);
	[DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int value, int size);
	[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
	[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
	[DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
	[DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
	[DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref uint size);
	[DllImport("kernel32.dll")] public static extern bool GetProcessTimes(IntPtr process, out long creation, out long exit, out long kernel, out long user);
	[DllImport("kernel32.dll")] public static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
	[DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern bool Process32FirstW(IntPtr snapshot, ref PROCESSENTRY32 entry);
	[DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern bool Process32NextW(IntPtr snapshot, ref PROCESSENTRY32 entry);
	[DllImport("advapi32.dll")] public static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
	[DllImport("advapi32.dll")] public static extern bool GetTokenInformation(IntPtr token, int cls, out int info, int size, out int returned);
}

static class Helper {
	static JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 1000 };

	// ---- references ------------------------------------------------------------------------------

	static Dictionary<string, AutomationElement> elements = new Dictionary<string, AutomationElement>();
	static Dictionary<string, string> names = new Dictionary<string, string>();
	static int counter = 0;

	static string RefFor(AutomationElement el, int[] runtime) {
		string key = runtime != null ? string.Join(".", Array.ConvertAll<int, string>(runtime, delegate(int n) { return n.ToString(CultureInfo.InvariantCulture); })) : null;
		string r;
		if (key != null && names.TryGetValue(key, out r)) return r;
		// Controls that are gone are forgotten all at once, rarely: a reference that was dropped is answered with "gone".
		if (elements.Count > 50000) { elements.Clear(); names.Clear(); }
		counter++;
		r = "e" + counter.ToString(CultureInfo.InvariantCulture);
		elements[r] = el;
		if (key != null) names[key] = r;
		return r;
	}

	static string RefFor(AutomationElement el) {
		int[] runtime = null;
		try { runtime = el.GetRuntimeId(); } catch (Exception) { }
		return RefFor(el, runtime);
	}

	static AutomationElement Element(Dictionary<string, object> p) {
		object r;
		AutomationElement el;
		if (!p.TryGetValue("ref", out r) || r == null || !elements.TryGetValue(r.ToString(), out el)) throw new Fail("gone", "no control has this reference");
		return el;
	}

	// ---- windows and processes -------------------------------------------------------------------

	const int GWL_EXSTYLE = -20;
	const int WS_EX_TOOLWINDOW = 0x80;
	const int WS_EX_APPWINDOW = 0x40000;
	const uint GW_OWNER = 4;
	const uint GA_ROOT = 2;

	static string Text(IntPtr h) {
		int n = Native.GetWindowTextLength(h);
		if (n <= 0) return "";
		StringBuilder sb = new StringBuilder(n + 1);
		Native.GetWindowText(h, sb, sb.Capacity);
		return sb.ToString();
	}

	static string ClassOf(IntPtr h) {
		StringBuilder sb = new StringBuilder(256);
		Native.GetClassName(h, sb, sb.Capacity);
		return sb.ToString();
	}

	static int RawPid(IntPtr h) {
		uint pid;
		Native.GetWindowThreadProcessId(h, out pid);
		return (int)pid;
	}

	static Dictionary<int, string> exeNames = new Dictionary<int, string>();

	static string ExePath(int pid) {
		IntPtr h = Native.OpenProcess(0x1000, false, pid);
		if (h == IntPtr.Zero) return "";
		try {
			StringBuilder sb = new StringBuilder(1024);
			uint size = (uint)sb.Capacity;
			return Native.QueryFullProcessImageName(h, 0, sb, ref size) ? sb.ToString() : "";
		} finally { Native.CloseHandle(h); }
	}

	static string ProcessName(int pid) {
		string n;
		if (exeNames.TryGetValue(pid, out n)) return n;
		try { n = Process.GetProcessById(pid).ProcessName; } catch (Exception) { n = ""; }
		exeNames[pid] = n;
		return n;
	}

	/**
	 * The process a top-level window is of. An app of the Store draws its window in a process of
	 * its own inside a frame that ApplicationFrameHost owns: the window is that app's.
	 */
	static int OwnerOf(IntPtr h) {
		if (h == IntPtr.Zero) return 0;
		int pid = RawPid(h);
		if (!string.Equals(ProcessName(pid), "ApplicationFrameHost", StringComparison.OrdinalIgnoreCase)) return pid;
		int inner = 0;
		Native.EnumChildWindows(h, delegate(IntPtr c, IntPtr data) {
			int other = RawPid(c);
			if (other != pid) { inner = other; return false; }
			return true;
		}, IntPtr.Zero);
		return inner != 0 ? inner : pid;
	}

	static IntPtr Root(IntPtr h) {
		if (h == IntPtr.Zero) return h;
		IntPtr r = Native.GetAncestor(h, GA_ROOT);
		return r == IntPtr.Zero ? h : r;
	}

	static int FrontPid() { return OwnerOf(Root(Native.GetForegroundWindow())); }

	static bool IsAppWindow(IntPtr h) {
		if (!Native.IsWindowVisible(h)) return false;
		int cloaked;
		// A window of another virtual desktop, or of a Store app that is not running, is there and cannot be seen.
		if (Native.DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return false;
		int ex = Native.GetWindowLong(h, GWL_EXSTYLE);
		if ((ex & WS_EX_TOOLWINDOW) != 0 && (ex & WS_EX_APPWINDOW) == 0) return false;
		string cls = ClassOf(h);
		if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd" || cls == "Shell_SecondaryTrayWnd") return false;
		Native.RECT r;
		if (!Native.GetWindowRect(h, out r) || r.Right - r.Left < 2 || r.Bottom - r.Top < 2) return false;
		// An owned window without a title is a popup of its app, not a window of its own.
		if (Native.GetWindow(h, GW_OWNER) != IntPtr.Zero && Text(h).Length == 0) return false;
		return true;
	}

	/** The apps' windows from the front to the back. */
	static List<IntPtr> TopWindows() {
		List<IntPtr> all = new List<IntPtr>();
		Native.EnumWindows(delegate(IntPtr h, IntPtr data) { if (IsAppWindow(h)) all.Add(h); return true; }, IntPtr.Zero);
		return all;
	}

	static Dictionary<int, List<IntPtr>> WindowsByPid() {
		Dictionary<int, List<IntPtr>> map = new Dictionary<int, List<IntPtr>>();
		foreach (IntPtr h in TopWindows()) {
			int pid = OwnerOf(h);
			List<IntPtr> l;
			if (!map.TryGetValue(pid, out l)) { l = new List<IntPtr>(); map[pid] = l; }
			l.Add(h);
		}
		return map;
	}

	static List<IntPtr> WindowsOf(int pid) {
		List<IntPtr> l;
		return WindowsByPid().TryGetValue(pid, out l) ? l : new List<IntPtr>();
	}

	/** Where a window is drawn, without the invisible border Windows keeps around it for resizing. */
	static Native.RECT Frame(IntPtr h) {
		Native.RECT r;
		if (Native.DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(Native.RECT))) == 0 && r.Right > r.Left) return r;
		Native.GetWindowRect(h, out r);
		return r;
	}

	static string WinRef(IntPtr h) { return "w" + h.ToInt64().ToString(CultureInfo.InvariantCulture); }

	static IntPtr WinOf(Dictionary<string, object> p) {
		object r;
		if (!p.TryGetValue("ref", out r) || r == null) return IntPtr.Zero;
		string s = r.ToString();
		long n;
		if (!s.StartsWith("w") || !long.TryParse(s.Substring(1), NumberStyles.Integer, CultureInfo.InvariantCulture, out n)) return IntPtr.Zero;
		IntPtr h = new IntPtr(n);
		if (!Native.IsWindow(h)) throw new Fail("gone", "this window does not exist any more");
		return h;
	}

	static Dictionary<string, object> Describe(IntPtr h, int index, IntPtr front) {
		Native.RECT r = Frame(h);
		Dictionary<string, object> d = new Dictionary<string, object>();
		d["index"] = index;
		d["ref"] = WinRef(h);
		d["title"] = Text(h);
		if (Native.IsIconic(h)) d["minimized"] = true;
		if (h == front) d["main"] = true;
		d["x"] = r.Left; d["y"] = r.Top; d["w"] = r.Right - r.Left; d["h"] = r.Bottom - r.Top;
		return d;
	}

	static List<object> WindowList(int pid) {
		List<object> l = new List<object>();
		IntPtr front = Root(Native.GetForegroundWindow());
		int i = 0;
		foreach (IntPtr h in WindowsOf(pid)) l.Add(Describe(h, ++i, front));
		return l;
	}

	// The app pine runs in: the window of the console it was started from, or else the first
	// process above this one that has a window (Windows Terminal, the editor's terminal).
	static List<int> hosts = FindHosts();

	static List<int> FindHosts() {
		List<int> found = new List<int>();
		try {
			IntPtr console = Native.GetConsoleWindow();
			if (console != IntPtr.Zero && Native.IsWindowVisible(console)) found.Add(OwnerOf(console));
			if (found.Count > 0) return found;
			Dictionary<int, int> parents = new Dictionary<int, int>();
			IntPtr snap = Native.CreateToolhelp32Snapshot(2, 0);
			Native.PROCESSENTRY32 e = new Native.PROCESSENTRY32();
			e.dwSize = (uint)Marshal.SizeOf(typeof(Native.PROCESSENTRY32));
			if (Native.Process32FirstW(snap, ref e)) {
				do { parents[(int)e.th32ProcessID] = (int)e.th32ParentProcessID; } while (Native.Process32NextW(snap, ref e));
			}
			Native.CloseHandle(snap);
			Dictionary<int, List<IntPtr>> wins = WindowsByPid();
			int child = Process.GetCurrentProcess().Id;
			int pid;
			for (int i = 0; i < 32 && parents.TryGetValue(child, out pid) && pid > 4; i++) {
				// A process id is used again after its process ended: a "parent" younger than its child is another program.
				if (Started(pid) > Started(child)) break;
				if (wins.ContainsKey(pid)) { found.Add(pid); break; }
				child = pid;
			}
		} catch (Exception) { }
		return found;
	}

	static long Started(int pid) {
		IntPtr h = Native.OpenProcess(0x1000, false, pid);
		if (h == IntPtr.Zero) return long.MaxValue;
		try {
			long c, x, k, u;
			return Native.GetProcessTimes(h, out c, out x, out k, out u) ? c : long.MaxValue;
		} finally { Native.CloseHandle(h); }
	}

	/**
	 * Whether a process runs as administrator. Windows drops input to it from a program without
	 * those rights, and says nothing. A process whose token cannot be read is not called so: the
	 * look before each piece of input still holds there.
	 */
	static bool Elevated(int pid) {
		IntPtr h = Native.OpenProcess(0x1000, false, pid);
		if (h == IntPtr.Zero) return false;
		try {
			IntPtr token;
			if (!Native.OpenProcessToken(h, 8, out token)) return false;
			try {
				int elevated, size;
				return Native.GetTokenInformation(token, 20, out elevated, 4, out size) && elevated != 0;
			} finally { Native.CloseHandle(token); }
		} finally { Native.CloseHandle(h); }
	}

	static bool selfElevated = Elevated(Process.GetCurrentProcess().Id);

	static Dictionary<int, string> appNames = new Dictionary<int, string>();

	static string NameOf(int pid) {
		string n;
		if (appNames.TryGetValue(pid, out n)) return n;
		n = "";
		string file = ExePath(pid);
		if (file.Length > 0) {
			try {
				string desc = FileVersionInfo.GetVersionInfo(file).FileDescription;
				if (!string.IsNullOrEmpty(desc) && desc.Trim().Length > 0 && desc.Length < 60) n = desc.Trim();
			} catch (Exception) { }
		}
		if (n.Length == 0) n = ProcessName(pid);
		if (n.Length == 0) n = "pid " + pid.ToString(CultureInfo.InvariantCulture);
		appNames[pid] = n;
		return n;
	}

	static Dictionary<string, object> Info(int pid) {
		Dictionary<string, object> d = new Dictionary<string, object>();
		d["name"] = NameOf(pid);
		d["pid"] = pid;
		d["bundle"] = ExePath(pid);
		d["host"] = hosts.Contains(pid);
		d["front"] = FrontPid() == pid;
		d["hidden"] = false;
		return d;
	}

	static bool Called(int pid, string q) {
		if (string.Equals(NameOf(pid), q, StringComparison.OrdinalIgnoreCase)) return true;
		string p = ProcessName(pid);
		return string.Equals(p, q, StringComparison.OrdinalIgnoreCase) || string.Equals(p + ".exe", q, StringComparison.OrdinalIgnoreCase);
	}

	/** The running app somebody means by a name: its name, or the name of its program. One with windows first. */
	static int LookUp(string query) {
		string q = query.Trim();
		if (q.Length == 0) return 0;
		foreach (int pid in WindowsByPid().Keys) if (Called(pid, q)) return pid;
		string bare = q.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? q.Substring(0, q.Length - 4) : q;
		try {
			Process[] ps = Process.GetProcessesByName(bare);
			if (ps.Length > 0) return ps[0].Id;
		} catch (Exception) { }
		return 0;
	}

	static int Running(Dictionary<string, object> p) {
		int pid = Int(p, "pid", 0);
		try {
			Process.GetProcessById(pid);
		} catch (Exception) { throw new Fail("not_running", "the app is not running any more"); }
		return pid;
	}

	// ---- the outline -----------------------------------------------------------------------------

	static Dictionary<int, string> roles = new Dictionary<int, string>();

	static void Role(ControlType t, string role) { roles[t.Id] = role; }

	static Helper() {
		Role(ControlType.Button, "AXButton"); Role(ControlType.Calendar, "AXGroup"); Role(ControlType.CheckBox, "AXCheckBox");
		Role(ControlType.ComboBox, "AXComboBox"); Role(ControlType.Custom, "AXGroup"); Role(ControlType.DataGrid, "AXTable");
		Role(ControlType.DataItem, "AXRow"); Role(ControlType.Document, "AXTextArea"); Role(ControlType.Edit, "AXTextField");
		Role(ControlType.Group, "AXGroup"); Role(ControlType.Header, "AXGroup"); Role(ControlType.HeaderItem, "AXColumnHeader");
		Role(ControlType.Hyperlink, "AXLink"); Role(ControlType.Image, "AXImage"); Role(ControlType.List, "AXList");
		Role(ControlType.ListItem, "AXListItem"); Role(ControlType.Menu, "AXMenu"); Role(ControlType.MenuItem, "AXMenuItem");
		Role(ControlType.Pane, "AXGroup"); Role(ControlType.ProgressBar, "AXProgressIndicator"); Role(ControlType.RadioButton, "AXRadioButton");
		Role(ControlType.Slider, "AXSlider"); Role(ControlType.Spinner, "AXIncrementor"); Role(ControlType.SplitButton, "AXMenuButton");
		Role(ControlType.StatusBar, "AXStatusBar"); Role(ControlType.Tab, "AXTabGroup"); Role(ControlType.TabItem, "AXButton");
		Role(ControlType.Table, "AXTable"); Role(ControlType.Text, "AXStaticText"); Role(ControlType.TitleBar, "AXGroup");
		Role(ControlType.ToolBar, "AXToolbar"); Role(ControlType.ToolTip, "AXHelpTag"); Role(ControlType.Tree, "AXOutline");
		Role(ControlType.TreeItem, "AXRow"); Role(ControlType.Window, "AXSheet");
	}

	/** Not worth a line in an outline, with everything inside. */
	static bool Skipped(ControlType t) {
		return t == ControlType.ScrollBar || t == ControlType.Separator || t == ControlType.Thumb || t == ControlType.MenuBar;
	}

	/** What holds rows: only those that can be seen are listed, the rest is reached by scrolling. */
	static bool Holder(ControlType t) {
		return t == ControlType.List || t == ControlType.DataGrid || t == ControlType.Tree || t == ControlType.Table;
	}

	static string RoleName(ControlType t) {
		string r;
		if (t != null && roles.TryGetValue(t.Id, out r)) return r;
		return "AXGroup";
	}

	static AutomationProperty[] cached = {
		AutomationElement.NameProperty, AutomationElement.ControlTypeProperty, AutomationElement.IsEnabledProperty, AutomationElement.HasKeyboardFocusProperty,
		AutomationElement.IsOffscreenProperty, AutomationElement.HelpTextProperty, AutomationElement.RuntimeIdProperty, AutomationElement.IsPasswordProperty,
		AutomationElement.IsInvokePatternAvailableProperty, AutomationElement.IsTogglePatternAvailableProperty, AutomationElement.IsSelectionItemPatternAvailableProperty,
		AutomationElement.IsExpandCollapsePatternAvailableProperty, AutomationElement.IsValuePatternAvailableProperty, AutomationElement.IsRangeValuePatternAvailableProperty,
		ValuePattern.ValueProperty, ValuePattern.IsReadOnlyProperty, TogglePattern.ToggleStateProperty, SelectionItemPattern.IsSelectedProperty,
		RangeValuePattern.ValueProperty, RangeValuePattern.IsReadOnlyProperty,
	};

	static object C(AutomationElement e, AutomationProperty p) {
		try {
			object v = e.GetCachedPropertyValue(p, true);
			return v == AutomationElement.NotSupported ? null : v;
		} catch (Exception) { return null; }
	}

	static bool B(object v) { return v is bool && (bool)v; }

	class Walk { public int Count; public bool Cut; public int Limit; }

	static Dictionary<string, object> Node(AutomationElement e, int depth, Walk walk, bool holder) {
		if (walk.Count >= walk.Limit || depth > 60) { walk.Cut = true; return null; }
		ControlType t = C(e, AutomationElement.ControlTypeProperty) as ControlType;
		if (t != null && Skipped(t)) return null;
		if (holder && B(C(e, AutomationElement.IsOffscreenProperty))) return null;
		walk.Count++;
		string role = depth == 0 ? "AXWindow" : RoleName(t);
		Dictionary<string, object> n = new Dictionary<string, object>();
		string name = C(e, AutomationElement.NameProperty) as string;
		if (!string.IsNullOrEmpty(name)) n["title"] = name;
		string help = C(e, AutomationElement.HelpTextProperty) as string;
		if (!string.IsNullOrEmpty(help)) n["help"] = help;
		bool invoke = B(C(e, AutomationElement.IsInvokePatternAvailableProperty));
		bool toggle = B(C(e, AutomationElement.IsTogglePatternAvailableProperty));
		bool selectable = B(C(e, AutomationElement.IsSelectionItemPatternAvailableProperty));
		bool expand = B(C(e, AutomationElement.IsExpandCollapsePatternAvailableProperty));
		bool hasValue = B(C(e, AutomationElement.IsValuePatternAvailableProperty));
		bool hasRange = B(C(e, AutomationElement.IsRangeValuePatternAvailableProperty));
		bool password = B(C(e, AutomationElement.IsPasswordProperty));
		if (t == ControlType.TabItem) n["subrole"] = "AXTabButton";
		if (t == ControlType.Edit && password) n["subrole"] = "AXSecureTextField";
		// A button that stays pressed is a switch.
		if (t == ControlType.Button && toggle) { role = "AXCheckBox"; n["subrole"] = "AXToggle"; }
		// A document that cannot be written into is a page to read: a web page, a help text.
		if (t == ControlType.Document && !(hasValue && !B(C(e, ValuePattern.IsReadOnlyProperty)))) role = "AXWebArea";
		n["role"] = role;
		if (role == "AXCheckBox" && toggle) {
			object s = C(e, TogglePattern.ToggleStateProperty);
			n["value"] = s is ToggleState ? ((ToggleState)s == ToggleState.On ? 1 : (ToggleState)s == ToggleState.Indeterminate ? 2 : 0) : 0;
		} else if (role == "AXRadioButton") {
			n["value"] = B(C(e, SelectionItemPattern.IsSelectedProperty)) ? 1 : 0;
		} else if (hasRange && (t == ControlType.Slider || t == ControlType.Spinner || t == ControlType.ProgressBar)) {
			object v = C(e, RangeValuePattern.ValueProperty);
			if (v is double && !double.IsNaN((double)v) && !double.IsInfinity((double)v)) n["value"] = (double)v;
		} else if (hasValue && !password && t != ControlType.Text) {
			string v = C(e, ValuePattern.ValueProperty) as string;
			if (!string.IsNullOrEmpty(v)) {
				if (v.Length > 6000) { n["more"] = v.Length - 6000; v = v.Substring(0, 6000); }
				n["value"] = v;
			}
		}
		if (t != null && t != ControlType.RadioButton && selectable && B(C(e, SelectionItemPattern.IsSelectedProperty))) n["selected"] = true;
		if (!B(C(e, AutomationElement.IsEnabledProperty))) n["disabled"] = true;
		if (B(C(e, AutomationElement.HasKeyboardFocusProperty))) n["focused"] = true;
		bool press = depth > 0 && (invoke || toggle || selectable || (expand && t != ControlType.Tree && t != ControlType.Window));
		bool edit = (hasValue && !B(C(e, ValuePattern.IsReadOnlyProperty)) && (t == ControlType.Edit || t == ControlType.ComboBox || t == ControlType.Document || t == ControlType.Spinner))
			|| (hasRange && !B(C(e, RangeValuePattern.IsReadOnlyProperty)) && (t == ControlType.Slider || t == ControlType.Spinner));
		if (press) n["press"] = true;
		if (edit) n["edit"] = true;
		if (depth > 0 && (press || edit || t == ControlType.ListItem || t == ControlType.TreeItem || t == ControlType.DataItem || t == ControlType.Edit)) {
			n["ref"] = RefFor(e, C(e, AutomationElement.RuntimeIdProperty) as int[]);
		}
		List<object> children = new List<object>();
		AutomationElementCollection kids = null;
		try { kids = e.CachedChildren; } catch (Exception) { }
		if (kids != null) {
			bool holds = t != null && Holder(t);
			foreach (AutomationElement kid in kids) {
				Dictionary<string, object> c = Node(kid, depth + 1, walk, holds);
				if (c != null) children.Add(c);
			}
		}
		if (children.Count > 0) n["children"] = children;
		return n;
	}

	static AutomationElement Cached(AutomationElement el, TreeScope scope) {
		CacheRequest cr = new CacheRequest();
		cr.TreeScope = scope;
		cr.TreeFilter = Automation.ControlViewCondition;
		cr.AutomationElementMode = AutomationElementMode.Full;
		foreach (AutomationProperty p in cached) cr.Add(p);
		return el.GetUpdatedCache(cr);
	}

	// ---- menus -----------------------------------------------------------------------------------

	static List<object> MenuItems(AutomationElement parent) {
		List<object> items = new List<object>();
		AutomationElementCollection kids = parent.FindAll(TreeScope.Children, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.MenuItem));
		foreach (AutomationElement kid in kids) {
			string title;
			try { title = kid.Current.Name; } catch (Exception) { continue; }
			if (string.IsNullOrEmpty(title)) continue;
			Dictionary<string, object> d = new Dictionary<string, object>();
			d["ref"] = RefFor(kid);
			d["title"] = title;
			try {
				if (!kid.Current.IsEnabled) d["disabled"] = true;
				string keys = kid.Current.AcceleratorKey;
				if (!string.IsNullOrEmpty(keys)) d["shortcut"] = keys.Replace(" ", "").ToLowerInvariant();
				object pat;
				if (kid.TryGetCurrentPattern(TogglePattern.Pattern, out pat) && ((TogglePattern)pat).Current.ToggleState == ToggleState.On) d["mark"] = "✓";
				if (kid.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pat) && ((ExpandCollapsePattern)pat).Current.ExpandCollapseState != ExpandCollapseState.LeafNode) d["submenu"] = true;
			} catch (Exception) { }
			items.Add(d);
		}
		return items;
	}

	static AutomationElement MenuBarOf(IntPtr window) {
		AutomationElement w = AutomationElement.FromHandle(window);
		Condition bar = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.MenuBar);
		AutomationElementCollection found = w.FindAll(TreeScope.Children, bar);
		if (found.Count == 0) found = w.FindAll(TreeScope.Descendants, bar);
		foreach (AutomationElement m in found) {
			// The title bar's own menu (move, size, close) is the system's.
			string id = "";
			try { id = m.Current.AutomationId; } catch (Exception) { }
			if (id != "SystemMenuBar") return m;
		}
		return null;
	}

	// ---- input -----------------------------------------------------------------------------------

	const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
	const uint KEYUP = 2, UNICODE = 4, EXTENDED = 1;

	static void Send(List<Native.INPUT> list) {
		if (list.Count == 0) return;
		Native.SendInput((uint)list.Count, list.ToArray(), Marshal.SizeOf(typeof(Native.INPUT)));
	}

	static Native.INPUT Mouse(uint flags, int dx, int dy, int data) {
		Native.INPUT i = new Native.INPUT();
		i.type = INPUT_MOUSE;
		i.u.mi.dx = dx; i.u.mi.dy = dy; i.u.mi.dwFlags = flags; i.u.mi.mouseData = unchecked((uint)data);
		return i;
	}

	static Native.INPUT Key(ushort vk, ushort scan, uint flags) {
		Native.INPUT i = new Native.INPUT();
		i.type = INPUT_KEYBOARD;
		i.u.ki.wVk = vk; i.u.ki.wScan = scan; i.u.ki.dwFlags = flags;
		return i;
	}

	static void MoveTo(double x, double y) {
		int vx = Native.GetSystemMetrics(76), vy = Native.GetSystemMetrics(77), vw = Native.GetSystemMetrics(78), vh = Native.GetSystemMetrics(79);
		int nx = (int)Math.Round((x - vx) * 65535.0 / Math.Max(1, vw - 1));
		int ny = (int)Math.Round((y - vy) * 65535.0 / Math.Max(1, vh - 1));
		// MOVE | ABSOLUTE | VIRTUALDESK
		Send(new List<Native.INPUT> { Mouse(0x0001 | 0x8000 | 0x4000, nx, ny, 0) });
	}

	/** Keys go to the window in front: before each piece of them, the app that was named has to be there. */
	static void InFront(int pid) {
		if (pid > 0 && FrontPid() != pid) throw new Fail("moved", "");
	}

	static void Under(int pid, double x, double y) {
		if (pid <= 0) return;
		Native.POINT pt = new Native.POINT();
		pt.X = (int)Math.Round(x); pt.Y = (int)Math.Round(y);
		if (OwnerOf(Root(Native.WindowFromPoint(pt))) != pid) throw new Fail("moved", "");
		InFront(pid);
	}

	static bool IsExtended(ushort vk) {
		return (vk >= 0x21 && vk <= 0x28) || vk == 0x2D || vk == 0x2E;
	}

	static void Press(ushort vk, List<string> mods, int pid) {
		List<Native.INPUT> list = new List<Native.INPUT>();
		List<ushort> held = new List<ushort>();
		foreach (string m in mods) {
			ushort mk = m == "ctrl" ? (ushort)0x11 : m == "alt" ? (ushort)0x12 : m == "shift" ? (ushort)0x10 : (ushort)0;
			if (mk == 0) throw new Fail("unknown_key", "the modifier key \"" + m + "\" is not pressed on Windows: shortcuts use ctrl, alt and shift");
			if (!held.Contains(mk)) held.Add(mk);
		}
		foreach (ushort mk in held) list.Add(Key(mk, (ushort)Native.MapVirtualKey(mk, 0), 0));
		uint ext = IsExtended(vk) ? EXTENDED : 0;
		ushort scan = (ushort)Native.MapVirtualKey(vk, 0);
		list.Add(Key(vk, scan, ext));
		list.Add(Key(vk, scan, ext | KEYUP));
		for (int i = held.Count - 1; i >= 0; i--) list.Add(Key(held[i], (ushort)Native.MapVirtualKey(held[i], 0), KEYUP));
		InFront(pid);
		// One call: what the owner types meanwhile does not come in between.
		Send(list);
	}

	static Dictionary<string, ushort> named = new Dictionary<string, ushort> {
		{ "return", 0x0D }, { "enter", 0x0D }, { "tab", 0x09 }, { "space", 0x20 }, { "delete", 0x08 }, { "backspace", 0x08 }, { "forwarddelete", 0x2E },
		{ "escape", 0x1B }, { "esc", 0x1B }, { "left", 0x25 }, { "up", 0x26 }, { "right", 0x27 }, { "down", 0x28 }, { "home", 0x24 }, { "end", 0x23 },
		{ "pageup", 0x21 }, { "pagedown", 0x22 }, { "f1", 0x70 }, { "f2", 0x71 }, { "f3", 0x72 }, { "f4", 0x73 }, { "f5", 0x74 }, { "f6", 0x75 },
		{ "f7", 0x76 }, { "f8", 0x77 }, { "f9", 0x78 }, { "f10", 0x79 }, { "f11", 0x7A }, { "f12", 0x7B },
	};

	static void TypeText(string text, int pid) {
		List<Native.INPUT> run = new List<Native.INPUT>();
		int units = 0;
		Action flush = delegate {
			if (run.Count == 0) return;
			InFront(pid);
			Send(run);
			run.Clear();
			units = 0;
			Thread.Sleep(10);
		};
		foreach (char ch in text.Replace("\r\n", "\n")) {
			if (ch == '\n' || ch == '\r' || ch == '\t') {
				flush();
				// A line break is the return key and a tab the tab key: as text they are not always taken for that.
				Press(ch == '\t' ? (ushort)0x09 : (ushort)0x0D, new List<string>(), pid);
				continue;
			}
			run.Add(Key(0, ch, UNICODE));
			run.Add(Key(0, ch, UNICODE | KEYUP));
			// A pair of surrogates is one character: never cut between them.
			if (++units >= 16 && !char.IsHighSurrogate(ch)) flush();
		}
		flush();
	}

	/**
	 * A program in the background may not take the front: Windows lets the one that made the last
	 * input, or one attached to the input of the window in front.
	 */
	static void Focus(IntPtr h) {
		if (Native.IsIconic(h)) Native.ShowWindow(h, 9);
		Send(new List<Native.INPUT> { Mouse(0x0001, 0, 0, 0) });
		if (Native.SetForegroundWindow(h) && Root(Native.GetForegroundWindow()) == h) return;
		uint dummy;
		uint front = Native.GetWindowThreadProcessId(Native.GetForegroundWindow(), out dummy);
		uint me = Native.GetCurrentThreadId();
		bool attached = front != 0 && front != me && Native.AttachThreadInput(me, front, true);
		try {
			Native.BringWindowToTop(h);
			Native.SetForegroundWindow(h);
		} finally {
			if (attached) Native.AttachThreadInput(me, front, false);
		}
	}

	// ---- pictures --------------------------------------------------------------------------------

	static bool Blank(Bitmap b) {
		// PrintWindow gives a black picture for a window it cannot draw.
		for (int i = 1; i < 16; i++) for (int j = 1; j < 16; j++) {
			Color c = b.GetPixel(b.Width * i / 16, b.Height * j / 16);
			if (c.R > 8 || c.G > 8 || c.B > 8) return false;
		}
		return true;
	}

	static Bitmap FromScreen(Native.RECT r) {
		Bitmap b = new Bitmap(r.Right - r.Left, r.Bottom - r.Top, PixelFormat.Format32bppArgb);
		using (Graphics g = Graphics.FromImage(b)) g.CopyFromScreen(r.Left, r.Top, 0, 0, b.Size, CopyPixelOperation.SourceCopy);
		return b;
	}

	static Native.RECT Clip(Native.RECT r) {
		Native.RECT v;
		v.Left = Native.GetSystemMetrics(76); v.Top = Native.GetSystemMetrics(77);
		v.Right = v.Left + Native.GetSystemMetrics(78); v.Bottom = v.Top + Native.GetSystemMetrics(79);
		Native.RECT o;
		o.Left = Math.Max(r.Left, v.Left); o.Top = Math.Max(r.Top, v.Top); o.Right = Math.Min(r.Right, v.Right); o.Bottom = Math.Min(r.Bottom, v.Bottom);
		if (o.Right - o.Left < 2 || o.Bottom - o.Top < 2) throw new Fail("failed", "this window is not on a screen");
		return o;
	}

	/** Writes a picture no larger than asked for, as JPEG: a model is sent every picture again with every turn. */
	static string Shrink(Bitmap b, string dir, double edge, double area, out int w, out int h) {
		double W = b.Width, H = b.Height;
		double scale = Math.Min(1, Math.Min(edge / Math.Max(W, H), Math.Sqrt(area / (W * H))));
		w = Math.Max(1, (int)Math.Round(W * scale));
		h = Math.Max(1, (int)Math.Round(H * scale));
		string file = Path.Combine(dir, "shot-" + Process.GetCurrentProcess().Id.ToString(CultureInfo.InvariantCulture) + "-" + DateTime.UtcNow.Ticks.ToString(CultureInfo.InvariantCulture) + ".jpg");
		using (Bitmap small = new Bitmap(w, h, PixelFormat.Format24bppRgb)) {
			using (Graphics g = Graphics.FromImage(small)) {
				g.InterpolationMode = InterpolationMode.HighQualityBicubic;
				g.DrawImage(b, 0, 0, w, h);
			}
			ImageCodecInfo jpeg = null;
			foreach (ImageCodecInfo c in ImageCodecInfo.GetImageEncoders()) if (c.FormatID == ImageFormat.Jpeg.Guid) jpeg = c;
			EncoderParameters ps = new EncoderParameters(1);
			ps.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 80L);
			small.Save(file, jpeg, ps);
		}
		return file;
	}

	static List<System.Windows.Forms.Screen> Screens() {
		List<System.Windows.Forms.Screen> l = new List<System.Windows.Forms.Screen>();
		foreach (System.Windows.Forms.Screen s in System.Windows.Forms.Screen.AllScreens) if (s.Primary) l.Add(s);
		foreach (System.Windows.Forms.Screen s in System.Windows.Forms.Screen.AllScreens) if (!s.Primary) l.Add(s);
		return l;
	}

	static List<object> Displays() {
		List<object> l = new List<object>();
		int i = 0;
		foreach (System.Windows.Forms.Screen s in Screens()) {
			Dictionary<string, object> d = new Dictionary<string, object>();
			d["index"] = ++i; d["x"] = s.Bounds.X; d["y"] = s.Bounds.Y; d["w"] = s.Bounds.Width; d["h"] = s.Bounds.Height; d["main"] = s.Primary;
			l.Add(d);
		}
		return l;
	}

	// ---- opening an app --------------------------------------------------------------------------

	/** An app by its name: a program registered under App Paths, one of Windows' own, or an entry of the Start menu. Never a path. */
	static string Find(string q) {
		if (!Regex.IsMatch(q, "^[A-Za-z0-9][A-Za-z0-9 ._+-]*$")) return null;
		string exe = q.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? q : q + ".exe";
		foreach (RegistryKey hive in new RegistryKey[] { Registry.CurrentUser, Registry.LocalMachine }) {
			try {
				using (RegistryKey k = hive.OpenSubKey("SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\" + exe)) {
					if (k == null) continue;
					string v = k.GetValue("") as string;
					if (string.IsNullOrEmpty(v)) continue;
					v = Environment.ExpandEnvironmentVariables(v.Trim().Trim('\x22'));
					if (File.Exists(v)) return v;
				}
			} catch (Exception) { }
		}
		foreach (string dir in new string[] { Environment.SystemDirectory, Environment.GetFolderPath(Environment.SpecialFolder.Windows) }) {
			string f = Path.Combine(dir, exe);
			if (File.Exists(f)) return f;
		}
		foreach (Environment.SpecialFolder sf in new Environment.SpecialFolder[] { Environment.SpecialFolder.StartMenu, Environment.SpecialFolder.CommonStartMenu }) {
			string found = Shortcut(Environment.GetFolderPath(sf), q + ".lnk", 0);
			if (found != null) return found;
		}
		return null;
	}

	static string Shortcut(string dir, string name, int depth) {
		if (string.IsNullOrEmpty(dir) || depth > 4) return null;
		try {
			foreach (string f in Directory.GetFiles(dir, "*.lnk")) if (string.Equals(Path.GetFileName(f), name, StringComparison.OrdinalIgnoreCase)) return f;
			foreach (string d in Directory.GetDirectories(dir)) {
				string found = Shortcut(d, name, depth + 1);
				if (found != null) return found;
			}
		} catch (Exception) { }
		return null;
	}

	// ---- commands --------------------------------------------------------------------------------

	static double Num(Dictionary<string, object> p, string key) {
		object v;
		if (!p.TryGetValue(key, out v) || v == null || v is string) throw new Fail("failed", key + " is missing");
		return Convert.ToDouble(v, CultureInfo.InvariantCulture);
	}

	static int Int(Dictionary<string, object> p, string key, int fallback) {
		object v;
		if (!p.TryGetValue(key, out v) || v == null || v is string) return fallback;
		return Convert.ToInt32(v, CultureInfo.InvariantCulture);
	}

	static string Str(Dictionary<string, object> p, string key) {
		object v;
		return p.TryGetValue(key, out v) && v is string ? (string)v : null;
	}

	static Dictionary<string, object> Center(AutomationElement el, string why) {
		System.Windows.Rect r = el.Current.BoundingRectangle;
		if (r.IsEmpty || r.Width <= 0 || r.Height <= 0) throw new Fail("failed", why);
		Dictionary<string, object> d = new Dictionary<string, object>();
		d["done"] = false; d["x"] = r.X + r.Width / 2; d["y"] = r.Y + r.Height / 2;
		return d;
	}

	/** A press that opens a dialog may not be answered until the dialog is closed: then it is said to be unsure. */
	static bool Bounded(ThreadStart work) {
		Exception failed = null;
		Thread t = new Thread(delegate() { try { work(); } catch (Exception e) { failed = e; } });
		t.IsBackground = true;
		t.Start();
		if (!t.Join(3000)) return false;
		if (failed != null) {
			if (failed is ElementNotEnabledException) throw new Fail("failed", "this control is disabled");
			throw failed;
		}
		return true;
	}

	static Dictionary<string, object> Done(bool answered) {
		Dictionary<string, object> d = new Dictionary<string, object>();
		d["done"] = true;
		if (!answered) d["unsure"] = true;
		return d;
	}

	static Dictionary<string, object> Handle(string cmd, Dictionary<string, object> p) {
		Dictionary<string, object> r = new Dictionary<string, object>();
		switch (cmd) {
		case "status": {
			r["accessibility"] = true; r["screen"] = true; r["system"] = "windows";
			r["pid"] = Process.GetCurrentProcess().Id;
			if (hosts.Count > 0) r["host"] = Info(hosts[0]);
			return r;
		}

		case "apps": {
			List<object> list = new List<object>();
			IntPtr front = Root(Native.GetForegroundWindow());
			foreach (KeyValuePair<int, List<IntPtr>> kv in WindowsByPid()) {
				Dictionary<string, object> a = Info(kv.Key);
				List<object> wins = new List<object>();
				int i = 0;
				foreach (IntPtr h in kv.Value) wins.Add(Describe(h, ++i, front));
				a["windows"] = wins;
				list.Add(a);
			}
			r["apps"] = list; r["displays"] = Displays(); r["accessibility"] = true;
			return r;
		}

		case "find": {
			int pid = LookUp(Str(p, "app") ?? "");
			if (pid == 0) { r["running"] = false; return r; }
			r = Info(pid);
			r["running"] = true;
			return r;
		}

		case "open": {
			string q = (Str(p, "app") ?? "").Trim();
			if (q.Length == 0) throw new Fail("failed", "app is missing");
			int pid = LookUp(q);
			if (pid != 0) { r = Info(pid); r["launched"] = false; return r; }
			string file = Find(q);
			if (file == null) throw new Fail("not_found", "no app called " + q + " was found");
			ProcessStartInfo si = new ProcessStartInfo(file);
			// Through the shell: the app gets none of this helper's handles, and a shortcut opens what it points at.
			si.UseShellExecute = true;
			si.WorkingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
			Process started = Process.Start(si);
			string stem = Path.GetFileNameWithoutExtension(file);
			for (int i = 0; i < 150; i++) {
				Dictionary<int, List<IntPtr>> wins = WindowsByPid();
				foreach (int candidate in wins.Keys) {
					if ((started != null && candidate == started.Id) || Called(candidate, q) || Called(candidate, stem)) {
						r = Info(candidate); r["launched"] = true; return r;
					}
				}
				Thread.Sleep(100);
			}
			throw new Fail("failed", "the app was started but did not appear");
		}

		case "activate": {
			int pid = Running(p);
			IntPtr h = WinOf(p);
			bool asked = h != IntPtr.Zero;
			if (h == IntPtr.Zero) {
				foreach (IntPtr w in WindowsOf(pid)) { if (!Native.IsIconic(w)) { h = w; break; } }
				if (h == IntPtr.Zero) { List<IntPtr> all = WindowsOf(pid); if (all.Count > 0) h = all[0]; }
			}
			bool was = FrontPid() == pid;
			if (h == IntPtr.Zero) { r["front"] = was; return r; }
			if (!selfElevated && Elevated(pid)) throw new Fail("elevated", "");
			if (!was || asked || Native.IsIconic(h)) Focus(h);
			for (int i = 0; i < 30; i++) {
				if (FrontPid() == pid) {
					// An app that has just come forward drops the keys and clicks of its first moment.
					if (!was) Thread.Sleep(200);
					r["front"] = true;
					return r;
				}
				Thread.Sleep(50);
			}
			r["front"] = false;
			return r;
		}

		case "windows":
			r["windows"] = WindowList(Running(p));
			return r;

		case "frame": {
			IntPtr h = WinOf(p);
			if (h != IntPtr.Zero) {
				Native.RECT f = Frame(h);
				r["x"] = f.Left; r["y"] = f.Top; r["w"] = f.Right - f.Left; r["h"] = f.Bottom - f.Top;
				return r;
			}
			System.Windows.Rect b = Element(p).Current.BoundingRectangle;
			if (b.IsEmpty) throw new Fail("gone", "this control does not exist any more");
			r["x"] = b.X; r["y"] = b.Y; r["w"] = b.Width; r["h"] = b.Height;
			return r;
		}

		case "tree": {
			int pid = Running(p);
			List<IntPtr> all = WindowsOf(pid);
			IntPtr front = Root(Native.GetForegroundWindow());
			r["windows"] = WindowList(pid);
			IntPtr chosen = IntPtr.Zero;
			int n = Int(p, "window", 0);
			if (n != 0) {
				if (n < 1 || n > all.Count) throw new Fail("not_found", "there is no window " + n.ToString(CultureInfo.InvariantCulture));
				chosen = all[n - 1];
			} else if (all.Contains(front)) {
				chosen = front;
			} else {
				foreach (IntPtr w in all) { if (!Native.IsIconic(w)) { chosen = w; break; } }
				if (chosen == IntPtr.Zero && all.Count > 0) chosen = all[0];
			}
			if (chosen == IntPtr.Zero) return r;
			r["window"] = Describe(chosen, all.IndexOf(chosen) + 1, front);
			Walk walk = new Walk();
			walk.Limit = Int(p, "max", 2500);
			AutomationElement root = Cached(AutomationElement.FromHandle(chosen), TreeScope.Subtree);
			Dictionary<string, object> node = Node(root, 0, walk, false);
			if (node != null) { node["title"] = Text(chosen); r["root"] = node; }
			r["cut"] = walk.Cut;
			return r;
		}

		case "menu": {
			int pid = Running(p);
			AutomationElement parent;
			if (Str(p, "ref") != null) {
				parent = Element(p);
				object pat;
				// What is in a menu of Windows is there once the menu is open.
				if (parent.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pat) && ((ExpandCollapsePattern)pat).Current.ExpandCollapseState == ExpandCollapseState.Collapsed) {
					ExpandCollapsePattern ec = (ExpandCollapsePattern)pat;
					Bounded(delegate() { ec.Expand(); });
					Thread.Sleep(250);
				}
				List<object> items = MenuItems(parent);
				if (items.Count == 0) {
					// A classic menu opens as a window of its own, beside the entry and not inside it.
					AutomationElement menu = parent.FindFirst(TreeScope.Children, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Menu));
					if (menu == null) {
						AutomationElementCollection popups = AutomationElement.RootElement.FindAll(TreeScope.Children, new AndCondition(new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Menu), new PropertyCondition(AutomationElement.ProcessIdProperty, pid)));
						if (popups.Count > 0) menu = popups[0];
					}
					if (menu != null) items = MenuItems(menu);
				}
				r["items"] = items;
				return r;
			}
			IntPtr front = Root(Native.GetForegroundWindow());
			List<IntPtr> wins = WindowsOf(pid);
			IntPtr w = wins.Contains(front) ? front : (wins.Count > 0 ? wins[0] : IntPtr.Zero);
			AutomationElement bar = w == IntPtr.Zero ? null : MenuBarOf(w);
			r["items"] = bar == null ? new List<object>() : MenuItems(bar);
			return r;
		}

		case "whose": {
			AutomationElement el = Element(p);
			AutomationElement.AutomationElementInformation c = el.Current;
			r["pid"] = c.ProcessId;
			r["role"] = c.ControlType == ControlType.Button && el.GetCurrentPropertyValue(AutomationElement.IsTogglePatternAvailableProperty) is bool && (bool)el.GetCurrentPropertyValue(AutomationElement.IsTogglePatternAvailableProperty) ? "AXCheckBox" : RoleName(c.ControlType);
			if (!string.IsNullOrEmpty(c.Name)) r["title"] = c.Name;
			return r;
		}

		case "press": {
			AutomationElement el = Element(p);
			object pat;
			if (el.TryGetCurrentPattern(InvokePattern.Pattern, out pat)) { InvokePattern ip = (InvokePattern)pat; return Done(Bounded(delegate() { ip.Invoke(); })); }
			if (el.TryGetCurrentPattern(TogglePattern.Pattern, out pat)) { TogglePattern tp = (TogglePattern)pat; return Done(Bounded(delegate() { tp.Toggle(); })); }
			if (el.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pat)) {
				SelectionItemPattern sp = (SelectionItemPattern)pat;
				r = Done(Bounded(delegate() { sp.Select(); }));
				r["selected"] = true;
				return r;
			}
			if (el.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pat)) {
				ExpandCollapsePattern ep = (ExpandCollapsePattern)pat;
				bool open = ep.Current.ExpandCollapseState == ExpandCollapseState.Collapsed;
				return Done(Bounded(delegate() { if (open) ep.Expand(); else ep.Collapse(); }));
			}
			// Nothing to press by name: the caller clicks in its middle instead.
			return Center(el, "this control cannot be pressed");
		}

		case "set": {
			AutomationElement el = Element(p);
			string text = Str(p, "text");
			if (text == null) throw new Fail("failed", "text is missing");
			try { el.SetFocus(); } catch (Exception) { }
			object pat;
			if (el.TryGetCurrentPattern(ValuePattern.Pattern, out pat) && !((ValuePattern)pat).Current.IsReadOnly) {
				((ValuePattern)pat).SetValue(text);
				r["done"] = true;
				return r;
			}
			double number;
			if (el.TryGetCurrentPattern(RangeValuePattern.Pattern, out pat) && !((RangeValuePattern)pat).Current.IsReadOnly && double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out number)) {
				((RangeValuePattern)pat).SetValue(number);
				r["done"] = true;
				return r;
			}
			return Center(el, "this control takes no text");
		}

		case "at": {
			double x = Num(p, "x"), y = Num(p, "y");
			try {
				AutomationElement el = AutomationElement.FromPoint(new System.Windows.Point(x, y));
				AutomationElement.AutomationElementInformation c = el.Current;
				r["pid"] = c.ProcessId;
				r["name"] = NameOf(c.ProcessId);
				r["role"] = RoleName(c.ControlType);
				if (!string.IsNullOrEmpty(c.Name)) r["title"] = c.Name;
			} catch (Exception) { }
			Native.POINT pt = new Native.POINT();
			pt.X = (int)Math.Round(x); pt.Y = (int)Math.Round(y);
			int owner = OwnerOf(Root(Native.WindowFromPoint(pt)));
			if (owner != 0) { r["wpid"] = owner; r["wname"] = NameOf(owner); }
			return r;
		}

		case "click": {
			double x = Num(p, "x"), y = Num(p, "y");
			int pid = Int(p, "pid", 0);
			bool right = Str(p, "button") == "right";
			int count = Math.Max(1, Math.Min(3, Int(p, "count", 1)));
			Under(pid, x, y);
			MoveTo(x, y);
			Thread.Sleep(30);
			Under(pid, x, y);
			for (int i = 0; i < count; i++) {
				Send(new List<Native.INPUT> { Mouse(right ? 0x0008u : 0x0002u, 0, 0, 0) });
				Thread.Sleep(20);
				Send(new List<Native.INPUT> { Mouse(right ? 0x0010u : 0x0004u, 0, 0, 0) });
				Thread.Sleep(40);
			}
			return r;
		}

		case "drag": {
			double x = Num(p, "x"), y = Num(p, "y"), x2 = Num(p, "x2"), y2 = Num(p, "y2");
			int pid = Int(p, "pid", 0);
			Under(pid, x, y);
			MoveTo(x, y);
			Thread.Sleep(30);
			Send(new List<Native.INPUT> { Mouse(0x0002, 0, 0, 0) });
			Thread.Sleep(80);
			// In steps: an app only takes a drag for one when the pointer travels.
			for (int i = 1; i <= 12; i++) {
				MoveTo(x + (x2 - x) * i / 12, y + (y2 - y) * i / 12);
				Thread.Sleep(15);
			}
			Thread.Sleep(60);
			Send(new List<Native.INPUT> { Mouse(0x0004, 0, 0, 0) });
			return r;
		}

		case "scroll": {
			double x = Num(p, "x"), y = Num(p, "y");
			int pid = Int(p, "pid", 0), dx = Int(p, "dx", 0), dy = Int(p, "dy", 0);
			Under(pid, x, y);
			MoveTo(x, y);
			Thread.Sleep(30);
			uint lines = 3;
			Native.SystemParametersInfo(0x68, 0, ref lines, 0);
			if (lines == 0 || lines > 100) lines = 3;
			// A turn of the wheel is 120 and scrolls `lines` lines; up and right are positive.
			int vertical = (int)Math.Round(dy * 120.0 / lines), horizontal = (int)Math.Round(-dx * 120.0 / lines);
			while (vertical != 0 || horizontal != 0) {
				int v = Math.Max(-120, Math.Min(120, vertical)), h = Math.Max(-120, Math.Min(120, horizontal));
				if (v != 0) Send(new List<Native.INPUT> { Mouse(0x0800, 0, 0, v) });
				if (h != 0) Send(new List<Native.INPUT> { Mouse(0x01000, 0, 0, h) });
				vertical -= v; horizontal -= h;
				Thread.Sleep(15);
			}
			return r;
		}

		case "type": {
			string text = Str(p, "text");
			if (text == null) throw new Fail("failed", "text is missing");
			TypeText(text, Int(p, "pid", 0));
			return r;
		}

		case "key": {
			string key = (Str(p, "key") ?? "").ToLowerInvariant();
			if (key.Length == 0) throw new Fail("failed", "key is missing");
			int pid = Int(p, "pid", 0);
			List<string> mods = new List<string>();
			object raw;
			if (p.TryGetValue("mods", out raw) && raw is IEnumerable && !(raw is string)) foreach (object m in (IEnumerable)raw) mods.Add(Convert.ToString(m, CultureInfo.InvariantCulture));
			ushort vk;
			if (!named.TryGetValue(key, out vk)) {
				if (key.Length != 1) throw new Fail("unknown_key", "there is no key \"" + key + "\" on this keyboard");
				// Which key makes the character on the keyboard layout of the app in front: on a German one "z" is where an American one has "y".
				uint dummy;
				IntPtr layout = Native.GetKeyboardLayout(Native.GetWindowThreadProcessId(Native.GetForegroundWindow(), out dummy));
				short scan = Native.VkKeyScanEx(key[0], layout);
				if (scan == -1) throw new Fail("unknown_key", "there is no key \"" + key + "\" on this keyboard");
				vk = (ushort)(scan & 0xFF);
				int shift = (scan >> 8) & 0xFF;
				if ((shift & 1) != 0 && !mods.Contains("shift")) mods.Add("shift");
				if ((shift & 2) != 0 && !mods.Contains("ctrl")) mods.Add("ctrl");
				if ((shift & 4) != 0 && !mods.Contains("alt")) mods.Add("alt");
			}
			Press(vk, mods, pid);
			return r;
		}

		case "shot": {
			string dir = Str(p, "dir");
			if (dir == null) throw new Fail("failed", "dir is missing");
			double edge = p.ContainsKey("edge") ? Num(p, "edge") : 1280, area = p.ContainsKey("area") ? Num(p, "area") : 1150000;
			Native.RECT shown;
			Bitmap picture = null;
			try {
				IntPtr h = WinOf(p);
				if (h != IntPtr.Zero) {
					if (Native.IsIconic(h)) throw new Fail("minimized", "");
					Native.RECT outer, f = Frame(h);
					Native.GetWindowRect(h, out outer);
					shown = f;
					// The window itself, also where another one covers it.
					using (Bitmap whole = new Bitmap(Math.Max(1, outer.Right - outer.Left), Math.Max(1, outer.Bottom - outer.Top), PixelFormat.Format32bppArgb)) {
						bool drawn;
						using (Graphics g = Graphics.FromImage(whole)) {
							IntPtr hdc = g.GetHdc();
							drawn = Native.PrintWindow(h, hdc, 2);
							g.ReleaseHdc(hdc);
						}
						if (drawn && !Blank(whole)) {
							picture = new Bitmap(f.Right - f.Left, f.Bottom - f.Top, PixelFormat.Format32bppArgb);
							using (Graphics g = Graphics.FromImage(picture)) g.DrawImage(whole, new Rectangle(0, 0, picture.Width, picture.Height), new Rectangle(f.Left - outer.Left, f.Top - outer.Top, picture.Width, picture.Height), GraphicsUnit.Pixel);
						}
					}
					if (picture == null) {
						// A part of the screen shows the app only while the app is in front: pine brings it there and asks again.
						if (FrontPid() != OwnerOf(h)) throw new Fail("behind", "this window is behind another app");
						shown = Clip(f);
						picture = FromScreen(shown);
					}
					r["wx"] = f.Left; r["wy"] = f.Top;
				} else {
					List<System.Windows.Forms.Screen> all = Screens();
					int n = Int(p, "display", 1);
					if (n < 1 || n > all.Count) throw new Fail("not_found", "there is no screen " + n.ToString(CultureInfo.InvariantCulture) + "; there " + (all.Count == 1 ? "is 1 screen" : "are " + all.Count.ToString(CultureInfo.InvariantCulture) + " screens"));
					Rectangle b = all[n - 1].Bounds;
					shown.Left = b.Left; shown.Top = b.Top; shown.Right = b.Right; shown.Bottom = b.Bottom;
					picture = FromScreen(shown);
					r["display"] = n; r["displays"] = all.Count;
				}
				int w, hgt;
				r["file"] = Shrink(picture, dir, edge, area, out w, out hgt);
				r["width"] = w; r["height"] = hgt;
				r["x"] = shown.Left; r["y"] = shown.Top; r["w"] = shown.Right - shown.Left; r["h"] = shown.Bottom - shown.Top;
				return r;
			} finally {
				if (picture != null) picture.Dispose();
			}
		}

		default:
			throw new Fail("failed", "unknown command " + cmd);
		}
	}

	// ---- main ------------------------------------------------------------------------------------

	[MTAThread]
	static void Main(string[] args) {
		// Physical pixels everywhere: what UI Automation, window rectangles and SendInput say agree only then.
		try { if (!Native.SetProcessDpiAwarenessContext(new IntPtr(-4))) Native.SetProcessDPIAware(); } catch (Exception) { try { Native.SetProcessDPIAware(); } catch (Exception) { } }
		StreamReader input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
		StreamWriter output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
		output.AutoFlush = true;
		string line;
		while ((line = input.ReadLine()) != null) {
			Dictionary<string, object> msg;
			try { msg = json.Deserialize<Dictionary<string, object>>(line); } catch (Exception) { continue; }
			if (msg == null || !(msg.ContainsKey("cmd") && msg["cmd"] is string)) continue;
			object id = msg.ContainsKey("id") ? msg["id"] : null;
			Dictionary<string, object> r;
			try {
				r = Handle((string)msg["cmd"], msg);
				r["id"] = id;
				r["ok"] = true;
			} catch (Exception e) {
				r = new Dictionary<string, object>();
				r["id"] = id;
				r["ok"] = false;
				Fail f = e as Fail;
				if (f != null) { r["code"] = f.Code; r["error"] = f.Message; }
				else if (e is ElementNotAvailableException) { r["code"] = "gone"; r["error"] = "this control does not exist any more"; }
				else if (e is ElementNotEnabledException) { r["code"] = "failed"; r["error"] = "this control is disabled"; }
				else { r["code"] = "failed"; r["error"] = e.GetType().Name + ": " + e.Message; }
			}
			output.WriteLine(json.Serialize(r));
		}
	}
}
