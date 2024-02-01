import chalk from 'chalk'
import os from 'node:os'
import strip from 'strip-ansi'
import * as _vscodeUri from 'vscode-uri'

// hack to compatible with Jiti
// see details: https://github.com/fi3ework/vite-plugin-checker/issues/197
// @ts-expect-error
const URI = _vscodeUri?.default?.URI ?? _vscodeUri.URI
import { parentPort } from 'node:worker_threads'

import { codeFrameColumns, type SourceLocation } from '@babel/code-frame'

import { WS_CHECKER_ERROR_EVENT } from './client/index.js'
import {
  ACTION_TYPES,
  DiagnosticLevel,
  type DiagnosticToRuntime,
  type ClientDiagnosticPayload,
} from './types.js'
import { isMainThread } from './utils.js'

export { codeFrameColumns, strip }
export type { SourceLocation }

import type { LineAndCharacter } from 'typescript'

export interface NormalizedDiagnostic {
  /** error message */
  message?: string
  /** error conclusion */
  conclusion?: string
  /** error stack */
  stack?: string | string[]
  /** file name */
  id?: string
  /** checker diagnostic source */
  checker: string
  /** raw code frame generated by @babel/code-frame */
  codeFrame?: string
  /** code frame, but striped */
  stripedCodeFrame?: string
  /** error code location */
  loc?: SourceLocation
  /** error level */
  level?: DiagnosticLevel
}

const defaultLogLevel = [
  DiagnosticLevel.Warning,
  DiagnosticLevel.Error,
  DiagnosticLevel.Suggestion,
  DiagnosticLevel.Message,
]

export function filterLogLevel(
  diagnostics: NormalizedDiagnostic,
  level?: DiagnosticLevel[]
): NormalizedDiagnostic | null
export function filterLogLevel(
  diagnostics: NormalizedDiagnostic[],
  level?: DiagnosticLevel[]
): NormalizedDiagnostic[]
export function filterLogLevel(
  diagnostics: NormalizedDiagnostic | NormalizedDiagnostic[],
  level: DiagnosticLevel[] = defaultLogLevel
): NormalizedDiagnostic | null | NormalizedDiagnostic[] {
  if (Array.isArray(diagnostics)) {
    return diagnostics.filter((d) => {
      if (typeof d.level !== 'number') return false
      return level.includes(d.level)
    })
  } else {
    if (!diagnostics.level) return null
    return level.includes(diagnostics.level) ? diagnostics : null
  }
}

export const isNormalizedDiagnostic = (
  d: NormalizedDiagnostic | null | undefined
): d is NormalizedDiagnostic => {
  return Boolean(d)
}

export function diagnosticToTerminalLog(
  d: NormalizedDiagnostic,
  name?: 'TypeScript' | 'vue-tsc' | 'VLS' | 'ESLint' | 'Stylelint'
): string {
  const nameInLabel = name ? `(${name})` : ''
  const boldBlack = chalk.bold.rgb(0, 0, 0)

  const labelMap: Record<DiagnosticLevel, string> = {
    [DiagnosticLevel.Error]: boldBlack.bgRedBright(` ERROR${nameInLabel} `),
    [DiagnosticLevel.Warning]: boldBlack.bgYellowBright(` WARNING${nameInLabel} `),
    [DiagnosticLevel.Suggestion]: boldBlack.bgBlueBright(` SUGGESTION${nameInLabel} `),
    [DiagnosticLevel.Message]: boldBlack.bgCyanBright(` MESSAGE${nameInLabel} `),
  }

  const levelLabel = labelMap[d.level ?? DiagnosticLevel.Error]
  const fileLabel = boldBlack.bgCyanBright(' FILE ') + ' '
  const position = d.loc
    ? chalk.yellow(d.loc.start.line) + ':' + chalk.yellow(d.loc.start.column)
    : ''

  return [
    levelLabel + ' ' + d.message,
    fileLabel + d.id + ':' + position + os.EOL,
    d.codeFrame + os.EOL,
    d.conclusion,
  ]
    .filter(Boolean)
    .join(os.EOL)
}

export function diagnosticToRuntimeError(d: NormalizedDiagnostic): DiagnosticToRuntime
export function diagnosticToRuntimeError(d: NormalizedDiagnostic[]): DiagnosticToRuntime[]
export function diagnosticToRuntimeError(
  diagnostics: NormalizedDiagnostic | NormalizedDiagnostic[]
): DiagnosticToRuntime | DiagnosticToRuntime[] {
  const diagnosticsArray = Array.isArray(diagnostics) ? diagnostics : [diagnostics]

  const results: DiagnosticToRuntime[] = diagnosticsArray.map((d) => {
    let loc: DiagnosticToRuntime['loc']
    if (d.loc) {
      loc = {
        file: d.id ?? '',
        line: d.loc.start.line,
        column: typeof d.loc.start.column === 'number' ? d.loc.start.column : 0,
      }
    }

    return {
      message: d.message ?? '',
      stack:
        typeof d.stack === 'string' ? d.stack : Array.isArray(d.stack) ? d.stack.join(os.EOL) : '',
      id: d.id,
      frame: d.stripedCodeFrame,
      checkerId: d.checker,
      level: d.level,
      loc,
    }
  })

  return Array.isArray(diagnostics) ? results : results[0]!
}

export function toClientPayload(
  id: string,
  diagnostics: DiagnosticToRuntime[]
): ClientDiagnosticPayload {
  return {
    event: WS_CHECKER_ERROR_EVENT,
    data: {
      checkerId: id,
      diagnostics,
    },
  }
}

export function createFrame({
  source,
  location,
}: {
  /** file source code */
  source: string
  location: SourceLocation
}) {
  const frame = codeFrameColumns(source, location, {
    // worker tty did not fork parent process stdout, let's make a workaround
    forceColor: true,
  })
    .split('\n')
    .map((line) => '  ' + line)
    .join(os.EOL)

  return frame
}

export function tsLocationToBabelLocation(
  tsLoc: Record<'start' | 'end', LineAndCharacter /** 0-based */>
): SourceLocation {
  return {
    start: { line: tsLoc.start.line + 1, column: tsLoc.start.character + 1 },
    end: { line: tsLoc.end.line + 1, column: tsLoc.end.character + 1 },
  }
}

export function wrapCheckerSummary(checkerName: string, rawSummary: string): string {
  return `[${checkerName}] ${rawSummary}`
}

export function composeCheckerSummary(
  checkerName: string,
  errorCount: number,
  warningCount: number
): string {
  const message = `Found ${errorCount} error${
    errorCount > 1 ? 's' : ''
  } and ${warningCount} warning${warningCount > 1 ? 's' : ''}`

  const hasError = errorCount > 0
  const hasWarning = warningCount > 0
  const color = hasError ? 'red' : hasWarning ? 'yellow' : 'green'
  return chalk[color](wrapCheckerSummary(checkerName, message))
}

/* ------------------------------ miscellaneous ----------------------------- */
export function ensureCall(callback: CallableFunction) {
  setTimeout(() => {
    callback()
  })
}

export function consoleLog(value: string) {
  if (isMainThread) {
    console.log(value)
  } else {
    parentPort?.postMessage({
      type: ACTION_TYPES.console,
      payload: value,
    })
  }
}
