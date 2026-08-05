/** levels/*.yaml 以纯文本经 `?raw` 导入（vite 原生支持，随文件变更触发 HMR）。 */
declare module '*.yaml?raw' {
  const text: string
  export default text
}
