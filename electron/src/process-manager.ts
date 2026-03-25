import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { app } from 'electron';

export class GoProcessManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private isShuttingDown = false;
  private restartCount = 0;
  private readonly MAX_RESTARTS = 3;
  private readonly RESTART_DELAY = 2000;

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
      if (output.includes('Server listening on :8080')) {
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
  }
}
