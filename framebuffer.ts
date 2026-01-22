// framebuffer.ts - Virtual terminal state buffer
// Parses ANSI escape sequences and maintains current screen state

interface Cell {
  char: string;
  fg: number;      // Foreground color (0-255, -1 for default)
  bg: number;      // Background color (0-255, -1 for default)
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  blink: boolean;
  inverse: boolean;
  hidden: boolean;
  strikethrough: boolean;
}

interface CursorState {
  x: number;
  y: number;
  visible: boolean;
}

interface SavedCursor {
  x: number;
  y: number;
  attrs: Cell;
}

function defaultCell(): Cell {
  return {
    char: " ",
    fg: -1,
    bg: -1,
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    blink: false,
    inverse: false,
    hidden: false,
    strikethrough: false,
  };
}

export class Framebuffer {
  private cols: number;
  private rows: number;
  private cells: Cell[][];
  private cursor: CursorState;
  private savedCursor: SavedCursor | null = null;
  private currentAttrs: Cell;
  private scrollTop: number;
  private scrollBottom: number;
  private altBuffer: Cell[][] | null = null;
  private altCursor: CursorState | null = null;
  private parseBuffer: string = "";

  constructor(cols: number = 80, rows: number = 24) {
    this.cols = cols;
    this.rows = rows;
    this.cursor = { x: 0, y: 0, visible: true };
    this.currentAttrs = defaultCell();
    this.scrollTop = 0;
    this.scrollBottom = rows - 1;
    this.cells = this.createBuffer();
  }

  private createBuffer(): Cell[][] {
    const buffer: Cell[][] = [];
    for (let y = 0; y < this.rows; y++) {
      buffer.push(this.createRow());
    }
    return buffer;
  }

  private createRow(): Cell[] {
    const row: Cell[] = [];
    for (let x = 0; x < this.cols; x++) {
      row.push(defaultCell());
    }
    return row;
  }

  resize(cols: number, rows: number): void {
    const oldCells = this.cells;
    const oldRows = this.rows;
    const oldCols = this.cols;

    this.cols = cols;
    this.rows = rows;
    this.scrollBottom = rows - 1;
    this.cells = this.createBuffer();

    // Copy old content
    for (let y = 0; y < Math.min(oldRows, rows); y++) {
      for (let x = 0; x < Math.min(oldCols, cols); x++) {
        this.cells[y][x] = oldCells[y][x];
      }
    }

    // Clamp cursor
    this.cursor.x = Math.min(this.cursor.x, cols - 1);
    this.cursor.y = Math.min(this.cursor.y, rows - 1);
  }

  write(data: Uint8Array | string): void {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    this.parseBuffer += text;
    this.parse();
  }

  private parse(): void {
    let i = 0;
    const buf = this.parseBuffer;

    while (i < buf.length) {
      const char = buf[i];

      if (char === "\x1b") {
        // ESC sequence
        if (i + 1 >= buf.length) {
          // Need more data
          this.parseBuffer = buf.slice(i);
          return;
        }

        const next = buf[i + 1];

        if (next === "[") {
          // CSI sequence
          const match = buf.slice(i).match(/^\x1b\[([?!>]?)([0-9;]*)([a-zA-Z@`])/);
          if (!match) {
            if (buf.length - i < 32) {
              // Might be incomplete, wait for more
              this.parseBuffer = buf.slice(i);
              return;
            }
            // Invalid sequence, skip ESC[
            i += 2;
            continue;
          }
          this.handleCSI(match[1], match[2], match[3]);
          i += match[0].length;
        } else if (next === "]") {
          // OSC sequence (Operating System Command)
          const end = buf.slice(i).search(/\x07|\x1b\\/);
          if (end === -1) {
            this.parseBuffer = buf.slice(i);
            return;
          }
          // Skip OSC sequences (title changes, etc.)
          i += end + (buf[i + end] === "\x07" ? 1 : 2);
        } else if (next === "(") {
          // Character set designation, skip
          i += 3;
        } else if (next === ")") {
          i += 3;
        } else if (next === "7") {
          // Save cursor
          this.saveCursor();
          i += 2;
        } else if (next === "8") {
          // Restore cursor
          this.restoreCursor();
          i += 2;
        } else if (next === "M") {
          // Reverse index (scroll down)
          this.reverseIndex();
          i += 2;
        } else if (next === "D") {
          // Index (scroll up)
          this.index();
          i += 2;
        } else if (next === "E") {
          // Next line
          this.cursor.x = 0;
          this.index();
          i += 2;
        } else if (next === "c") {
          // Reset
          this.reset();
          i += 2;
        } else {
          // Unknown ESC sequence
          i += 2;
        }
      } else if (char === "\r") {
        this.cursor.x = 0;
        i++;
      } else if (char === "\n") {
        this.linefeed();
        i++;
      } else if (char === "\t") {
        // Tab - move to next 8-column boundary
        this.cursor.x = Math.min(this.cols - 1, (Math.floor(this.cursor.x / 8) + 1) * 8);
        i++;
      } else if (char === "\b") {
        // Backspace
        if (this.cursor.x > 0) this.cursor.x--;
        i++;
      } else if (char === "\x07") {
        // Bell - ignore
        i++;
      } else if (char.charCodeAt(0) < 32) {
        // Other control characters - ignore
        i++;
      } else {
        // Regular character
        this.putChar(char);
        i++;
      }
    }

    this.parseBuffer = "";
  }

  private handleCSI(prefix: string, params: string, command: string): void {
    const args = params ? params.split(";").map((n) => parseInt(n, 10) || 0) : [];

    if (prefix === "?") {
      // DEC private modes
      this.handleDECMode(args, command);
      return;
    }

    switch (command) {
      case "A": // Cursor up
        this.cursor.y = Math.max(0, this.cursor.y - (args[0] || 1));
        break;
      case "B": // Cursor down
        this.cursor.y = Math.min(this.rows - 1, this.cursor.y + (args[0] || 1));
        break;
      case "C": // Cursor forward
        this.cursor.x = Math.min(this.cols - 1, this.cursor.x + (args[0] || 1));
        break;
      case "D": // Cursor backward
        this.cursor.x = Math.max(0, this.cursor.x - (args[0] || 1));
        break;
      case "E": // Cursor next line
        this.cursor.x = 0;
        this.cursor.y = Math.min(this.rows - 1, this.cursor.y + (args[0] || 1));
        break;
      case "F": // Cursor previous line
        this.cursor.x = 0;
        this.cursor.y = Math.max(0, this.cursor.y - (args[0] || 1));
        break;
      case "G": // Cursor horizontal absolute
        this.cursor.x = Math.min(this.cols - 1, Math.max(0, (args[0] || 1) - 1));
        break;
      case "H": // Cursor position
      case "f":
        this.cursor.y = Math.min(this.rows - 1, Math.max(0, (args[0] || 1) - 1));
        this.cursor.x = Math.min(this.cols - 1, Math.max(0, (args[1] || 1) - 1));
        break;
      case "J": // Erase in display
        this.eraseInDisplay(args[0] || 0);
        break;
      case "K": // Erase in line
        this.eraseInLine(args[0] || 0);
        break;
      case "L": // Insert lines
        this.insertLines(args[0] || 1);
        break;
      case "M": // Delete lines
        this.deleteLines(args[0] || 1);
        break;
      case "P": // Delete characters
        this.deleteChars(args[0] || 1);
        break;
      case "@": // Insert characters
        this.insertChars(args[0] || 1);
        break;
      case "X": // Erase characters
        this.eraseChars(args[0] || 1);
        break;
      case "d": // Cursor vertical absolute
        this.cursor.y = Math.min(this.rows - 1, Math.max(0, (args[0] || 1) - 1));
        break;
      case "m": // SGR (Select Graphic Rendition)
        this.handleSGR(args.length ? args : [0]);
        break;
      case "r": // Set scrolling region
        this.scrollTop = (args[0] || 1) - 1;
        this.scrollBottom = (args[1] || this.rows) - 1;
        break;
      case "s": // Save cursor position
        this.saveCursor();
        break;
      case "u": // Restore cursor position
        this.restoreCursor();
        break;
      case "n": // Device status report - ignore
        break;
      case "c": // Device attributes - ignore
        break;
      case "h": // Set mode - ignore most
        break;
      case "l": // Reset mode - ignore most
        break;
    }
  }

  private handleDECMode(args: number[], command: string): void {
    const set = command === "h";
    for (const mode of args) {
      switch (mode) {
        case 25: // Cursor visibility
          this.cursor.visible = set;
          break;
        case 1049: // Alternate screen buffer
          if (set) {
            this.altBuffer = this.cells;
            this.altCursor = { ...this.cursor };
            this.cells = this.createBuffer();
            this.cursor = { x: 0, y: 0, visible: true };
          } else if (this.altBuffer) {
            this.cells = this.altBuffer;
            this.cursor = this.altCursor!;
            this.altBuffer = null;
            this.altCursor = null;
          }
          break;
        case 1: // Application cursor keys - ignore
        case 7: // Auto-wrap - ignore (always on)
        case 12: // Blinking cursor - ignore
        case 47: // Alternate screen (old)
        case 1047: // Alternate screen
        case 1048: // Save/restore cursor
        case 2004: // Bracketed paste - ignore
          break;
      }
    }
  }

  private handleSGR(args: number[]): void {
    let i = 0;
    while (i < args.length) {
      const code = args[i];
      
      if (code === 0) {
        // Reset
        this.currentAttrs = defaultCell();
      } else if (code === 1) {
        this.currentAttrs.bold = true;
      } else if (code === 2) {
        this.currentAttrs.dim = true;
      } else if (code === 3) {
        this.currentAttrs.italic = true;
      } else if (code === 4) {
        this.currentAttrs.underline = true;
      } else if (code === 5) {
        this.currentAttrs.blink = true;
      } else if (code === 7) {
        this.currentAttrs.inverse = true;
      } else if (code === 8) {
        this.currentAttrs.hidden = true;
      } else if (code === 9) {
        this.currentAttrs.strikethrough = true;
      } else if (code === 22) {
        this.currentAttrs.bold = false;
        this.currentAttrs.dim = false;
      } else if (code === 23) {
        this.currentAttrs.italic = false;
      } else if (code === 24) {
        this.currentAttrs.underline = false;
      } else if (code === 25) {
        this.currentAttrs.blink = false;
      } else if (code === 27) {
        this.currentAttrs.inverse = false;
      } else if (code === 28) {
        this.currentAttrs.hidden = false;
      } else if (code === 29) {
        this.currentAttrs.strikethrough = false;
      } else if (code >= 30 && code <= 37) {
        this.currentAttrs.fg = code - 30;
      } else if (code === 38) {
        // Extended foreground color
        if (args[i + 1] === 5) {
          this.currentAttrs.fg = args[i + 2] || 0;
          i += 2;
        } else if (args[i + 1] === 2) {
          // 24-bit color - approximate to 256
          const r = args[i + 2] || 0;
          const g = args[i + 3] || 0;
          const b = args[i + 4] || 0;
          this.currentAttrs.fg = 16 + 36 * Math.floor(r / 51) + 6 * Math.floor(g / 51) + Math.floor(b / 51);
          i += 4;
        }
      } else if (code === 39) {
        this.currentAttrs.fg = -1;
      } else if (code >= 40 && code <= 47) {
        this.currentAttrs.bg = code - 40;
      } else if (code === 48) {
        // Extended background color
        if (args[i + 1] === 5) {
          this.currentAttrs.bg = args[i + 2] || 0;
          i += 2;
        } else if (args[i + 1] === 2) {
          const r = args[i + 2] || 0;
          const g = args[i + 3] || 0;
          const b = args[i + 4] || 0;
          this.currentAttrs.bg = 16 + 36 * Math.floor(r / 51) + 6 * Math.floor(g / 51) + Math.floor(b / 51);
          i += 4;
        }
      } else if (code === 49) {
        this.currentAttrs.bg = -1;
      } else if (code >= 90 && code <= 97) {
        this.currentAttrs.fg = code - 90 + 8; // Bright colors
      } else if (code >= 100 && code <= 107) {
        this.currentAttrs.bg = code - 100 + 8; // Bright colors
      }
      i++;
    }
  }

  private putChar(char: string): void {
    if (this.cursor.x >= this.cols) {
      this.cursor.x = 0;
      this.linefeed();
    }
    
    this.cells[this.cursor.y][this.cursor.x] = {
      ...this.currentAttrs,
      char,
    };
    this.cursor.x++;
  }

  private linefeed(): void {
    if (this.cursor.y === this.scrollBottom) {
      this.scrollUp();
    } else if (this.cursor.y < this.rows - 1) {
      this.cursor.y++;
    }
  }

  private index(): void {
    this.linefeed();
  }

  private reverseIndex(): void {
    if (this.cursor.y === this.scrollTop) {
      this.scrollDown();
    } else if (this.cursor.y > 0) {
      this.cursor.y--;
    }
  }

  private scrollUp(): void {
    // Remove top line in scroll region, add new line at bottom
    this.cells.splice(this.scrollTop, 1);
    this.cells.splice(this.scrollBottom, 0, this.createRow());
  }

  private scrollDown(): void {
    // Remove bottom line in scroll region, add new line at top
    this.cells.splice(this.scrollBottom, 1);
    this.cells.splice(this.scrollTop, 0, this.createRow());
  }

  private eraseInDisplay(mode: number): void {
    if (mode === 0) {
      // Erase from cursor to end
      this.eraseInLine(0);
      for (let y = this.cursor.y + 1; y < this.rows; y++) {
        this.cells[y] = this.createRow();
      }
    } else if (mode === 1) {
      // Erase from start to cursor
      for (let y = 0; y < this.cursor.y; y++) {
        this.cells[y] = this.createRow();
      }
      this.eraseInLine(1);
    } else if (mode === 2 || mode === 3) {
      // Erase entire display
      this.cells = this.createBuffer();
    }
  }

  private eraseInLine(mode: number): void {
    const row = this.cells[this.cursor.y];
    if (mode === 0) {
      // Erase from cursor to end
      for (let x = this.cursor.x; x < this.cols; x++) {
        row[x] = defaultCell();
      }
    } else if (mode === 1) {
      // Erase from start to cursor
      for (let x = 0; x <= this.cursor.x; x++) {
        row[x] = defaultCell();
      }
    } else if (mode === 2) {
      // Erase entire line
      this.cells[this.cursor.y] = this.createRow();
    }
  }

  private insertLines(count: number): void {
    for (let i = 0; i < count; i++) {
      this.cells.splice(this.scrollBottom, 1);
      this.cells.splice(this.cursor.y, 0, this.createRow());
    }
  }

  private deleteLines(count: number): void {
    for (let i = 0; i < count; i++) {
      this.cells.splice(this.cursor.y, 1);
      this.cells.splice(this.scrollBottom, 0, this.createRow());
    }
  }

  private insertChars(count: number): void {
    const row = this.cells[this.cursor.y];
    for (let i = 0; i < count; i++) {
      row.pop();
      row.splice(this.cursor.x, 0, defaultCell());
    }
  }

  private deleteChars(count: number): void {
    const row = this.cells[this.cursor.y];
    for (let i = 0; i < count; i++) {
      row.splice(this.cursor.x, 1);
      row.push(defaultCell());
    }
  }

  private eraseChars(count: number): void {
    const row = this.cells[this.cursor.y];
    for (let i = 0; i < count && this.cursor.x + i < this.cols; i++) {
      row[this.cursor.x + i] = defaultCell();
    }
  }

  private saveCursor(): void {
    this.savedCursor = {
      x: this.cursor.x,
      y: this.cursor.y,
      attrs: { ...this.currentAttrs },
    };
  }

  private restoreCursor(): void {
    if (this.savedCursor) {
      this.cursor.x = this.savedCursor.x;
      this.cursor.y = this.savedCursor.y;
      this.currentAttrs = { ...this.savedCursor.attrs };
    }
  }

  private reset(): void {
    this.cells = this.createBuffer();
    this.cursor = { x: 0, y: 0, visible: true };
    this.currentAttrs = defaultCell();
    this.scrollTop = 0;
    this.scrollBottom = this.rows - 1;
    this.savedCursor = null;
    this.altBuffer = null;
    this.altCursor = null;
  }

  // Serialize to ANSI escape sequences that recreate the current state
  serialize(): string {
    let output = "";
    
    // Reset and clear
    output += "\x1b[0m\x1b[2J\x1b[H";
    
    let lastAttrs = defaultCell();
    
    for (let y = 0; y < this.rows; y++) {
      // Move to line start
      output += `\x1b[${y + 1};1H`;
      
      for (let x = 0; x < this.cols; x++) {
        const cell = this.cells[y][x];
        
        // Build SGR sequence if attributes changed
        const sgr: number[] = [];
        
        if (cell.bold !== lastAttrs.bold || 
            cell.dim !== lastAttrs.dim ||
            cell.italic !== lastAttrs.italic ||
            cell.underline !== lastAttrs.underline ||
            cell.blink !== lastAttrs.blink ||
            cell.inverse !== lastAttrs.inverse ||
            cell.hidden !== lastAttrs.hidden ||
            cell.strikethrough !== lastAttrs.strikethrough ||
            cell.fg !== lastAttrs.fg ||
            cell.bg !== lastAttrs.bg) {
          
          sgr.push(0); // Reset first
          if (cell.bold) sgr.push(1);
          if (cell.dim) sgr.push(2);
          if (cell.italic) sgr.push(3);
          if (cell.underline) sgr.push(4);
          if (cell.blink) sgr.push(5);
          if (cell.inverse) sgr.push(7);
          if (cell.hidden) sgr.push(8);
          if (cell.strikethrough) sgr.push(9);
          if (cell.fg >= 0 && cell.fg < 8) sgr.push(30 + cell.fg);
          else if (cell.fg >= 8 && cell.fg < 16) sgr.push(90 + cell.fg - 8);
          else if (cell.fg >= 16) sgr.push(38, 5, cell.fg);
          if (cell.bg >= 0 && cell.bg < 8) sgr.push(40 + cell.bg);
          else if (cell.bg >= 8 && cell.bg < 16) sgr.push(100 + cell.bg - 8);
          else if (cell.bg >= 16) sgr.push(48, 5, cell.bg);
          
          output += `\x1b[${sgr.join(";")}m`;
          lastAttrs = { ...cell };
        }
        
        output += cell.char;
      }
    }
    
    // Reset attributes and position cursor
    output += `\x1b[0m\x1b[${this.cursor.y + 1};${this.cursor.x + 1}H`;
    if (!this.cursor.visible) {
      output += "\x1b[?25l";
    }
    
    return output;
  }

  getSize(): { cols: number; rows: number } {
    return { cols: this.cols, rows: this.rows };
  }
}
