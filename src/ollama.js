const { execFile } = require('node:child_process');
const { config } = require('./config');

// Anbindung an das lokale Ollama. Nichts verlaesst diesen Rechner.
//
// Modellwahl haengt am freien Grafikspeicher: laeuft ein Spiel, ist die GPU
// belegt und Ollama schiebt ein grosses Modell groesstenteils auf die CPU
// (gemessen: 71% CPU, ~12s pro Antwort). Dann ist ein kleines Modell auf der
// GPU schneller UND sparsamer als ein grosses auf der CPU.

const VRAM_CACHE_MS = 60 * 1000;
// Ungefaehre Belegung des kleinen Modells, um beim Zurueckwechseln auf das
// grosse nicht faelschlich "zu wenig frei" zu messen.
const FALLBACK_MODEL_MB = 3000;
// Liegt weniger als dieser Anteil eines geladenen Modells auf der Grafikkarte,
// rechnet ueberwiegend der Prozessor und es lohnt sich, kleiner zu werden.
const MIN_GPU_RATIO = 0.6;

let vramCache = { value: null, at: 0 };
let availableModels = null;

function readFreeVramMb() {
  return new Promise((resolve) => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=memory.free', '--format=csv,noheader,nounits'],
      { timeout: 5000, windowsHide: true },
      (error, stdout) => {
        if (error) return resolve(null);
        const value = Number(String(stdout).trim().split(/\r?\n/)[0]);
        resolve(Number.isFinite(value) ? value : null);
      },
    );
  });
}

async function getFreeVramMb() {
  const now = Date.now();
  if (vramCache.value !== null && now - vramCache.at < VRAM_CACHE_MS) {
    return vramCache.value;
  }

  const value = await readFreeVramMb();
  vramCache = { value, at: now };
  return value;
}

async function listModels() {
  if (availableModels) return availableModels;

  try {
    const res = await fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const json = await res.json();
    availableModels = (json.models || []).map((model) => model.name);
    return availableModels;
  } catch {
    return [];
  }
}

// Welche Modelle gerade im Speicher liegen - inklusive der tatsaechlichen
// Aufteilung zwischen Grafikkarte und Prozessor.
async function getLoadedDetails() {
  try {
    const res = await fetch(`${config.ollamaUrl}/api/ps`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const json = await res.json();
    return (json.models || []).map((model) => ({
      name: model.name,
      gpuRatio: model.size > 0 ? model.size_vram / model.size : 0,
    }));
  } catch {
    return [];
  }
}

async function getLoadedModels() {
  return (await getLoadedDetails()).map((model) => model.name);
}

/**
 * Wie viel Grafikspeicher waere frei, wenn Ghostxx seine eigenen Modelle
 * beiseite legt?
 *
 * Der reine freie Speicher taeuscht: liegt sein Sprachmodell mit 5,3 GB drin,
 * meldet die Karte 0,7 GB frei - und er haelt sich fuer blockiert, obwohl
 * Ollama das Modell beim naechsten Bild ohnehin verdraengen wuerde. Genau so
 * hat sich das Bild-Vorablesen selbst lahmgelegt und in vier Minuten kein
 * einziges Bild gelesen.
 *
 * Interessant ist nur, was ANDERE belegen. Also GTA.
 */
async function getFreiOhneEigeneMb() {
  const frei = await getFreeVramMb();
  if (frei === null) return null;

  try {
    const res = await fetch(`${config.ollamaUrl}/api/ps`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return frei;
    const json = await res.json();
    const eigenes = (json.models || [])
      .reduce((summe, m) => summe + (m.size_vram || 0), 0) / (1024 * 1024);
    return Math.round(frei + eigenes);
  } catch {
    return frei;
  }
}

/**
 * Waehlt das Modell nach freiem Grafikspeicher.
 * Ohne nvidia-smi oder bei abgeschaltetem Auto-Wechsel bleibt es beim grossen.
 */
async function pickModel() {
  if (!config.ollamaAutoSwitch) return config.ollamaModel;

  const details = await getLoadedDetails();
  const loaded = details.map((model) => model.name);
  const big = details.find((model) => model.name === config.ollamaModel);

  // Ist das grosse Modell schon geladen, wird es normalerweise weiterbenutzt -
  // es belegt den Grafikspeicher selbst, eine Messung des freien Speichers
  // wuerde deshalb faelschlich "zu wenig" ergeben und der Bot wuerde staendig
  // zwischen den Modellen wechseln.
  //
  // Ausnahme: liegt es groesstenteils im Arbeitsspeicher, ist genau die
  // langsame Kombination entstanden, die vermieden werden soll (gemessen: 31%
  // auf der GPU, ~13s pro Antwort). Dann lieber das kleine Modell, das
  // vollstaendig auf die Grafikkarte passt.
  if (big) {
    if (big.gpuRatio >= MIN_GPU_RATIO) return config.ollamaModel;
    const models = await listModels();
    if (models.includes(config.ollamaFallbackModel)) return config.ollamaFallbackModel;
    return config.ollamaModel;
  }

  const free = await getFreeVramMb();
  if (free === null) return config.ollamaModel;

  // Laeuft nur das kleine Modell, zaehlt sein Speicher als verfuegbar mit -
  // sonst bliebe der Bot dauerhaft beim kleinen haengen, auch wenn das Spiel
  // laengst zu ist.
  const freeAfterUnload = loaded.includes(config.ollamaFallbackModel)
    ? free + FALLBACK_MODEL_MB
    : free;

  if (freeAfterUnload >= config.ollamaVramThresholdMb) return config.ollamaModel;

  const models = await listModels();
  if (models.length && !models.includes(config.ollamaFallbackModel)) {
    return config.ollamaModel;
  }

  return config.ollamaFallbackModel;
}

async function isReachable() {
  try {
    const res = await fetch(`${config.ollamaUrl}/api/version`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Ein Durchgang gegen /api/chat. Wirft nie - Fehler kommen als { ok: false }
 * zurueck, damit ein abgestuerztes Ollama nie den Bot mitreisst.
 */
// Waehrend Ollama ein Modell laedt, antwortet es mit 5xx. Bei knappem
// Grafikspeicher - etwa wenn nebenher gespielt wird - dauert so ein Ladevorgang
// mehrere Sekunden. Ein einzelner Versuch nach 1,5 Sekunden war zu frueh: im
// Test kam trotzdem "Ollama antwortete mit 500" durch.
const RETRY_DELAYS_MS = [2000, 5000];

async function chat(options) {
  // Bilder gehen durch die Schlange, damit sich nie zwei davon eine
  // Grafikkarte teilen. Text laeuft daran vorbei.
  const mitBild = options.messages?.some((m) => m.images?.length);
  return mitBild ? reihe(() => chatDurchgaenge(options)) : chatDurchgaenge(options);
}

async function chatDurchgaenge(options) {
  let result = await chatOnce(options);

  for (const delay of RETRY_DELAYS_MS) {
    if (result.ok || !result.retryable) break;
    await new Promise((resolve) => setTimeout(resolve, delay));
    result = await chatOnce(options);
  }

  return result;
}

async function chatOnce({
  messages,
  tools,
  model,
  think = false,
  temperature = 0.2,
  // Wieviele Schichten auf die Grafikkarte sollen. 0 heisst: alles auf den
  // Prozessor. Damit laesst sich eine Anfrage bewusst am Grafikspeicher
  // vorbeileiten - langsamer, aber sie stoert das Spiel nicht.
  numGpu,
  keepAlive,
  // Wiederholungsbremse. Fuer den Chat noetig, fuers Bildlesen schaedlich -
  // dort MUSS sich Text wiederholen duerfen (zwei Events untereinander, Punkte,
  // Familiennamen). Deshalb abschaltbar.
  repeatPenalty = 1.2,
  // Obergrenze fuer die Antwortlaenge. Die Bildpruefung braucht drei Zeilen;
  // ohne Grenze hat das Modell im Test 924 Token produziert, und jedes davon
  // kostet Zeit.
  numPredict,
  // Eigene Zeitgrenze. Bildlesen braucht deutlich mehr Luft als ein Chat.
  timeoutMs,
}) {
  const chosen = model || (await pickModel());
  const started = Date.now();

  laufend += 1;
  try {
    const res = await fetch(`${config.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs || config.ollamaTimeoutMs),
      body: JSON.stringify({
        model: chosen,
        messages,
        ...(tools?.length ? { tools } : {}),
        stream: false,
        think,
        keep_alive: keepAlive || config.ollamaKeepAlive,
        options: {
          temperature,
          num_ctx: config.ollamaNumCtx,
          ...(numGpu === undefined ? {} : { num_gpu: numGpu }),
          // Ohne Wiederholungsbremse antwortet er auf aehnliche Nachrichten
          // Wort fuer Wort identisch - im echten Betrieb kam fuenfmal
          // hintereinander derselbe Satz, was ihn wie eine kaputte Platte
          // wirken liess. Sein eigener Text steht ja im Verlauf und
          // verstaerkt sich dadurch selbst.
          repeat_penalty: repeatPenalty,
          repeat_last_n: 256,
          ...(numPredict ? { num_predict: numPredict } : {}),
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return {
        ok: false,
        error: `Ollama antwortete mit ${res.status}`,
        detail,
        model: chosen,
        retryable: res.status >= 500,
      };
    }

    const json = await res.json();
    const ms = Date.now() - started;

    merkeAnfrage({
      zeit: new Date().toISOString(),
      model: chosen,
      ms,
      // Ollama liefert die Zaehler mit. Daraus wird die einzige Zahl, an der
      // man sieht ob die Grafikkarte mitspielt: Token pro Sekunde.
      token: json.eval_count || 0,
      proSek: json.eval_count && json.eval_duration
        ? Math.round((json.eval_count / (json.eval_duration / 1e9)) * 10) / 10
        : null,
      mitBild: Boolean(messages?.some((m) => m.images?.length)),
    });

    return {
      ok: true,
      model: chosen,
      ms,
      content: json.message?.content || '',
      toolCalls: json.message?.tool_calls || [],
    };
  } catch (error) {
    const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError';
    return {
      ok: false,
      model: chosen,
      ms: Date.now() - started,
      error: timedOut ? 'Zeitüberschreitung' : error.message,
      timedOut,
    };
  } finally {
    laufend = Math.max(0, laufend - 1);
  }
}

// Die letzten Anfragen ans Sprachmodell - fuers Dashboard.
//
// Bisher stand nirgends, was er zuletzt gerechnet hat und wie schnell. Genau
// das ist aber die Zahl, an der man sieht, ob die Grafikkarte mitspielt:
// 100 Token pro Sekunde ist normal, 20 heisst, das Modell liegt im
// Arbeitsspeicher statt auf der Karte.
const ANFRAGEN_SPEICHER = 20;
const anfragen = [];

// Wie viele Anfragen gerade wirklich laufen.
//
// Dafuer gibt es keinen anderen Weg: von aussen sieht man nur, dass ein Modell
// geladen IST - nicht, ob es in diesem Moment rechnet. Der Ring im Dashboard
// haengt daran, und ein Ring, der immer dreht, sagt nichts aus.
let laufend = 0;

function rechnetGerade() {
  return laufend > 0;
}

// Immer nur EIN Bild gleichzeitig.
//
// Der Vorableser liest im Hintergrund, die Auszahlung liest im Vordergrund,
// und eine Messung liest auch mal - laufen zwei davon zusammen, teilen sie
// sich eine Grafikkarte und werden beide drei- bis viermal langsamer. Dann
// reissen beide die 90 Sekunden und melden "Bild nicht lesbar", obwohl das
// Bild tadellos ist.
//
// Genau so ist es passiert: gemessen 0 von 3 gut lesbaren Nachweisen, bei
// 95 % GPU-Last - und die Last kam von Ghostxx selbst.
//
// Textanfragen sind davon nicht betroffen, die sind kurz und sollen nicht
// hinter einem Bild warten muessen.
let bildSchlange = Promise.resolve();

function reihe(aufgabe) {
  const dran = bildSchlange.then(aufgabe, aufgabe);
  // Fehler nicht in die Kette tragen, sonst steht sie fuer immer.
  bildSchlange = dran.then(() => undefined, () => undefined);
  return dran;
}

function merkeAnfrage(eintrag) {
  anfragen.push(eintrag);
  if (anfragen.length > ANFRAGEN_SPEICHER) anfragen.shift();
}

function letzteAnfragen() {
  return [...anfragen].reverse();
}

/**
 * Ein Modell sofort aus dem Grafikspeicher werfen.
 *
 * Ollama laesst ein Modell nach der letzten Anfrage noch eine Weile liegen -
 * beim Bildmodell fuenf Minuten. Das ist beim Auszaehlen richtig, weil dann
 * hundert Bilder hintereinander kommen. Beim stillen Vorablesen ist es
 * gefaehrlich: liest er ein einzelnes Bild und Kevin startet danach ein Spiel,
 * belegt das Modell noch minutenlang 5,9 GB, die dem Spiel fehlen.
 *
 * Deshalb raeumt das Vorablesen hinter sich auf.
 */
async function entladeModell(model) {
  try {
    await fetch(`${config.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ model, keep_alive: 0 }),
    });
    return true;
  } catch {
    return false;
  }
}

// Laedt das Modell vor, damit die erste echte Anfrage nicht auf das Laden wartet.
async function warmUp() {
  const model = await pickModel();
  const result = await chat({
    model,
    messages: [{ role: 'user', content: 'ok' }],
    temperature: 0,
  });

  return { model, ok: result.ok };
}

module.exports = {
  chat,
  entladeModell,
  getFreeVramMb,
  getFreiOhneEigeneMb,
  getLoadedDetails,
  letzteAnfragen,
  rechnetGerade,
  getLoadedModels,
  isReachable,
  listModels,
  pickModel,
  warmUp,
};
