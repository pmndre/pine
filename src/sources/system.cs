// pine's helper for the "system" event source on Windows: it says what this computer does (sleep
// and wake, the screens, the lock, power, the network, disks, apps), one JSON object per line on
// standard output, in the same lines as the Mac's helper (system.swift). It decides nothing: which
// of these become events, and for whom, is system.ts's business. Its arguments name what to listen
// for; it ends when its input is closed.
//
// Built by pine with the C# compiler every Windows carries (src/csharp.ts), so C# 5: no string
// interpolation, no expression bodies. What Windows tells, it tells a window: this helper makes a
// hidden one and runs its message loop on the main thread, which is what delivers sleep and wake,
// the screens' state, the battery, the lock (WTS session notifications) and disks (WM_DEVICECHANGE).
// The network comes from NetworkChange, apps from the list of processes of this session.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

static class Program
{
	const int WM_POWERBROADCAST = 0x0218;
	const int WM_DEVICECHANGE = 0x0219;
	const int WM_WTSSESSION_CHANGE = 0x02B1;
	const int PBT_APMSUSPEND = 0x0004;
	const int PBT_APMRESUMESUSPEND = 0x0007;
	const int PBT_APMPOWERSTATUSCHANGE = 0x000A;
	const int PBT_APMRESUMEAUTOMATIC = 0x0012;
	const int PBT_POWERSETTINGCHANGE = 0x8013;
	const int WTS_SESSION_LOCK = 0x7;
	const int WTS_SESSION_UNLOCK = 0x8;
	const int DBT_DEVICEARRIVAL = 0x8000;
	const int DBT_DEVICEREMOVECOMPLETE = 0x8004;
	const int DBT_DEVTYP_VOLUME = 2;

	// Whether the screens are on (0 off, 1 on, 2 dimmed), and the battery's charge in percent.
	static readonly Guid DisplayState = new Guid("6FE69556-704A-47A0-8F24-C28D936FDA47");
	static readonly Guid BatteryPercent = new Guid("A7AD8041-B45A-4CAE-87A3-EECBB468A9E1");

	[StructLayout(LayoutKind.Sequential)]
	struct SYSTEM_POWER_STATUS
	{
		public byte ACLineStatus;
		public byte BatteryFlag;
		public byte BatteryLifePercent;
		public byte SystemStatusFlag;
		public int BatteryLifeTime;
		public int BatteryFullLifeTime;
	}

	[DllImport("kernel32.dll")]
	static extern bool GetSystemPowerStatus(out SYSTEM_POWER_STATUS status);

	[DllImport("user32.dll")]
	static extern IntPtr RegisterPowerSettingNotification(IntPtr recipient, ref Guid setting, int flags);

	[DllImport("wtsapi32.dll")]
	static extern bool WTSRegisterSessionNotification(IntPtr window, int flags);

	static readonly object Gate = new object();
	static readonly Stream Out = Console.OpenStandardOutput();
	static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);
	static HashSet<string> wanted;
	static Window window;
	static System.Threading.Timer appsTimer;
	static System.Windows.Forms.Timer readyTimer;

	static bool On(string kind)
	{
		return wanted.Count == 0 || wanted.Contains(kind);
	}

	static string Quote(string s)
	{
		StringBuilder b = new StringBuilder("\"");
		foreach (char c in s)
		{
			if (c == '"' || c == '\\') b.Append('\\').Append(c);
			else if (c < 0x20 || c == 0x7f || c == 0x2028 || c == 0x2029) b.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
			else b.Append(c);
		}
		return b.Append('"').ToString();
	}

	// One line: the event and its fields, given as name, value, name, value. A value is a string, a bool or an int.
	static void Say(string ev, params object[] fields)
	{
		StringBuilder b = new StringBuilder();
		for (int i = 0; i + 1 < fields.Length; i += 2)
		{
			b.Append(Quote((string)fields[i])).Append(':');
			object v = fields[i + 1];
			if (v is bool) b.Append((bool)v ? "true" : "false");
			else if (v is int) b.Append(((int)v).ToString(CultureInfo.InvariantCulture));
			else b.Append(Quote(Convert.ToString(v, CultureInfo.InvariantCulture)));
			b.Append(',');
		}
		b.Insert(0, "{").Append("\"event\":").Append(Quote(ev)).Append("}\n");
		byte[] bytes = Utf8.GetBytes(b.ToString());
		lock (Gate)
		{
			try
			{
				Out.Write(bytes, 0, bytes.Length);
				Out.Flush();
			}
			catch (IOException)
			{
				// Nobody reads any more: pine is gone.
				Environment.Exit(0);
			}
		}
	}

	static string lastPower;

	// Where the power comes from and how full the battery is. A computer without a battery says only "ac".
	static void Power()
	{
		SYSTEM_POWER_STATUS s;
		if (!GetSystemPowerStatus(out s)) return;
		List<object> fields = new List<object>();
		fields.Add("on");
		fields.Add(s.ACLineStatus == 0 ? "battery" : "ac");
		// 128: no system battery; 255: unknown. 8: charging.
		if ((s.BatteryFlag & 128) == 0 && s.BatteryFlag != 255 && s.BatteryLifePercent <= 100)
		{
			fields.Add("percent");
			fields.Add((int)s.BatteryLifePercent);
			fields.Add("charging");
			fields.Add((s.BatteryFlag & 8) != 0);
		}
		string key = string.Join("|", fields);
		lock (Gate)
		{
			if (key == lastPower) return;
			lastPower = key;
		}
		Say("power", fields.ToArray());
	}

	static string lastNetwork;

	// Online when an interface that is up has a gateway; the way is that interface's kind.
	static void Network()
	{
		bool online = false;
		string via = "other";
		try
		{
			foreach (NetworkInterface n in NetworkInterface.GetAllNetworkInterfaces())
			{
				NetworkInterfaceType t = n.NetworkInterfaceType;
				if (n.OperationalStatus != OperationalStatus.Up || t == NetworkInterfaceType.Loopback || t == NetworkInterfaceType.Tunnel) continue;
				bool gateway = false;
				foreach (GatewayIPAddressInformation g in n.GetIPProperties().GatewayAddresses)
				{
					if (!g.Address.Equals(IPAddress.Any) && !g.Address.Equals(IPAddress.IPv6Any)) { gateway = true; break; }
				}
				if (!gateway) continue;
				string kind = "other";
				if (t == NetworkInterfaceType.Wireless80211) kind = "wifi";
				else if (t == NetworkInterfaceType.Wwanpp || t == NetworkInterfaceType.Wwanpp2) kind = "cellular";
				else if (t == NetworkInterfaceType.Ethernet || t == NetworkInterfaceType.GigabitEthernet || t == NetworkInterfaceType.FastEthernetT || t == NetworkInterfaceType.FastEthernetFx || t == NetworkInterfaceType.Ethernet3Megabit) kind = "ethernet";
				if (!online || (via == "other" && kind != "other")) via = kind;
				online = true;
			}
		}
		catch (NetworkInformationException)
		{
			return;
		}
		string key = online ? via : "offline";
		lock (Gate)
		{
			if (key == lastNetwork) return;
			lastNetwork = key;
		}
		if (online) Say("network", "online", true, "via", via);
		else Say("network", "online", false);
	}

	static int display = -1;
	static bool asleep;

	// The first state Windows sends is how things are: the starting point, not a change. Dimmed counts as on.
	static void Display(int state)
	{
		int now = state == 0 ? 0 : 1;
		if (display >= 0 && now != display) Say(now == 1 ? "display-on" : "display-off");
		display = now;
	}

	// A disk's label, by its drive ("E:\"), kept from when it came so that its going can be named too.
	static readonly Dictionary<string, string> labels = new Dictionary<string, string>();

	static string Label(string drive)
	{
		try
		{
			DriveInfo d = new DriveInfo(drive);
			if (d.IsReady && d.VolumeLabel.Length > 0) return d.VolumeLabel;
		}
		catch (Exception)
		{
		}
		return drive.TrimEnd('\\');
	}

	static void Volume(bool came, int mask)
	{
		for (int i = 0; i < 26; i++)
		{
			if ((mask & (1 << i)) == 0) continue;
			string drive = ((char)('A' + i)).ToString() + ":\\";
			if (came)
			{
				// Reading the label may wait for the disk or the network: not on the window's thread.
				ThreadPool.QueueUserWorkItem(delegate
				{
					string name = Label(drive);
					lock (labels) labels[drive] = name;
					Say("mounted", "name", name, "path", drive);
				});
			}
			else
			{
				string name;
				lock (labels)
				{
					if (!labels.TryGetValue(drive, out name)) name = drive.TrimEnd('\\');
					labels.Remove(drive);
				}
				Say("unmounted", "name", name, "path", drive);
			}
		}
	}

	static void Labels()
	{
		foreach (DriveInfo d in DriveInfo.GetDrives())
		{
			if (d.DriveType == DriveType.Network) continue;
			string name = Label(d.Name);
			lock (labels) if (!labels.ContainsKey(d.Name)) labels[d.Name] = name;
		}
	}

	static HashSet<string> running;
	static readonly object looking = new object();

	// Apps by the name of their program, without ".exe", in this session (not services): said when the
	// first process of a name starts and when the last one ends, so that a browser of thirty processes is one app.
	static void Apps()
	{
		// A look that takes longer than the timer's two seconds is not run twice at once.
		if (!Monitor.TryEnter(looking)) return;
		try { Look(); }
		finally { Monitor.Exit(looking); }
	}

	static void Look()
	{
		HashSet<string> now = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
		int session = Process.GetCurrentProcess().SessionId;
		foreach (Process p in Process.GetProcesses())
		{
			try
			{
				if (p.SessionId == session) now.Add(p.ProcessName);
			}
			catch (Exception)
			{
			}
			finally
			{
				p.Dispose();
			}
		}
		if (running != null)
		{
			foreach (string n in now) if (!running.Contains(n)) Say("app-started", "app", n);
			foreach (string n in running) if (!now.Contains(n)) Say("app-quit", "app", n);
		}
		running = now;
	}

	class Window : NativeWindow
	{
		public Window()
		{
			// A top-level window that is never shown: Windows sends power and disk news to top-level windows.
			CreateHandle(new CreateParams());
		}

		protected override void WndProc(ref Message m)
		{
			try
			{
				if (m.Msg == WM_POWERBROADCAST)
				{
					int what = m.WParam.ToInt32();
					if (what == PBT_APMSUSPEND && On("sleep"))
					{
						asleep = true;
						Say("sleeping");
					}
					else if ((what == PBT_APMRESUMEAUTOMATIC || (what == PBT_APMRESUMESUSPEND && asleep)) && On("sleep"))
					{
						// After a wake by hand both come, the automatic one first: said once.
						asleep = false;
						Say("woke");
					}
					else if (what == PBT_APMPOWERSTATUSCHANGE && On("power")) Power();
					else if (what == PBT_POWERSETTINGCHANGE && m.LParam != IntPtr.Zero)
					{
						// POWERBROADCAST_SETTING: the setting's GUID, the length of its data, the data (a DWORD here).
						Guid setting = (Guid)Marshal.PtrToStructure(m.LParam, typeof(Guid));
						int data = Marshal.ReadInt32(m.LParam, 20);
						if (setting == DisplayState) Display(data);
						else if (setting == BatteryPercent) Power();
					}
				}
				else if (m.Msg == WM_WTSSESSION_CHANGE && On("lock"))
				{
					int what = m.WParam.ToInt32();
					if (what == WTS_SESSION_LOCK) Say("locked");
					else if (what == WTS_SESSION_UNLOCK) Say("unlocked");
				}
				else if (m.Msg == WM_DEVICECHANGE && On("volumes") && m.LParam != IntPtr.Zero)
				{
					int what = m.WParam.ToInt32();
					// DEV_BROADCAST_VOLUME: size, device type, reserved, the mask of drive letters, flags.
					if ((what == DBT_DEVICEARRIVAL || what == DBT_DEVICEREMOVECOMPLETE) && Marshal.ReadInt32(m.LParam, 4) == DBT_DEVTYP_VOLUME)
						Volume(what == DBT_DEVICEARRIVAL, Marshal.ReadInt32(m.LParam, 12));
				}
			}
			catch (Exception)
			{
				// A message it could not read is no reason to stop listening.
			}
			base.WndProc(ref m);
		}
	}

	[STAThread]
	static void Main(string[] args)
	{
		wanted = new HashSet<string>(args);

		// pine closes the input when the source stops, and when pine itself is gone the input is closed too.
		Thread input = new Thread(delegate()
		{
			Stream stdin = Console.OpenStandardInput();
			byte[] buffer = new byte[256];
			try
			{
				while (stdin.Read(buffer, 0, buffer.Length) > 0) { }
			}
			catch (Exception)
			{
			}
			Environment.Exit(0);
		});
		input.IsBackground = true;
		input.Start();

		window = new Window();
		if (On("sleep"))
		{
			Guid g = DisplayState;
			RegisterPowerSettingNotification(window.Handle, ref g, 0);
		}
		if (On("lock")) WTSRegisterSessionNotification(window.Handle, 0);
		if (On("power"))
		{
			// Said once at the start, so that whoever listens knows what a later line differs from.
			Power();
			Guid g = BatteryPercent;
			RegisterPowerSettingNotification(window.Handle, ref g, 0);
		}
		if (On("network"))
		{
			Network();
			NetworkChange.NetworkAddressChanged += delegate { Network(); };
			NetworkChange.NetworkAvailabilityChanged += delegate { Network(); };
		}
		if (On("volumes")) ThreadPool.QueueUserWorkItem(delegate { Labels(); });
		if (On("apps"))
		{
			Apps();
			appsTimer = new System.Threading.Timer(delegate
			{
				try { Apps(); }
				catch (Exception) { }
			}, null, 2000, 2000);
		}

		// Said from the message loop: "ready" means the loop that delivers the news runs.
		readyTimer = new System.Windows.Forms.Timer();
		readyTimer.Interval = 1;
		readyTimer.Tick += delegate
		{
			readyTimer.Stop();
			Say("ready");
		};
		readyTimer.Start();
		Application.Run();
	}
}
