import { EventEmitter } from 'events';
import { execSync } from 'child_process';
import os from 'os';
import * as pty from 'node-pty';
import Project from './models/Project.js';
import { containerManager } from './containerManager.js';
import { stripAnsi } from './conversationParser.js';

const SHELL_PROMPT = '__STARTUPP_SHELL_PROMPT__';

let cachedDockerBinary = null;

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function dockerPath() {
  if (cachedDockerBinary) return cachedDockerBinary;

  const extraPath = [
    process.env.PATH || '',
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/bin',
    '/snap/bin',
    `${os.homedir()}/.docker/bin`,
    `${os.homedir()}/.local/bin`,
  ].join(':');

  try {
    cachedDockerBinary = execSync('command -v docker', {
      encoding: 'utf8',
      env: { ...process.env, PATH: extraPath },
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || 'docker';
  } catch {
    cachedDockerBinary = 'docker';
  }

  return cachedDockerBinary;
}

function stripTerminalControls(data = '') {
  return stripAnsi(String(data || '')
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B[P^_][\s\S]*?\x1B\\/g, ''))
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1B[()][A-Za-z0-9]/g, '')
    .replace(/\x1B[78=><]/g, '')
    .replace(/\x1B./g, '')
    .replace(/␛\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/␛[78=><]?/g, '');
}

function cleanOutput(data, command = '') {
  let text = stripTerminalControls(data)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(new RegExp(`${SHELL_PROMPT}\\s*`, 'g'), '');

  if (command) {
    const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`^\\s*${escaped}\\s*\\n?`), '');
  }

  return text;
}

function normalizeInput(session, input) {
  const text = String(input || '');
  const trimmed = text.trim();
  const tail = stripTerminalControls(session.outputTail || '').trimEnd();
  const yesNoDefaultYes = /(?:\(|\[)Y\/n(?:\)|\])\s*$/i.test(tail);
  const yesNoDefaultNo = /(?:\(|\[)y\/N(?:\)|\])\s*$/i.test(tail);

  if (/^(down|arrow down|↓)$/i.test(trimmed)) return '\x1b[B';
  if (/^(up|arrow up|↑)$/i.test(trimmed)) return '\x1b[A';
  if (/^(right|arrow right|→)$/i.test(trimmed)) return '\x1b[C';
  if (/^(left|arrow left|←)$/i.test(trimmed)) return '\x1b[D';
  if (/^(space|spacebar)$/i.test(trimmed)) return ' ';
  if (/^(escape|esc)$/i.test(trimmed)) return '\x1b';
  if ((yesNoDefaultYes || yesNoDefaultNo) && /^(y|yes)$/i.test(trimmed)) return 'y';
  if ((yesNoDefaultYes || yesNoDefaultNo) && /^(n|no)$/i.test(trimmed)) return 'n';
  if (/^(enter|return)$/i.test(trimmed)) return '\r';
  if (/^(ctrl-c|control-c|interrupt)$/i.test(trimmed)) return '\x03';

  return text.replace(/\n/g, '\r') + '\r';
}

class ShellProxy extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map();
  }

  key(projectId, chatSessionId) {
    return `${projectId}:${chatSessionId}`;
  }

  ensureSession({ projectId, chatSessionId }) {
    const key = this.key(projectId, chatSessionId);
    const existing = this.sessions.get(key);
    if (existing?.ptyProcess && existing.status === 'active') return existing;

    const project = Project.findById(projectId);
    if (!project) throw new Error('Project not found');

    let shell = '/bin/bash';
    let args = ['--noprofile', '--norc', '-i'];
    let cwd = project.folderPath || process.env.HOME || os.homedir();

    if (project.containerName) {
      const status = containerManager.getContainerStatus(project.containerName);
      if (!status) throw new Error(`Container '${project.containerName}' does not exist`);
      if (status !== 'running' && !containerManager.startContainer(project.containerName)) {
        throw new Error(`Failed to start container '${project.containerName}'`);
      }

      const workDir = containerManager.getWorkDir(project.containerName) || '/workspace';
      const docker = dockerPath();
      shell = '/bin/bash';
      args = [
        '-lc',
        `exec ${shellQuote(docker)} exec -it -e TERM=xterm-256color -e COLORTERM=truecolor -e NO_COLOR=1 -e BROWSER=false -e PS1=${shellQuote(`${SHELL_PROMPT} `)} -w ${shellQuote(workDir)} ${shellQuote(project.containerName)} bash --noprofile --norc -i`,
      ];
      cwd = undefined;
    }

    const ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env: {
        ...process.env,
        PATH: `${process.env.PATH || ''}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/snap/bin:${os.homedir()}/.docker/bin:${os.homedir()}/.local/bin`,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        NO_COLOR: '1',
        BROWSER: 'false',
        PS1: `${SHELL_PROMPT} `,
      },
    });

    const session = {
      key,
      projectId,
      chatSessionId,
      ptyProcess,
      status: 'active',
      outputTail: '',
      atPrompt: false,
      currentCommand: '',
    };

    ptyProcess.onData((data) => this.handleData(session, data));
    ptyProcess.onExit(({ exitCode, signal }) => {
      session.status = 'terminated';
      this.sessions.delete(key);
      this.emit('exit', { projectId, chatSessionId, exitCode, signal });
    });

    this.sessions.set(key, session);
    return session;
  }

  handleData(session, data) {
    session.outputTail = (session.outputTail + data).slice(-5000);
    const clean = cleanOutput(data, session.currentCommand);

    if (stripTerminalControls(data).includes(SHELL_PROMPT)) {
      session.atPrompt = true;
      session.currentCommand = '';
    }

    if (!clean.trim()) return;

    this.emit('data', {
      projectId: session.projectId,
      chatSessionId: session.chatSessionId,
      data: clean,
      atPrompt: session.atPrompt,
      tail: stripTerminalControls(session.outputTail).slice(-500),
    });
  }

  send({ projectId, chatSessionId, input }) {
    const session = this.ensureSession({ projectId, chatSessionId });
    const data = normalizeInput(session, input);
    session.atPrompt = false;
    session.currentCommand = String(input || '').trim();
    session.ptyProcess.write(data);
    return { key: session.key, atPrompt: session.atPrompt };
  }

  interrupt({ projectId, chatSessionId }) {
    const session = this.ensureSession({ projectId, chatSessionId });
    session.ptyProcess.write('\x03');
  }
}

export const shellProxy = new ShellProxy();
export default shellProxy;
