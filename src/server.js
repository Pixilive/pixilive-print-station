const http = require('http')
const axios = require('axios')
const sharp = require('sharp')
const { exec } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const chokidar = require('chokidar')

let store = null
let server = null
let watcher = null
let addJobCallback = null
let updateJobStatusCallback = null

let settings = {
  printer: '',
  format: '10x15',
  port: 4242,
  maskPortrait: null,
  maskLandscape: null,
  hotfolderPath: null,
  hotfolderActive: false
}

async function initStore() {
  const { default: ElectronStore } = await import('electron-store')
  store = new ElectronStore()
  const saved = store.get('settings')
  if (saved) settings = { ...settings, ...saved }
}

const FORMATS = {
  '10x15': { width: 1844, height: 1240 },
  '13x18': { width: 2138, height: 1476 },
  '15x20': { width: 2362, height: 1772 }
}

function getSettings() {
  return settings
}

function updateSettings(newSettings) {
  settings = { ...settings, ...newSettings }
  if (store) store.set('settings', settings)
  if ('hotfolderActive' in newSettings || 'hotfolderPath' in newSettings) {
    restartWatcher()
  }
}

async function notifyBubble(printId, quantity, bubbleEnv) {
  if (!printId) return
  const url = bubbleEnv === 'test'
    ? 'https://apppixilive.bubbleapps.io/version-test/api/1.1/wf/print_succes/'
    : 'https://apppixilive.bubbleapps.io/api/1.1/wf/print_succes/'
  try {
    await axios.post(url, {
      print_id: printId,
      quantity: quantity
    })
    console.log('Bubble notifié pour:', printId, '| env:', bubbleEnv)
  } catch (err) {
    console.error('Erreur notification Bubble:', err.message)
  }
}

async function processAndPrint(imageUrl, quantity, name, printId, bubbleEnv) {
  try {
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' })
    const imageBuffer = Buffer.from(response.data)

    const meta = await sharp(imageBuffer).metadata()
    const isPortrait = meta.height > meta.width

    const format = FORMATS[settings.format] || FORMATS['10x15']
    const targetWidth = isPortrait ? format.height : format.width
    const targetHeight = isPortrait ? format.width : format.height

    let processed = sharp(imageBuffer).resize(targetWidth, targetHeight, {
      fit: 'cover',
      position: 'center'
    })

    const maskPath = isPortrait ? settings.maskPortrait : settings.maskLandscape
    if (maskPath && fs.existsSync(maskPath)) {
      const maskBuffer = await sharp(maskPath)
        .resize(targetWidth, targetHeight, { fit: 'fill' })
        .toBuffer()
      processed = processed.composite([{ input: maskBuffer, blend: 'over' }])
    }

    const tmpFile = path.join(os.tmpdir(), `pxl_print_${Date.now()}.jpg`)
    await processed.jpeg({ quality: 95 }).toFile(tmpFile)

    const printer = settings.printer ? `-d "${settings.printer}"` : ''
    const copies = `-n ${quantity}`

    const pageSize = {
      '10x15': '300dnp6x4',
      '13x18': '210dnp5x7',
      '15x20': '310dnp6x8'
    }[settings.format] || '300dnp6x4'

    const cmd = `lp ${printer} ${copies} -o PageSize=${pageSize} "${tmpFile}"`

    exec(cmd, (error, stdout, stderr) => {
      fs.unlink(tmpFile, () => {})
      if (error) {
        console.error('Erreur impression:', stderr)
      } else {
        console.log('Impression envoyée:', stdout)
        notifyBubble(printId, quantity, bubbleEnv)
      }
    })

    return { success: true, message: `Impression envoyée pour ${name}` }

  } catch (err) {
    console.error('Erreur processAndPrint:', err)
    return { success: false, message: err.message }
  }
}

async function printLocalFile(filePath, jobId) {
  try {
    const imageBuffer = fs.readFileSync(filePath)
    const meta = await sharp(imageBuffer).metadata()
    const isPortrait = meta.height > meta.width

    const format = FORMATS[settings.format] || FORMATS['10x15']
    const targetWidth = isPortrait ? format.height : format.width
    const targetHeight = isPortrait ? format.width : format.height

    let processed = sharp(imageBuffer).resize(targetWidth, targetHeight, {
      fit: 'cover',
      position: 'center'
    })

    const maskPath = isPortrait ? settings.maskPortrait : settings.maskLandscape
    if (maskPath && fs.existsSync(maskPath)) {
      const maskBuffer = await sharp(maskPath)
        .resize(targetWidth, targetHeight, { fit: 'fill' })
        .toBuffer()
      processed = processed.composite([{ input: maskBuffer, blend: 'over' }])
    }

    const tmpFile = path.join(os.tmpdir(), `pxl_hf_${Date.now()}.jpg`)
    await processed.jpeg({ quality: 95 }).toFile(tmpFile)

    const printer = settings.printer ? `-d "${settings.printer}"` : ''
    const pageSize = {
      '10x15': '300dnp6x4',
      '13x18': '210dnp5x7',
      '15x20': '310dnp6x8'
    }[settings.format] || '300dnp6x4'

    const cmd = `lp ${printer} -n 1 -o PageSize=${pageSize} "${tmpFile}"`

    exec(cmd, (error, stdout, stderr) => {
      fs.unlink(tmpFile, () => {})
      if (error) {
        console.error('Erreur hotfolder:', stderr)
        if (updateJobStatusCallback && jobId) {
          updateJobStatusCallback(jobId, 'error')
        }
      } else {
        console.log('Hotfolder imprimé:', path.basename(filePath))
        const printedDir = path.join(path.dirname(filePath), '_printed')
        if (!fs.existsSync(printedDir)) fs.mkdirSync(printedDir)
        fs.rename(filePath, path.join(printedDir, path.basename(filePath)), () => {})
        if (updateJobStatusCallback && jobId) {
          updateJobStatusCallback(jobId, 'done')
        }
      }
    })
  } catch (err) {
    console.error('Erreur printLocalFile:', err)
    if (updateJobStatusCallback && jobId) {
      updateJobStatusCallback(jobId, 'error')
    }
  }
}

function restartWatcher() {
  if (watcher) {
    watcher.close()
    watcher = null
  }
  if (settings.hotfolderActive && settings.hotfolderPath && fs.existsSync(settings.hotfolderPath)) {
    watcher = chokidar.watch(settings.hotfolderPath, {
      persistent: true,
      ignoreInitial: true,
      ignored: /(^|[\/\\])_printed/,
      awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 200 }
    })
    watcher.on('add', (filePath) => {
      const ext = path.extname(filePath).toLowerCase()
      if (['.jpg', '.jpeg', '.png'].includes(ext)) {
        console.log('Hotfolder détecte:', filePath)
        const jobId = Date.now().toString()
        if (addJobCallback) {
          addJobCallback({ id: jobId, name: path.basename(filePath), quantity: 1, status: 'printing' })
        }
        printLocalFile(filePath, jobId)
      }
    })
    console.log('Hotfolder actif sur:', settings.hotfolderPath)
  }
}

function startServer(addJob, updateJobStatus) {
  addJobCallback = addJob
  updateJobStatusCallback = updateJobStatus

  initStore().then(() => {
    restartWatcher()
  })

  server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (req.method === 'POST' && req.url === '/print') {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', async () => {
        try {
          const { imageUrl, quantity, name, printId } = JSON.parse(body)
          if (!imageUrl) {
            res.writeHead(400)
            res.end(JSON.stringify({ success: false, message: 'imageUrl manquant' }))
            return
          }
          const result = await processAndPrint(imageUrl, quantity || 1, name || '', printId || '')
          res.writeHead(result.success ? 200 : 500)
          res.end(JSON.stringify(result))
        } catch (e) {
          res.writeHead(400)
          res.end(JSON.stringify({ success: false, message: 'JSON invalide' }))
        }
      })
      return
    }

    if (req.method === 'GET' && req.url === '/status') {
      res.writeHead(200)
      res.end(JSON.stringify({
        status: 'ok',
        printer: settings.printer,
        format: settings.format,
        port: settings.port,
        hotfolderActive: settings.hotfolderActive
      }))
      return
    }

    res.writeHead(404)
    res.end()
  })

  server.listen(settings.port, '127.0.0.1', () => {
    console.log(`Serveur démarré sur le port ${settings.port}`)
  })
}

function stopServer() {
  if (watcher) watcher.close()
  if (server) server.close()
}

module.exports = { startServer, stopServer, getSettings, updateSettings, processAndPrint }