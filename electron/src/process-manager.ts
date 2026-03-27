import { spawn, ChildProcess, execSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as net from 'node:net';
import path from 'node:path';
import { app } from 'electron';

export class GoProcessManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private isShuttingDown = false;
  private restartCount = 0;
  private readonly MAX_RESTARTS = 3;
  private readonly RESTART_DELAY = 2000;
  private readonly pidFilePath: string;

  constructor() {
    super();
    this.pidFilePath = path.join(app.getPath('userData'), 'backend.pid');
  }

  async start(): Promise<void> {
    const binaryPath = this.getBinaryPath();

    console.log(`[GoProcessManager] Starting Go backend: ${binaryPath}`);

    const frontendDir = this.getFrontendDistPath();
    this.process = spawn(binaryPath, ['--frontend-dir', frontendDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ENCOUNTY_ELECTRON: '1' }
    });

    this.process.stdout?.on('data', (data) => {
      const output = data.toString();
      console.log('[Go]', output.trim());

      // Check if server is ready
      if (output.includes('Server listening')) {
        this.emit('ready');
      }
    });

    this.process.stderr?.on('data', (data) => {
      const output = data.toString();
      console.error('[Go]', output.trim());

      // slog writes to stderr; check for server ready signal
      if (output.includes('Server listening')) {
        this.emit('ready');
      }
    });

    this.process.on('exit', (code, signal) => {
      console.log(`[GoProcessManager] Process exited with code ${code}, signal ${signal}`);

      if (!this.isShuttingDown && code !== 0) {
        this.handleCrash(code);
      }
    });

    this.process.on('error', (err) => {
      console.error('[GoProcessManager] Process error:', err);
      this.emit('error', err);
    });

    if (this.process.pid) {
      this.writePidFile(this.process.pid);
    }
  }

  private handleCrash(exitCode: number | null): void {
    if (this.restartCount >= this.MAX_RESTARTS) {
      console.error('[GoProcessManager] Max restart attempts reached');
      this.emit('max-restarts-reached');
      return;
    }

    this.restartCount++;
    console.log(`[GoProcessManager] Restarting (attempt ${this.restartCount}/${this.MAX_RESTARTS})...`);

    setTimeout(() => {
      this.start().catch((err) => {
        console.error('[GoProcessManager] Restart failed:', err);
      });
    }, this.RESTART_DELAY);
  }

  /** Returns the path to the frontend dist directory for overlay serving. */
  private getFrontendDistPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'frontend-dist');
    }
    return path.join(__dirname, '..', '..', 'frontend', 'dist');
  }

  private getBinaryPath(): string {
    // Linux x64 + Windows x64 only
    const binaryName = process.platform === 'win32'
      ? 'encounty-backend-windows.exe'
      : 'encounty-backend-linux';

    if (app.isPackaged) {
      // Production mode: binary in resources
      const resourcesPath = process.resourcesPath;
      return path.join(resourcesPath, binaryName);
    } else {
      // Development mode: binary in root directory
      return path.join(__dirname, '..', '..', binaryName);
    }
  }

  async stop(): Promise<void> {
    this.isShuttingDown = true;

    if (!this.process) {
      console.log('[GoProcessManager] No process to stop');
      return;
    }

    console.log('[GoProcessManager] Sending SIGTERM...');
    this.process.kill('SIGTERM');

    // Wait for graceful shutdown or force kill after 5s
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        console.log('[GoProcessManager] Force killing with SIGKILL');
        this.process?.kill('SIGKILL');
        resolve();
      }, 5000);

      this.process?.once('exit', () => {
        clearTimeout(timeout);
        console.log('[GoProcessManager] Process stopped gracefully');
        resolve();
      });
    });

    this.process = null;
    this.removePidFile();
  }

  /** Writes the backend process PID to a file for zombie detection on next launch. */
  private writePidFile(pid: number): void {
    try {
      fs.writeFileSync(this.pidFilePath, String(pid), 'utf8');
    } catch { /* ignore write errors */ }
  }

  /** Removes the PID file after the backend process is stopped. */
  private removePidFile(): void {
    try {
      if (fs.existsSync(this.pidFilePath)) fs.unlinkSync(this.pidFilePath);
    } catch { /* ignore */ }
  }

  /** Reads a stale PID from the PID file and checks if the process is still alive. */
  readStalePid(): number | null {
    try {
      if (!fs.existsSync(this.pidFilePath)) return null;
      const pid = parseInt(fs.readFileSync(this.pidFilePath, 'utf8').trim(), 10);
      if (isNaN(pid)) return null;
      // Signal 0 checks if the process exists without sending a real signal
      try { process.kill(pid, 0); return pid; } catch { return null; }
    } catch { return null; }
  }

  /** Checks whether a TCP port is currently accepting connections on localhost. */
  static checkPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.createConnection({ port, host: '127.0.0.1' });
      socket.setTimeout(1000);
      socket.on('connect', () => { socket.destroy(); resolve(true); });
      socket.on('error', () => resolve(false));
      socket.on('timeout', () => { socket.destroy(); resolve(false); });
    });
  }

  /** Finds the PID of the process listening on the given TCP port, or null if none found. */
  static findProcessOnPort(port: number): number | null {
    try {
      if (process.platform === 'win32') {
        const output = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf8', timeout: 3000 });
        const match = output.trim().split('\n')[0]?.match(/\s+(\d+)\s*$/);
        return match ? parseInt(match[1], 10) : null;
      } else {
        const output = execSync(`fuser ${port}/tcp 2>/dev/null`, { encoding: 'utf8', timeout: 3000 });
        const pid = parseInt(output.trim(), 10);
        return isNaN(pid) ? null : pid;
      }
    } catch {
      return null;
    }
  }

  /** Kills a process by PID, trying SIGTERM first then SIGKILL after 2 seconds. */
  static async killProcess(pid: number): Promise<void> {
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /PID ${pid} /F`, { timeout: 5000 });
      } else {
        process.kill(pid, 'SIGTERM');
        // Wait up to 2s for graceful exit, then force kill
        await new Promise<void>((resolve) => {
          let checks = 0;
          const interval = setInterval(() => {
            try {
              process.kill(pid, 0);
              checks++;
              if (checks > 10) {
                clearInterval(interval);
                try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
                resolve();
              }
            } catch {
              clearInterval(interval);
              resolve();
            }
          }, 200);
        });
      }
    } catch { /* process might already be dead */ }
  }
}
