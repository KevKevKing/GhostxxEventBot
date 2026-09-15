const { chat } = require('./ollama');

// Auffangnetz hinter dem Parser.
//
// Der Parser versteht die klaren Faelle in unter einer Millisekunde, verlangt
// dafuer aber @Erwaehnungen. Wer "tausch im 40er den GhostMuffiin gegen Pascal"
// schreibt, fiel bisher durch - das Modell hier faengt das ab.
//
// Wichtig: es fuehrt nichts aus. Es meldet nur eine Absicht, die danach durch
// dieselbe Rechtepruefung, Namensaufloesung und Bestaetigung laeuft wie alles
// andere. Weil source 'model' ist, kommt IMMER ein Bestaetigungsknopf - ein
// Fehlgriff des Modells kann also nie still eine Liste veraendern.

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'tausche_teilnehmer',
      description: 'Tauscht in einer Anmeldung einen Spieler gegen einen anderen aus.',
      parameters: {
        type: 'object',
        properties: {
          event: { type: 'string', description: 'Name des Events, z.B. "40er". Leer lassen wenn nicht genannt.' },
          raus: { type: 'string', description: 'Wer rausgeht - Name oder Erwähnung, genau wie geschrieben.' },
          rein: { type: 'string', description: 'Wer reinkommt - Name oder Erwähnung, genau wie geschrieben.' },
        },
        required: ['raus', 'rein'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'trage_ein',
      description: 'Trägt einen Spieler in eine Anmeldung ein.',
      parameters: {
        type: 'object',
        properties: {
          event: { type: 'string', description: 'Name des Events. Leer lassen wenn nicht genannt.' },
          spieler: { type: 'string', description: 'Wer eingetragen wird - Name oder Erwähnung.' },
          auswechselspieler: { type: 'boolean', description: 'true wenn als Auswechselspieler oder Ersatz.' },
        },
        required: ['spieler'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'trage_aus',
      description: 'Entfernt einen Spieler aus einer Anmeldung.',
      parameters: {
        type: 'object',
        properties: {
          event: { type: 'string', description: 'Name des Events. Leer lassen wenn nicht genannt.' },
          spieler: { type: 'string', description: 'Wer entfernt wird - Name oder Erwähnung.' },
        },
        required: ['spieler'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'zeige_teilnehmer',
      description: 'Zeigt die Teilnehmerliste einer Anmeldung.',
      parameters: {
        type: 'object',
        properties: {
          event: { type: 'string', description: 'Name des Events. Leer lassen wenn nicht genannt.' },
        },
        required: [],
      },
    },
  },
];

function cleanValue(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  // Modelle geben gern Platzhalter zurueck statt das Feld wegzulassen.
  if (/^(null|none|leer|unbekannt|n\/a|-)$/i.test(text)) return '';
  return text;
}

/** Uebersetzt einen Werkzeugaufruf in dieselbe Absichtsform wie der Parser. */
function toIntent(call) {
  const name = call?.function?.name;
  const args = call?.function?.arguments || {};
  const event = cleanValue(args.event);

  if (name === 'tausche_teilnehmer') {
    const out = cleanValue(args.raus);
    const into = cleanValue(args.rein);
    if (!out || !into) return null;
    return { action: 'swap', event, needsEvent: !event, out, in: into, source: 'model' };
  }

  if (name === 'trage_ein') {
    const player = cleanValue(args.spieler);
    if (!player) return null;
    return {
      action: 'add',
      event,
      needsEvent: !event,
      player,
      substitute: args.auswechselspieler === true || args.auswechselspieler === 'true',
      source: 'model',
    };
  }

  if (name === 'trage_aus') {
    const player = cleanValue(args.spieler);
    if (!player) return null;
    return { action: 'remove', event, needsEvent: !event, player, source: 'model' };
  }

  if (name === 'zeige_teilnehmer') {
    return { action: 'list', event, needsEvent: !event, source: 'model' };
  }

  return null;
}

/**
 * Ein Aufruf, zwei moegliche Ergebnisse: eine Absicht oder eine Chatantwort.
 *
 * Beides in einer Anfrage statt in zwei - sonst kostet jedes "hey wie gehts"
 * doppelt Rechenzeit.
 */
async function askModel({ system, history = [], text, withTools = true }) {
  const result = await chat({
    messages: [
      { role: 'system', content: system },
      ...history,
      { role: 'user', content: text },
    ],
    // Ohne Werkzeuge, wenn es offensichtlich nicht um Anmeldungen geht.
    //
    // Liegen die Werkzeuge auf dem Tisch, greift das Modell danach: auf
    // "wer ist der aktuelle Praesident von Dagestan" hat es die Teilnehmer-
    // liste aufgerufen, nur weil der Satz mit "wer ist" beginnt.
    ...(withTools ? { tools: TOOLS } : {}),
    temperature: withTools ? 0.2 : 0.45,
    // Harte Obergrenze gegen Textwaende.
    //
    // Im Leitungschat kamen auf zwei unklare Fragen Antworten von ueber 200
    // Woertern ohne Satzzeichen, die sich am Ende im Kreis drehten - beide
    // endeten mit demselben Satzbrei. Das Modell hatte sich verrannt und lief
    // bis zum Kontextende weiter.
    //
    // Anders als beim Bildmodell ist eine Grenze hier gefahrlos: qwen3.5 denkt
    // nicht vor der Antwort (nachgemessen: kein Denk-Feld), es faengt sofort
    // an zu schreiben. Zwei bis drei Saetze brauchen rund 80 Token, 250 lassen
    // also reichlich Luft und schneiden nur das Entgleiste ab.
    numPredict: 250,
  });

  if (!result.ok) return { ok: false, ...result };

  const call = result.toolCalls?.[0];
  const intent = call ? toIntent(call) : null;

  return {
    ok: true,
    model: result.model,
    ms: result.ms,
    intent,
    content: result.content || '',
  };
}

module.exports = {
  TOOLS,
  askModel,
  toIntent,
};
