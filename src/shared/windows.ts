// Données partagées des outils Windows (libellés des cartes, listes fixes).

/** Pages des Paramètres que Compi peut ouvrir (liste fixe). */
export const SETTINGS_PAGES = {
  display: 'Écran',
  nightlight: 'Éclairage nocturne',
  sound: 'Son',
  bluetooth: 'Bluetooth et appareils',
  printers: 'Imprimantes',
  mousetouchpad: 'Souris',
  'network-status': 'Réseau',
  'network-wifi': 'Wi-Fi',
  personalization: 'Personnalisation',
  'personalization-background': 'Arrière-plan',
  colors: 'Couleurs et thème',
  notifications: 'Notifications',
  quiethours: 'Ne pas déranger',
  powersleep: 'Alimentation',
  batterysaver: 'Batterie',
  storagesense: 'Stockage',
  appsfeatures: 'Applications installées',
  defaultapps: 'Applications par défaut',
  startupapps: 'Applications au démarrage',
  'dateandtime': 'Date et heure',
  'regionlanguage': 'Langue et région',
  windowsupdate: 'Windows Update',
  'privacy-microphone': 'Confidentialité du micro',
  'privacy-webcam': 'Confidentialité de la caméra',
  about: 'Informations système'
} as const
export type SettingsPage = keyof typeof SETTINGS_PAGES

export function isSettingsPage(page: string): page is SettingsPage {
  return Object.prototype.hasOwnProperty.call(SETTINGS_PAGES, page)
}
