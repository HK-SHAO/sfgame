import { name } from '../../package.json'

// 持久化 = 开发者模式权威状态；URL dev 仅关卡内会话级生效（创作入口/分享链接），离关即失效。
// 键前缀跟随 package.json name（存储管理页据此识别，勿改）
const DEV_KEY = `${name}.dev`

export function loadDev(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(DEV_KEY) === '1'
  } catch {
    return false
  }
}

export function saveDev(on: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (on) localStorage.setItem(DEV_KEY, '1')
    else localStorage.removeItem(DEV_KEY)
  } catch {
    // 隐私模式/存储禁用：静默降级为仅本次会话有效
  }
}
