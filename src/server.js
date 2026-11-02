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
let logsCallback = null
let paperCallback = null
let getLangCallback = null

// Textes produits par PPS (journal, erreurs). Les messages venant de macOS restent dans la langue du Mac.
const TEXTS = {
  fr: {
    noName: 'Photo sans nom',
    aborted: 'Travail interrompu par le système',
    canceled: 'Travail annulé',
    bubble: 'Pixilive non mis à jour',
    header: 'heure;source;nom;fichier;quantité;feuilles envoyées;statut;travail;id bubble;erreur',
    status: { 'imprimé': 'imprimé', 'écart': 'écart', 'échec': 'échec', 'annulé': 'annulé', 'pixilive': 'pixilive non mis à jour' },
    timeLocale: 'fr-FR'
  },
  en: {
    noName: 'Unnamed photo',
    aborted: 'Job aborted by the system',
    canceled: 'Job canceled',
    bubble: 'Pixilive not updated',
    header: 'time;source;name;file;quantity;sheets sent;status;job;bubble id;error',
    status: { 'imprimé': 'printed', 'écart': 'shortfall', 'échec': 'failed', 'annulé': 'canceled', 'pixilive': 'pixilive not updated' },
    timeLocale: 'en-GB'
  }
}

function txt() {
  const lang = getLangCallback ? getLangCallback() : 'fr'
  return TEXTS[lang] || TEXTS.en
}

// --- Journal des impressions et niveau de papier ---
const logs = []
let logSeq = 0
const sessionStart = new Date()
let sessionFile = null
const stats = { requested: 0, printed: 0, failures: 0, gaps: 0 }
let paper = null
let paperAlerted = false
const PAPER_ALERT_RATIO = 0.10

let settings = {
  printer: '',
  format: '10x15',
  port: 4242,
  maskPortrait: null,
  maskLandscape: null,
  hotfolderPath: null,
  hotfolderActive: false,
  language: 'auto'
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
  if ('printer' in newSettings) {
    paperAlerted = false
    paper = null
    checkPaper("changement d'imprimante")
  }
}

// ---------- Journal ----------

function addLog(fields) {
  const entry = {
    id: ++logSeq,
    time: new Date().toISOString(),
    status: 'préparation',
    sheets: null,
    jobId: null,
    error: null,
    thumb: null,
    ...fields
  }
  logs.unshift(entry)
  if (logs.length > 300) logs.pop()
  if (idleTimer) scheduleIdleCheck() // une nouvelle impression repousse la vérification
  emitLogs()
  return entry
}

function updateLog(entry, fields) {
  const wasFinal = entry.final
  Object.assign(entry, fields)
  if (fields.bubbleError) writeLogLine({ ...entry, status: 'pixilive', error: fields.bubbleError })
  if (!wasFinal && ['imprimé', 'écart', 'échec', 'annulé'].includes(entry.status)) {
    entry.final = true
    if (entry.status === 'échec' || entry.status === 'annulé') stats.failures++
    else stats.printed += entry.sheets ?? entry.quantity
    if (entry.status === 'écart') stats.gaps++
    writeLogLine(entry)
  }
  emitLogs()
}

function journalData() {
  return { logs, stats, sessionStart: sessionStart.toISOString() }
}

function emitLogs() {
  if (logsCallback) logsCallback(journalData())
}

function getLogs() {
  return journalData()
}

// « IMG_5884_1793529081218x627119690421633000_6.jpg » -> « IMG_5884 »
function cleanFileName(fileName) {
  if (!fileName) return ''
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/_\d{10,}x\d+_\d+(_test)?$/, '')
}

function logDir() {
  return path.join(os.homedir(), 'Documents', 'Pixilive Print Station', 'journaux')
}

// Un fichier par session (ouverture de PPS), créé à la première impression
function sessionLogFile() {
  if (sessionFile) return sessionFile
  const d = sessionStart
  const p2 = n => String(n).padStart(2, '0')
  const dir = logDir()
  fs.mkdirSync(dir, { recursive: true })
  sessionFile = path.join(dir, `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}h${p2(d.getMinutes())}.csv`)
  return sessionFile
}

function writeLogLine(entry) {
  try {
    const file = sessionLogFile()
    const d = new Date(entry.time)
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, '\ufeff' + txt().header + '\n')
    }
    const line = [
      d.toLocaleTimeString(txt().timeLocale), entry.source, entry.name, entry.file ?? '', entry.quantity,
      entry.sheets ?? '', txt().status[entry.status] || entry.status, entry.jobId ?? '', entry.printId ?? '', entry.error ?? ''
    ].map(esc).join(';')
    fs.appendFileSync(file, line + '\n')
  } catch (err) {
    console.error('Erreur écriture journal:', err.message)
  }
}

async function makeThumb(imageBuffer) {
  try {
    const t = await sharp(imageBuffer).rotate().resize(96, 96, { fit: 'cover' }).jpeg({ quality: 70 }).toBuffer()
    return 'data:image/jpeg;base64,' + t.toString('base64')
  } catch {
    return null
  }
}

function tmpName(prefix) {
  // Nom unique même si deux photos sont prêtes à la même milliseconde
  return path.join(os.tmpdir(), `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`)
}

function sendToPrinter(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) return reject(new Error((stderr || error.message).trim()))
      // « …est Dai_Nippon_Printing_DS_RX1-2042 (1 fichier(s)) » / « …is Printer-2042 (1 file(s)) »
      const m = stdout.match(/-(\d+)\s*\(/)
      resolve(m ? m[1] : null)
    })
  })
}

// ---------- Interrogation de CUPS (ipptool est fourni avec macOS) ----------

const IPP_JOB_TEST = path.join(os.tmpdir(), 'pps_job.test')
const IPP_PRINTER_TEST = path.join(os.tmpdir(), 'pps_printer.test')

function writeIppTests() {
  const head = [
    '{',
    'GROUP operation-attributes-tag',
    'ATTR charset attributes-charset utf-8',
    'ATTR naturalLanguage attributes-natural-language en',
    'ATTR uri printer-uri $uri',
    'ATTR name requesting-user-name $user'
  ]
  fs.writeFileSync(IPP_JOB_TEST, [
    ...head.slice(0, 1), 'OPERATION Get-Job-Attributes', ...head.slice(1),
    'ATTR integer job-id $job_id',
    'ATTR keyword requested-attributes job-state,job-media-sheets-completed',
    '}', ''
  ].join('\n'))
  fs.writeFileSync(IPP_PRINTER_TEST, [
    ...head.slice(0, 1), 'OPERATION Get-Printer-Attributes', ...head.slice(1),
    'ATTR keyword requested-attributes marker-message,marker-levels,marker-names,marker-change-time',
    '}', ''
  ].join('\n'))
}

function printerUri() {
  return `ipp://localhost/printers/${encodeURIComponent(settings.printer)}`
}

function ipp(testFile, vars = {}) {
  const defs = Object.entries(vars).map(([k, v]) => `-d ${k}=${v}`).join(' ')
  // lpstat -r réveille le service d'impression de macOS s'il s'est mis en veille
  const cmd = `lpstat -r >/dev/null 2>&1; /usr/bin/ipptool -tv ${defs} "${printerUri()}" "${testFile}"`
  return new Promise(resolve => {
    exec(cmd, { timeout: 15000 }, (err, stdout) => resolve(parseIpp(stdout || '')))
  })
}

function parseIpp(out) {
  const attrs = {}
  const body = out.split('status-code')[1] || ''
  for (const line of body.split('\n')) {
    const m = line.match(/^\s+([\w-]+) \([^)]*\) = (.*)$/)
    if (m) attrs[m[1]] = m[2].trim()
  }
  return attrs
}

const JOB_DONE = { completed: 'completed', '9': 'completed', canceled: 'canceled', '7': 'canceled', aborted: 'aborted', '8': 'aborted' }

// Suit un travail jusqu'à la fin et note le nombre de feuilles confirmé par le pilote
async function notifyPrinted(entry, sheets) {
  if (!entry.bubble || !sheets) return
  const r = await notifyBubble(entry.bubble.printId, sheets, entry.bubble.env, entry.bubble.endpoint)
  updateLog(entry, r.ok ? { bubble: { ...entry.bubble, notified: true } } : { bubbleError: `${txt().bubble} (${r.error})` })
}

// Si macOS ne donne aucune information sur le travail, on se contente de l'envoi
function finishWithoutTracking(entry) {
  updateLog(entry, { status: 'imprimé', sheets: null, note: 'suivi indisponible' })
  notifyPrinted(entry, entry.quantity)
  paperUsed(entry.quantity)
}

function watchJob(jobId, entry) {
  const started = Date.now()
  let blind = 0
  const tick = async () => {
    const a = await ipp(IPP_JOB_TEST, { job_id: jobId })
    if (!a['job-state']) {
      if (++blind >= 3) return finishWithoutTracking(entry)
      return setTimeout(tick, 4000)
    }
    blind = 0
    const state = JOB_DONE[a['job-state']]
    const sheets = a['job-media-sheets-completed'] !== undefined ? parseInt(a['job-media-sheets-completed']) : null
    if (state === 'completed') {
      const ok = sheets === null || sheets >= entry.quantity
      updateLog(entry, { status: ok ? 'imprimé' : 'écart', sheets })
      notifyPrinted(entry, sheets ?? entry.quantity)
      paperUsed(sheets ?? entry.quantity)
      return
    }
    if (state === 'canceled' || state === 'aborted') {
      updateLog(entry, { status: 'annulé', sheets, error: state === 'aborted' ? txt().aborted : txt().canceled })
      return
    }
    if (sheets !== null && sheets !== entry.sheets) updateLog(entry, { sheets })
    if (Date.now() - started > 30 * 60 * 1000) return // on arrête de suivre après 30 min
    setTimeout(tick, 4000)
  }
  setTimeout(tick, 3000)
}

// ---------- Niveau de papier ----------
// 1. Vérification réelle au démarrage (et au changement d'imprimante)
// 2. -1 par feuille envoyée, sans descendre sous 0 (le rouleau chargé fixe le format)
// 3. Vérification réelle après 60 s sans activité, s'il y a eu des impressions depuis la dernière
// 4. Vérification réelle si une impression part alors que le compteur est à 0 (rouleau changé)
// Une réponse sans total (ex. « 0/0 » pendant un changement de rouleau) est ignorée.

const IDLE_CHECK_DELAY = 60 * 1000
let idleTimer = null
let printedSinceCheck = false
let checking = false
const reportLevelsSupport = {}

// On n'envoie la demande qu'aux imprimantes dont le pilote la gère
function printerSupportsReportLevels() {
  const name = settings.printer
  if (!name) return false
  if (name in reportLevelsSupport) return reportLevelsSupport[name]
  let ok = false
  try { ok = fs.readFileSync(`/etc/cups/ppd/${name}.ppd`, 'latin1').includes('vnd.cups-command') } catch {}
  reportLevelsSupport[name] = ok
  return ok
}

function getPaper() {
  if (paper) return { ...paper, checking }
  return checking ? { checking } : null
}

function emitPaper(alert = false) {
  if (paperCallback) paperCallback(getPaper(), alert)
}

function setPaper(remaining, total, media) {
  const low = total > 0 && remaining <= total * PAPER_ALERT_RATIO
  const alert = low && !paperAlerted
  paperAlerted = low
  paper = {
    remaining, total, low,
    percent: total ? Math.round(remaining / total * 100) : null,
    media: media ?? (paper ? paper.media : ''),
    updatedAt: new Date().toISOString()
  }
  emitPaper(alert)
}

async function readPaperMarkers() {
  const a = await ipp(IPP_PRINTER_TEST)
  const m = (a['marker-message'] || '').match(/(\d+)\s*\/\s*(\d+)/)
  if (!m) return null
  const total = parseInt(m[2])
  if (!total) return null
  return { remaining: parseInt(m[1]), total, media: a['marker-names'] || '' }
}

function waitJobDone(jobId, timeoutMs) {
  return new Promise(resolve => {
    const started = Date.now()
    const tick = async () => {
      const a = await ipp(IPP_JOB_TEST, { job_id: jobId })
      if (JOB_DONE[a['job-state']] || Date.now() - started > timeoutMs) return resolve()
      setTimeout(tick, 1000)
    }
    setTimeout(tick, 1000)
  })
}

async function checkPaper(reason) {
  if (!settings.printer || checking) return
  checking = true
  printedSinceCheck = false
  emitPaper()
  const started = Date.now()
  try {
    if (printerSupportsReportLevels()) {
      const cmd = `printf '#CUPS-COMMAND\nReportLevels\n' | lp -d "${settings.printer}" -o document-format=application/vnd.cups-command`
      const jobId = await sendToPrinter(cmd).catch(() => null)
      if (jobId) await waitJobDone(jobId, 60000)
    }
    const r = await readPaperMarkers()
    if (r) setPaper(r.remaining, r.total, r.media)
    console.log(`Vérification papier (${reason}) : ${r ? r.remaining + '/' + r.total : 'pas de réponse valable, ignorée'} en ${((Date.now() - started) / 1000).toFixed(1)} s`)
  } catch (err) {
    console.error('Erreur vérification papier:', err.message)
  } finally {
    checking = false
    emitPaper()
  }
}

function scheduleIdleCheck() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    idleTimer = null
    const busy = logs.some(e => e.status === 'préparation' || e.status === 'en cours')
    if (busy) return scheduleIdleCheck()
    if (printedSinceCheck) checkPaper('inactivité')
  }, IDLE_CHECK_DELAY)
}

// Des feuilles viennent d'être envoyées à l'imprimante
function paperUsed(sheets) {
  printedSinceCheck = true
  if (paper && paper.total) {
    const wasEmpty = paper.remaining <= 0
    setPaper(Math.max(0, paper.remaining - sheets), paper.total)
    if (wasEmpty) checkPaper('impression avec un compteur à 0 : rouleau changé')
  }
  scheduleIdleCheck()
}

// Prévient Bubble qu'une impression est réellement sortie
// endpoint : print_succes (impression directe) ou print_hotfolder_succes (Dropbox)
async function notifyBubble(printId, quantity, bubbleEnv, endpoint = 'print_succes') {
  if (!printId) return { ok: false, error: 'aucun id' }
  const base = 'https://apppixilive.bubbleapps.io/' + (bubbleEnv === 'test' ? 'version-test/' : '')
  const url = `${base}api/1.1/wf/${endpoint}/`
  try {
    await axios.post(url, { print_id: printId, quantity: quantity }, { timeout: 15000 })
    console.log('Bubble notifié pour:', printId, '| x', quantity, '|', endpoint, '| env:', bubbleEnv)
    return { ok: true }
  } catch (err) {
    const detail = err.response ? `HTTP ${err.response.status}` : err.message
    console.error('Erreur notification Bubble:', detail, '|', url)
    return { ok: false, error: detail }
  }
}

// « IMG_5884_1793529081218x627119690421633000_6.jpg » -> id Bubble + environnement
function parseHotfolderName(fileName) {
  const m = fileName.match(/_(\d{10,}x\d+)_\d+(_test)?\.[^.]+$/)
  return m ? { printId: m[1], env: m[2] ? 'test' : 'live' } : null
}

async function processAndPrint(imageUrl, quantity, name, printId, bubbleEnv, fileName) {
  const file = cleanFileName(fileName)
  const entry = addLog({
    source: 'direct', name: name || file || txt().noName, file,
    quantity: Number(quantity) || 1, printId: printId || null,
    bubble: printId ? { printId, env: bubbleEnv, endpoint: 'print_succes' } : null
  })
  stats.requested += entry.quantity
  try {
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 })
    const imageBuffer = Buffer.from(response.data)
    updateLog(entry, { thumb: await makeThumb(imageBuffer) })

    const meta = await sharp(imageBuffer).metadata()
    const rotated = meta.orientation >= 5
    const isPortrait = rotated ? meta.width > meta.height : meta.height > meta.width

    const format = FORMATS[settings.format] || FORMATS['10x15']
    const targetWidth = isPortrait ? format.height : format.width
    const targetHeight = isPortrait ? format.width : format.height

    let processed = sharp(imageBuffer).rotate().resize(targetWidth, targetHeight, {
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

    const tmpFile = tmpName('pxl_print')
    await processed.jpeg({ quality: 95 }).toFile(tmpFile)

    const printer = settings.printer ? `-d "${settings.printer}"` : ''
    const copies = `-n ${quantity}`

    const pageSize = {
      '10x15': '300dnp6x4',
      '13x18': '210dnp5x7',
      '15x20': '310dnp6x8'
    }[settings.format] || '300dnp6x4'

    const cmd = `lp ${printer} ${copies} -o PageSize=${pageSize} "${tmpFile}"`

    let printJobId
    try {
      printJobId = await sendToPrinter(cmd)
    } finally {
      fs.unlink(tmpFile, () => {})
    }
    console.log('Impression envoyée, travail', printJobId)
    updateLog(entry, { status: 'en cours', jobId: printJobId })
    // Bubble sera prévenu quand les feuilles seront réellement sorties (voir watchJob)
    if (printJobId) watchJob(printJobId, entry)
    else finishWithoutTracking(entry)

    return { success: true, message: `Impression envoyée pour ${name}` }

  } catch (err) {
    console.error('Erreur processAndPrint:', err)
    updateLog(entry, { status: 'échec', error: err.message })
    return { success: false, message: err.message }
  }
}

async function printLocalFile(filePath, jobId) {
  const file = cleanFileName(path.basename(filePath))
  const parsed = parseHotfolderName(path.basename(filePath))
  const entry = addLog({
    source: 'hotfolder', name: file, file: path.basename(filePath), quantity: 1,
    printId: parsed ? parsed.printId : null,
    // Pas de notification Bubble pour le hotfolder : le workflow Dropbox gère lui-même le statut (sujet mis de côté)
    bubble: null
  })
  stats.requested += 1
  try {
    const imageBuffer = fs.readFileSync(filePath)
    updateLog(entry, { thumb: await makeThumb(imageBuffer) })
    const meta = await sharp(imageBuffer).metadata()
    const rotated = meta.orientation >= 5
    const isPortrait = rotated ? meta.width > meta.height : meta.height > meta.width

    const format = FORMATS[settings.format] || FORMATS['10x15']
    const targetWidth = isPortrait ? format.height : format.width
    const targetHeight = isPortrait ? format.width : format.height

    let processed = sharp(imageBuffer).rotate().resize(targetWidth, targetHeight, {
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

    const tmpFile = tmpName('pxl_hf')
    await processed.jpeg({ quality: 95 }).toFile(tmpFile)

    const printer = settings.printer ? `-d "${settings.printer}"` : ''
    const pageSize = {
      '10x15': '300dnp6x4',
      '13x18': '210dnp5x7',
      '15x20': '310dnp6x8'
    }[settings.format] || '300dnp6x4'

    const cmd = `lp ${printer} -n 1 -o PageSize=${pageSize} "${tmpFile}"`

    let printJobId
    try {
      printJobId = await sendToPrinter(cmd)
    } finally {
      fs.unlink(tmpFile, () => {})
    }
    console.log('Hotfolder imprimé:', path.basename(filePath), '| travail', printJobId)
    updateLog(entry, { status: 'en cours', jobId: printJobId })
    const printedDir = path.join(path.dirname(filePath), '_printed')
    if (!fs.existsSync(printedDir)) fs.mkdirSync(printedDir)
    fs.rename(filePath, path.join(printedDir, path.basename(filePath)), () => {})
    if (updateJobStatusCallback && jobId) {
      updateJobStatusCallback(jobId, 'done')
    }
    if (printJobId) watchJob(printJobId, entry)
    else finishWithoutTracking(entry)
  } catch (err) {
    console.error('Erreur printLocalFile:', err)
    updateLog(entry, { status: 'échec', error: err.message })
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

function startServer(addJob, updateJobStatus, hooks = {}) {
  addJobCallback = addJob
  updateJobStatusCallback = updateJobStatus
  logsCallback = hooks.onLogs || null
  paperCallback = hooks.onPaper || null
  getLangCallback = hooks.getLang || null

  try { writeIppTests() } catch (err) { console.error('Erreur tests IPP:', err.message) }

  initStore().then(() => {
    restartWatcher()
    checkPaper('démarrage')
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
  if (idleTimer) clearTimeout(idleTimer)
  if (watcher) watcher.close()
  if (server) server.close()
}

module.exports = { startServer, stopServer, getSettings, updateSettings, processAndPrint, getLogs, getPaper, logDir }