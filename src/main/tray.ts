import { join } from 'node:path'
import { app, Menu, nativeImage, Tray } from 'electron'
import { sendIslandCommand } from './notchWindow'
import { settings } from './store/settings'

let tray: Tray | null = null

export function resourcePath(file: string): string {
  return app.isPackaged ? join(process.resourcesPath, 'resources', file) : join(app.getAppPath(), 'resources', file)
}

function buildMenu(): Menu {
  const s = settings.get()
  return Menu.buildFromTemplate([
    { label: 'Parler à Compi', accelerator: s.shortcut, click: () => sendIslandCommand('open-chat') },
    { label: 'Activité', click: () => sendIslandCommand('open-activity') },
    { label: 'Réglages', click: () => sendIslandCommand('open-settings') },
    { type: 'separator' },
    {
      label: 'Démarrer avec Windows',
      type: 'checkbox',
      checked: s.launchAtLogin,
      click: (item) => settings.update({ launchAtLogin: item.checked })
    },
    { type: 'separator' },
    { label: 'Quitter Compi', click: () => app.quit() }
  ])
}

export function createTray(): Tray {
  const icon = nativeImage.createFromPath(resourcePath('tray.png'))
  icon.addRepresentation({ scaleFactor: 2, buffer: nativeImage.createFromPath(resourcePath('tray@2x.png')).toPNG() })
  tray = new Tray(icon)
  tray.setToolTip('Compi — ton compagnon IA')
  tray.setContextMenu(buildMenu())
  tray.on('click', () => sendIslandCommand('open-chat'))
  settings.onChange(() => tray?.setContextMenu(buildMenu()))
  return tray
}
