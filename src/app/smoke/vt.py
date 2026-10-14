"""
A tiny VT100 screen for headless smoke tests of the OpenTUI app: run the app under a
pseudo-terminal, feed it keystrokes, and read back the screen as plain text.

OpenTUI draws with absolute cursor moves and SGR colours, so a grid that understands cursor
positioning, erases and printable text (with wide characters such as emoji) is all we need.
"""
import fcntl
import os
import pty
import re
import select
import struct
import termios
import time
import unicodedata

CSI = re.compile(r"\x1b\[([0-9;?<>=]*)([ -/]*)([@-~])")
OSC = re.compile(r"\x1b[\]P_^].*?(?:\x07|\x1b\\)", re.S)


def width(ch):
    if unicodedata.combining(ch) or ch in "‍️":
        return 0
    if unicodedata.east_asian_width(ch) in ("W", "F"):
        return 2
    return 1


class Screen:
    def __init__(self, cols=120, rows=40):
        self.cols, self.rows = cols, rows
        self.grid = [[" "] * cols for _ in range(rows)]
        self.x = self.y = 0
        self.pending = ""

    def put(self, ch):
        w = width(ch)
        if w == 0:
            return
        if self.x >= self.cols:
            self.x = 0
            self.y = min(self.rows - 1, self.y + 1)
        if 0 <= self.y < self.rows and 0 <= self.x < self.cols:
            self.grid[self.y][self.x] = ch
            if w == 2 and self.x + 1 < self.cols:
                self.grid[self.y][self.x + 1] = ""
        self.x += w

    def csi(self, params, final):
        nums = [int(p) if p.isdigit() else 0 for p in params.lstrip("?<>=").split(";")] if params else []
        n = (nums[0] if nums and nums[0] else 1)
        if params.startswith(("?", "<", ">", "=")):
            return
        if final in "Hf":
            row = nums[0] if len(nums) > 0 and nums[0] else 1
            col = nums[1] if len(nums) > 1 and nums[1] else 1
            self.y, self.x = min(self.rows - 1, row - 1), min(self.cols - 1, col - 1)
        elif final == "A":
            self.y = max(0, self.y - n)
        elif final == "B":
            self.y = min(self.rows - 1, self.y + n)
        elif final == "C":
            self.x = min(self.cols - 1, self.x + n)
        elif final == "D":
            self.x = max(0, self.x - n)
        elif final == "G":
            self.x = min(self.cols - 1, n - 1)
        elif final == "d":
            self.y = min(self.rows - 1, n - 1)
        elif final == "J":
            mode = nums[0] if nums else 0
            if mode == 2 or mode == 3:
                self.grid = [[" "] * self.cols for _ in range(self.rows)]
            elif mode == 0:
                self.grid[self.y][self.x:] = [" "] * (self.cols - self.x)
                for r in range(self.y + 1, self.rows):
                    self.grid[r] = [" "] * self.cols
        elif final == "K":
            mode = nums[0] if nums else 0
            if mode == 0:
                self.grid[self.y][self.x:] = [" "] * (self.cols - self.x)
            elif mode == 1:
                self.grid[self.y][: self.x + 1] = [" "] * (self.x + 1)
            else:
                self.grid[self.y] = [" "] * self.cols
        elif final == "X":
            for i in range(n):
                if self.x + i < self.cols:
                    self.grid[self.y][self.x + i] = " "

    def feed(self, data: str):
        data = self.pending + data
        self.pending = ""
        data = OSC.sub("", data)
        i = 0
        while i < len(data):
            ch = data[i]
            if ch == "\x1b":
                m = CSI.match(data, i)
                if m:
                    self.csi(m.group(1), m.group(3))
                    i = m.end()
                    continue
                if i + 1 >= len(data) or (data[i + 1] == "[" and not CSI.match(data, i)):
                    # An incomplete sequence at the end of a read: keep it for the next one.
                    if len(data) - i < 32:
                        self.pending = data[i:]
                        return
                i += 2
                continue
            if ch == "\r":
                self.x = 0
            elif ch == "\n":
                self.y = min(self.rows - 1, self.y + 1)
            elif ch == "\b":
                self.x = max(0, self.x - 1)
            elif ch >= " ":
                self.put(ch)
            i += 1

    def text(self):
        return "\n".join("".join(row).rstrip() for row in self.grid)


class App:
    """The app under a pty: send keys, wait for text, read the screen."""

    def __init__(self, argv, cwd, env=None, cols=120, rows=40):
        self.screen = Screen(cols, rows)
        self.raw = b""
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.chdir(cwd)
            os.environ.update(env or {})
            os.environ["TERM"] = "xterm-256color"
            os.execvp(argv[0], argv)
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        self.alive = True
        self.decoder = __import__("codecs").getincrementaldecoder("utf8")("replace")

    def pump(self, seconds=0.2):
        end = time.time() + seconds
        while time.time() < end and self.alive:
            r, _, _ = select.select([self.fd], [], [], 0.05)
            if not r:
                continue
            try:
                data = os.read(self.fd, 65536)
            except OSError:
                self.alive = False
                return
            if not data:
                self.alive = False
                return
            self.raw += data
            self.screen.feed(self.decoder.decode(data))

    def wait_for(self, pattern, timeout=30.0):
        """Pump until the screen matches (a regex); returns the match or None."""
        end = time.time() + timeout
        rx = re.compile(pattern, re.S | re.I)
        while time.time() < end and self.alive:
            self.pump(0.2)
            m = rx.search(self.screen.text())
            if m:
                return m
        return rx.search(self.screen.text())

    def send(self, keys, settle=0.3):
        os.write(self.fd, keys.encode() if isinstance(keys, str) else keys)
        self.pump(settle)

    def type(self, text, settle=0.3):
        for ch in text:
            os.write(self.fd, ch.encode())
            self.pump(0.01)
        self.pump(settle)

    def text(self):
        return self.screen.text()

    def close(self):
        try:
            os.kill(self.pid, 15)
        except ProcessLookupError:
            pass
        self.pump(0.3)


KEYS = {
    "up": "\x1b[A", "down": "\x1b[B", "right": "\x1b[C", "left": "\x1b[D",
    "enter": "\r", "esc": "\x1b", "tab": "\t", "backspace": "\x7f", "ctrl-c": "\x03",
    "pageup": "\x1b[5~", "pagedown": "\x1b[6~",
}
