// pine's ears on Windows: turns what is said into text, on this computer.
//
// The terminal UI and the Pine app start this helper when the owner wants to dictate a message
// (src/tui/voice.ts builds it with the C# compiler of .NET Framework 4 on first use, src/csharp.ts).
// It listens to the default microphone, has Windows' own speech recogniser (System.Speech, the
// desktop recogniser, which works on the device and sends nothing anywhere) recognise the words,
// and writes what it hears as lines of JSON, one a line, as voice.swift does on a Mac:
//
//   {"type":"ready"}                      listening
//   {"type":"partial","text":"..."}       everything heard so far; the end of it may still change
//   {"type":"final","text":"..."}         the whole of it; the helper ends after this line
//   {"type":"error","code":"...","message":"..."}   it cannot; the message says what to do
//
// It listens until its input is closed, which is how the UI says "that was all".
// `--locale de-DE` names the language; `--check` only says what is there; `--file <wav>` reads a
// recording instead of the microphone. The helper decides nothing and keeps nothing.
//
// C# 5, for the compiler every Windows carries: no string interpolation, no expression bodies.
using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.IO;
using System.Speech.Recognition;
using System.Text;
using System.Threading;

static class Voice
{
	static readonly object Gate = new object();
	static readonly Stream Stdout = Console.OpenStandardOutput();
	static readonly ManualResetEvent Over = new ManualResetEvent(false);
	static readonly ManualResetEvent Stopped = new ManualResetEvent(false);
	// What is settled, and what is shown: the settled words and those still being heard.
	static string settled = "";
	static string heard = "";

	// Every character outside ASCII is written as \uXXXX: the line is the same in any code page.
	static string Q(string s)
	{
		if (s == null) return "null";
		StringBuilder b = new StringBuilder("\"");
		foreach (char c in s)
		{
			if (c == '"') b.Append("\\\"");
			else if (c == '\\') b.Append("\\\\");
			else if (c < 0x20 || c > 0x7e) b.Append("\\u").Append(((int)c).ToString("x4"));
			else b.Append(c);
		}
		return b.Append('"').ToString();
	}

	static void Out(string json)
	{
		byte[] bytes = Encoding.ASCII.GetBytes(json + "\n");
		lock (Gate)
		{
			Stdout.Write(bytes, 0, bytes.Length);
			Stdout.Flush();
		}
	}

	static void Fail(string code, string message)
	{
		Out("{\"type\":\"error\",\"code\":" + Q(code) + ",\"message\":" + Q(message) + "}");
		Environment.Exit(1);
	}

	static string Arg(string[] args, string name)
	{
		for (int i = 0; i + 1 < args.Length; i++) if (args[i] == name) return args[i + 1];
		return null;
	}

	static string Join(string a, string b)
	{
		a = a.Trim();
		b = b == null ? "" : b.Trim();
		if (a.Length == 0) return b;
		if (b.Length == 0) return a;
		return a + " " + b;
	}

	static RecognizerInfo Pick(ReadOnlyCollection<RecognizerInfo> all, CultureInfo wanted)
	{
		if (wanted == null) return null;
		foreach (RecognizerInfo r in all) if (string.Equals(r.Culture.Name, wanted.Name, StringComparison.OrdinalIgnoreCase)) return r;
		foreach (RecognizerInfo r in all) if (r.Culture.TwoLetterISOLanguageName == wanted.TwoLetterISOLanguageName) return r;
		return null;
	}

	const string AddOne = "Add one in Settings > Time & language > Language & region: choose the language, then Language options, and install Speech recognition (Windows 10: Settings > Time & Language > Language). Windows recognises English, German, French, Spanish, Japanese and Chinese this way.";

	static int Main(string[] args)
	{
		string locale = Arg(args, "--locale");
		string file = Arg(args, "--file");
		CultureInfo wanted = null;
		if (locale != null)
		{
			try { wanted = new CultureInfo(locale); }
			catch (ArgumentException) { Fail("language", "Windows does not know the language " + locale + "."); }
		}

		ReadOnlyCollection<RecognizerInfo> all = SpeechRecognitionEngine.InstalledRecognizers();
		List<string> names = new List<string>();
		foreach (RecognizerInfo r in all) names.Add(r.Culture.Name);
		// Without a language: the one Windows is shown in, then the one of its formats, then the recogniser Windows is set to.
		RecognizerInfo info = wanted != null ? Pick(all, wanted) : (Pick(all, CultureInfo.CurrentUICulture) ?? Pick(all, CultureInfo.CurrentCulture));

		if (Array.IndexOf(args, "--check") >= 0)
		{
			StringBuilder list = new StringBuilder("[");
			for (int i = 0; i < names.Count; i++) list.Append(i > 0 ? "," : "").Append(Q(names[i]));
			Out("{\"type\":\"status\",\"engine\":\"system.speech\",\"locale\":" + Q(info != null ? info.Culture.Name : null) + ",\"wanted\":" + Q(wanted != null ? wanted.Name : CultureInfo.CurrentUICulture.Name) + ",\"installed\":" + list.Append("]").ToString() + "}");
			return 0;
		}
		if (all.Count == 0) Fail("language", "Windows has no speech recogniser on this computer. " + AddOne);
		if (wanted != null && info == null) Fail("language", "Windows has no speech recogniser for " + wanted.Name + " on this computer (it has " + string.Join(", ", names) + "). Use one of those with /voice <language>, or add one. " + AddOne);

		SpeechRecognitionEngine engine = null;
		try { engine = info != null ? new SpeechRecognitionEngine(info) : new SpeechRecognitionEngine(); }
		catch (Exception e) { Fail("language", "Windows' speech recogniser could not be started (" + e.Message + "). " + AddOne); }
		engine.LoadGrammar(new DictationGrammar());
		try
		{
			if (file != null) engine.SetInputToWaveFile(file);
			else engine.SetInputToDefaultAudioDevice();
		}
		catch (Exception e)
		{
			if (file != null) Fail("audio", "the recording could not be read (" + e.Message + ").");
			Fail("microphone", "Windows has no microphone to listen with (" + e.Message + "). Connect one, or choose one in Settings > System > Sound > Input, then try again.");
		}

		engine.SpeechHypothesized += (s, e) =>
		{
			string text;
			lock (Gate) text = heard = Join(settled, e.Result.Text);
			Out("{\"type\":\"partial\",\"text\":" + Q(text) + "}");
		};
		engine.SpeechRecognized += (s, e) =>
		{
			string text;
			lock (Gate) text = heard = settled = Join(settled, e.Result.Text);
			Out("{\"type\":\"partial\",\"text\":" + Q(text) + "}");
		};
		// What it could not make out is not kept.
		engine.SpeechRecognitionRejected += (s, e) =>
		{
			lock (Gate) heard = settled;
		};
		engine.RecognizeCompleted += (s, e) =>
		{
			if (e.Error != null && heard.Length == 0) Fail("recognition", e.Error.Message);
			Over.Set();
		};

		engine.RecognizeAsync(RecognizeMode.Multiple);
		Out("{\"type\":\"ready\"}");
		if (file == null)
		{
			Thread input = new Thread(() =>
			{
				Stream stdin = Console.OpenStandardInput();
				byte[] buffer = new byte[256];
				try { while (stdin.Read(buffer, 0, buffer.Length) > 0) { } }
				catch (IOException) { }
				Stopped.Set();
				// Ends after what is being said now has been recognised.
				engine.RecognizeAsyncStop();
			});
			input.IsBackground = true;
			input.Start();
			Stopped.WaitOne();
			if (!Over.WaitOne(6000)) engine.RecognizeAsyncCancel();
		}
		else Over.WaitOne();
		string last;
		lock (Gate) last = heard;
		Out("{\"type\":\"final\",\"text\":" + Q(last) + "}");
		Environment.Exit(0);
		return 0;
	}
}
