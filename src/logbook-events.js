const { normalizeText } = require('./text-match');

// Welche Events es im Logbuch gibt und wie sie heissen.
//
// "aliases" sind die Kuerzel, die die Leute in den Nachrichtentext schreiben.
// "ingame" sind die Namen, wie sie im Spiel eingeblendet werden - danach sucht
// die Bildpruefung.
//
// Ganz bewusst eine feste Liste: es wird NUR gesucht, was hier drinsteht.
// "Ueberfall auf die Militaerbasis" zum Beispiel ist ein Anzeigefehler im Spiel
// und kein echtes Event - ohne feste Liste haette der Bot es mitgezaehlt.

const EVENTS = [
  {
    key: '40er',
    label: '40er',
    aliases: ['40er', '40', 'vierziger'],
    //
    // "Kampf ums Geschaeft fuer inoffizielle Organisationen" gehoert HIERHER.
    //
    // Das ist die Gewinnmeldung des Ressourcenkriegs - Kevins Auskunft, und
    // sie deckt sich mit dem Bild: unter der Zeile steht "Familie Unknown hat
    // die Ressource Dam uebernommen".
    //
    // Ich hatte es zweimal falsch: erst lag es bei BizWar (weil "Geschaeft"
    // darin vorkommt), dann habe ich es fuer eine Ankuendigung gehalten, die
    // staendig in der Ecke haengt, und ganz herausgeworfen. Beides war falsch.
    // BizWar ist "Uebernahme des Geschaefts" - ein anderes Event.
    //
    // Gesucht wird nur nach "kampf ums geschaeft": das Bildmodell liest das
    // Wort danach mal als "inoffizielle", mal "infizielle", mal "informelle".
    //
    // "krieg am ressourcen" ist kein Tippfehler von mir, sondern das, was das
    // Bildmodell einmal abgelesen hat. Solche Verleser stehen hier mit drin,
    // wenn sie in den Daten wirklich vorgekommen sind - erfunden wird keiner.
    //
    // "staatliche angestellte" ist Kevins Auskunft: ein bekannter BUG im
    // Spiel selbst, kein Verleser des Modells. Der Kasten zeigt eigentlich
    // den Gegnernamen zum 40er, zeigt durch den Fehler aber diesen Text.
    // Steht deshalb bewusst HIER und nicht nur auf der Ignorieren-Liste:
    // taucht der Bug auf - auch ohne die Kopfzeile "Krieg um Ressourcen",
    // etwa wenn der Ausschnitt nur die untere Haelfte des Kastens trifft -
    // ist das trotzdem ein 40er, kein unlesbares Bild. "Ganz wichtig",
    // Kevins Worten nach: NUR 40er, niemals mit SK verwechseln, obwohl
    // beide mit "Staatliche" anfangen.
    //
    // "kressourcen" ist gemessen: beim Drift-Bild las das Modell aus dem
    // Zuschnitt "Krieg,Kressourcen,Driftwettbewerbe" - es hat den Kasten also
    // richtig GESEHEN, nur das "um" mit dem "R" verschmolzen. Ohne diese Zeile
    // faellt so ein Nachweis durch, obwohl das Modell alles richtig gemacht
    // hat. Das Wort gibt es sonst nirgends, es kann also nichts Falsches
    // treffen.
    ingame: [
      'krieg um ressourcen', 'krieg am ressourcen', 'ressourcenkrieg', 'kressourcen',
      'kampf ums geschaeft',
      'staatliche angestellte', 'staatliche anstellung',
    ],
  },
  {
    key: 'bizwar',
    label: 'Bizwar',
    aliases: ['bizwar', 'biz war', 'bw', 'bizzwar'],
    // NUR "Uebernahme des Geschaefts".
    //
    // Hier standen frueher auch "kampf ums geschaeft" und das blanke
    // "geschaeft". Beides war falsch, aber anders falsch, als ich lange
    // dachte: "Kampf ums Geschaeft fuer inoffizielle Organisationen" ist
    // keine Ankuendigung, sondern die GEWINNMELDUNG DES RESSOURCENKRIEGS -
    // sie steht deshalb beim 40er.
    //
    // Folge damals: ein Nachweis mit "40er Win" wurde als BizWar erkannt,
    // weil das Wort "Geschaeft" darin vorkam. Zwei verschiedene Events, die
    // sich ein Wort teilen.
    //
    // "Krieg um das Geschaeft" ist ebenfalls BizWar - Kevins Auskunft.
    // Aufpassen: das ist NICHT "Kampf ums Geschaeft fuer inoffizielle
    // Organisationen", das ist der 40er. Ein Wort Unterschied, zwei Events.
    ingame: ['uebernahme des geschaefts', 'krieg um das geschaeft'],
  },
  {
    key: 'rp-fabrik',
    label: 'RP-Fabrik',
    aliases: ['rp fabrik', 'rpfabrik', 'rp-fabrik', 'rp'],
    // "RP Ticket Factory" ist keine Verlesung, sondern Englisch statt
    // Deutsch - gemessen an echten Bildern am 24.08. (Kevins Meldung): das
    // Spiel zeigt den Kasten bei manchen Spielern auf Englisch an, gleiche
    // Bedeutung, anderes Wort. "Factory" gibt es sonst nirgends im Katalog.
    ingame: ['rp ticket fabrik', 'ticket fabrik', 'rp ticket factory', 'ticket factory'],
  },
  {
    key: 'waffenfabrik',
    label: 'Waffenfabrik',
    aliases: ['wf', 'waffenfabrik', 'waffen fabrik'],
    ingame: ['uebernahme einer waffenfabrik', 'waffenfabrik'],
  },
  {
    key: 'weinberge',
    label: 'Weinberge',
    aliases: ['weinberge', 'weinberg', 'wein'],
    ingame: ['weinberge', 'weinberg'],
  },
  {
    key: 'giesserei',
    label: 'Gießerei',
    aliases: ['giesserei', 'gieserei', 'giesserrei', 'giess'],
    // "Glaserlei" und "Glaserei" hat das Bildmodell aus "Giesserei" gemacht -
    // beides steht so in den Daten. Eine Glaserei ist kein anderes Event, das
    // Wort kann also nichts Falsches treffen.
    //
    // "Seizure of a foundry" ist dieselbe Sache wie bei RP-Fabrik: Englisch
    // statt Deutsch, gemessen am 24.08. am selben Ticket. "Foundry" gibt es
    // sonst nirgends im Katalog.
    ingame: ['uebernahme der giesserei', 'giesserei', 'glaserei', 'glaserlei', 'seizure of a foundry', 'foundry'],
  },
  {
    key: 'hafen',
    label: 'Hafen',
    aliases: ['hafen', 'hafendrop', 'hafen drop'],
    ingame: ['die schlacht im hafen', 'schlacht im hafen'],
  },
  {
    key: 'bank',
    label: 'Bank',
    aliases: ['bank', 'bankueberfall', 'banküberfall', 'bank ueberfall'],
    ingame: ['bankueberfall', 'bank ueberfall'],
  },
  {
    key: 'ekz',
    label: 'EKZ',
    aliases: ['ekz', 'einkaufszentrum', 'einkaufs zentrum'],
    // Frueher stand hier "kein Name im Bild". Das war falsch: das Event heisst
    // im Spiel "Eroberung eines Einkaufszentrums" und laeuft taeglich 17:15.
    // Damit ist SK der einzige Fall ohne Namen.
    ingame: ['eroberung eines einkaufszentrums', 'einkaufszentrum'],
  },
  {
    key: 'sk',
    label: 'SK',
    aliases: ['sk', 'staatliche', 'staatliche kontrolle', 'staat'],
    // Hier stand jahrelang "im Bild nur zwei Wappen, kein Text" - und deshalb
    // eine leere Liste. Das stimmt nur waehrend des Events.
    //
    // Auf dem ABSCHLUSSBILDSCHIRM steht "STAATLICHE KONTROLLE" in riesigen
    // Buchstaben, genau wie bei jedem anderen Event. Das Bildmodell hat es
    // dreimal sauber abgelesen und der Katalog hat es jedes Mal weggeworfen,
    // weil hier nichts zum Vergleichen stand.
    //
    // Die zwei Wappen bleiben als zweiter Weg: waehrend des Events gibt es
    // wirklich keinen Text, nur die beiden Familienwappen oben.
    ingame: ['staatliche kontrolle'],
  },
  // Diese fuenf standen im Terminplan, aber nicht hier - der Bot hat sie also
  // taeglich gepostet und konnte sie danach nicht auszahlen. Wer "50er win"
  // schrieb, fand keinen Treffer im Katalog und wurde nicht gezaehlt.
  {
    key: '50er',
    label: '50er',
    aliases: ['50er', '50', 'fuenfziger', 'fünfziger', 'rangfolge'],
    // "Der Kampf ums Ranking" ist dasselbe Event - Kevins Auskunft. Das Spiel
    // blendet es mal so, mal als "Kampf um die Rangfolge" ein.
    //
    // Gefunden ueber ein Bild im Logbuch, auf dem beides zusammen mit der
    // Gewinnmeldung des Ressourcenkriegs stand. Ohne diese Zeile zaehlte so
    // ein Bild still als 40er - dabei stehen dort ZWEI Events, und genau
    // dafuer gibt es das Achtungszeichen.
    ingame: ['kampf um die rangfolge', 'rangfolge', 'kampf ums ranking'],
  },
  {
    key: 'hotel',
    label: 'Hotel',
    aliases: ['hotel'],
    ingame: ['uebernahme des hotels', 'hotel'],
  },
  {
    key: 'flugzeugtraeger',
    label: 'Flugzeugträger',
    aliases: ['ft', 'flugzeugtraeger', 'flugzeugträger', 'flugzeug traeger', 'traeger'],
    // Im Spiel heisst es "Eroberung des Flugzeugtraegers".
    //
    // Beim Messen hat das Modell daraus "EINNAHME DES FLUGZEUGTRAEGERS"
    // gemacht - es hat also nicht abgelesen, sondern mit einem Synonym
    // umschrieben. Deshalb stehen die falschen Varianten hier trotzdem mit
    // drin: sie schaden nicht und fangen genau solche Faelle ab.
    ingame: [
      'eroberung des flugzeugtraegers',
      'einnahme des flugzeugtraegers',
      'kaperung eines flugzeugtraegers',
      'flugzeugtraeger',
    ],
  },
  {
    key: 'gefaengnis',
    label: 'Gefängnis',
    aliases: ['gefaengnis', 'gefängnis', 'knast', 'jail'],
    ingame: ['angriff auf das gefaengnis', 'gefaengnis'],
  },
  {
    key: 'waffenteile',
    label: 'Waffenteile',
    aliases: ['waffenteile', 'waffen teile', 'komponenten', 'uebrige komponenten'],
    ingame: ['uebrige komponenten', 'komponenten'],
  },
  {
    // FamWar hat es bis jetzt gar nicht gegeben.
    //
    // In der Auszahlungstabelle steht er seit jeher ("richtet sich nach den
    // erhaltenen Gegenstaenden"), im Eventkatalog aber nicht - es gab also
    // weder ein Kuerzel fuer den Text noch einen Namen fuers Bild. Ein FamWar
    // konnte damit ueberhaupt nicht ins Logbuch eingetragen werden.
    //
    // Im Spiel heisst er "Battle of Families" - so hat das Bildmodell es
    // zweimal abgelesen, und beide Male fiel es durch.
    key: 'famwar',
    label: 'FamWar',
    aliases: ['famwar', 'fam war', 'familienkrieg'],
    ingame: ['battle of families'],
  },
  {
    key: 'famraid',
    label: 'FamRaid',
    aliases: ['raid', 'famraid', 'fam raid'],
    ingame: ['raid'],
    // Die Anzeige oben rechts ist beim Raid haeufig fehlerhaft. Findet der Bot
    // den Namen nicht, ist das deshalb KEIN Widerspruch - sonst wuerde er Leute
    // wegen eines Anzeigefehlers im Spiel anschreiben.
    unreliableInGame: true,
  },
];

const WIN_WORDS = ['win', 'won', 'gewonnen', 'gewinn', 'sieg', 'w'];
const LOSE_WORDS = ['lose', 'loss', 'lost', 'verloren', 'niederlage', 'l', 'loose', 'lsoe'];

function getEvent(key) {
  return EVENTS.find((event) => event.key === key) || null;
}

/**
 * Sucht das Event im Nachrichtentext ("40er win", "sk lose", "WF Win").
 *
 * Laengere Kuerzel zuerst, damit "rp fabrik" nicht als "rp" durchgeht und
 * "bizwar" nicht am "bw" haengenbleibt.
 */
function findEventInText(text) {
  const words = normalizeText(text).split(' ').filter(Boolean);
  const joined = words.join(' ');

  const kandidaten = [];
  for (const event of EVENTS) {
    for (const alias of event.aliases) {
      const needle = normalizeText(alias);
      if (!needle) continue;

      const treffer = needle.includes(' ')
        ? joined.includes(needle)
        : words.includes(needle);

      if (treffer) kandidaten.push({ event, laenge: needle.length });
    }
  }

  if (!kandidaten.length) return null;
  kandidaten.sort((a, b) => b.laenge - a.laenge);
  return kandidaten[0].event;
}

function findResultInText(text) {
  const words = normalizeText(text).split(' ').filter(Boolean);
  const hatWin = words.some((word) => WIN_WORDS.includes(word));
  const hatLose = words.some((word) => LOSE_WORDS.includes(word));

  // Beides genannt heisst: nicht eindeutig. Lieber nachfragen als raten.
  if (hatWin && hatLose) return '';
  if (hatWin) return 'win';
  if (hatLose) return 'lose';
  return '';
}

/**
 * Liest die Behauptung aus einem Logbuch-Beitrag.
 * Der Text ist die Angabe, das Bild spaeter der Nachweis.
 */
function parseClaim(text) {
  const event = findEventInText(text);
  const result = findResultInText(text);

  // Ohne Ergebnis geht gar nichts - das steht nie im Bild.
  if (!result) {
    return { ok: false, reason: event ? 'kein_ergebnis' : 'kein_event', event, result: '', text };
  }

  // Viele schreiben nur "WIN" ohne Eventnamen. Dann muss das Event aus dem
  // Screenshot kommen - das ist kein Fehler, sondern der Normalfall bei manchen.
  if (!event) {
    return { ok: false, reason: 'event_aus_bild', event: null, result, text, needsEventFromImage: true };
  }

  return { ok: true, event, result, text };
}

function listEventLabels() {
  return EVENTS.map((event) => event.label);
}

// Unsere Familie, wie sie im Bild stehen kann.
//
// Im Wappen steht "UNKNOWN EROTICA": "Unknown" ist die Familie, "Erotica" die
// Turfleader - das Wappen wurde deswegen geaendert. Beides muss als "wir"
// gelten.
//
// Warum das wichtig ist: liest das Modell nur "Erotica" als Siegerfamilie,
// haette es ohne diese Zeile als FREMDE Familie gegolten. Ein sauberer Sieg
// waere dann als Widerspruch markiert worden - Arbeit fuer nichts, und im
// schlechteren Fall eine Nachfrage bei jemandem, der alles richtig gemacht hat.
const EIGENE_FAMILIE = ['unknown', 'erotica'];

// Was das Bildmodell schreibt, wenn kein Gewinner dasteht.
const OHNE_GEWINNER = ['', 'steht nicht da', 'keins', 'keine', 'keine angabe', 'n/a', '-'];

/**
 * Steht im Bild eine FREMDE Familie als Gewinner?
 *
 * Gibt den Namen zurueck, sonst ''.
 *
 * Nur diese Richtung ist verwertbar, und das hat einen unangenehmen Grund:
 * unsere Familie heisst "Unknown" - dasselbe Wort, das ein Bildmodell auch
 * hinschreibt, wenn es etwas NICHT lesen konnte. "Unknown" als Gewinner kann
 * also "wir haben gewonnen" heissen oder "keine Ahnung".
 *
 * Gemessen an den 82 gelesenen Bildern spricht viel dafuer, dass er es
 * wirklich abliest: alle 13 Bilder mit "Unknown" hatten auch einen echten
 * Eventnamen im Bild, waren also Abschlussbildschirme. Ein Modell, das raet,
 * haette das nicht getroffen. Trotzdem bleibt es ein Wort mit zwei
 * Bedeutungen, und darauf wird kein Geld ausgezahlt.
 *
 * Eine fremde Familie ist dagegen eindeutig: "EL EGNU" schreibt niemand aus
 * Verlegenheit hin.
 */
function fremdeSiegerFamilie(gewinner) {
  const text = normalizeText(gewinner);
  if (OHNE_GEWINNER.includes(text)) return '';
  if (EIGENE_FAMILIE.some((name) => text.includes(name))) return '';
  return String(gewinner || '').trim();
}

// Was im Spiel steht, aber KEIN Nachweis ist.
//
// Steht hier, damit niemand es spaeter "nachtraegt", weil es im Dashboard als
// unbekannte Lesung auftaucht. Jede Zeile ist eine Entscheidung, kein Versehen.
const NICHT_GEZAEHLT = [
  // Kevins Auskunft: ein Event, das nicht ausgezahlt wird.
  //
  // Absichtlich nur "anwerbung von deal" statt der ganzen Phrase: glm-ocr
  // liest das Wortende uneinheitlich - "Dealern", "Dealeren" waren beide in
  // echten Lesungen dabei. Der Anfang der Phrase blieb in allen Messungen
  // gleich.
  { text: 'anwerbung von deal', warum: 'Event, wird bei uns nicht gezaehlt' },
  // Anzeigefehler des Spiels - die Basis ist gar kein Familien-Event.
  { text: 'ueberfall auf die militaerbasis', warum: 'Anzeigefehler im Spiel' },
  // Der Kasten unten rechts, der staendig laeuft.
  { text: 'roulette', warum: 'Werbung im Spiel, kein Event' },
  // Statt des Eventnamens hat er die Wappenzeile gelesen: "UNKNOWN EROTICA"
  // ist unsere Familie, "EL EGNU" die gegnerische. Beides Namen, kein Event.
  { text: 'unknown erotica', warum: 'unser Familienwappen, kein Eventname' },
  { text: 'el egnu', warum: 'Familienname, kein Eventname' },
];

/** Ist das eine bekannte Einblendung, die absichtlich nicht zaehlt? */
function bewusstIgnoriert(gelesen) {
  const text = normalizeText(gelesen);
  if (!text) return null;
  return NICHT_GEZAEHLT.find((e) => text.includes(e.text)) || null;
}

/**
 * Welche Events aus dem Katalog stecken in dem, was das Bildmodell abgelesen hat?
 *
 * Steht bewusst HIER und nicht bei der Bildpruefung, denn diese Zuordnung darf
 * nirgends gespeichert werden - sie muss jedesmal neu aus dem Katalog kommen.
 *
 * Der Grund steht in den Daten: im Bildgedaechtnis lagen drei Bilder, die als
 * "Bizwar" abgelegt waren, weil der Katalog frueher "kampf ums geschaeft"
 * enthielt. Nach Kevins Korrektur war der Katalog richtig, die gespeicherten
 * Zuordnungen aber immer noch falsch. Wer die Zuordnung ablegt, muss sie bei
 * jeder Katalogaenderung von Hand nachziehen - und genau das vergisst man.
 */
// "staatliche angestellte" ist zweideutig - siehe Kommentar beim 40er-Eintrag.
//
// Dort steht es fuer einen Spielbug (der 40er-Kasten zeigt durch einen Fehler
// diesen Text). Seit glm-ocr Text roh abliest statt ihn zu interpretieren,
// taucht dieselbe Phrase aber auch als harmloser Zaehler im UNABHAENGIGEN
// "Anwerbung von Dealern"-Kasten auf ("0 Staatliche Angestellte" = eine von
// zwei Rekruten-Kategorien, kein Bug). qwen3-vl hat diesen Kasten nie
// woertlich mitgelesen, glm-ocr schon - genau deshalb ist das erst jetzt
// aufgefallen, gemessen an Kevins fuenf SK-Bildern vom 17.08. (zwei davon
// zeigten beide Kaesten gleichzeitig und wurden faelschlich als 40er erkannt).
//
// Steht "anwerbung von deal..." auch im Text, gilt "staatliche angestellte"
// NICHT als 40er-Bug-Treffer - dann ist es sicher der harmlose Zaehler.
//
// Absichtlich nur bis "deal" statt der ganzen Phrase - glm-ocr hat "Dealern"
// UND "Dealeren" gelesen, bei genau demselben Bild in zwei Durchgaengen.
// Genau diese Luecke hat einen Fehlalarm verursacht: der erste Test lief mit
// "Dealeren" durch, weil der Vergleich exakt war und nicht griff.
const STAATLICHE_ANGESTELLTE_MEHRDEUTIG = 'staatliche angestellte';
const ANWERBUNG_VON_DEALERN = 'anwerbung von deal';

function levenshtein(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      d[i][j] = a[i - 1] === b[j - 1]
        ? d[i - 1][j - 1]
        : 1 + Math.min(d[i - 1][j], d[i][j - 1], d[i - 1][j - 1]);
    }
  }
  return d[a.length][b.length];
}

// Bestes (kleinstes) Ergebnis ueber ein gleitendes Fenster derselben Laenge
// wie der gesuchte Name - so ist egal, WO im Text die Aehnlichkeit steckt.
function bestesFenster(text, gesucht) {
  const n = gesucht.length;
  if (text.length < n) return levenshtein(text, gesucht) / n;

  let beste = Infinity;
  for (let i = 0; i <= text.length - n; i += 1) {
    const d = levenshtein(text.slice(i, i + n), gesucht);
    if (d < beste) beste = d;
    if (beste === 0) break;
  }
  return beste / n;
}

// Unscharfer Rueckfall, wenn kein Name woertlich vorkommt - glm-ocr verliest
// sich manchmal ("Rassauren" statt "Ressourcen"), obwohl der echte Text ganz
// klar zu erkennen ist. Gemessen (18.08.), bevor das eingebaut wurde:
//
//   echte Verleser liegen bei 5-21% Abweichung vom echten Namen
//   die naechsten zwei VERSCHIEDENEN Events liegen sich bei 32% am naehsten
//
// 20% laesst also echte Verleser durch und bleibt mit Abstand unter jeder
// Verwechslungsgefahr zwischen zwei echten Events.
//
// Kurze Namen sind trotzdem ausgeschlossen: "raid" (famraid) hat nur 4
// Buchstaben - bei einem Prozent-Vergleich reichen dann ein, zwei zufaellig
// aehnliche Zeichen, um IRGENDWO im Text einen Treffer zu erzeugen. Gemessen:
// bei 25% traf "raid" auf JEDEM einzigen Testbild faelschlich zu, sogar auf
// deutlich zu kurzen, voellig unverwandten Textstuecken. Ab zwoelf Buchstaben
// ist ein Prozentwert erst wirklich aussagekraeftig.
const FUZZY_MIN_LAENGE = 12;
const FUZZY_SCHWELLE = 0.20;

function findEventsInImageText(gelesen) {
  const text = normalizeText(gelesen);
  if (!text || text === 'keins') return [];

  const nebenAnwerbung = text.includes(ANWERBUNG_VON_DEALERN);
  const zaehltNicht = (normName) => nebenAnwerbung && normName === STAATLICHE_ANGESTELLTE_MEHRDEUTIG;

  const exakt = EVENTS.filter((event) => (
    event.ingame.some((name) => {
      const normName = normalizeText(name);
      if (zaehltNicht(normName)) return false;
      return text.includes(normName);
    })
  ));
  if (exakt.length) return exakt;

  // Nur wenn ueberhaupt kein Name woertlich passt: unscharf nachsehen. Das
  // hat keinen Einfluss auf den haeufigen Fall (woertlicher Treffer bleibt
  // unveraendert), nur auf Bilder, die sonst leer ausgegangen waeren.
  return EVENTS.filter((event) => (
    event.ingame.some((name) => {
      const normName = normalizeText(name);
      if (normName.length < FUZZY_MIN_LAENGE) return false;
      if (zaehltNicht(normName)) return false;
      return bestesFenster(text, normName) <= FUZZY_SCHWELLE;
    })
  ));
}

module.exports = {
  EVENTS,
  bewusstIgnoriert,
  findEventInText,
  findEventsInImageText,
  findResultInText,
  fremdeSiegerFamilie,
  getEvent,
  listEventLabels,
  parseClaim,
};
