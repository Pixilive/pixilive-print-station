const { app, BrowserWindow, Tray, nativeImage, ipcMain, dialog, Notification, shell } = require('electron')
const axios = require('axios')
const path = require('path')
const { exec } = require('child_process')
const { startServer, stopServer, getSettings, updateSettings, processAndPrint, getLogs, getPaper, logDir } = require('./server')

let tray = null
let win = null
let jobs = []
let maskImporting = false

function addJob(job) {
  jobs.unshift(job)
  if (jobs.length > 20) jobs.pop()
  if (win) win.webContents.send('jobs-updated', jobs)
  updateTrayBadge()
}

function updateJobStatus(id, status) {
  const job = jobs.find(j => j.id === id)
  if (job) {
    job.status = status
    if (win) win.webContents.send('jobs-updated', jobs)
    updateTrayBadge()
  }
}

// Langue : réglage « auto » = français si le Mac est en français, anglais sinon
function resolveLang() {
  const choice = (getSettings().language || 'auto')
  if (choice === 'fr' || choice === 'en') return choice
  const sys = ((app.getPreferredSystemLanguages && app.getPreferredSystemLanguages()[0]) || app.getLocale() || 'en').toLowerCase()
  return sys.startsWith('fr') ? 'fr' : 'en'
}

const MAIN_TEXTS = {
  fr: {
    paperTitle: 'Papier bientôt épuisé',
    paperBody: (r, t) => `Il reste ${r} tirages sur ${t}. Préparez un nouveau rouleau.`,
    maskTitle: o => `Choisir le masque ${o === 'portrait' ? 'portrait' : 'paysage'}`,
    folderTitle: 'Choisir le dossier hotfolder',
    updateTitle: 'Nouvelle version disponible',
    updateBody: v => `Pixilive Print Station ${v} est disponible. Cliquez pour la télécharger.`
  },
  en: {
    paperTitle: 'Paper running low',
    paperBody: (r, t) => `${r} prints left out of ${t}. Get a new roll ready.`,
    maskTitle: o => `Choose the ${o === 'portrait' ? 'portrait' : 'landscape'} mask`,
    folderTitle: 'Choose the hotfolder',
    updateTitle: 'New version available',
    updateBody: v => `Pixilive Print Station ${v} is available. Click to download it.`
  }
}

function mt() {
  return MAIN_TEXTS[resolveLang()]
}

// ---------- Nouvelle version ----------
// Pas d'installation automatique (l'app n'est pas signée) : on prévient simplement
// l'utilisateur qu'une version plus récente est publiée sur GitHub.
const RELEASES_URL = 'https://github.com/Pixilive/pixilive-print-station/releases'

function isNewerVersion(latest, current) {
  const a = String(latest).replace(/^v/, '').split('.').map(n => parseInt(n) || 0)
  const b = String(current).replace(/^v/, '').split('.').map(n => parseInt(n) || 0)
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true
    if ((a[i] || 0) < (b[i] || 0)) return false
  }
  return false
}

async function checkNewVersion() {
  try {
    const { data } = await axios.get('https://api.github.com/repos/Pixilive/pixilive-print-station/releases/latest', {
      headers: { 'User-Agent': 'Pixilive-Print-Station', Accept: 'application/vnd.github+json' },
      timeout: 10000
    })
    const latest = String(data.tag_name || '').replace(/^v/, '')
    console.log('Dernière version publiée :', latest, '| version installée :', app.getVersion())
    if (latest && isNewerVersion(latest, app.getVersion()) && Notification.isSupported()) {
      const notif = new Notification({ title: mt().updateTitle, body: mt().updateBody(latest) })
      notif.on('click', () => shell.openExternal(data.html_url || RELEASES_URL))
      notif.show()
    }
  } catch (err) {
    console.error('Vérification de version impossible :', err.message)
  }
}

function onLogs(journal) {
  if (win) win.webContents.send('logs-updated', journal)
}

function onPaper(paper, alert) {
  if (win) win.webContents.send('paper-updated', paper)
  if (alert && Notification.isSupported()) {
    new Notification({
      title: mt().paperTitle,
      body: mt().paperBody(paper.remaining, paper.total)
    }).show()
  }
}

function updateTrayBadge() {
  const pending = jobs.filter(j => j.status === 'pending' || j.status === 'printing').length
  tray.setTitle(pending > 0 ? ` ${pending}` : '')
}

function handleDeepLink(url) {
  try {
    const urlObj = new URL(url)
    if (urlObj.hostname === 'print') {
      const imageUrl = urlObj.searchParams.get('imageUrl')
      const quantity = parseInt(urlObj.searchParams.get('quantity')) || 1
      const name = urlObj.searchParams.get('name') || ''
      const printId = urlObj.searchParams.get('id') || ''
      const bubbleEnv = urlObj.searchParams.get('env') || 'live'
      const fileName = urlObj.searchParams.get('file') || ''
      if (imageUrl) {
        const jobId = Date.now().toString()
        addJob({ id: jobId, name, quantity, status: 'printing' })
        processAndPrint(imageUrl, quantity, name, printId, bubbleEnv, fileName)
          .then(result => updateJobStatus(jobId, result.success ? 'done' : 'error'))
          .catch(() => updateJobStatus(jobId, 'error'))
      }
    }
  } catch (e) {
    console.error('Deep link error:', e)
  }
}

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('pixilive-print', process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient('pixilive-print')
}

app.whenReady().then(() => {
  startServer(addJob, updateJobStatus, { onLogs, onPaper, getLang: resolveLang })
  checkNewVersion()

  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets/tray-icon.png'))
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('Pixilive Print Station')

  win = new BrowserWindow({
    width: 320,
    height: 425,
    show: false,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  })

  win.loadFile(path.join(__dirname, 'renderer.html'))

  win.on('blur', () => {
    if (!maskImporting) win.hide()
  })

  tray.on('click', () => {
    if (win.isVisible()) {
      win.hide()
    } else {
      const bounds = tray.getBounds()
      win.setPosition(
        Math.round(bounds.x - 140 + bounds.width / 2),
        Math.round(bounds.y + bounds.height + 4)
      )
      win.show()
      win.focus()
    }
  })

  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleDeepLink(url)
  })

  if (process.platform === 'darwin') {
    app.dock.setIcon(nativeImage.createFromPath(path.join(__dirname, 'assets/icon.icns')))
  }

  app.on('activate', () => {
    const bounds = tray.getBounds()
    win.setPosition(
      Math.round(bounds.x - 140 + bounds.width / 2),
      Math.round(bounds.y + bounds.height + 4)
    )
    win.show()
    win.focus()
  })

  ipcMain.handle('get-settings', () => getSettings())

  ipcMain.handle('update-settings', (_, newSettings) => {
    updateSettings(newSettings)
    if ('language' in newSettings && win) win.webContents.send('language-changed', resolveLang())
    return getSettings()
  })

  ipcMain.handle('get-language', () => resolveLang())

  ipcMain.handle('get-printers', () => {
    return new Promise((resolve) => {
      exec('lpstat -a 2>/dev/null | awk \'{print $1}\'', (err, stdout) => {
        if (err || !stdout.trim()) {
          resolve([])
        } else {
          resolve(stdout.trim().split('\n').filter(Boolean))
        }
      })
    })
  })

  ipcMain.handle('get-jobs', () => jobs)

  ipcMain.handle('get-logs', () => getLogs())

  ipcMain.handle('get-paper', () => getPaper())

  ipcMain.handle('open-log-folder', () => {
    const dir = logDir()
    require('fs').mkdirSync(dir, { recursive: true })
    return shell.openPath(dir)
  })

  ipcMain.handle('import-mask', async (_, orientation) => {
    maskImporting = true
    win.setAlwaysOnTop(false)
    const result = await dialog.showOpenDialog(win, {
      title: mt().maskTitle(orientation),
      filters: [{ name: 'PNG', extensions: ['png'] }],
      properties: ['openFile']
    })
    win.setAlwaysOnTop(true)
    maskImporting = false
    if (result.canceled || !result.filePaths.length) return null
    const filePath = result.filePaths[0]
    const key = orientation === 'portrait' ? 'maskPortrait' : 'maskLandscape'
    updateSettings({ [key]: filePath })
    return filePath
  })
  
  ipcMain.handle('select-hotfolder', async () => {
    maskImporting = true
    win.setAlwaysOnTop(false)
    const result = await dialog.showOpenDialog(win, {
      title: mt().folderTitle,
      properties: ['openDirectory']
    })
    win.setAlwaysOnTop(true)
    maskImporting = false
    if (result.canceled || !result.filePaths.length) return null
    const folderPath = result.filePaths[0]
    updateSettings({ hotfolderPath: folderPath })
    return folderPath
  })

  ipcMain.handle('quit', () => {
    stopServer()
    app.exit(0)
  })
})

app.on('window-all-closed', (e) => {
  e.preventDefault()
})

app.on('before-quit', () => {
  stopServer()
})