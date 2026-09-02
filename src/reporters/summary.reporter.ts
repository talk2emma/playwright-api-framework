/**
 * A custom reporter that answers the question a build actually asks.
 *
 * Playwright's HTML report is excellent for a person with a browser. What a
 * pipeline needs is different: one machine-readable file that says whether the
 * run passed, which tests failed and why, which endpoints were slow, and how
 * long the whole thing took — small enough to post into a chat message or gate
 * a deployment on.
 *
 * `reports/summary.json` is that file. It is also what makes the run
 * comparable over time; every field here is chosen to be diffable between two
 * runs of the same suite.
 */
import fs from 'node:fs';
import path from 'node:path';
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';

/** One failure, reduced to what somebody triaging needs. */
interface FailureEntry {
  readonly title: string;
  readonly file: string;
  readonly project: string;
  readonly durationMs: number;
  readonly retries: number;
  readonly error: string;
  /** Tags on the test, so `@smoke` failures can be spotted immediately. */
  readonly tags: string[];
}

interface Summary {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly status: FullResult['status'];
  readonly environment: string;
  readonly totals: {
    total: number;
    passed: number;
    failed: number;
    flaky: number;
    skipped: number;
    timedOut: number;
  };
  readonly passRate: number;
  readonly slowestTests: { title: string; durationMs: number }[];
  readonly failures: FailureEntry[];
}

export default class SummaryReporter implements Reporter {
  private startedAt = Date.now();
  private readonly failures: FailureEntry[] = [];
  private readonly durations: { title: string; durationMs: number }[] = [];
  private readonly counts = { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0, timedOut: 0 };
  private outputFile = 'reports/summary.json';

  onBegin(config: FullConfig, _suite: Suite): void {
    this.startedAt = Date.now();
    /*
     * The repository root, not `config.rootDir` — that resolves to the common
     * ancestor of the projects' test directories, which is `tests/`, and would
     * scatter the summary somewhere nobody looks. `configFile` is the reliable
     * anchor; `cwd` is the fallback for a programmatic run.
     */
    const root = config.configFile ? path.dirname(config.configFile) : process.cwd();
    this.outputFile = path.join(root, 'reports', 'summary.json');
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.counts.total += 1;
    this.durations.push({
      title: test.titlePath().slice(1).join(' › '),
      durationMs: result.duration,
    });

    switch (result.status) {
      case 'passed':
        /* Playwright reports a test that passed on retry as `passed` with
         * retries > 0. Counting those as flaky rather than passed is what
         * keeps a suite from quietly rotting behind a green tick. */
        if (result.retry > 0) this.counts.flaky += 1;
        else this.counts.passed += 1;
        break;
      case 'skipped':
        this.counts.skipped += 1;
        break;
      case 'timedOut':
        this.counts.timedOut += 1;
        this.recordFailure(test, result);
        break;
      default:
        this.counts.failed += 1;
        this.recordFailure(test, result);
    }
  }

  onEnd(result: FullResult): void {
    const finishedAt = Date.now();
    const decided = this.counts.total - this.counts.skipped;

    const summary: Summary = {
      startedAt: new Date(this.startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      durationMs: finishedAt - this.startedAt,
      status: result.status,
      environment: process.env.TEST_ENV ?? 'staging',
      totals: { ...this.counts },
      passRate:
        decided === 0 ? 0 : Math.round(((this.counts.passed + this.counts.flaky) / decided) * 100),
      slowestTests: [...this.durations].sort((a, b) => b.durationMs - a.durationMs).slice(0, 10),
      failures: this.failures,
    };

    fs.mkdirSync(path.dirname(this.outputFile), { recursive: true });
    fs.writeFileSync(this.outputFile, JSON.stringify(summary, null, 2));

    this.printConsoleSummary(summary);
  }

  /** Reporters must never crash the run, so failures here are swallowed. */
  onError(): void {
    /* Deliberately empty: Playwright already reports the error itself. */
  }

  private recordFailure(test: TestCase, result: TestResult): void {
    this.failures.push({
      title: test.titlePath().slice(1).join(' › '),
      file: path.relative(process.cwd(), test.location.file),
      project: test.parent.project()?.name ?? 'unknown',
      durationMs: result.duration,
      retries: result.retry,
      error: stripAnsi(result.error?.message ?? 'no error message')
        .split('\n')
        .slice(0, 12)
        .join('\n'),
      tags: test.tags,
    });
  }

  private printConsoleSummary(summary: Summary): void {
    const seconds = (summary.durationMs / 1000).toFixed(1);
    const lines = [
      '',
      `  ${summary.totals.passed} passed · ${summary.totals.failed} failed · ` +
        `${summary.totals.flaky} flaky · ${summary.totals.skipped} skipped  (${seconds}s, ${summary.environment})`,
    ];
    if (summary.failures.length) {
      lines.push('', '  Failures:');
      for (const failure of summary.failures.slice(0, 10)) {
        lines.push(`    · ${failure.title}  [${failure.project}]`);
      }
    }
    lines.push('', `  Summary written to ${path.relative(process.cwd(), this.outputFile)}`, '');
    /* stdout, not the logger: this is reporter output, not diagnostic logging. */
    process.stdout.write(lines.join('\n'));
  }
}

/**
 * Removes terminal colour codes.
 *
 * The escape character is built from its code point so no literal control
 * byte appears in the source, which keeps the file safe to open in any editor
 * and to paste into a diff.
 */
function stripAnsi(text: string): string {
  const escape = String.fromCharCode(27);
  return text.replace(new RegExp(`${escape}\\[[0-9;]*m`, 'g'), '');
}
