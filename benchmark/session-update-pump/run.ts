/**
 * Compare the production legacy and coalesced pump modes in fresh Node
 * processes. The connection serializes each ACP update without retaining its
 * payload, so memory measurements describe the adapter workload rather than a
 * test fixture that stores every notification.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentSideConnection } from '@agentclientprotocol/sdk'
import { parseSessionUpdateMode, SessionUpdatePump, type SessionUpdateMode } from '../../src/acp/session-update-pump.js'

const CHILD_MODE_ENV = 'PI_ACP_BENCHMARK_CHILD_MODE'
const DEFAULT_ITERATIONS = 5
const WARMUP_ITERATIONS = 1
const TEXT_BURST_DELTA_COUNT = 10_000
const MODEL_CADENCE_DELTA_COUNT = 100
const MODEL_CADENCE_DELAY_MS = 2
const BASH_OUTPUT_DELTA_COUNT = 5_000

type MemorySample = {
  heapUsed: number
  rss: number
}

type Scenario = {
  name: string
  description: string
  run: (pump: SessionUpdatePump, sampleMemory: () => void) => Promise<void>
}

type Measurement = {
  updates: number
  serializedBytes: number
  cpuMs: number
  wallMs: number
  firstUpdateMs: number | null
  peakHeapDeltaBytes: number
  retainedHeapDeltaBytes: number
  peakRssDeltaBytes: number
  retainedRssDeltaBytes: number
}

type ScenarioReport = Measurement & {
  name: string
  description: string
}

type ModeReport = {
  mode: SessionUpdateMode
  nodeVersion: string
  iterations: number
  scenarios: ScenarioReport[]
}

class MemoryTracker {
  private readonly baseline = memorySample()
  private peak = this.baseline

  sample = (): void => {
    const current = memorySample()
    this.peak = {
      heapUsed: Math.max(this.peak.heapUsed, current.heapUsed),
      rss: Math.max(this.peak.rss, current.rss)
    }
  }

  snapshot(): Pick<Measurement, 'peakHeapDeltaBytes' | 'peakRssDeltaBytes'> {
    return {
      peakHeapDeltaBytes: this.peak.heapUsed - this.baseline.heapUsed,
      peakRssDeltaBytes: this.peak.rss - this.baseline.rss
    }
  }

  retained(): Pick<Measurement, 'retainedHeapDeltaBytes' | 'retainedRssDeltaBytes'> {
    const current = memorySample()
    return {
      retainedHeapDeltaBytes: current.heapUsed - this.baseline.heapUsed,
      retainedRssDeltaBytes: current.rss - this.baseline.rss
    }
  }
}

class BenchmarkConnection {
  updateCount = 0
  serializedBytes = 0
  firstUpdateAt: number | null = null

  constructor(private readonly sampleMemory: () => void) {}

  async sessionUpdate(message: Parameters<AgentSideConnection['sessionUpdate']>[0]): Promise<void> {
    if (this.firstUpdateAt === null) this.firstUpdateAt = performance.now()

    const serialized = JSON.stringify(message)
    this.updateCount += 1
    this.serializedBytes += Buffer.byteLength(serialized)
    this.sampleMemory()
  }
}

const scenarios: Scenario[] = [
  {
    name: 'text-burst',
    description: `${TEXT_BURST_DELTA_COUNT.toLocaleString()} consecutive one-byte assistant text deltas.`,
    async run(pump, sampleMemory) {
      for (let index = 0; index < TEXT_BURST_DELTA_COUNT; index += 1) {
        pump.appendAgentMessage('x')
        if (index % 128 === 0) sampleMemory()
      }
    }
  },
  {
    name: 'model-cadence',
    description: `${MODEL_CADENCE_DELTA_COUNT} assistant text deltas scheduled every ${MODEL_CADENCE_DELAY_MS} milliseconds.`,
    async run(pump, sampleMemory) {
      for (let index = 0; index < MODEL_CADENCE_DELTA_COUNT; index += 1) {
        pump.appendAgentMessage('token ')
        sampleMemory()
        await wait(MODEL_CADENCE_DELAY_MS)
      }
    }
  },
  {
    name: 'bash-output-burst',
    description: `${BASH_OUTPUT_DELTA_COUNT.toLocaleString()} consecutive Bash terminal-output deltas for one tool call.`,
    async run(pump, sampleMemory) {
      for (let index = 0; index < BASH_OUTPUT_DELTA_COUNT; index += 1) {
        pump.appendTerminalOutput('benchmark-bash', '0123456789abcdef\n')
        if (index % 128 === 0) sampleMemory()
      }
    }
  }
]

async function measure(mode: SessionUpdateMode, scenario: Scenario): Promise<Measurement> {
  collectGarbage()
  const memory = new MemoryTracker()
  const connection = new BenchmarkConnection(memory.sample)
  const pump = new SessionUpdatePump(connection as unknown as AgentSideConnection, 'benchmark-session', { mode })
  const startedAt = performance.now()
  const cpuStartedAt = process.cpuUsage()

  await scenario.run(pump, memory.sample)
  await pump.flush()
  memory.sample()

  const cpu = process.cpuUsage(cpuStartedAt)
  const wallMs = performance.now() - startedAt
  collectGarbage()
  memory.sample()

  return {
    updates: connection.updateCount,
    serializedBytes: connection.serializedBytes,
    cpuMs: (cpu.user + cpu.system) / 1_000,
    wallMs,
    firstUpdateMs: connection.firstUpdateAt === null ? null : connection.firstUpdateAt - startedAt,
    ...memory.snapshot(),
    ...memory.retained()
  }
}

async function runMode(mode: SessionUpdateMode, iterations: number): Promise<ModeReport> {
  for (let warmup = 0; warmup < WARMUP_ITERATIONS; warmup += 1) {
    for (const scenario of scenarios) await measure(mode, scenario)
  }

  const measurements = new Map<string, Measurement[]>()
  for (const scenario of scenarios) measurements.set(scenario.name, [])

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (const scenario of scenarios) {
      measurements.get(scenario.name)?.push(await measure(mode, scenario))
    }
  }

  return {
    mode,
    nodeVersion: process.version,
    iterations,
    scenarios: scenarios.map(scenario => ({
      name: scenario.name,
      description: scenario.description,
      ...medianMeasurement(measurements.get(scenario.name) ?? [])
    }))
  }
}

function medianMeasurement(measurements: Measurement[]): Measurement {
  if (measurements.length === 0) throw new Error('Cannot summarize an empty benchmark sample')

  return {
    updates: measurements[0].updates,
    serializedBytes: measurements[0].serializedBytes,
    cpuMs: median(measurements.map(measurement => measurement.cpuMs)),
    wallMs: median(measurements.map(measurement => measurement.wallMs)),
    firstUpdateMs: medianNullable(measurements.map(measurement => measurement.firstUpdateMs)),
    peakHeapDeltaBytes: median(measurements.map(measurement => measurement.peakHeapDeltaBytes)),
    retainedHeapDeltaBytes: median(measurements.map(measurement => measurement.retainedHeapDeltaBytes)),
    peakRssDeltaBytes: median(measurements.map(measurement => measurement.peakRssDeltaBytes)),
    retainedRssDeltaBytes: median(measurements.map(measurement => measurement.retainedRssDeltaBytes))
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function medianNullable(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null)
  return present.length === 0 ? null : median(present)
}

function memorySample(): MemorySample {
  const { heapUsed, rss } = process.memoryUsage()
  return { heapUsed, rss }
}

function collectGarbage(): void {
  global.gc?.()
}

function wait(delayMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delayMs))
}

function readIterations(): number {
  const value = process.argv.find(argument => argument.startsWith('--iterations='))
  if (!value) return DEFAULT_ITERATIONS

  const iterations = Number.parseInt(value.slice('--iterations='.length), 10)
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error('--iterations must be a positive integer')
  }
  return iterations
}

function runChild(mode: SessionUpdateMode, iterations: number): ModeReport {
  const scriptPath = fileURLToPath(import.meta.url)
  const result = spawnSync(
    process.execPath,
    ['--expose-gc', '--import', 'tsx', scriptPath, `--iterations=${iterations}`],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        PI_ACP_SESSION_UPDATE_MODE: mode,
        [CHILD_MODE_ENV]: 'true'
      }
    }
  )

  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Benchmark child for ${mode} failed:\n${result.stderr.trim()}`)
  }

  return JSON.parse(result.stdout) as ModeReport
}

function writeReport(legacy: ModeReport, coalesced: ModeReport): string {
  const reportPath = join(
    dirname(fileURLToPath(import.meta.url)),
    'reports',
    `session-update-pump-${new Date().toISOString().replace(/[:.]/g, '-')}.md`
  )
  mkdirSync(dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, renderReport(legacy, coalesced), 'utf8')
  return reportPath
}

function renderReport(legacy: ModeReport, coalesced: ModeReport): string {
  const legacyByScenario = new Map(legacy.scenarios.map(scenario => [scenario.name, scenario]))
  const coalescedByScenario = new Map(coalesced.scenarios.map(scenario => [scenario.name, scenario]))
  const resultRows = scenarios.flatMap(scenario => {
    const legacyResult = legacyByScenario.get(scenario.name)
    const coalescedResult = coalescedByScenario.get(scenario.name)
    return [renderResultRow('legacy', legacyResult), renderResultRow('coalesced', coalescedResult)]
  })
  const comparisonRows = scenarios.map(scenario =>
    renderComparisonRow(legacyByScenario.get(scenario.name), coalescedByScenario.get(scenario.name))
  )

  const workloads = scenarios.map(scenario => `- \`${scenario.name}\`: ${scenario.description}`).join('\n')

  return [
    '# SessionUpdatePump benchmark',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `Node: ${legacy.nodeVersion}`,
    '',
    `Iterations per scenario: ${legacy.iterations} after ${WARMUP_ITERATIONS} warm-up iteration.`,
    '',
    '## Method',
    '',
    'Each mode runs in a fresh Node process. The benchmark uses the production SessionUpdatePump mode selected from PI_ACP_SESSION_UPDATE_MODE and a connection that serializes, counts, and immediately releases ACP messages.',
    'It measures adapter-side work only; it does not model Pi model inference, stdio transport backpressure, or Zed rendering.',
    'Wall time includes the fixture cadence and can vary with operating-system timer resolution.',
    '',
    '## Workloads',
    '',
    workloads,
    '',
    '## Median results',
    '',
    '| Workload | Mode | ACP updates | JSON bytes | CPU ms | Wall ms | First update ms | Peak heap delta | Retained heap delta |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    resultRows.join('\n'),
    '',
    '## Coalesced relative to legacy',
    '',
    '| Workload | ACP update reduction | CPU change | Wall-time change | Peak heap change | Retained heap change |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    comparisonRows.join('\n'),
    '',
    '## Interpretation boundary',
    '',
    'The report proves the effect of changing only session update granularity under fixed synthetic Pi-like deltas.',
    'It is evidence for adapter overhead reduction, not proof that every CPU or memory cost in a real Zed session originates in this path.',
    'Treat CPU values reported as 0.00 ms as below the process-level sampling resolution, not as proof of zero CPU cost.',
    ''
  ].join('\n')
}

function renderResultRow(mode: string, result: ScenarioReport | undefined): string {
  if (!result) return `| unavailable | ${mode} | — | — | — | — | — | — | — |`
  return `| ${result.name} | ${mode} | ${result.updates} | ${formatBytes(result.serializedBytes)} | ${formatMilliseconds(result.cpuMs)} | ${formatMilliseconds(result.wallMs)} | ${formatNullableMilliseconds(result.firstUpdateMs)} | ${formatBytes(result.peakHeapDeltaBytes)} | ${formatBytes(result.retainedHeapDeltaBytes)} |`
}

function renderComparisonRow(legacy: ScenarioReport | undefined, coalesced: ScenarioReport | undefined): string {
  if (!legacy || !coalesced) return '| unavailable | — | — | — | — | — |'
  return `| ${legacy.name} | ${formatFewer(legacy.updates, coalesced.updates)} | ${formatRelativeChange(legacy.cpuMs, coalesced.cpuMs)} | ${formatRelativeChange(legacy.wallMs, coalesced.wallMs)} | ${formatRelativeChange(legacy.peakHeapDeltaBytes, coalesced.peakHeapDeltaBytes)} | ${formatRelativeChange(legacy.retainedHeapDeltaBytes, coalesced.retainedHeapDeltaBytes)} |`
}

function formatFewer(legacy: number, coalesced: number): string {
  if (legacy === 0) return '—'
  const percent = ((legacy - coalesced) / legacy) * 100
  const digits = Math.abs(percent) >= 99 ? 2 : 1
  return percent >= 0 ? `${percent.toFixed(digits)}% fewer` : `${Math.abs(percent).toFixed(digits)}% more`
}

function formatRelativeChange(legacy: number, coalesced: number): string {
  if (legacy === 0) return '—'
  const percent = ((coalesced - legacy) / Math.abs(legacy)) * 100
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`
}

function formatBytes(bytes: number): string {
  const sign = bytes < 0 ? '-' : ''
  const absolute = Math.abs(bytes)
  if (absolute < 1024) return `${sign}${absolute} B`
  if (absolute < 1024 * 1024) return `${sign}${(absolute / 1024).toFixed(1)} KiB`
  return `${sign}${(absolute / (1024 * 1024)).toFixed(2)} MiB`
}

function formatMilliseconds(value: number): string {
  return `${value.toFixed(2)} ms`
}

function formatNullableMilliseconds(value: number | null): string {
  return value === null ? '—' : formatMilliseconds(value)
}

const iterations = readIterations()

if (process.env[CHILD_MODE_ENV] === 'true') {
  const mode = parseSessionUpdateMode(process.env.PI_ACP_SESSION_UPDATE_MODE)
  process.stdout.write(JSON.stringify(await runMode(mode, iterations)))
} else {
  const legacy = runChild('legacy', iterations)
  const coalesced = runChild('coalesced', iterations)
  const reportPath = writeReport(legacy, coalesced)
  console.log(`SessionUpdatePump benchmark report: ${reportPath}`)
}
