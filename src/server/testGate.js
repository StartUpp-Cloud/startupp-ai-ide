/**
 * Test Gate
 * Runs tests after code changes and gates plan progression.
 * Supports auto-detection of test frameworks and structured result parsing.
 */

import { exec } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

class TestGate {
  /**
   * Auto-detect the test command from a project's configuration.
   * Reads package.json scripts for 'test', 'test:unit', etc.
   * Falls back to common config file patterns (vitest, jest, pytest).
   * @param {string} projectPath - Absolute path to the project directory.
   * @returns {string|null} The test command to run, or null if undetectable.
   */
  detectTestCommand(projectPath) {
    // Try package.json first
    const packageJsonPath = path.join(projectPath, 'package.json');

    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
        const scripts = packageJson.scripts || {};

        // Check test scripts in priority order
        const testScriptKeys = ['test', 'test:unit', 'test:ci', 'test:run'];

        for (const key of testScriptKeys) {
          const script = scripts[key];
          if (script && !this._isPlaceholderScript(script)) {
            return `npm run ${key}`;
          }
        }
      } catch {
        // Malformed package.json, continue to fallback detection
      }
    }

    // Fallback: check for known config files
    const configDetections = [
      { file: 'vitest.config.ts', command: 'npx vitest run' },
      { file: 'vitest.config.js', command: 'npx vitest run' },
      { file: 'vitest.config.mts', command: 'npx vitest run' },
      { file: 'jest.config.ts', command: 'npx jest' },
      { file: 'jest.config.js', command: 'npx jest' },
      { file: 'jest.config.mjs', command: 'npx jest' },
      { file: '.mocharc.yml', command: 'npx mocha' },
      { file: '.mocharc.json', command: 'npx mocha' },
      { file: 'pytest.ini', command: 'pytest' },
      { file: 'pyproject.toml', command: 'pytest' },
      { file: 'setup.cfg', command: 'pytest' },
    ];

    for (const { file, command } of configDetections) {
      if (existsSync(path.join(projectPath, file))) {
        return command;
      }
    }

    return null;
  }

  /**
   * Run tests and return structured results.
   * Uses child_process.exec for timeout support and non-blocking execution.
   * @param {string} projectPath - Absolute path to the project directory.
   * @param {object} [options] - Options for test execution.
   * @param {string} [options.testCommand] - Override the auto-detected test command.
   * @param {number} [options.timeout=120000] - Timeout in milliseconds (default 2 minutes).
   * @returns {Promise<{ passed: boolean, output: string, duration: number, summary: string }>}
   *   Structured test results.
   */
  async runTests(projectPath, { testCommand, timeout = 120000 } = {}) {
    const command = testCommand || this.detectTestCommand(projectPath);

    if (!command) {
      return {
        passed: false,
        output: 'No test command detected. Add a test script to package.json or provide a testCommand option.',
        duration: 0,
        summary: 'No tests found',
      };
    }

    const startTime = Date.now();

    try {
      const output = await this._execAsync(command, {
        cwd: projectPath,
        timeout,
        env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
      });

      const duration = Date.now() - startTime;
      const results = this.parseResults(output);

      return {
        passed: true,
        output,
        duration,
        summary: results.summary || `All tests passed (${duration}ms)`,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const output = this._combineOutput(error.stdout, error.stderr);

      // Check if it was a timeout
      if (error.killed) {
        return {
          passed: false,
          output,
          duration,
          summary: `Tests timed out after ${timeout}ms`,
        };
      }

      const results = this.parseResults(output);

      return {
        passed: false,
        output,
        duration,
        summary: results.summary || `Tests failed (exit code ${error.code || 'unknown'})`,
      };
    }
  }

  /**
   * Parse test output to extract pass/fail counts.
   * Handles output formats from jest, vitest, mocha, and pytest.
   * @param {string} output - Raw test runner output (stdout + stderr).
   * @returns {{ total: number, passed: number, failed: number, summary: string }}
   *   Parsed test result counts.
   */
  parseResults(output) {
    if (!output) {
      return { total: 0, passed: 0, failed: 0, summary: '' };
    }

    // Jest / Vitest format: "Tests:  2 failed, 5 passed, 7 total"
    const jestMatch = output.match(
      /Tests:\s+(?:(\d+)\s+failed,?\s*)?(?:(\d+)\s+skipped,?\s*)?(?:(\d+)\s+passed,?\s*)?(\d+)\s+total/i,
    );
    if (jestMatch) {
      const failed = parseInt(jestMatch[1] || '0', 10);
      const passed = parseInt(jestMatch[3] || '0', 10);
      const total = parseInt(jestMatch[4], 10);
      return {
        total,
        passed,
        failed,
        summary: `${passed} passed, ${failed} failed out of ${total} tests`,
      };
    }

    // Vitest alternative format: "✓ X tests passed" / "× Y tests failed"
    const vitestPassedMatch = output.match(/(\d+)\s+tests?\s+passed/i);
    const vitestFailedMatch = output.match(/(\d+)\s+tests?\s+failed/i);
    if (vitestPassedMatch || vitestFailedMatch) {
      const passed = parseInt(vitestPassedMatch?.[1] || '0', 10);
      const failed = parseInt(vitestFailedMatch?.[1] || '0', 10);
      const total = passed + failed;
      return {
        total,
        passed,
        failed,
        summary: `${passed} passed, ${failed} failed out of ${total} tests`,
      };
    }

    // Mocha format: "5 passing (200ms)" / "2 failing"
    const mochaPassingMatch = output.match(/(\d+)\s+passing/i);
    const mochaFailingMatch = output.match(/(\d+)\s+failing/i);
    if (mochaPassingMatch || mochaFailingMatch) {
      const passed = parseInt(mochaPassingMatch?.[1] || '0', 10);
      const failed = parseInt(mochaFailingMatch?.[1] || '0', 10);
      const total = passed + failed;
      return {
        total,
        passed,
        failed,
        summary: `${passed} passing, ${failed} failing out of ${total} tests`,
      };
    }

    // Pytest format: "5 passed, 2 failed" or "5 passed"
    const pytestMatch = output.match(
      /(?:(\d+)\s+passed)?(?:,?\s*(\d+)\s+failed)?(?:,?\s*(\d+)\s+error)?/i,
    );
    // More specific pytest pattern to avoid false positives
    const pytestSpecific = output.match(
      /=+\s*(?:(\d+)\s+passed)?(?:,?\s*(\d+)\s+failed)?(?:,?\s*(\d+)\s+error)?.*=+/i,
    );
    if (pytestSpecific) {
      const passed = parseInt(pytestSpecific[1] || '0', 10);
      const failed = parseInt(pytestSpecific[2] || '0', 10);
      const errors = parseInt(pytestSpecific[3] || '0', 10);
      const total = passed + failed + errors;
      return {
        total,
        passed,
        failed: failed + errors,
        summary: `${passed} passed, ${failed + errors} failed out of ${total} tests`,
      };
    }

    return { total: 0, passed: 0, failed: 0, summary: '' };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Check if a test script is just the default npm placeholder.
   * @param {string} script - The script string from package.json.
   * @returns {boolean} True if the script is a placeholder.
   * @private
   */
  _isPlaceholderScript(script) {
    const placeholders = [
      'echo "Error: no test specified" && exit 1',
      'echo "Error: no test specified" && exit 1',
      'echo "no test" && exit 1',
    ];
    return placeholders.some((p) => script.trim().includes(p));
  }

  /**
   * Promisified exec wrapper with combined output capture.
   * @param {string} command - The command to execute.
   * @param {object} options - Options passed to child_process.exec.
   * @returns {Promise<string>} Combined stdout and stderr output.
   * @private
   */
  _execAsync(command, options) {
    return new Promise((resolve, reject) => {
      exec(command, { ...options, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
          return;
        }
        resolve(this._combineOutput(stdout, stderr));
      });
    });
  }

  /**
   * Combine stdout and stderr into a single output string.
   * @param {string} stdout - Standard output.
   * @param {string} stderr - Standard error.
   * @returns {string} Combined output.
   * @private
   */
  _combineOutput(stdout, stderr) {
    const parts = [];
    if (stdout) parts.push(stdout);
    if (stderr) parts.push(stderr);
    return parts.join('\n').trim();
  }
}

export const testGate = new TestGate();
export default testGate;
