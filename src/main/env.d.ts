// Scripts PowerShell importés comme texte (`import script from './host.ps1?raw'`).
declare module '*.ps1?raw' {
  const content: string
  export default content
}
