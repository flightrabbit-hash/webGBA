# 시험 D1: 일반 권한 프로세스(탐색기와 같은 Medium)에서 OLE DoDragDrop 으로 파일을 webGBA 창에 끌어 놓는다.
#   powershell -NoProfile -STA -ExecutionPolicy Bypass -File tools/test/drag-drop.ps1 -File <게임 파일> [-Title "webGBA V0.1.0"]
# 끌기 원본 창(WinForms)을 띄우고, 다른 Thread 가 실제 마우스 입력(mouse_event)으로 누른 채 webGBA 창 가운데로 옮겨 놓는다.
# 함께 webGBA 프로세스의 무결성 수준을 출력한다.
param(
  [Parameter(Mandatory = $true)][string]$File,
  [string]$Title = "webGBA V0.1.0"
)

[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @"
using System;
using System.Collections.Specialized;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

public static class DragProbe {
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string name);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr token, int cls, IntPtr info, int len, out int ret);
  [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthority(IntPtr sid, uint index);
  [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }

  const uint LEFTDOWN = 0x0002, LEFTUP = 0x0004;

  public static string Integrity(IntPtr hwnd) {
    uint pid;
    GetWindowThreadProcessId(hwnd, out pid);
    IntPtr proc = OpenProcess(0x1000, false, pid);
    if (proc == IntPtr.Zero) return "pid " + pid + " (열지 못함)";
    IntPtr token;
    if (!OpenProcessToken(proc, 0x0008, out token)) { CloseHandle(proc); return "pid " + pid + " (토큰 없음)"; }
    int len;
    GetTokenInformation(token, 25, IntPtr.Zero, 0, out len);
    IntPtr buf = Marshal.AllocHGlobal(len);
    string result = "pid " + pid;
    if (GetTokenInformation(token, 25, buf, len, out len)) {
      IntPtr sid = Marshal.ReadIntPtr(buf);
      int count = Marshal.ReadByte(GetSidSubAuthorityCount(sid));
      int rid = Marshal.ReadInt32(GetSidSubAuthority(sid, (uint)(count - 1)));
      string name = rid >= 0x3000 ? "High(관리자)" : rid >= 0x2000 ? "Medium(일반)" : "Low";
      result += " 무결성 0x" + rid.ToString("X") + " " + name;
    }
    Marshal.FreeHGlobal(buf);
    CloseHandle(token);
    CloseHandle(proc);
    return result;
  }

  public static string Run(string file, string title) {
    SetProcessDPIAware();
    IntPtr target = FindWindow(null, title);
    if (target == IntPtr.Zero) return "webGBA 창을 찾지 못했습니다";
    string integrity = Integrity(target);
    RECT r;
    GetWindowRect(target, out r);
    int tx = (r.L + r.R) / 2 + (r.R - r.L) / 8, ty = (r.T + r.B) / 2;

    var form = new Form();
    form.TopMost = true;
    form.StartPosition = FormStartPosition.Manual;
    form.Location = new Point(r.L + 30, r.T + 80);
    form.Size = new Size(240, 120);
    form.Text = "끌기 원본";
    var label = new Label();
    label.Text = "drag source";
    label.Dock = DockStyle.Fill;
    label.TextAlign = ContentAlignment.MiddleCenter;
    form.Controls.Add(label);
    string effect = "없음";
    label.MouseDown += (s, e) => {
      var data = new DataObject();
      var list = new StringCollection();
      list.Add(file);
      data.SetFileDropList(list);
      effect = label.DoDragDrop(data, DragDropEffects.Copy | DragDropEffects.Link | DragDropEffects.Move).ToString();
      form.Close();
    };
    form.Shown += (s, e) => {
      Point p = label.PointToScreen(new Point(label.Width / 2, label.Height / 2));
      var mover = new Thread(() => {
        Thread.Sleep(700);
        SetCursorPos(p.X, p.Y);
        Thread.Sleep(150);
        mouse_event(LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
        Thread.Sleep(200);
        for (int i = 1; i <= 40; i++) {
          SetCursorPos(p.X + (tx - p.X) * i / 40, p.Y + (ty - p.Y) * i / 40);
          mouse_event(0x0001, 0, 0, 0, UIntPtr.Zero);
          Thread.Sleep(25);
        }
        Thread.Sleep(500);
        mouse_event(LEFTUP, 0, 0, 0, UIntPtr.Zero);
      });
      mover.IsBackground = true;
      mover.Start();
    };
    var timeout = new System.Windows.Forms.Timer();
    timeout.Interval = 15000;
    timeout.Tick += (s, e) => form.Close();
    timeout.Start();
    Application.Run(form);
    return integrity + " · 끌어 놓기 결과 " + effect;
  }
}
"@

[DragProbe]::Run($File, $Title)
