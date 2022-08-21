/* eslint-disable */

const readyTimeReg = /ready in \d+ms\./im
const hmrUpdateTimeReg = /\d+:\d+:\d+ [AP]M /gim
const winPathReg = /(\/)?(\D:\/)?\D\/vite-plugin-checker\/vite-plugin-checker\/playground-temp/im
const winNewLineReg = /\/r\/n/gim
import os from 'os'

function doesUseDoubleSlashAsPath(val: string) {
  return val.includes('//vite-plugin-checker//')
}

/**
 * erase log time
 */
export const serializers = {
  // why this function is not in Jest's documentation 🤨
  serialize(val, config, indentation, depth, refs, printer) {
    console.log('💅🏻 using custom serializer')
    let result = val
    result = result.replace(readyTimeReg, 'ready in XXXms')
    result = result.replace(hmrUpdateTimeReg, 'HH:MM:SS AM ')
    if (os.platform() === 'win32') {
      result = result.replace(winNewLineReg, '/n')

      if (winPathReg.test(result)) {
        result = result.replace(winPathReg, '<PROJECT_ROOT>/playground-temp')
      }

      if (doesUseDoubleSlashAsPath(result)) {
        result = result.replace(
          `//a//vite-plugin-checker//vite-plugin-checker//playground-temp`,
          '<PROJECT_ROOT>/playground-temp'
        )
        result = result.split('//').join('/')
      }
    }

    return printer(result)
  },
  test(val: any) {
    if (typeof val !== 'string') return false
    if (readyTimeReg.test(val)) return true
    if (hmrUpdateTimeReg.test(val)) return true
    if (
      (os.platform() === 'win32' && (winPathReg.test(val) || winNewLineReg.test(val))) ||
      doesUseDoubleSlashAsPath(val)
    ) {
      return true
    }
    return false
  },
}
