const { app, BrowserWindow, Tray, nativeImage, ipcMain, dialog } = require('electron')
const path = require('path')
const { exec } = require('child_process')
const { startServer, stopServer, getSettings, updateSettings, processAndPrint } = require('./server')

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
      if (imageUrl) {
        const jobId = Date.now().toString()
        addJob({ id: jobId, name, quantity, status: 'printing' })
        processAndPrint(imageUrl, quantity, name, printId, bubbleEnv)
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
  startServer(addJob, updateJobStatus)

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
    return getSettings()
  })

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

  ipcMain.handle('import-mask', async (_, orientation) => {
    maskImporting = true
    win.setAlwaysOnTop(false)
    const result = await dialog.showOpenDialog(win, {
      title: `Choisir le masque ${orientation}`,
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
      title: 'Choisir le dossier hotfolder',
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